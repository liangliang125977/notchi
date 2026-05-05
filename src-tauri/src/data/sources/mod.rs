//! v1.0 — multi-source ingest layer.
//!
//! Each AI coding tool has its own jsonl shape. We normalise them
//! through a single [`DataSourceAdapter`] trait so the watcher /
//! tracker / DB schema stay one code path.
//!
//! - [`claude_code`] — the original `~/.claude/projects/**/*.jsonl`
//!   adapter (T2.2). Lifted out of `ingest.rs` verbatim during the
//!   v1.0 refactor.
//! - [`codex`] — `~/.codex/sessions/**/*.jsonl` (Codex CLI). Schema
//!   is documented in `CHANGELOG.md` (2026-05-05 entry).
//! - [`opencode`] / [`cursor`] — stubs reserved for v1.0 step 2.
//!
//! Privacy: adapters MUST NOT log raw user prompts, assistant content,
//! or full filesystem paths. Only `source` / `session_id` / `model`
//! land in stderr; everything else stays in the SQLite events table.

pub mod claude_code;
pub mod codex;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Runtime};

/// Normalised event the ingest pipeline persists / forwards. Every
/// adapter parses its own line shape into this type.
#[derive(Debug, Clone)]
pub struct ParsedEvent {
    /// Stable identifier for this source, e.g. `"claude-code"` or
    /// `"codex"`. Stored verbatim in `events.source`.
    pub source: &'static str,
    /// ISO-8601 UTC. Empty string when the line lacks a timestamp; we
    /// fall back to file mtime in the caller.
    pub timestamp: String,
    /// Per-source session id (uuid for Claude Code, ULID for Codex).
    pub session_id: String,
    pub project_path: Option<String>,
    pub model: Option<String>,
    pub message_id: Option<String>,
    pub request_id: Option<String>,
    pub stop_reason: Option<String>,
    /// Internal classifier — drives session-tracker behaviour.
    pub kind: EventKind,
    pub usage: Option<ParsedUsage>,
    pub is_third_party: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    /// Assistant turn carrying token usage. Persisted to `events`.
    Assistant,
    /// Real user input — feeds the pending-input tracker (R1 reset).
    UserTurn,
    /// Turn-completion signal carrying `stop_reason` but no usage
    /// payload (e.g. Codex `task_complete`). Claude Code piggybacks
    /// stop_reason on its assistant rows so this variant is unused
    /// today; it ships now so the next adapter doesn't have to widen
    /// the trait surface.
    #[allow(dead_code)]
    Completion,
    /// Anything else we want to skip but not error on.
    Other,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedUsage {
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_create: i64,
}

impl ParsedUsage {
    pub fn is_empty(&self) -> bool {
        self.input == 0 && self.output == 0 && self.cache_read == 0 && self.cache_create == 0
    }
    pub fn total(&self) -> i64 {
        self.input + self.output + self.cache_read + self.cache_create
    }
}

/// One AI tool's jsonl format. Implementors stay stateless — all
/// per-session state lives in the shared `SessionTracker`.
pub trait DataSourceAdapter: Send + Sync + 'static {
    /// Stable, lowercase, kebab-case. Used as `events.source` and as
    /// the dedupe key for the watcher set.
    fn name(&self) -> &'static str;

    /// Roots to recursively walk + watch. Empty vec means "tool not
    /// installed on this Mac" and the orchestrator skips us.
    fn discover_paths<R: Runtime>(&self, app: &AppHandle<R>) -> Vec<PathBuf>
    where
        Self: Sized;

    /// Parse one already-newline-trimmed JSONL line. `default_session`
    /// is the file stem fallback for sources that don't repeat the
    /// session id on every line. Returns `None` for lines that aren't
    /// of interest (and `EventKind::Other` for ones we explicitly
    /// recognise but ignore).
    fn parse_line(&self, line: &[u8], default_session: &str) -> Option<ParsedEvent>;
}

/// Object-safe wrapper so the orchestrator can hold a heterogeneous
/// `Vec<Box<dyn DynAdapter>>`. The associated `discover_paths` is
/// generic over `Runtime` which is not object-safe; we pre-resolve
/// paths up front and stash them.
pub struct ResolvedAdapter {
    pub adapter: Arc<dyn ParseAdapter>,
    pub paths: Vec<PathBuf>,
}

/// Object-safe slice of [`DataSourceAdapter`] that only needs the
/// post-discovery hooks.
pub trait ParseAdapter: Send + Sync + 'static {
    fn name(&self) -> &'static str;
    fn parse_line(&self, line: &[u8], default_session: &str) -> Option<ParsedEvent>;
}

impl<T: DataSourceAdapter> ParseAdapter for T {
    fn name(&self) -> &'static str {
        DataSourceAdapter::name(self)
    }
    fn parse_line(&self, line: &[u8], default_session: &str) -> Option<ParsedEvent> {
        DataSourceAdapter::parse_line(self, line, default_session)
    }
}
