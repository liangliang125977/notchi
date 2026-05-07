//! OpenCode adapter — SQLite-based sync.
//!
//! OpenCode stores its data in `~/.local/share/opencode/opencode.db`
//! (a SQLite database, not JSONL). This module implements a standalone
//! polling sync rather than the JSONL `DataSourceAdapter` trait, since
//! line-by-line parsing doesn't apply here.
//!
//! Token data lives in the `message` table under the `data` JSON column
//! at `metadata.assistant.tokens.{input,output,cache.{read,write}}`.
//!
//! Cost is always stored as `"0"` per user request — token counts only.

use std::path::PathBuf;
use std::time::Duration;

use chrono::{TimeZone, Utc};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::SqlitePool;
use tauri::Emitter;

const SOURCE: &str = "opencode";

/// Return the path to OpenCode's SQLite database, or `None` if the app
/// is not installed on this machine.
pub fn find_db() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let path = PathBuf::from(home).join(".local/share/opencode/opencode.db");
    if path.exists() { Some(path) } else { None }
}

/// Read the sync watermark (last processed `time_created` in milliseconds).
/// Stored in `ingest_state.last_byte_offset`, keyed by the DB path string.
async fn read_watermark(pool: &SqlitePool, db_key: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT last_byte_offset FROM ingest_state WHERE jsonl_path = ?1",
    )
    .bind(db_key)
    .fetch_optional(pool)
    .await
    .unwrap_or(None)
    .unwrap_or(0)
}

async fn write_watermark(pool: &SqlitePool, db_key: &str, ts: i64) -> Result<(), sqlx::Error> {
    let now_iso = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO ingest_state (jsonl_path, last_byte_offset, last_modified)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(jsonl_path) DO UPDATE SET
            last_byte_offset = excluded.last_byte_offset,
            last_modified = excluded.last_modified",
    )
    .bind(db_key)
    .bind(ts)
    .bind(&now_iso)
    .execute(pool)
    .await?;
    Ok(())
}

