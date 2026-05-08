//! Claude Code jsonl adapter — first source, lifted from the original
//! single-source `ingest.rs`.
//!
//! Schema (reverse-engineered from real `~/.claude/projects/*.jsonl`):
//!
//! ```text
//! { "type": "assistant",
//!   "timestamp": "<ISO-8601 UTC>",
//!   "sessionId": "<uuid>",
//!   "cwd": "<absolute project path>",
//!   "requestId": "<opaque>",
//!   "message": {
//!     "id": "msg_…",
//!     "model": "claude-opus-4-7" | …,
//!     "stop_reason": "end_turn" | "tool_use" | "user_cancelled" | …,
//!     "usage": { "input_tokens": int, "output_tokens": int,
//!                "cache_read_input_tokens": int,
//!                "cache_creation_input_tokens": int, … }
//!   }
//! }
//! ```
//!
//! `type=user` rows are emitted both for real user input (string
//! content) and tool_result echoes (array containing
//! `{type:"tool_result"}`). Only the former is a "user turn".

use std::path::PathBuf;

use serde::Deserialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use super::{DataSourceAdapter, EventKind, ParsedEvent, ParsedUsage};

const SOURCE: &str = "claude-code";
const SETTINGS_STORE: &str = "settings.json";

pub struct ClaudeCodeAdapter;

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

#[derive(Debug, Deserialize)]
struct UserEnvelope<'a> {
    #[serde(rename = "type")]
    ty: Option<&'a str>,
    timestamp: Option<&'a str>,
    #[serde(rename = "sessionId")]
    session_id: Option<&'a str>,
    message: Option<UserMessage>,
}

#[derive(Debug, Deserialize)]
struct UserMessage {
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

fn user_envelope_is_real_turn(env: &UserEnvelope<'_>) -> bool {
    match env.message.as_ref().and_then(|m| m.content.as_ref()) {
        Some(serde_json::Value::String(_)) => true,
        Some(serde_json::Value::Array(arr)) => !arr
            .iter()
            .any(|item| item.get("type").and_then(|t| t.as_str()) == Some("tool_result")),
        _ => true,
    }
}

impl DataSourceAdapter for ClaudeCodeAdapter {
    fn name(&self) -> &'static str {
        SOURCE
    }

    fn discover_paths<R: Runtime>(&self, app: &AppHandle<R>) -> Vec<PathBuf> {
        // SPEC §4 S18 override.
        if let Ok(store) = app.store(SETTINGS_STORE) {
            if let Some(v) = store.get("claudeCodeDataDir") {
                if let Some(s) = v.as_str() {
                    let p = PathBuf::from(s);
                    if p.exists() {
                        return vec![p];
                    }
                }
            }
        }
        let Some(home) = std::env::var_os("HOME") else {
            return Vec::new();
        };
        let default = PathBuf::from(home).join(".claude/projects");
        if default.exists() {
            vec![default]
        } else {
            Vec::new()
        }
    }

    fn parse_line(&self, line: &[u8], default_session: &str) -> Option<ParsedEvent> {
        // Subagent lines have a top-level `agentId`. Detect via untyped peek
        // once and reuse for both user/assistant branches below.
        let agent_id: Option<String> = serde_json::from_slice::<serde_json::Value>(line)
            .ok()
            .and_then(|v| {
                v.get("agentId")
                    .and_then(|a| a.as_str())
                    .map(str::to_owned)
            });

        // Try the user envelope first since it's cheaper; both shapes
        // share the outer `type` field.
        if let Ok(uenv) = serde_json::from_slice::<UserEnvelope>(line) {
            if uenv.ty == Some("user") {
                let kind = if user_envelope_is_real_turn(&uenv) {
                    EventKind::UserTurn
                } else {
                    EventKind::Other
                };
                let parent_session_id = if agent_id.is_some() {
                    uenv.session_id.map(str::to_owned)
                } else {
                    None
                };
                return Some(ParsedEvent {
                    source: SOURCE,
                    timestamp: uenv.timestamp.unwrap_or("").to_string(),
                    session_id: uenv
                        .session_id
                        .map(str::to_owned)
                        .unwrap_or_else(|| default_session.to_string()),
                    project_path: None,
                    model: None,
                    message_id: None,
                    request_id: None,
                    stop_reason: None,
                    kind,
                    usage: None,
                    is_third_party: false,
                    agent_id: agent_id.clone(),
                    parent_session_id,
                });
            }
        }

        let env: AssistantEnvelope = serde_json::from_slice(line).ok()?;
        if env.ty != Some("assistant") {
            return None;
        }
        let msg = env.message?;
        let usage = msg.usage.map(|u| ParsedUsage {
            input: u.input_tokens,
            output: u.output_tokens,
            cache_read: u.cache_read_input_tokens,
            cache_create: u.cache_creation_input_tokens,
        });

        let parent_session_id = if agent_id.is_some() {
            env.session_id.map(str::to_owned)
        } else {
            None
        };
        Some(ParsedEvent {
            source: SOURCE,
            timestamp: env.timestamp.unwrap_or("").to_string(),
            session_id: env
                .session_id
                .map(str::to_owned)
                .unwrap_or_else(|| default_session.to_string()),
            project_path: env.cwd.map(str::to_owned),
            model: msg.model.map(str::to_owned),
            message_id: msg.id.map(str::to_owned),
            request_id: env.request_id.map(str::to_owned),
            stop_reason: msg.stop_reason.map(str::to_owned),
            kind: EventKind::Assistant,
            usage,
            is_third_party: false,
            agent_id,
            parent_session_id,
        })
    }
}
