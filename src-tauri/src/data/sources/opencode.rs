//! OpenCode adapter — STUB.
//!
//! TODO(v1.0 step 2): implement when we have a sample
//! `~/.opencode/**` jsonl shape to reverse-engineer. The user's Mac
//! does not have OpenCode installed at the time the v1.0 step 1 work
//! ran, so `discover_paths` returns an empty vec and the orchestrator
//! skips us cleanly.

use std::path::PathBuf;

use tauri::{AppHandle, Runtime};

use super::{DataSourceAdapter, ParsedEvent};

pub struct OpenCodeAdapter;

impl DataSourceAdapter for OpenCodeAdapter {
    fn name(&self) -> &'static str {
        "opencode"
    }

    fn discover_paths<R: Runtime>(&self, _app: &AppHandle<R>) -> Vec<PathBuf> {
        // TODO: probe ~/.opencode (or wherever OpenCode lands its log
        // files). Empty until we have real data to test against.
        Vec::new()
    }

    fn parse_line(&self, _line: &[u8], _default_session: &str) -> Option<ParsedEvent> {
        // TODO: parse OpenCode jsonl. Stub returns None so any future
        // erroneous wiring at least doesn't panic.
        None
    }
}
