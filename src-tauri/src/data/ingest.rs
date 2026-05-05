//! T2.2 + T2.3 + T2.5 — jsonl ingestion.
//!
//! ## jsonl schema (reverse-engineered from real `~/.claude/projects/*.jsonl`)
//!
//! Each line is one JSON object with `type` ∈ {assistant, user, system,
//! attachment, queue-operation, last-prompt, ...}. Only `type=assistant`
//! lines carry the `usage` block we want:
//!
//! ```text
//! {
//!   "type": "assistant",
//!   "timestamp": "<ISO-8601 UTC>",
//!   "sessionId": "<uuid>",
//!   "cwd": "<absolute project path>",       // privacy: not logged
//!   "requestId": "<opaque>",                  // dedupe key
//!   "message": {
//!     "id": "msg_…",                          // dedupe key
//!     "model": "claude-opus-4-7" | …,
//!     "usage": {
//!       "input_tokens": int,
//!       "output_tokens": int,
//!       "cache_read_input_tokens": int,
//!       "cache_creation_input_tokens": int,
//!       …  // service_tier / inference_geo / iterations / speed / server_tool_use
//!     }
//!   }
//! }
//! ```
//!
//! The `cwd` field is the original project root. The directory name
//! itself (e.g. `-Users-leon-Documents-code-foo`) is the dash-encoded
//! variant. We persist `cwd` only as `project_path` in SQLite — never
//! to logs.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rust_decimal::Decimal;
use serde::Deserialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::{mpsc, Mutex, Notify};
use walkdir::WalkDir;

use super::pricing::{self, Pricing};
use super::sessions::{CompletionEvent, SessionTracker};
use super::{db, IngestStatus};

pub const TASK_COMPLETED_EVENT: &str = "pet:task-completed";
pub const PENDING_INPUT_EVENT: &str = "pet:pending-input";

const SOURCE_CLAUDE_CODE: &str = "claude-code";
/// Cap retro-scan to recent 30 days per SPEC §5.7 (S13).
const BACKFILL_DAYS: i64 = 30;

#[derive(Debug, Deserialize)]
struct AssistantEnvelope<'a> {
    #[serde(rename = "type")]
    ty: Option<&'a str>,
    timestamp: Option<&'a str>,
    #[serde(rename = "sessionId")]
    session_id: Option<&'a str>,
    cwd: Option<&'a str>,
    #[serde(rename = "requestId")]
    request_id: Option<&'a str>,
    message: Option<AssistantMessage<'a>>,
}

#[derive(Debug, Deserialize)]
struct AssistantMessage<'a> {
    #[serde(borrow)]
    id: Option<&'a str>,
    #[serde(borrow)]
    model: Option<&'a str>,
    #[serde(borrow, rename = "stop_reason")]
    stop_reason: Option<&'a str>,
    usage: Option<Usage>,
}

/// Lighter-weight envelope for the session-tracker pass on user rows
/// (assistant rows go through the typed parse that captures usage too).
#[derive(Debug, Deserialize)]
struct UserEnvelope<'a> {
    #[serde(rename = "type")]
    ty: Option<&'a str>,
    timestamp: Option<&'a str>,
    #[serde(rename = "sessionId")]
    session_id: Option<&'a str>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct Usage {
    input_tokens: i64,
    output_tokens: i64,
    cache_read_input_tokens: i64,
    cache_creation_input_tokens: i64,
}

