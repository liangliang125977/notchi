//! Codex CLI jsonl adapter — `~/.codex/sessions/**/rollout-*.jsonl`.
//!
//! Schema is documented in `CHANGELOG.md` (entry "Codex jsonl schema
//! reverse-engineered"). Summary:
//!
//! - Each file is one CLI rollout. First line is `type: "session_meta"`
//!   carrying the session id and cwd. Subsequent lines carry
//!   `type: "turn_context"` (per-turn model / approval policy /
//!   sandbox) or `type: "event_msg"` (typed CLI events) or
//!   `type: "response_item"` (model response fragments).
//! - Token usage rides on `event_msg.payload.type == "token_count"`,
//!   under `info.last_token_usage` (per-turn delta, NOT cumulative —
//!   the sibling `total_token_usage` is the running total and would
//!   double-count if summed).
//! - User input is `event_msg.payload.type == "user_message"`.
//! - Turn completion is `event_msg.payload.type == "task_complete"`.
//!
//! Model id normalisation: Codex emits raw OpenAI ids
//! (`gpt-5`, `gpt-5-mini`, `o3`, `o4-mini`, …) on `turn_context.model`.
//! We persist them verbatim — the pricing seed in `pricing.rs` matches
//! the same string. When Codex is configured to drive a non-OpenAI
//! provider (e.g. Claude), `session_meta.model_provider` indicates
//! that and pricing falls through to the existing Anthropic seed by
//! exact model match.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::{AppHandle, Runtime};

use super::{DataSourceAdapter, EventKind, ParsedEvent, ParsedUsage};

const SOURCE: &str = "codex";

pub struct CodexAdapter {
    /// Per-file scratchpad: track the last `turn_context.model` so we
    /// can stamp it onto subsequent `token_count` events (which carry
    /// no model field of their own). Keyed by `default_session` since
    /// the orchestrator passes the file's session hint on every line.
    last_model: Mutex<std::collections::HashMap<String, String>>,
    /// Project path from the most recent `session_meta` or `turn_context`
    /// for this file. Applied to subsequent `token_count` events.
    last_project_path: Mutex<std::collections::HashMap<String, Option<String>>>,
}

impl Default for CodexAdapter {
    fn default() -> Self {
        Self {
            last_model: Mutex::new(Default::default()),
            last_project_path: Mutex::new(Default::default()),
        }
    }
}

impl CodexAdapter {
    pub fn new() -> Self {
        Self::default()
    }
}