/// One sync pass — reads new messages from OpenCode's SQLite DB and
/// inserts them into our events table. Returns the count inserted.
pub async fn sync_once(pool: &SqlitePool, oc_path: &std::path::Path) -> Result<usize, String> {
    let db_key = oc_path.to_string_lossy().to_string();
    let watermark = read_watermark(pool, &db_key).await;

    // Open a read-only connection to OpenCode's database.
    let opts = SqliteConnectOptions::new()
        .filename(oc_path)
        .read_only(true);
    let oc_pool = SqlitePool::connect_with(opts)
        .await
        .map_err(|e| format!("open opencode db: {e}"))?;

    // Pull assistant messages with token data newer than our watermark.
    // json_extract paths follow the OpenCode `data` JSON shape:
    //   { role, metadata: { assistant: { modelID, tokens: { input, output, cache: { read, write } } } } }
    // We filter in SQL to avoid transferring payload-only rows.
    let rows: Vec<(String, String, i64, String, i64, i64, i64, i64, Option<String>)> =
        sqlx::query_as(
            "SELECT
                m.id,
                m.session_id,
                m.time_created,
                COALESCE(json_extract(m.data, '$.metadata.assistant.modelID'), 'unknown'),
                COALESCE(json_extract(m.data, '$.metadata.assistant.tokens.input'), 0),
                COALESCE(json_extract(m.data, '$.metadata.assistant.tokens.output'), 0),
                COALESCE(json_extract(m.data, '$.metadata.assistant.tokens.cache.read'), 0),
                COALESCE(json_extract(m.data, '$.metadata.assistant.tokens.cache.write'), 0),
                s.directory
             FROM message m
             JOIN session s ON m.session_id = s.id
             WHERE json_extract(m.data, '$.role') = 'assistant'
               AND json_extract(m.data, '$.metadata.assistant') IS NOT NULL
               AND m.time_created > ?1
               AND (  COALESCE(json_extract(m.data, '$.metadata.assistant.tokens.input'), 0)
                    + COALESCE(json_extract(m.data, '$.metadata.assistant.tokens.output'), 0)) > 0
             ORDER BY m.time_created ASC",
        )
        .bind(watermark)
        .fetch_all(&oc_pool)
        .await
        .map_err(|e| format!("query opencode messages: {e}"))?;

    oc_pool.close().await;

    if rows.is_empty() {
        return Ok(0);
    }

    let mut max_ts = watermark;
    let mut inserted = 0usize;
    let now_iso = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    for (msg_id, session_id, time_created, model, input, output, cache_read, cache_write, directory) in &rows
    {
        if *input == 0 && *output == 0 && *cache_read == 0 && *cache_write == 0 {
            continue;
        }

        // Convert OpenCode millisecond timestamp to ISO-8601 UTC.
        let timestamp = Utc
            .timestamp_millis_opt(*time_created)
            .single()
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_else(|| now_iso.clone());

        // INSERT OR IGNORE — the partial unique index
        // `idx_events_source_msgid` on (source, message_id) WHERE
        // source = 'opencode' prevents duplicates on restart.
        let res = sqlx::query(
            "INSERT OR IGNORE INTO events (
                timestamp, source, model,
                input_tokens, output_tokens,
                cache_read_input_tokens, cache_creation_input_tokens,
                cost_usd, project_path, session_id, is_third_party,
                endpoint_id, raw_event_type, message_id, request_id, ingested_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,'0',?8,?9,0,NULL,'assistant',?10,NULL,?11)",
        )
        .bind(&timestamp)
        .bind(SOURCE)
        .bind(model)
        .bind(input)
        .bind(output)
        .bind(cache_read)
        .bind(cache_write)
        .bind(directory.as_deref())
        .bind(&session_id)
        .bind(msg_id)
        .bind(&now_iso)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        if res.rows_affected() > 0 {
            inserted += 1;
        }
        if *time_created > max_ts {
            max_ts = *time_created;
        }
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    if max_ts > watermark {
        write_watermark(pool, &db_key, max_ts)
            .await
            .map_err(|e| eprintln!("[opencode] watermark write failed: {e}"))
            .ok();
    }

    Ok(inserted)
}

/// Background task: initial sync + periodic polling every 60 seconds.
/// Spawned by `commands::install` when `find_db()` returns `Some`.
pub async fn run_poller<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    pool: SqlitePool,
    oc_path: PathBuf,
    status: std::sync::Arc<tokio::sync::Mutex<crate::data::IngestStatus>>,
) {
    let db_key = oc_path.to_string_lossy().to_string();

    // Register source entry in status so the UI sees it immediately.
    {
        let mut s = status.lock().await;
        s.sources.push(crate::data::SourceStatus {
            name: SOURCE.to_string(),
            roots: vec![db_key.clone()],
            files_watched: 1,
            events_count: 0,
            last_ingest_at: None,
        });
    }

    let mut ticker = tokio::time::interval(Duration::from_secs(60));

    loop {
        ticker.tick().await;

        match sync_once(&pool, &oc_path).await {
            Ok(n) => {
                let now_iso = Utc::now().to_rfc3339();
                let mut s = status.lock().await;
                if let Some(entry) = s.sources.iter_mut().find(|src| src.name == SOURCE) {
                    entry.last_ingest_at = Some(now_iso.clone());
                    // Recount from DB on each poll so the number stays accurate.
                    let count: i64 = sqlx::query_scalar(
                        "SELECT COUNT(*) FROM events WHERE source = ?1",
                    )
                    .bind(SOURCE)
                    .fetch_one(&pool)
                    .await
                    .unwrap_or(0);
                    entry.events_count = count;
                }
                if n > 0 {
                    eprintln!("[opencode] synced {n} new events");
                    // Notify the pet window that new events arrived.
                    let _ = app.emit("ingest:updated", ());
                }
            }
            Err(e) => {
                eprintln!("[opencode] sync failed: {e}");
            }
        }
    }
}