/// Discover the Claude Code data dir. SPEC §4 S18: when the default
/// `~/.claude/projects` does not exist, the user can override via the
/// settings store.
pub fn resolve_data_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store("settings.json") {
        if let Some(v) = store.get("claudeCodeDataDir") {
            if let Some(s) = v.as_str() {
                let p = PathBuf::from(s);
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }
    let home = std::env::var_os("HOME")?;
    let default = PathBuf::from(home).join(".claude/projects");
    if default.exists() {
        Some(default)
    } else {
        None
    }
}

/// Result of one parse pass over a single jsonl file.
#[derive(Default, Debug)]
struct ParsePass {
    inserted: usize,
    parse_errors: usize,
    completed: Vec<CompletionEvent>,
}

/// Parse jsonl bytes starting at `start_offset` and insert assistant
/// usage rows. Returns the number of bytes consumed since the file
/// start (i.e. the new resume point).
async fn ingest_file(
    pool: &SqlitePool,
    path: &Path,
    start_offset: u64,
    tracker: Option<&SessionTracker>,
) -> Result<ParsePass, std::io::Error> {
    let bytes = tokio::fs::read(path).await?;
    if (start_offset as usize) >= bytes.len() {
        return Ok(ParsePass::default());
    }
    // Resume at start_offset, but cut off at the last newline so we
    // don't try to parse a half-flushed record. Anything past the last
    // \n is left for the next pass.
    let slice = &bytes[start_offset as usize..];
    let last_nl = slice.iter().rposition(|b| *b == b'\n');
    let (consumable, consumed) = match last_nl {
        Some(idx) => (&slice[..=idx], idx + 1),
        None => return Ok(ParsePass::default()),
    };
    let new_offset = start_offset + consumed as u64;

    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    let mut tx = pool.begin().await.map_err(io_other)?;
    let mut inserted = 0usize;
    let mut parse_errors = 0usize;
    let mut completed: Vec<CompletionEvent> = Vec::new();
    let now_iso = Utc::now().to_rfc3339();

    // Cache pricing per model to avoid round-tripping on every line.
    let mut pricing_cache: std::collections::HashMap<String, Pricing> =
        std::collections::HashMap::new();

    for line in consumable.split(|b| *b == b'\n') {
        if line.is_empty() {
            continue;
        }

        // T3.2 — feed the session tracker on user lines only. Assistant
        // lines go through the typed parse below so we record token
        // counts at the same time.
        if let Some(tr) = tracker {
            if let Ok(live) = serde_json::from_slice::<UserEnvelope>(line) {
                if live.ty == Some("user") {
                    let ts = live.timestamp.and_then(parse_iso);
                    let sid_for_live = live.session_id.unwrap_or(&session_id);
                    tr.observe_user(sid_for_live, ts);
                }
            }
        }

        let env: AssistantEnvelope = match serde_json::from_slice(line) {
            Ok(v) => v,
            Err(_) => {
                parse_errors += 1;
                continue;
            }
        };
        if env.ty != Some("assistant") {
            continue;
        }
        let Some(msg) = env.message else { continue };
        let assistant_ts = env.timestamp.and_then(parse_iso);
        let assistant_sid = env.session_id.unwrap_or(&session_id);

        // Notify tracker even for fragments without usage (so stop_reason
        // is recorded). For fragments without a stop_reason this is a
        // cheap last_assistant_at touch which the tracker uses to
        // measure idle time.
        let usage_tokens = msg
            .usage
            .as_ref()
            .map(|u| {
                u.input_tokens
                    + u.output_tokens
                    + u.cache_read_input_tokens
                    + u.cache_creation_input_tokens
            })
            .unwrap_or(0);
        if let Some(tr) = tracker {
            let res = tr.observe_assistant(
                assistant_sid,
                assistant_ts,
                msg.model,
                msg.stop_reason,
                usage_tokens,
            );
            if let Some(c) = res.completed {
                completed.push(c);
            }
        }

        let Some(usage) = msg.usage else { continue };
        let model = msg.model.unwrap_or("unknown").to_string();
        // Skip rows that look entirely empty (no tokens at all).
        if usage.input_tokens == 0
            && usage.output_tokens == 0
            && usage.cache_read_input_tokens == 0
            && usage.cache_creation_input_tokens == 0
        {
            continue;
        }
        let timestamp = env.timestamp.unwrap_or("").to_string();
        let session = env.session_id.unwrap_or(&session_id).to_string();
        let project_path = env.cwd.map(|s| s.to_string());
        let request_id = env.request_id.map(|s| s.to_string());
        let message_id = msg.id.map(|s| s.to_string());

        let p = if let Some(p) = pricing_cache.get(&model) {
            p.clone()
        } else {
            let p = pricing::lookup(pool, &model, "").await;
            pricing_cache.insert(model.clone(), p.clone());
            p
        };
        let cost = pricing::cost_for_turn(
            &p,
            usage.input_tokens,
            usage.output_tokens,
            usage.cache_read_input_tokens,
            usage.cache_creation_input_tokens,
        );
        let cost_str = decimal_to_text(cost);

        // INSERT OR IGNORE leverages the partial unique index on
        // (message_id, request_id) for dedupe across subagent mirrors.
        let res = sqlx::query(
            "INSERT OR IGNORE INTO events (
                timestamp, source, model, input_tokens, output_tokens,
                cache_read_input_tokens, cache_creation_input_tokens,
                cost_usd, project_path, session_id, is_third_party,
                endpoint_id, raw_event_type, message_id, request_id, ingested_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,0,NULL,?11,?12,?13,?14)",
        )
        .bind(&timestamp)
        .bind(SOURCE_CLAUDE_CODE)
        .bind(&model)
        .bind(usage.input_tokens)
        .bind(usage.output_tokens)
        .bind(usage.cache_read_input_tokens)
        .bind(usage.cache_creation_input_tokens)
        .bind(&cost_str)
        .bind(project_path.as_deref())
        .bind(&session)
        .bind("assistant")
        .bind(message_id.as_deref())
        .bind(request_id.as_deref())
        .bind(&now_iso)
        .execute(&mut *tx)
        .await
        .map_err(io_other)?;
        if res.rows_affected() > 0 {
            inserted += 1;
        }
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
        // S14: bump per-day error counter for the dev panel and the log.
        sqlx::query("INSERT INTO parse_errors_today (occurred_at) VALUES (?1)")
            .bind(&now_iso)
            .execute(&mut *tx)
            .await
            .map_err(io_other)?;
        log_parse_error(parse_errors);
    }

    tx.commit().await.map_err(io_other)?;
    let _ = new_offset; // already persisted in ingest_state row above
    Ok(ParsePass { inserted, parse_errors, completed })
}

