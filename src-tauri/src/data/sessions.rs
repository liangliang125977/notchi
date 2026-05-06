//! T3.2/T3.3 — in-memory tracker for per-session liveness so the
//! emotion engine can answer two questions:
//!
//! - Did any session just finish a turn that wasn't user-cancelled?
//!   (R2 — fires `pet:task-completed` events)
//! - Are any sessions currently "waiting on the user" (assistant
//!   ended ≥ N seconds ago, no fresh user turn)? (R1)
//!
//! Notes:
//! - We only persist this in memory. Restarts forget pending state,
//!   which is fine — the watcher will tail-read the same jsonl rows
//!   on the next file change anyway, and bubbles aren't critical.
//! - Privacy: we never store user prompt text, only `session_id`,
//!   timestamps, model, and `stop_reason` enum.

use std::collections::HashMap;
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use serde::Serialize;

/// v1.0 — sessions are now keyed by `(source, session_id)` so two
/// different tools can hold sessions with overlapping ids without
/// trampling each other's tracker state. The on-wire shape (and the
/// `events.session_id` column) keeps `session_id` flat; the source
/// just selects the namespace.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct SessionKey {
    pub source: String,
    pub session_id: String,
}

impl SessionKey {
    pub fn new(source: &str, session_id: &str) -> Self {
        Self {
            source: source.to_string(),
            session_id: session_id.to_string(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct SessionState {
    /// First time we observed any row for this session.
    pub started_at: Option<DateTime<Utc>>,
    /// Most recent assistant turn seen.
    pub last_assistant_at: Option<DateTime<Utc>>,
    /// Stop reason from the last assistant turn (if any).
    pub last_stop_reason: Option<String>,
    /// Most recent user turn seen.
    pub last_user_at: Option<DateTime<Utc>>,
    /// Last model name observed on assistant turns (for completion notif).
    pub last_model: Option<String>,
    /// Total token count (input+output+cache_creation) accumulated for
    /// this session — used for the completion bubble copy.
    pub total_tokens: i64,
    /// Have we already emitted a `task-completed` event for the latest
    /// stop_reason? Reset whenever a new user turn arrives.
    pub completion_emitted: bool,
    /// Have we already emitted `pending-input` for the current quiet
    /// stretch? Reset whenever a fresh user turn arrives.
    pub pending_emitted_at_30s: bool,
    pub pending_emitted_at_60s: bool,
    pub pending_emitted_at_180s: bool,
}

#[derive(Default)]
pub struct SessionTracker {
    inner: Mutex<HashMap<SessionKey, SessionState>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompletionEvent {
    pub source: String,
    pub session_id: String,
    pub model: Option<String>,
    pub stop_reason: String,
    pub duration_secs: i64,
    pub total_tokens: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PendingInputEvent {
    pub source: String,
    pub session_id: String,
    pub idle_secs: i64,
    /// 30 / 60 / 180 — the bracket this event was emitted for.
    pub bracket: i64,
}

/// Outcome of an `observe_*` call so callers know what events to emit.
#[derive(Default)]
pub struct ObserveResult {
    pub completed: Option<CompletionEvent>,
}

impl SessionTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record an assistant turn. Returns a `CompletionEvent` only when
    /// (a) this turn carries a non-cancellation `stop_reason`, (b) the
    /// session has been alive for > 5s, (c) we have not already fired
    /// for this stop_reason.
    pub fn observe_assistant(
        &self,
        source: &str,
        session_id: &str,
        timestamp: Option<DateTime<Utc>>,
        model: Option<&str>,
        stop_reason: Option<&str>,
        new_tokens: i64,
    ) -> ObserveResult {
        let mut guard = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let st = guard.entry(SessionKey::new(source, session_id)).or_default();
        if st.started_at.is_none() {
            st.started_at = timestamp;
        }
        st.last_assistant_at = timestamp.or(st.last_assistant_at);
        if let Some(m) = model {
            st.last_model = Some(m.to_string());
        }
        st.total_tokens = st.total_tokens.saturating_add(new_tokens);

        let mut out = ObserveResult::default();
        let Some(reason) = stop_reason else {
            return out;
        };
        // Only signal "completed" — skip fragments mid-stream and skip
        // user-initiated cancellations (no celebration for those).
        if reason == "user_cancelled" || reason.is_empty() {
            st.last_stop_reason = Some(reason.to_string());
            return out;
        }
        if st.last_stop_reason.as_deref() == Some(reason) && st.completion_emitted {
            return out;
        }
        st.last_stop_reason = Some(reason.to_string());

        // SPEC §5.6 R2 — drop sessions shorter than 5s (rapid failures).
        let dur_secs = match (st.started_at, timestamp) {
            (Some(s), Some(e)) => (e - s).num_seconds().max(0),
            _ => 0,
        };
        if dur_secs < 5 {
            // mark anyway so we don't re-fire if the session is touched
            // again — the bubble would be misleading.
            st.completion_emitted = true;
            return out;
        }
        st.completion_emitted = true;
        out.completed = Some(CompletionEvent {
            source: source.to_string(),
            session_id: session_id.to_string(),
            model: st.last_model.clone(),
            stop_reason: reason.to_string(),
            duration_secs: dur_secs,
            total_tokens: st.total_tokens,
        });
        out
    }

    /// Record a user turn. Resets pending-input emission flags so the
    /// next quiet stretch can fire fresh bubbles.
    pub fn observe_user(&self, source: &str, session_id: &str, timestamp: Option<DateTime<Utc>>) {
        let mut guard = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let st = guard.entry(SessionKey::new(source, session_id)).or_default();
        if st.started_at.is_none() {
            st.started_at = timestamp;
        }
        st.last_user_at = timestamp.or(st.last_user_at);
        st.pending_emitted_at_30s = false;
        st.pending_emitted_at_60s = false;
        st.pending_emitted_at_180s = false;
        st.completion_emitted = false;
        st.last_stop_reason = None;
    }

    /// Returns the next pending-input bubble that should fire (if any),
    /// based on the configured threshold brackets. Mutates the in-memory
    /// state to record the emission so we don't re-fire.
    ///
    /// "Pending" means the session's last assistant turn carries a
    /// completion `stop_reason`, no user turn has happened since, and
    /// the silence has crossed 30 / 60 / 180 seconds.
    pub fn poll_pending_input(&self, now: DateTime<Utc>) -> Option<PendingInputEvent> {
        let mut guard = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        // Iterate sorted by (source, session_id) for deterministic
        // behaviour in tests; HashMap iteration order would otherwise vary.
        let mut keys: Vec<SessionKey> = guard.keys().cloned().collect();
        keys.sort_by(|a, b| (a.source.as_str(), a.session_id.as_str())
            .cmp(&(b.source.as_str(), b.session_id.as_str())));
        for key in keys {
            let Some(st) = guard.get_mut(&key) else {
                continue;
            };
            let Some(reason) = st.last_stop_reason.as_deref() else {
                continue;
            };
            if reason == "user_cancelled" || reason.is_empty() {
                continue;
            }
            let Some(la) = st.last_assistant_at else {
                continue;
            };
            // user replied since assistant ended → not pending.
            if let Some(lu) = st.last_user_at {
                if lu >= la {
                    continue;
                }
            }
            // Stale sessions (no activity for > 5 minutes) — drop them
            // out of the pending pool. The window's idle/sleep state
            // covers them via the session-quiet path.
            let idle = (now - la).num_seconds();
            if idle > 5 * 60 {
                continue;
            }
            if idle >= 180 && !st.pending_emitted_at_180s {
                st.pending_emitted_at_180s = true;
                return Some(PendingInputEvent {
                    source: key.source,
                    session_id: key.session_id,
                    idle_secs: idle,
                    bracket: 180,
                });
            }
            if idle >= 60 && !st.pending_emitted_at_60s {
                st.pending_emitted_at_60s = true;
                return Some(PendingInputEvent {
                    source: key.source,
                    session_id: key.session_id,
                    idle_secs: idle,
                    bracket: 60,
                });
            }
            if idle >= 30 && !st.pending_emitted_at_30s {
                st.pending_emitted_at_30s = true;
                return Some(PendingInputEvent {
                    source: key.source,
                    session_id: key.session_id,
                    idle_secs: idle,
                    bracket: 30,
                });
            }
        }
        None
    }
}
