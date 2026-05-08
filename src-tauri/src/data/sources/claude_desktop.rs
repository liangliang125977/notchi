//! Claude Desktop adapter — parses `audit.jsonl` files emitted by the
//! Claude Desktop app's embedded Claude Code agent.
//!
//! Path layout:
//!
//! ```text
//! ~/Library/Application Support/Claude/local-agent-mode-sessions/
//!   <plugin-uuid>/<bucket-uuid>/local_<session-uuid>/
//!     audit.jsonl                                 ← what we ingest
//!     .claude/projects/<encoded-cwd>/*.jsonl      ← non-token rows, skipped
//! ```
//!
//! Schema (reverse-engineered from real audit.jsonl rows; structure
//! only — no captured content):
//!
//! ```text
//! { "type":             "assistant" | "user" | "system" | "result" | …,
//!   "session_id":       "<uuid>",
//!   "uuid":             "<row uuid>",
//!   "_audit_timestamp": "<ISO-8601 UTC>",
//!   "_audit_hmac":      "<hex>",
//!   "message": {
//!     "id":          "msg_…",
//!     "model":       "claude-opus-4-7" | …,
//!     "stop_reason": "end_turn" | …,
//!     "usage": {
//!       "input_tokens":                int,
//!       "output_tokens":               int,
//!       "cache_read_input_tokens":     int,
//!       "cache_creation_input_tokens": int,
//!       …
//!     },
//!     "content": <string | array of blocks>
//!   }
//! }
//! ```
//!
//! Differences from `claude_code` jsonl:
//! - `session_id` (snake_case) instead of `sessionId`.
//! - `_audit_timestamp` instead of `timestamp`.
//! - No `cwd` field — Desktop sessions don't carry project paths.
//! - No `requestId` — we use the row `uuid` as request id surrogate.
//!
//! The embedded `.claude/projects/*.jsonl` files share extension but
//! lack `_audit_timestamp` and don't carry token usage. We require
//! `_audit_timestamp` to be present and skip everything else, so the
//! recursive walker can sweep the whole subtree harmlessly.

use std::path::PathBuf;

use serde::Deserialize;
use tauri::{AppHandle, Runtime};

use super::{DataSourceAdapter, EventKind, ParsedEvent, ParsedUsage};

const SOURCE: &str = "claude-desktop";

pub struct ClaudeDesktopAdapter;

#[derive(Debug, Deserialize)]
struct AuditEnvelope<'a> {
    #[serde(rename = "type")]
    ty: Option<&'a str>,
    #[serde(rename = "_audit_timestamp")]
    audit_timestamp: Option<&'a str>,
    #[serde(rename = "session_id")]
    session_id: Option<&'a str>,
    uuid: Option<&'a str>,
    message: Option<AuditMessage<'a>>,
}

#[derive(Debug, Deserialize)]
struct AuditMessage<'a> {
    #[serde(borrow)]
    id: Option<&'a str>,
    #[serde(borrow)]
    model: Option<&'a str>,
    #[serde(borrow, rename = "stop_reason")]
    stop_reason: Option<&'a str>,
    usage: Option<Usage>,
    content: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct Usage {
    input_tokens: i64,
    output_tokens: i64,
    cache_read_input_tokens: i64,
    cache_creation_input_tokens: i64,
}

fn user_content_is_real_turn(content: Option<&serde_json::Value>) -> bool {
    match content {
        Some(serde_json::Value::String(_)) => true,
        Some(serde_json::Value::Array(arr)) => !arr
            .iter()
            .any(|item| item.get("type").and_then(|t| t.as_str()) == Some("tool_result")),
        _ => true,
    }
}

impl DataSourceAdapter for ClaudeDesktopAdapter {
    fn name(&self) -> &'static str {
        SOURCE
    }

    fn discover_paths<R: Runtime>(&self, _app: &AppHandle<R>) -> Vec<PathBuf> {
        let Some(home) = std::env::var_os("HOME") else {
            return Vec::new();
        };
        let p = PathBuf::from(home)
            .join("Library/Application Support/Claude/local-agent-mode-sessions");
        if p.exists() {
            vec![p]
        } else {
            Vec::new()
        }
    }

    fn parse_line(&self, line: &[u8], default_session: &str) -> Option<ParsedEvent> {
        let env: AuditEnvelope = serde_json::from_slice(line).ok()?;
        // Require audit signature so we silently skip the embedded
        // `.claude/projects/*.jsonl` rows that share extension but
        // carry no token usage.
        env.audit_timestamp?;
        let ty = env.ty?;

        match ty {
            "user" => {
                let content = env.message.as_ref().and_then(|m| m.content.as_ref());
                let kind = if user_content_is_real_turn(content) {
                    EventKind::UserTurn
                } else {
                    EventKind::Other
                };
                Some(ParsedEvent {
                    source: SOURCE,
                    timestamp: env.audit_timestamp.unwrap_or("").to_string(),
                    session_id: env
                        .session_id
                        .map(str::to_owned)
                        .unwrap_or_else(|| default_session.to_string()),
                    project_path: None,
                    model: None,
                    message_id: None,
                    request_id: env.uuid.map(str::to_owned),
                    stop_reason: None,
                    kind,
                    usage: None,
                    is_third_party: false,
                    agent_id: None,
                    parent_session_id: None,
                })
            }
            "assistant" => {
                let msg = env.message?;
                let usage = msg.usage.map(|u| ParsedUsage {
                    input: u.input_tokens,
                    output: u.output_tokens,
                    cache_read: u.cache_read_input_tokens,
                    cache_create: u.cache_creation_input_tokens,
                });
                Some(ParsedEvent {
                    source: SOURCE,
                    timestamp: env.audit_timestamp.unwrap_or("").to_string(),
                    session_id: env
                        .session_id
                        .map(str::to_owned)
                        .unwrap_or_else(|| default_session.to_string()),
                    project_path: None,
                    model: msg.model.map(str::to_owned),
                    message_id: msg.id.map(str::to_owned),
                    request_id: env.uuid.map(str::to_owned),
                    stop_reason: msg.stop_reason.map(str::to_owned),
                    kind: EventKind::Assistant,
                    usage,
                    is_third_party: false,
                    agent_id: None,
                    parent_session_id: None,
                })
            }
            _ => None,
        }
    }
}