fn parse_iso(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

/// T3.2 — periodic poll over the session tracker. Fires
/// `pet:pending-input` events when a session has been quiet long
/// enough to cross a 30/60/180-second bracket. Runs forever; cancelled
/// only when the Tauri app exits.
pub async fn run_pending_input_loop<R: Runtime>(
    app: AppHandle<R>,
    tracker: Arc<SessionTracker>,
) {
    let mut ticker = tokio::time::interval(Duration::from_secs(10));
    ticker.tick().await; // discard the immediate tick
    loop {
        ticker.tick().await;
        let now = Utc::now();
        // Drain whichever bracket fires first, then loop back through
        // the rest on the next tick. 10s cadence means at most ~10s of
        // latency past the bracket, which is well under the bubble
        // budget.
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
    // Round to 6dp so we don't accumulate noise; UI re-rounds for L2.
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

/// T2.3 — cold-start scan over recent jsonl files.
pub async fn backfill(
    pool: SqlitePool,
    data_dir: PathBuf,
    status: Arc<Mutex<IngestStatus>>,
) -> Result<(), std::io::Error> {
    let started = std::time::Instant::now();
    let cutoff = Utc::now() - chrono::Duration::days(BACKFILL_DAYS);

    let mut files = Vec::new();
    for entry in WalkDir::new(&data_dir).follow_links(false).into_iter().flatten() {
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
    let total_files = files.len();

    let mut total_events = 0usize;
    let mut total_errors = 0usize;
    for path in &files {
        let off = last_offset(&pool, path).await;
        // Backfill intentionally does not feed the tracker — we don't
        // want bubbles + notifications for events that happened days
        // ago.
        match ingest_file(&pool, path, off, None).await {
            Ok(p) => {
                total_events += p.inserted;
                total_errors += p.parse_errors;
            }
            Err(e) => {
                eprintln!("[ingest] read error on jsonl: {e}");
            }
        }
    }

    {
        let mut s = status.lock().await;
        s.events_count = scalar_count(&pool, "SELECT COUNT(*) FROM events").await;
        s.jsonl_files_watched = total_files as i64;
        s.last_ingest_at = Some(Utc::now().to_rfc3339());
        s.errors_today = scalar_count(
            &pool,
            "SELECT COUNT(*) FROM parse_errors_today \
             WHERE occurred_at >= datetime('now','start of day')",
        )
        .await;
    }

    eprintln!(
        "[ingest] backfilled {} events from {} files in {}ms (errors: {})",
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

/// T2.2 — fsevents-backed watcher. We forward all FS events to a
/// tokio mpsc, debounce ~750ms, and rescan modified files. Watcher
/// also wakes on `rescan` Notify (manual override / dev-mode reload).
///
/// T3.2/T3.3 — `tracker` accumulates per-session liveness so the
/// emotion engine can fire R1/R2 bubbles + native notifications.
/// `app` is the Tauri handle used to `emit` `pet:task-completed` and
/// `pet:pending-input`.
pub async fn run_watcher<R: Runtime>(
    app: AppHandle<R>,
    pool: SqlitePool,
    data_dir: PathBuf,
    status: Arc<Mutex<IngestStatus>>,
    rescan: Arc<Notify>,
    tracker: Arc<SessionTracker>,
) -> Result<(), notify::Error> {
    let (tx, mut rx) = mpsc::unbounded_channel::<PathBuf>();
    let tx_for_notify = tx.clone();
    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            let Ok(ev) = res else { return };
            if !matches!(
                ev.kind,
                EventKind::Modify(_) | EventKind::Create(_)
            ) {
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
    watcher.watch(&data_dir, RecursiveMode::Recursive)?;
    eprintln!("[ingest] fsevents watcher attached");

    let mut pending: std::collections::HashSet<PathBuf> = Default::default();
    let mut deadline: Option<tokio::time::Instant> = None;

    loop {
        // Timer that fires when debounce window elapses.
        let sleep = match deadline {
            Some(d) => tokio::time::sleep_until(d),
            None => tokio::time::sleep(Duration::from_secs(60 * 60)),
        };
        tokio::pin!(sleep);

        tokio::select! {
            biased;
            _ = rescan.notified() => {
                // Forced rescan — re-walk all jsonl files (e.g. user
                // pointed at a new data dir via S18 override).
                if let Err(e) = backfill(pool.clone(), data_dir.clone(), status.clone()).await {
                    eprintln!("[ingest] rescan failed: {e}");
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
                    match ingest_file(&pool, path, off, Some(tracker.as_ref())).await {
                        Ok(mut p) => {
                            inserted += p.inserted;
                            completed.append(&mut p.completed);
                        }
                        Err(e) => eprintln!("[ingest] tail err: {e}"),
                    }
                }
                for ev in &completed {
                    if let Err(e) = app.emit(TASK_COMPLETED_EVENT, ev) {
                        eprintln!("[ingest] failed to emit completion event: {e}");
                    }
                }
                if !batch.is_empty() {
                    let count = scalar_count(&pool, "SELECT COUNT(*) FROM events").await;
                    let mut s = status.lock().await;
                    s.events_count = count;
                    s.last_ingest_at = Some(Utc::now().to_rfc3339());
                    s.errors_today = scalar_count(
                        &pool,
                        "SELECT COUNT(*) FROM parse_errors_today \
                         WHERE occurred_at >= datetime('now','start of day')",
                    )
                    .await;
                    if inserted > 0 {
                        eprintln!(
                            "[ingest] tail-appended {} events from {} file(s)",
                            inserted,
                            batch.len()
                        );
                    }
                }
            }
        }
    }
}
