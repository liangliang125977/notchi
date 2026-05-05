//! T2 data layer — SQLite-backed token ingestion + query API.
//!
//! Submodule layout mirrors the T2.1–T2.5 task split:
//! - [`db`] — SQLite pool, schema migration, paths.
//! - [`pricing`] — built-in Anthropic price seed (T2.4).
//! - [`ingest`] — jsonl parser + backfill + fsevents watcher (T2.2/T2.3/T2.5).
//! - [`queries`] — read-only summaries used by Tauri commands.
//! - [`commands`] — `#[tauri::command]` exports for the UI (T2.6+).
//!
//! Privacy: nothing in this module is allowed to log raw user prompts,
//! assistant content, or full filesystem paths. Errors stay on stderr
//! with hashed/short identifiers; per-line jsonl parse errors land in
//! `~/Library/Logs/Notchi/parse-errors.log` (S14).

pub mod commands;
pub mod db;
pub mod evolution;
pub mod ingest;
pub mod pricing;
pub mod queries;
pub mod sessions;

use std::sync::Arc;

use sqlx::SqlitePool;
use tokio::sync::{Mutex, Notify};

/// State injected into Tauri so commands can reach the pool, the
/// ingest status, and the watcher kick channel.
pub struct DataState {
    pub pool: SqlitePool,
    pub status: Arc<Mutex<IngestStatus>>,
    pub rescan: Arc<Notify>,
    /// T3.2/T3.3 — per-session liveness for waiting/done detection.
    /// Held only to keep the `Arc` alive for the watcher / poll-loop;
    /// no command currently reads it directly.
    #[allow(dead_code)]
    pub sessions: Arc<sessions::SessionTracker>,
}

#[derive(Default, Debug, Clone, serde::Serialize)]
pub struct IngestStatus {
    pub events_count: i64,
    pub jsonl_files_watched: i64,
    pub last_ingest_at: Option<String>,
    pub errors_today: i64,
    pub claude_code_data_dir: Option<String>,
    pub claude_code_found: bool,
}
