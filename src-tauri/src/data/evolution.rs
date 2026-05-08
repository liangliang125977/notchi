//! v1.1 — Evolution + feeding logic.
//!
//! Stage thresholds use cumulative tokens across all sources. We sum
//! `input + output + cache_read + cache_creation` so that cache-heavy
//! workloads still progress (the L1 colour map already excludes cache
//! reads via cost; here we're growing the pet on raw activity).
//!
//! Feed level is persisted in `settings.json` as a small bundle:
//!   { feedLevel: u8 (0..=100), fedAt: ISO-8601 }
//! plus a rolling list of the last 5 feedings under `feedLog`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use super::DataState;

const SETTINGS_STORE: &str = "settings.json";
const FEED_LEVEL_KEY: &str = "feedLevel";
const FED_AT_KEY: &str = "fedAt";
const FEED_LOG_KEY: &str = "feedLog";

/// Hatchling unlocks at 100K cumulative tokens, Adult at 1M.
pub const STAGE_HATCHLING_THRESHOLD: i64 = 100_000;
pub const STAGE_ADULT_THRESHOLD: i64 = 1_000_000;

/// Per task completion the pet earns +10 saturation, capped at 100.
pub const FEED_PER_TASK: i32 = 10;
pub const FEED_MAX: i32 = 100;
/// Decay 5 points per hour idle.
pub const FEED_DECAY_PER_HOUR: i32 = 5;
pub const FEED_LOG_LIMIT: usize = 5;

#[derive(Debug, Clone, Serialize)]
pub struct EvolutionStatus {
    pub stage: u8,
    pub name: String,
    pub total_tokens: i64,
    pub next_threshold: Option<i64>,
    pub progress_pct: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FeedLogEntry {
    pub at: String,
    pub source: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PetStatus {
    pub feed_level: u8,
    pub mood: String,
    pub fed_at: Option<String>,
    pub evolution: EvolutionStatus,
    pub recent_feeds: Vec<FeedLogEntry>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct StoredFeedLogEntry {
    #[serde(default)]
    at: String,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    model: Option<String>,
}

/// Compute current cumulative tokens across all events.
pub async fn cumulative_tokens(pool: &SqlitePool) -> Result<i64, sqlx::Error> {
    let (total,): (i64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(input_tokens + output_tokens
                            + cache_read_input_tokens + cache_creation_input_tokens), 0)
         FROM events",
    )
    .fetch_one(pool)
    .await?;
    Ok(total)
}

pub fn evolution_for_tokens(total: i64) -> EvolutionStatus {
    if total < STAGE_HATCHLING_THRESHOLD {
        let pct = (total as f64) * 100.0 / (STAGE_HATCHLING_THRESHOLD as f64);
        EvolutionStatus {
            stage: 0,
            name: "Egg".into(),
            total_tokens: total,
            next_threshold: Some(STAGE_HATCHLING_THRESHOLD),
            progress_pct: pct.clamp(0.0, 100.0),
        }
    } else if total < STAGE_ADULT_THRESHOLD {
        let span = (STAGE_ADULT_THRESHOLD - STAGE_HATCHLING_THRESHOLD) as f64;
        let pct = ((total - STAGE_HATCHLING_THRESHOLD) as f64) * 100.0 / span;
        EvolutionStatus {
            stage: 1,
            name: "Hatchling".into(),
            total_tokens: total,
            next_threshold: Some(STAGE_ADULT_THRESHOLD),
            progress_pct: pct.clamp(0.0, 100.0),
        }
    } else {
        EvolutionStatus {
            stage: 2,
            name: "Adult".into(),
            total_tokens: total,
            next_threshold: None,
            progress_pct: 100.0,
        }
    }
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn parse_rfc3339(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

/// Apply hourly decay to a stored feed level. `fed_at` is the timestamp
/// of the last update (feed or decay snapshot). Returns the post-decay
/// level (clamped 0..=100).
pub fn apply_decay(stored_level: i32, fed_at: Option<&str>, now: DateTime<Utc>) -> i32 {
    let Some(at) = fed_at.and_then(parse_rfc3339) else {
        return stored_level.clamp(0, FEED_MAX);
    };
    let elapsed = now - at;
    let hours = elapsed.num_seconds().max(0) / 3600;
    let decay = (hours as i32).saturating_mul(FEED_DECAY_PER_HOUR);
    (stored_level - decay).clamp(0, FEED_MAX)
}

fn mood_for(level: i32) -> &'static str {
    if level < 20 {
        "hungry"
    } else if level < 70 {
        "content"
    } else {
        "happy"
    }
}

/// Order moods worst → best. Used by `fuse_mood` to take the
/// pessimistic min of two signals.
fn mood_rank(m: &str) -> u8 {
    match m {
        "hungry" => 0,
        "content" => 1,
        "happy" => 2,
        _ => 1, // unknown → neutral
    }
}

fn cache_mood_for(hit_pct: f64) -> &'static str {
    if hit_pct >= 90.0 {
        "happy"
    } else if hit_pct >= 70.0 {
        "content"
    } else {
        "hungry"
    }
}

/// Fuse feed-derived mood with cache-pulse mood, taking the worse of
/// the two. Returns `feed_mood` unchanged when there are not enough
/// recent samples to trust the cache signal (avoids cold-start
/// false alarms).
pub(crate) fn fuse_mood(
    feed_mood: &str,
    cache: &crate::data::queries::CachePulse,
) -> &'static str {
    // Canonicalise feed_mood to one of the three known strings.
    let fm: &'static str = match feed_mood {
        "hungry" => "hungry",
        "happy" => "happy",
        _ => "content",
    };
    if cache.samples < 5 {
        return fm;
    }
    let cm = cache_mood_for(cache.hit_pct);
    if mood_rank(cm) < mood_rank(fm) {
        cm
    } else {
        fm
    }
}

