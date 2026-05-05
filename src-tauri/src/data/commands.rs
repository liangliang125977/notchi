//! Tauri command surface for the data layer. The UI work in T2.6+ will
//! consume these; for now they let the dev-only "数据摘要" panel
//! validate the pipeline end-to-end.

use std::path::PathBuf;
use std::sync::Arc;

use sqlx::SqlitePool;
use tauri::State;
use tauri_plugin_store::StoreExt;

use super::queries::{self, GroupRow, Period, PricingEntry, SessionRow, TimeseriesPoint, TokenSummary};
use super::{ingest, DataState, IngestStatus};

const SETTINGS_STORE: &str = "settings.json";

fn pool_of<'a>(state: &'a State<DataState>) -> &'a SqlitePool {
    &state.pool
}

#[tauri::command]
pub async fn token_summary(
    state: State<'_, DataState>,
    period: String,
) -> Result<TokenSummary, String> {
    queries::token_summary(pool_of(&state), Period::from_str(&period))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn token_timeseries(
    state: State<'_, DataState>,
    period: String,
) -> Result<Vec<TimeseriesPoint>, String> {
    queries::token_timeseries(pool_of(&state), Period::from_str(&period))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn token_by_source(
    state: State<'_, DataState>,
    period: String,
) -> Result<Vec<GroupRow>, String> {
    queries::token_by_source(pool_of(&state), Period::from_str(&period))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn token_by_model(
    state: State<'_, DataState>,
    period: String,
) -> Result<Vec<GroupRow>, String> {
    queries::token_by_model(pool_of(&state), Period::from_str(&period))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn recent_sessions(
    state: State<'_, DataState>,
    limit: Option<i64>,
) -> Result<Vec<SessionRow>, String> {
    queries::recent_sessions(pool_of(&state), limit.unwrap_or(20))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_pricing_config(
    state: State<'_, DataState>,
) -> Result<Vec<PricingEntry>, String> {
    queries::list_pricing(pool_of(&state))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_pricing_entry(
    state: State<'_, DataState>,
    entry: PricingEntry,
) -> Result<(), String> {
    queries::upsert_pricing(pool_of(&state), &entry)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ingest_status(state: State<'_, DataState>) -> Result<IngestStatus, String> {
    Ok(state.status.lock().await.clone())
}

#[derive(serde::Serialize)]
pub struct SettingsBundle {
    pub claude_code_data_dir: Option<String>,
    pub claude_code_found: bool,
    pub mute_window_start: Option<String>,
    pub mute_window_end: Option<String>,
    pub monthly_budget_usd: Option<f64>,
    pub events_count: i64,
}

#[tauri::command]
pub async fn get_settings(
    app: tauri::AppHandle,
    state: State<'_, DataState>,
) -> Result<SettingsBundle, String> {
    let s = state.status.lock().await.clone();
    // Pull a couple of optional settings so the UI side has one entry
    // point rather than calling tauri-plugin-store directly for every
    // key; only the keys T2 cares about live here.
    let (mute_start, mute_end, budget) = match app.store(SETTINGS_STORE) {
        Ok(store) => (
            store
                .get("muteWindowStart")
                .and_then(|v| v.as_str().map(|s| s.to_string())),
            store
                .get("muteWindowEnd")
                .and_then(|v| v.as_str().map(|s| s.to_string())),
            store.get("monthlyBudgetUsd").and_then(|v| v.as_f64()),
        ),
        Err(_) => (None, None, None),
    };
    Ok(SettingsBundle {
        claude_code_data_dir: s.claude_code_data_dir,
        claude_code_found: s.claude_code_found,
        mute_window_start: mute_start,
        mute_window_end: mute_end,
        monthly_budget_usd: budget,
        events_count: s.events_count,
    })
}

/// Persist user-facing settings (monthly budget + mute window). Each
/// field is optional; omitted fields are left untouched. Pricing
/// edits go through `set_pricing_entry`; data-dir through
/// `set_claude_code_data_dir`.
#[derive(serde::Deserialize)]
pub struct SettingsPatch {
    #[serde(default)]
    pub monthly_budget_usd: Option<f64>,
    #[serde(default)]
    pub mute_window_start: Option<String>,
    #[serde(default)]
    pub mute_window_end: Option<String>,
}

#[tauri::command]
pub async fn set_settings(
    app: tauri::AppHandle,
    patch: SettingsPatch,
) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE).map_err(|e| e.to_string())?;
    if let Some(b) = patch.monthly_budget_usd {
        store.set(
            "monthlyBudgetUsd",
            serde_json::Number::from_f64(b)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null),
        );
    }
    if let Some(s) = patch.mute_window_start {
        store.set("muteWindowStart", serde_json::Value::String(s));
    }
    if let Some(e) = patch.mute_window_end {
        store.set("muteWindowEnd", serde_json::Value::String(e));
    }
    Ok(())
}

/// SPEC §4 / settings — wipe the events table and reset ingest
/// bookkeeping so the next watcher tick rebuilds from scratch.
#[tauri::command]
pub async fn clear_all_events(state: State<'_, DataState>) -> Result<(), String> {
    sqlx::query("DELETE FROM events")
        .execute(pool_of(&state))
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM ingest_state")
        .execute(pool_of(&state))
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM parse_errors_today")
        .execute(pool_of(&state))
        .await
        .map_err(|e| e.to_string())?;
    {
        let mut s = state.status.lock().await;
        s.events_count = 0;
        s.errors_today = 0;
        s.last_ingest_at = None;
    }
    state.rescan.notify_one();
    Ok(())
}

/// SPEC §4 S18 — let the user point Notchi at a manually chosen
/// Claude Code data dir. The watcher restart is wired through the
/// `rescan` Notify; we re-bind the watcher in the next run loop.
#[tauri::command]
pub async fn set_claude_code_data_dir(
    app: tauri::AppHandle,
    state: State<'_, DataState>,
    path: String,
) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("path does not exist: {path}"));
    }
    let store = app.store(SETTINGS_STORE).map_err(|e| e.to_string())?;
    store.set("claudeCodeDataDir", serde_json::Value::String(path.clone()));
    {
        let mut s = state.status.lock().await;
        s.claude_code_data_dir = Some(path);
        s.claude_code_found = true;
    }
    state.rescan.notify_one();
    Ok(())
}

/// Triggered by tray / dev panel "force refresh"; useful when the
/// fsevents watcher missed a write (NFS volumes, sleep/wake races).
#[tauri::command]
pub async fn rescan_now(state: State<'_, DataState>) -> Result<(), String> {
    state.rescan.notify_one();
    Ok(())
}

/// Wire-up helper: spawn the watcher + initial backfill. Returns the
/// state that should be `manage()`d by the Tauri builder.
pub async fn install<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<DataState, String> {
    use tokio::sync::{Mutex, Notify};

    let db_file = super::db::db_path(app)?;
    let pool = super::db::init_pool(&db_file)
        .await
        .map_err(|e| format!("init pool: {e}"))?;
    super::pricing::seed_if_empty(&pool)
        .await
        .map_err(|e| format!("seed pricing: {e}"))?;

    let data_dir = ingest::resolve_data_dir(app);
    let status = Arc::new(Mutex::new(IngestStatus {
        claude_code_data_dir: data_dir.as_ref().map(|p| p.to_string_lossy().to_string()),
        claude_code_found: data_dir.is_some(),
        ..Default::default()
    }));
    let rescan = Arc::new(Notify::new());

    if let Some(dir) = data_dir {
        let pool_bg = pool.clone();
        let dir_bg = dir.clone();
        let st_bg = status.clone();
        tokio::spawn(async move {
            if let Err(e) = ingest::backfill(pool_bg, dir_bg, st_bg).await {
                eprintln!("[ingest] backfill failed: {e}");
            }
        });

        let pool_w = pool.clone();
        let st_w = status.clone();
        let rs_w = rescan.clone();
        tokio::spawn(async move {
            if let Err(e) = ingest::run_watcher(pool_w, dir, st_w, rs_w).await {
                eprintln!("[ingest] watcher exited: {e}");
            }
        });
    } else {
        eprintln!("[ingest] ~/.claude/projects not found — S18 manual override required");
    }

    Ok(DataState { pool, status, rescan })
}
