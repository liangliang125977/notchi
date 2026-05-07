//! T2.1 — SQLite schema + sqlx pool.
//!
//! The DB lives at `<app_local_data_dir>/data.db`. We create the file
//! with `SqliteConnectOptions::create_if_missing(true)`, set
//! WAL + NORMAL synchronous (good enough for append-mostly local
//! workloads), and run a single in-line migration. We deliberately do
//! NOT depend on `sqlx::migrate!` macros / files — the schema is small
//! and lives next to the code that owns it.

use std::path::{Path, PathBuf};
use std::str::FromStr;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;
use tauri::Manager;

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    source TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd TEXT NOT NULL DEFAULT '0',
    project_path TEXT,
    session_id TEXT NOT NULL,
    is_third_party INTEGER NOT NULL DEFAULT 0,
    endpoint_id TEXT,
    raw_event_type TEXT,
    message_id TEXT,
    request_id TEXT,
    ingested_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_source_model ON events(source, model);
-- One assistant message can land in multiple jsonl files (subagent
-- mirrors the parent transcript). We dedupe on (message_id, request_id)
-- when both are present; NULLs disable dedupe for that row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_msg_dedupe
    ON events(message_id, request_id)
    WHERE message_id IS NOT NULL AND request_id IS NOT NULL;
-- Per-source message dedup for SQLite-backed sources (no request_id).
-- Uses a partial index so it doesn't collide with JSONL source dedupe logic.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_source_msgid
    ON events(source, message_id)
    WHERE source = 'opencode' AND message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ingest_state (
    jsonl_path TEXT PRIMARY KEY,
    last_byte_offset INTEGER NOT NULL,
    last_modified TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pricing (
    model TEXT NOT NULL,
    endpoint_id TEXT NOT NULL DEFAULT '',
    input_per_mtok TEXT NOT NULL,
    output_per_mtok TEXT NOT NULL,
    cache_read_per_mtok TEXT NOT NULL DEFAULT '0',
    cache_write_per_mtok TEXT NOT NULL DEFAULT '0',
    PRIMARY KEY (model, endpoint_id)
);

CREATE TABLE IF NOT EXISTS parse_errors_today (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parse_errors_at ON parse_errors_today(occurred_at);
"#;

/// Compute the on-disk DB path under the OS app-data dir. The directory
/// is created lazily here because tauri's `app_local_data_dir()` does
/// not guarantee it exists on first run.
pub fn db_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("app_local_data_dir: {e}"))?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir app data: {e}"))?;
    }
    Ok(dir.join("data.db"))
}

/// Path to the parse-error log (S14).
pub fn parse_error_log_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let dir = PathBuf::from(home).join("Library/Logs/Notchi");
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("parse-errors.log"))
}

pub async fn init_pool(db_file: &Path) -> Result<SqlitePool, sqlx::Error> {
    let url = format!("sqlite://{}", db_file.display());
    let opts = SqliteConnectOptions::from_str(&url)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(std::time::Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(opts)
        .await?;

    sqlx::query(SCHEMA_SQL).execute(&pool).await?;
    Ok(pool)
}