fn read_feed(app: &AppHandle) -> (i32, Option<String>, Vec<FeedLogEntry>) {
    let Ok(store) = app.store(SETTINGS_STORE) else {
        return (0, None, Vec::new());
    };
    let level = store
        .get(FEED_LEVEL_KEY)
        .and_then(|v| v.as_i64())
        .map(|v| v as i32)
        .unwrap_or(0);
    let fed_at = store
        .get(FED_AT_KEY)
        .and_then(|v| v.as_str().map(|s| s.to_string()));
    let log = store
        .get(FEED_LOG_KEY)
        .and_then(|v| serde_json::from_value::<Vec<StoredFeedLogEntry>>(v).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|e| FeedLogEntry {
            at: e.at,
            source: e.source,
            model: e.model,
        })
        .collect();
    (level, fed_at, log)
}

fn write_feed(
    app: &AppHandle,
    level: i32,
    fed_at: &str,
    log: &[FeedLogEntry],
) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE).map_err(|e| e.to_string())?;
    store.set(FEED_LEVEL_KEY, serde_json::Value::Number((level as i64).into()));
    store.set(FED_AT_KEY, serde_json::Value::String(fed_at.to_string()));
    let log_json = serde_json::to_value(
        log.iter()
            .map(|e| StoredFeedLogEntry {
                at: e.at.clone(),
                source: e.source.clone(),
                model: e.model.clone(),
            })
            .collect::<Vec<_>>(),
    )
    .map_err(|e| e.to_string())?;
    store.set(FEED_LOG_KEY, log_json);
    Ok(())
}

