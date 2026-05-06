//! Cursor adapter — STUB.
//!
//! TODO(v1.0 step 2): implement when we can verify Cursor's local
//! conversation log location (suspected: `~/Library/Application
//! Support/Cursor/**` SQLite + jsonl mix). The user's Mac does not
//! have Cursor installed; `discover_paths` returns empty so the
//! orchestrator skips this adapter.

use std::path::PathBuf;

use tauri::{AppHandle, Runtime};

use super::{DataSourceAdapter, ParsedEvent};

pub struct CursorAdapter;

impl DataSourceAdapter for CursorAdapter {
    fn name(&self) -> &'static str {
        "cursor"
    }

    fn discover_paths<R: Runtime>(&self, _app: &AppHandle<R>) -> Vec<PathBuf> {
        // TODO: probe ~/Library/Application Support/Cursor/**. Empty
        // until we have a sample shape to parse.
        Vec::new()
    }

    fn parse_line(&self, _line: &[u8], _default_session: &str) -> Option<ParsedEvent> {
        // TODO: parse Cursor conversation logs.
        None
    }
}