#[derive(Debug, Deserialize)]
struct Envelope {
    #[serde(rename = "type")]
    ty: Option<String>,
    timestamp: Option<String>,
    payload: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct SessionMeta {
    id: Option<String>,
    cwd: Option<String>,
    #[serde(rename = "model_provider")]
    _model_provider: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TurnContext {
    model: Option<String>,
    cwd: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct CodexTokenUsage {
    input_tokens: i64,
    cached_input_tokens: i64,
    output_tokens: i64,
    reasoning_output_tokens: i64,
}

impl DataSourceAdapter for CodexAdapter {
    fn name(&self) -> &'static str {
        SOURCE
    }

    fn discover_paths<R: Runtime>(&self, _app: &AppHandle<R>) -> Vec<PathBuf> {
        let Some(home) = std::env::var_os("HOME") else {
            return Vec::new();
        };
        let dir = PathBuf::from(home).join(".codex/sessions");
        if dir.exists() {
            vec![dir]
        } else {
            Vec::new()
        }
    }

    fn parse_line(&self, line: &[u8], default_session: &str) -> Option<ParsedEvent> {
        let env: Envelope = serde_json::from_slice(line).ok()?;
        let ty = env.ty.as_deref()?;
        let payload = env.payload.unwrap_or(serde_json::Value::Null);
        let timestamp = env.timestamp.unwrap_or_default();

        match ty {
            "session_meta" => {
                let meta: SessionMeta = serde_json::from_value(payload).ok()?;
                let sid = meta.id.unwrap_or_else(|| default_session.to_string());
                // Persist cwd so subsequent token_count events can carry it.
                if meta.cwd.is_some() {
                    let mut guard = self
                        .last_project_path
                        .lock()
                        .unwrap_or_else(|p| p.into_inner());
                    guard.insert(default_session.to_string(), meta.cwd.clone());
                }
                Some(ParsedEvent {
                    source: SOURCE,
                    timestamp,
                    session_id: sid,
                    project_path: meta.cwd,
                    model: None,
                    message_id: None,
                    request_id: None,
                    stop_reason: None,
                    kind: EventKind::Other,
                    usage: None,
                    is_third_party: false,
                    agent_id: None,
                    parent_session_id: None,
                })
            }
            "turn_context" => {
                let ctx: TurnContext = serde_json::from_value(payload).ok()?;
                if let Some(m) = ctx.model.as_deref() {
                    let mut guard = self
                        .last_model
                        .lock()
                        .unwrap_or_else(|p| p.into_inner());
                    guard.insert(default_session.to_string(), m.to_string());
                }
                // turn_context.cwd overrides session_meta.cwd when present.
                if ctx.cwd.is_some() {
                    let mut guard = self
                        .last_project_path
                        .lock()
                        .unwrap_or_else(|p| p.into_inner());
                    guard.insert(default_session.to_string(), ctx.cwd.clone());
                }
                Some(ParsedEvent {
                    source: SOURCE,
                    timestamp,
                    session_id: default_session.to_string(),
                    project_path: ctx.cwd,
                    model: ctx.model,
                    message_id: None,
                    request_id: None,
                    stop_reason: None,
                    kind: EventKind::Other,
                    usage: None,
                    is_third_party: false,
                    agent_id: None,
                    parent_session_id: None,
                })
            }
            "event_msg" => {
                let payload_type = payload
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string();
                match payload_type.as_str() {
                    "user_message" => Some(ParsedEvent {
                        source: SOURCE,
                        timestamp,
                        session_id: default_session.to_string(),
                        project_path: None,
                        model: None,
                        message_id: None,
                        request_id: None,
                        stop_reason: None,
                        kind: EventKind::UserTurn,
                        usage: None,
                        is_third_party: false,
                        agent_id: None,
                        parent_session_id: None,
                    }),
                    "task_complete" => {
                        let turn_id = payload
                            .get("turn_id")
                            .and_then(|t| t.as_str())
                            .map(str::to_owned);
                        Some(ParsedEvent {
                            source: SOURCE,
                            timestamp,
                            session_id: default_session.to_string(),
                            project_path: None,
                            model: None,
                            message_id: turn_id,
                            request_id: None,
                            stop_reason: Some("end_turn".to_string()),
                            kind: EventKind::Completion,
                            usage: None,
                            is_third_party: false,
                            agent_id: None,
                            parent_session_id: None,
                        })
                    }
                    "token_count" => {
                        let info = payload.get("info")?;
                        if info.is_null() {
                            return None;
                        }
                        let last = info.get("last_token_usage")?;
                        let usage: CodexTokenUsage =
                            serde_json::from_value(last.clone()).ok().unwrap_or_default();
                        let model = self
                            .last_model
                            .lock()
                            .unwrap_or_else(|p| p.into_inner())
                            .get(default_session)
                            .cloned();
                        let project_path = self
                            .last_project_path
                            .lock()
                            .unwrap_or_else(|p| p.into_inner())
                            .get(default_session)
                            .cloned()
                            .flatten();
                        // Codex `cached_input_tokens` is included in
                        // `input_tokens` rather than reported separately
                        // (unlike Anthropic's split). We mirror it into
                        // `cache_read` and subtract from input so cost
                        // math is correct against OpenAI cached pricing.
                        let cache_read = usage.cached_input_tokens.max(0);
                        let input = (usage.input_tokens - cache_read).max(0);
                        // `reasoning_output_tokens` are billed as output
                        // tokens by OpenAI; sum them.
                        let output = usage.output_tokens + usage.reasoning_output_tokens;
                        Some(ParsedEvent {
                            source: SOURCE,
                            timestamp,
                            session_id: default_session.to_string(),
                            project_path,
                            model,
                            message_id: None,
                            request_id: None,
                            stop_reason: None,
                            kind: EventKind::Assistant,
                            usage: Some(ParsedUsage {
                                input,
                                output,
                                cache_read,
                                cache_create: 0,
                            }),
                            is_third_party: false,
                            agent_id: None,
                            parent_session_id: None,
                        })
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }
}