#[tauri::command]
pub async fn evolution_status(
    state: tauri::State<'_, DataState>,
) -> Result<EvolutionStatus, String> {
    let total = cumulative_tokens(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(evolution_for_tokens(total))
}

#[tauri::command]
pub async fn pet_status(
    app: AppHandle,
    state: tauri::State<'_, DataState>,
) -> Result<PetStatus, String> {
    let total = cumulative_tokens(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    let evolution = evolution_for_tokens(total);

    let (stored_level, fed_at, recent_feeds) = read_feed(&app);
    let now = Utc::now();
    let level = apply_decay(stored_level, fed_at.as_deref(), now);

    // Cache discipline pulse — a hungry pet on a 30% cache hit rate is
    // an early warning that something just blew the prompt cache.
    let pulse = crate::data::queries::cache_pulse_1h(&state.pool)
        .await
        .unwrap_or(crate::data::queries::CachePulse {
            hit_pct: 100.0,
            samples: 0,
        });

    Ok(PetStatus {
        feed_level: level.clamp(0, FEED_MAX) as u8,
        mood: fuse_mood(mood_for(level), &pulse).to_string(),
        fed_at,
        evolution,
        recent_feeds,
    })
}

#[tauri::command]
pub async fn record_feed(
    app: AppHandle,
    source: Option<String>,
    model: Option<String>,
) -> Result<PetStatus, String> {
    let (stored_level, fed_at, mut log) = read_feed(&app);
    let now = Utc::now();
    let decayed = apply_decay(stored_level, fed_at.as_deref(), now);
    let next = (decayed + FEED_PER_TASK).clamp(0, FEED_MAX);
    let now_iso = now_rfc3339();

    log.insert(
        0,
        FeedLogEntry {
            at: now_iso.clone(),
            source,
            model,
        },
    );
    if log.len() > FEED_LOG_LIMIT {
        log.truncate(FEED_LOG_LIMIT);
    }

    write_feed(&app, next, &now_iso, &log)?;

    // Reuse pet_status to return a fresh snapshot without re-reading.
    // We need cumulative tokens too — fetch via the state-bound command
    // path so the caller gets the same shape as `pet_status`.
    use tauri::Manager;
    let state = app.state::<DataState>();
    let total = cumulative_tokens(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    let pulse = crate::data::queries::cache_pulse_1h(&state.pool)
        .await
        .unwrap_or(crate::data::queries::CachePulse {
            hit_pct: 100.0,
            samples: 0,
        });
    Ok(PetStatus {
        feed_level: next as u8,
        mood: fuse_mood(mood_for(next), &pulse).to_string(),
        fed_at: Some(now_iso),
        evolution: evolution_for_tokens(total),
        recent_feeds: log,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stages_map_correctly() {
        assert_eq!(evolution_for_tokens(0).stage, 0);
        assert_eq!(evolution_for_tokens(99_999).stage, 0);
        assert_eq!(evolution_for_tokens(100_000).stage, 1);
        assert_eq!(evolution_for_tokens(500_000).stage, 1);
        assert_eq!(evolution_for_tokens(1_000_000).stage, 2);
        assert_eq!(evolution_for_tokens(10_000_000).stage, 2);
    }

    #[test]
    fn egg_progress_linear() {
        let s = evolution_for_tokens(50_000);
        assert!((s.progress_pct - 50.0).abs() < 0.01);
        assert_eq!(s.next_threshold, Some(STAGE_HATCHLING_THRESHOLD));
    }

    #[test]
    fn hatchling_progress_linear() {
        let s = evolution_for_tokens(550_000);
        assert!((s.progress_pct - 50.0).abs() < 0.01);
    }

    #[test]
    fn adult_caps() {
        let s = evolution_for_tokens(2_000_000);
        assert_eq!(s.stage, 2);
        assert_eq!(s.next_threshold, None);
        assert_eq!(s.progress_pct, 100.0);
    }

    #[test]
    fn decay_zero_when_no_timestamp() {
        let level = apply_decay(50, None, Utc::now());
        assert_eq!(level, 50);
    }

    #[test]
    fn decay_takes_5_per_hour() {
        let now = Utc::now();
        let two_hours_ago = now - chrono::Duration::hours(2);
        let stamp = two_hours_ago.to_rfc3339();
        let level = apply_decay(50, Some(&stamp), now);
        assert_eq!(level, 40);
    }

    #[test]
    fn decay_clamps_to_zero() {
        let now = Utc::now();
        let day_ago = now - chrono::Duration::hours(48);
        let stamp = day_ago.to_rfc3339();
        let level = apply_decay(10, Some(&stamp), now);
        assert_eq!(level, 0);
    }

    #[test]
    fn mood_buckets() {
        assert_eq!(mood_for(0), "hungry");
        assert_eq!(mood_for(19), "hungry");
        assert_eq!(mood_for(20), "content");
        assert_eq!(mood_for(69), "content");
        assert_eq!(mood_for(70), "happy");
        assert_eq!(mood_for(100), "happy");
    }

    #[test]
    fn fuse_mood_truth_table() {
        use crate::data::queries::CachePulse;
        let p = |pct: f64, samples: i64| CachePulse { hit_pct: pct, samples };

        // Below sample threshold → cache ignored, feed_mood passes through
        assert_eq!(fuse_mood("happy", &p(10.0, 4)), "happy");
        assert_eq!(fuse_mood("hungry", &p(99.0, 4)), "hungry");

        // Cache happy + feed happy → happy
        assert_eq!(fuse_mood("happy", &p(95.0, 50)), "happy");

        // Cache hungry overrides feed happy → hungry
        assert_eq!(fuse_mood("happy", &p(40.0, 50)), "hungry");

        // Feed hungry overrides cache happy → hungry
        assert_eq!(fuse_mood("hungry", &p(95.0, 50)), "hungry");

        // Both content → content
        assert_eq!(fuse_mood("content", &p(80.0, 50)), "content");

        // Cache content + feed happy → content (take the worse of the two)
        assert_eq!(fuse_mood("happy", &p(80.0, 50)), "content");
    }
}
