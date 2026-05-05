//! Multi-source jsonl ingestion (T2.2 / T2.3 / T2.5 + v1.0).
//!
//! The original Claude-Code-only ingest code lifted out into
//! [`super::sources::claude_code`]. This module now orchestrates one
//! adapter at a time through the same backfill + fsevents watcher
//! pipeline; the v1.0 `install_all_sources` helper spawns one watcher
//! per registered source.
//!
//! Per-source SPEC bits:
//! - SPEC §5.7 / S13: 30-day cold-start backfill, then incremental tail.
//! - SPEC §4 S14: malformed lines skipped, counted, logged.
//! - Privacy (SPEC §4 S12 / CLAUDE.md): nothing here logs raw user
//!   prompts, assistant text, or full filesystem paths.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rust_decimal::Decimal;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::{mpsc, Mutex, Notify};
use walkdir::WalkDir;

use super::pricing::{self, Pricing};
use super::sessions::{CompletionEvent, SessionTracker};
use super::sources::{
    self, claude_code::ClaudeCodeAdapter, DataSourceAdapter, EventKind as ParsedKind,
    ParseAdapter, ParsedEvent,
};
use super::{db, IngestStatus, SourceStatus};

pub const TASK_COMPLETED_EVENT: &str = "pet:task-completed";
pub const PENDING_INPUT_EVENT: &str = "pet:pending-input";

/// Cap retro-scan to recent 30 days per SPEC §5.7 (S13).
const BACKFILL_DAYS: i64 = 30;

/// Resolve every adapter's discover_paths up front. Adapters whose
/// roots don't exist on this Mac return an empty vec and we skip them
/// from the watcher set.
pub fn resolve_sources<R: Runtime>(app: &AppHandle<R>) -> Vec<sources::ResolvedAdapter> {
    let mut out = Vec::new();
    let claude = ClaudeCodeAdapter;
    let claude_paths = claude.discover_paths(app);
    if !claude_paths.is_empty() {
        out.push(sources::ResolvedAdapter {
            adapter: Arc::new(claude),
            paths: claude_paths,
        });
    }
    out
}


/// Result of one parse pass over a single jsonl file.
#[derive(Default, Debug)]
struct ParsePass {
    inserted: usize,
    parse_errors: usize,
    completed: Vec<CompletionEvent>,
}

async fn ingest_file(
    pool: &SqlitePool,
    adapter: &dyn ParseAdapter,
    path: &Path,
    start_offset: u64,
    tracker: Option<&SessionTracker>,
) -> Result<ParsePass, std::io::Error> {
    let bytes = tokio::fs::read(path).await?;
    if (start_offset as usize) >= bytes.len() {
        return Ok(ParsePass::default());
    }
    let slice = &bytes[start_offset as usize..];
    let last_nl = slice.iter().rposition(|b| *b == b'\n');
    let (consumable, consumed) = match last_nl {
        Some(idx) => (&slice[..=idx], idx + 1),
        None => return Ok(ParsePass::default()),
    };
    let new_offset = start_offset + consumed as u64;

    let default_session = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    let mut tx = pool.begin().await.map_err(io_other)?;
    let mut inserted = 0usize;
    let mut parse_errors = 0usize;
    let mut completed: Vec<CompletionEvent> = Vec::new();
    let now_iso = Utc::now().to_rfc3339();
    let source_name = adapter.name();

    let mut pricing_cache: std::collections::HashMap<String, Pricing> =
        std::collections::HashMap::new();

    for line in consumable.split(|b| *b == b'\n') {
        if line.is_empty() {
            continue;
        }

        let Some(parsed) = adapter.parse_line(line, &default_session) else {
            // Adapter actively rejected — count as a parse error only
            // if the line is non-empty JSON we couldn't classify.
            if serde_json::from_slice::<serde_json::Value>(line).is_err() {
                parse_errors += 1;
            }
            continue;
        };

        let ts = parse_iso(&parsed.timestamp);
        let session_id = parsed.session_id.as_str();

        match parsed.kind {
            ParsedKind::UserTurn => {
                if let Some(tr) = tracker {
                    tr.observe_user(source_name, session_id, ts);
                }
                continue;
            }
            ParsedKind::Other => continue,
            ParsedKind::Completion => {
                if let Some(tr) = tracker {
                    let res = tr.observe_assistant(
                        source_name,
                        session_id,
                        ts,
                        parsed.model.as_deref(),
                        parsed.stop_reason.as_deref(),
                        0,
                    );
                    if let Some(c) = res.completed {
                        completed.push(c);
                    }
                }
                continue;
            }
            ParsedKind::Assistant => {
                let usage_total = parsed.usage.as_ref().map(|u| u.total()).unwrap_or(0);
                if let Some(tr) = tracker {
                    let res = tr.observe_assistant(
                        source_name,
                        session_id,
                        ts,
                        parsed.model.as_deref(),
                        parsed.stop_reason.as_deref(),
                        usage_total,
                    );
                    if let Some(c) = res.completed {
                        completed.push(c);
                    }
                }
            }
        }

        let Some(ref usage) = parsed.usage else { continue };
        if usage.is_empty() {
            continue;
        }

        persist_event(
            &mut tx,
            &parsed,
            usage,
            &mut pricing_cache,
            pool,
            &now_iso,
        )
        .await?;
        inserted += 1;
    }

    let mtime_iso = path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .map(|t| DateTime::<Utc>::from(t).to_rfc3339())
        .unwrap_or_else(|| now_iso.clone());

    sqlx::query(
        "INSERT INTO ingest_state (jsonl_path, last_byte_offset, last_modified)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(jsonl_path) DO UPDATE SET
            last_byte_offset = excluded.last_byte_offset,
            last_modified = excluded.last_modified",
    )
    .bind(path.to_string_lossy().as_ref())
    .bind(new_offset as i64)
    .bind(&mtime_iso)
    .execute(&mut *tx)
    .await
    .map_err(io_other)?;

    if parse_errors > 0 {
        sqlx::query("INSERT INTO parse_errors_today (occurred_at) VALUES (?1)")
            .bind(&now_iso)
            .execute(&mut *tx)
            .await
            .map_err(io_other)?;
        log_parse_error(parse_errors);
    }

    tx.commit().await.map_err(io_other)?;
    Ok(ParsePass {
        inserted,
        parse_errors,
        completed,
    })
}

async fn persist_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    parsed: &ParsedEvent,
    usage: &sources::ParsedUsage,
    pricing_cache: &mut std::collections::HashMap<String, Pricing>,
    pool: &SqlitePool,
    now_iso: &str,
) -> Result<(), std::io::Error> {
    let model = parsed.model.clone().unwrap_or_else(|| "unknown".to_string());
    let p = if let Some(p) = pricing_cache.get(&model) {
        p.clone()
    } else {
        let p = pricing::lookup(pool, &model, "").await;
        pricing_cache.insert(model.clone(), p.clone());
        p
    };
    let cost = pricing::cost_for_turn(
        &p,
        usage.input,
        usage.output,
        usage.cache_read,
        usage.cache_create,
    );
    let cost_str = decimal_to_text(cost);

    sqlx::query(
        "INSERT OR IGNORE INTO events (
            timestamp, source, model, input_tokens, output_tokens,
            cache_read_input_tokens, cache_creation_input_tokens,
            cost_usd, project_path, session_id, is_third_party,
            endpoint_id, raw_event_type, message_id, request_id, ingested_at
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,NULL,?12,?13,?14,?15)",
    )
    .bind(&parsed.timestamp)
    .bind(parsed.source)
    .bind(&model)
    .bind(usage.input)
    .bind(usage.output)
    .bind(usage.cache_read)
    .bind(usage.cache_create)
    .bind(&cost_str)
    .bind(parsed.project_path.as_deref())
    .bind(&parsed.session_id)
    .bind(if parsed.is_third_party { 1 } else { 0 })
    .bind("assistant")
    .bind(parsed.message_id.as_deref())
    .bind(parsed.request_id.as_deref())
    .bind(now_iso)
    .execute(&mut **tx)
    .await
    .map_err(io_other)?;
    Ok(())
}

fn parse_iso(s: &str) -> Option<DateTime<Utc>> {
    if s.is_empty() {
        return None;
    }
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

/// T3.2 — periodic poll over the session tracker. Fires
/// `pet:pending-input` events when a session has been quiet long
/// enough to cross a 30/60/180-second bracket.
pub async fn run_pending_input_loop<R: Runtime>(
    app: AppHandle<R>,
    tracker: Arc<SessionTracker>,
) {
    let mut ticker = tokio::time::interval(Duration::from_secs(10));
    ticker.tick().await;
    loop {
        ticker.tick().await;
        let now = Utc::now();
        while let Some(ev) = tracker.poll_pending_input(now) {
            if let Err(e) = app.emit(PENDING_INPUT_EVENT, &ev) {
                eprintln!("[ingest] failed to emit pending-input event: {e}");
                break;
            }
        }
    }
}

fn io_other<E: std::fmt::Display>(e: E) -> std::io::Error {
    std::io::Error::other(e.to_string())
}

fn decimal_to_text(d: Decimal) -> String {
    d.round_dp(6).normalize().to_string()
}

fn log_parse_error(n: usize) {
    let Some(path) = db::parse_error_log_path() else { return };
    let line = format!(
        "{}\t{} parse error(s) (lines skipped)\n",
        Utc::now().to_rfc3339(),
        n
    );
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
}

async fn last_offset(pool: &SqlitePool, path: &Path) -> u64 {
    let row: Option<(i64,)> =
        sqlx::query_as("SELECT last_byte_offset FROM ingest_state WHERE jsonl_path = ?1")
            .bind(path.to_string_lossy().as_ref())
            .fetch_optional(pool)
            .await
            .unwrap_or(None);
    row.map(|(v,)| v as u64).unwrap_or(0)
}

/// Cold-start scan over recent jsonl files for one source's roots.
pub async fn backfill_source(
    pool: SqlitePool,
    adapter: Arc<dyn ParseAdapter>,
    roots: Vec<PathBuf>,
    status: Arc<Mutex<IngestStatus>>,
) -> Result<(), std::io::Error> {
    let started = std::time::Instant::now();
    let cutoff = Utc::now() - chrono::Duration::days(BACKFILL_DAYS);

    let mut files = Vec::new();
    for root in &roots {
        for entry in WalkDir::new(root).follow_links(false).into_iter().flatten() {
            if !entry.file_type().is_file() {
                continue;
            }
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let mtime = p
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .map(DateTime::<Utc>::from);
            if let Some(t) = mtime {
                if t < cutoff {
                    continue;
                }
            }
            files.push(p.to_path_buf());
        }
    }
    let total_files = files.len();

    let mut total_events = 0usize;
    let mut total_errors = 0usize;
    for path in &files {
        let off = last_offset(&pool, path).await;
        match ingest_file(&pool, adapter.as_ref(), path, off, None).await {
            Ok(p) => {
                total_events += p.inserted;
                total_errors += p.parse_errors;
            }
            Err(e) => {
                eprintln!("[ingest:{}] read error on jsonl: {e}", adapter.name());
            }
        }
    }

    let now_iso = Utc::now().to_rfc3339();
    {
        let mut s = status.lock().await;
        s.events_count = scalar_count(&pool, "SELECT COUNT(*) FROM events").await;
        s.jsonl_files_watched = scalar_count(&pool, "SELECT COUNT(*) FROM ingest_state").await;
        s.last_ingest_at = Some(now_iso.clone());
        s.errors_today = scalar_count(
            &pool,
            "SELECT COUNT(*) FROM parse_errors_today \
             WHERE occurred_at >= datetime('now','start of day')",
        )
        .await;
        let entry = s
            .sources
            .iter_mut()
            .find(|src| src.name == adapter.name());
        if let Some(entry) = entry {
            entry.files_watched = total_files as i64;
            entry.last_ingest_at = Some(now_iso);
            entry.events_count = scalar_count_for_source(&pool, adapter.name()).await;
        }
    }

    eprintln!(
        "[ingest:{}] backfilled {} events from {} files in {}ms (errors: {})",
        adapter.name(),
        total_events,
        total_files,
        started.elapsed().as_millis(),
        total_errors,
    );
    Ok(())
}

async fn scalar_count(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(sql)
        .fetch_one(pool)
        .await
        .unwrap_or(0)
}

async fn scalar_count_for_source(pool: &SqlitePool, source: &str) -> i64 {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM events WHERE source = ?1")
        .bind(source)
        .fetch_one(pool)
        .await
        .unwrap_or(0)
}

/// Per-source watcher — one fsevents subscription per root.
pub async fn run_watcher_source<R: Runtime>(
    app: AppHandle<R>,
    pool: SqlitePool,
    adapter: Arc<dyn ParseAdapter>,
    roots: Vec<PathBuf>,
    status: Arc<Mutex<IngestStatus>>,
    rescan: Arc<Notify>,
    tracker: Arc<SessionTracker>,
) -> Result<(), notify::Error> {
    let (tx, mut rx) = mpsc::unbounded_channel::<PathBuf>();
    let tx_for_notify = tx.clone();
    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            let Ok(ev) = res else { return };
            if !matches!(ev.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                return;
            }
            for p in ev.paths {
                if p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                    let _ = tx_for_notify.send(p);
                }
            }
        },
        Config::default().with_poll_interval(Duration::from_secs(2)),
    )?;
    for root in &roots {
        watcher.watch(root, RecursiveMode::Recursive)?;
    }
    eprintln!(
        "[ingest:{}] fsevents watcher attached to {} root(s)",
        adapter.name(),
        roots.len()
    );

    let mut pending: std::collections::HashSet<PathBuf> = Default::default();
    let mut deadline: Option<tokio::time::Instant> = None;

    loop {
        let sleep = match deadline {
            Some(d) => tokio::time::sleep_until(d),
            None => tokio::time::sleep(Duration::from_secs(60 * 60)),
        };
        tokio::pin!(sleep);

        tokio::select! {
            biased;
            _ = rescan.notified() => {
                if let Err(e) = backfill_source(
                    pool.clone(),
                    adapter.clone(),
                    roots.clone(),
                    status.clone(),
                ).await {
                    eprintln!("[ingest:{}] rescan failed: {e}", adapter.name());
                }
            }
            Some(p) = rx.recv() => {
                pending.insert(p);
                deadline = Some(tokio::time::Instant::now() + Duration::from_millis(750));
            }
            _ = &mut sleep, if deadline.is_some() => {
                let batch: Vec<_> = pending.drain().collect();
                deadline = None;
                let mut inserted = 0usize;
                let mut completed: Vec<CompletionEvent> = Vec::new();
                for path in &batch {
                    let off = last_offset(&pool, path).await;
                    match ingest_file(&pool, adapter.as_ref(), path, off, Some(tracker.as_ref())).await {
                        Ok(mut p) => {
                            inserted += p.inserted;
                            completed.append(&mut p.completed);
                        }
                        Err(e) => eprintln!("[ingest:{}] tail err: {e}", adapter.name()),
                    }
                }
                for ev in &completed {
                    if let Err(e) = app.emit(TASK_COMPLETED_EVENT, ev) {
                        eprintln!("[ingest:{}] failed to emit completion event: {e}", adapter.name());
                    }
                }
                if !batch.is_empty() {
                    let count = scalar_count(&pool, "SELECT COUNT(*) FROM events").await;
                    let now_iso = Utc::now().to_rfc3339();
                    let mut s = status.lock().await;
                    s.events_count = count;
                    s.last_ingest_at = Some(now_iso.clone());
                    s.errors_today = scalar_count(
                        &pool,
                        "SELECT COUNT(*) FROM parse_errors_today \
                         WHERE occurred_at >= datetime('now','start of day')",
                    )
                    .await;
                    if let Some(entry) = s.sources.iter_mut().find(|src| src.name == adapter.name()) {
                        entry.last_ingest_at = Some(now_iso);
                        entry.events_count =
                            scalar_count_for_source(&pool, adapter.name()).await;
                    }
                    drop(s);
                    if inserted > 0 {
                        eprintln!(
                            "[ingest:{}] tail-appended {} events from {} file(s)",
                            adapter.name(),
                            inserted,
                            batch.len()
                        );
                    }
                }
            }
        }
    }
}

/// Build the initial per-source status rows so the UI sees registered
/// sources even before backfill completes.
pub fn make_initial_source_status(
    sources: &[sources::ResolvedAdapter],
) -> Vec<SourceStatus> {
    sources
        .iter()
        .map(|r| SourceStatus {
            name: r.adapter.name().to_string(),
            roots: r.paths.iter().map(|p| p.to_string_lossy().to_string()).collect(),
            files_watched: 0,
            events_count: 0,
            last_ingest_at: None,
        })
        .collect()
}
