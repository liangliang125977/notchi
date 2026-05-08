// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod data;
#[cfg(target_os = "macos")]
mod macos;
mod tray;

use serde::Serialize;
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager};
use tauri_plugin_store::StoreExt;

/// Filename of the JSON-backed settings store managed by
/// `tauri-plugin-store`. Lives under the OS app-data dir.
pub(crate) const SETTINGS_STORE_PATH: &str = "settings.json";
/// Settings key for the SPEC §4 S16 manual notch override.
const NOTCH_MODE_KEY: &str = "notchMode";
/// Settings key for SPEC §4 S8/S19 — last user-chosen pet window
/// position (`null` means "use the default notch position").
const WINDOW_POSITION_KEY: &str = "windowPosition";
/// SPEC §3 v1.2 — user-chosen target display (`localizedName`). `null`
/// means "follow the current main display".
const TARGET_SCREEN_ID_KEY: &str = "targetScreenId";
/// User-selected pet size: "large" (240) or "small" (120). Default "large".
const PET_SIZE_KEY: &str = "petSize";
/// Plan #2 — monthly USD budget used to derive burn-rate runway.
pub(crate) const MONTHLY_BUDGET_KEY: &str = "monthlyBudgetUsd";

/// SPEC §6.7 D4 — frontend asks Rust for the current default pet
/// position so it can compute the snap distance with the same numbers
/// the setup hook used. Returns top-left logical pixels and the pet
/// window's logical size.
#[derive(Serialize)]
struct PetTargetPosition {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[tauri::command]
fn pet_default_target_position(app: tauri::AppHandle) -> Result<PetTargetPosition, String> {
    #[cfg(target_os = "macos")]
    {
        let Some(window) = app.get_webview_window("pet") else {
            return Err("pet window not found".into());
        };
        let mode = read_notch_mode(&app);
        let target = read_target_screen_id(&app);
        let (x, y) = macos::pet_target_position_on(&window, mode, target.as_deref())
            .map_err(|e| e.to_string())?;
        Ok(PetTargetPosition {
            x,
            y,
            width: macos::PET_WINDOW_WIDTH,
            height: macos::PET_WINDOW_HEIGHT,
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("pet positioning is macOS-only".into())
    }
}

/// SPEC §4 S19 — frontend reports the current main screen identifier
/// so it can be persisted alongside the remembered window position.
/// On non-macOS this returns `None`.
#[tauri::command]
fn pet_main_screen_id() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        macos::read_main_screen_id()
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// v1.3 hardening — settings banner deep-links here when macOS
/// notification permission has been declined. Opens System Settings →
/// Notifications so the user can re-grant without hunting through
/// nested panes. No-op on non-macOS.
#[tauri::command]
fn open_macos_notifications_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.notifications")
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

/// SPEC §3 v1.2 — list every connected display so Settings can offer
/// a picker. Empty on non-macOS.
#[tauri::command]
#[cfg(target_os = "macos")]
fn list_screens() -> Vec<macos::ScreenInfo> {
    macos::list_all_screens()
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
fn list_screens() -> Vec<()> {
    Vec::new()
}

/// Resize the pet window to "large" (240) or "small" (120) and
/// reposition it against the notch. Persists the choice to settings.json.
#[tauri::command]
fn set_pet_size(app: tauri::AppHandle, size: String) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE_PATH)
        .map_err(|e| e.to_string())?;
    store.set(PET_SIZE_KEY, serde_json::Value::String(size.clone()));

    #[cfg(target_os = "macos")]
    {
        if let Some(pet) = app.get_webview_window("pet") {
            let pet_size = macos::PetSize::from_str(&size);
            let dim = pet_size.dimension();
            pet.set_size(LogicalSize::new(dim, dim))
                .map_err(|e| e.to_string())?;
            let mode = read_notch_mode(&app);
            let target = read_target_screen_id(&app);
            macos::position_pet_window_on_size(&pet, mode, target.as_deref(), pet_size)
                .map_err(|e| e.to_string())?;
        }
    }

    // Notify the pet webview so it can apply the CSS scale transform.
    let _ = app.emit("pet:size-changed", serde_json::json!({ "size": size }));

    Ok(())
}

/// Persist the user's target-screen choice. `id == None` resets to
/// "follow main display". The pet window is repositioned immediately
/// so the user sees the change without restarting.
#[tauri::command]
fn set_target_screen_id(app: tauri::AppHandle, id: Option<String>) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE_PATH)
        .map_err(|e| e.to_string())?;
    match &id {
        Some(s) => store.set(
            TARGET_SCREEN_ID_KEY,
            serde_json::Value::String(s.clone()),
        ),
        None => store.set(TARGET_SCREEN_ID_KEY, serde_json::Value::Null),
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(pet) = app.get_webview_window("pet") {
            let mode = read_notch_mode(&app);
            if let Err(err) = macos::position_pet_window_on(&pet, mode, id.as_deref()) {
                eprintln!("[v1.2] failed to retarget pet window: {err}");
            }
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            pet_default_target_position,
            pet_main_screen_id,
            open_macos_notifications_settings,
            list_screens,
            set_target_screen_id,
            set_pet_size,
            data::commands::token_summary,
            data::commands::token_timeseries,
            data::commands::token_by_source,
            data::commands::token_by_model,
            data::commands::token_by_project,
            data::commands::recent_sessions,
            data::commands::get_pricing_config,
            data::commands::set_pricing_entry,
            data::commands::ingest_status,
            data::commands::detected_sources,
            data::commands::species_status,
            data::commands::get_settings,
            data::commands::set_settings,
            data::commands::set_claude_code_data_dir,
            data::commands::clear_all_events,
            data::commands::rescan_now,
            data::commands::burn_rate_now,
            data::commands::set_monthly_budget,
            data::evolution::evolution_status,
            data::evolution::pet_status,
            data::evolution::record_feed,
        ])
        .setup(|app| {
            // T2 — install the data layer (pool + backfill + watcher).
            // tauri provides a tokio runtime via `tauri::async_runtime`;
            // we use it to await the synchronous part of setup (pool
            // creation + price seeding) and spawn the long-running
            // watcher / backfill tasks inside.
            let app_handle = app.handle().clone();
            let state = tauri::async_runtime::block_on(async move {
                data::commands::install(&app_handle).await
            })
            .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            app.manage(state);

            // v0.2 #1: subagent radar — poll every 5s and emit diff
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    use std::time::Duration;
                    let mut prev_state: Vec<crate::data::subagents::ActiveSubagent> = Vec::new();
                    loop {
                        let state = app_handle.state::<crate::data::DataState>();
                        let pool = &state.pool;
                        match crate::data::subagents::active_subagents(pool).await {
                            Ok(curr) => {
                                if serde_json::to_string(&curr).ok()
                                    != serde_json::to_string(&prev_state).ok() {
                                    let _ = app_handle.emit("pet:subagents-changed", &curr);
                                    prev_state = curr;
                                }
                            }
                            Err(e) => eprintln!("[subagents] {e}"),
                        }
                        tokio::time::sleep(Duration::from_secs(5)).await;
                    }
                });
            }

            // v0.2 #2: burn-rate predictor
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    use std::time::Duration;
                    let mut prev_status: Option<String> = None;
                    loop {
                        let state = app_handle.state::<crate::data::DataState>();
                        let budget = app_handle.store(SETTINGS_STORE_PATH).ok()
                            .and_then(|s| s.get(MONTHLY_BUDGET_KEY))
                            .and_then(|v| v.as_f64())
                            .unwrap_or(50.0);
                        match crate::data::burn_rate::burn_rate_now(&state.pool, budget).await {
                            Ok(br) => {
                                let _ = app_handle.emit("pet:burn-rate-changed", &br);
                                if prev_status.as_deref() != Some(&br.status) {
                                    prev_status = Some(br.status.clone());
                                }
                            }
                            Err(e) => eprintln!("[burn_rate] {e}"),
                        }
                        tokio::time::sleep(Duration::from_secs(30)).await;
                    }
                });
            }

            #[cfg(target_os = "macos")]
            {
                // SPEC §6.7 D1: hide from Dock and Cmd-Tab. Mirrors the
                // LSUIElement=true bundled Info.plist for the dev build,
                // where the dev binary runs unbundled and would otherwise
                // appear in the Dock.
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);

                if let Some(pet) = app.get_webview_window("pet") {
                    macos::apply_pet_window_behaviour(&pet)?;

                    let pet_size = read_pet_size(app.handle());
                    let dim = pet_size.dimension();
                    if (dim - macos::PET_WINDOW_SIZE_LARGE).abs() > 0.5 {
                        let _ = pet.set_size(LogicalSize::new(dim, dim));
                    }

                    let mode = read_notch_mode(app.handle());
                    let target_screen = read_target_screen_id(app.handle());
                    place_pet_window_at_startup(
                        app.handle(),
                        &pet,
                        mode,
                        target_screen.as_deref(),
                        pet_size,
                    );
                }
            }

            tray::install(app.handle())?;

            // Keep SETTINGS_SHOWN in sync when the window is closed via the
            // title-bar X button (CloseRequested is emitted before destroy).
            if let Some(settings_win) = app.get_webview_window("settings") {
                settings_win.on_window_event(|event| {
                    if let tauri::WindowEvent::CloseRequested { .. }
                    | tauri::WindowEvent::Destroyed = event
                    {
                        tray::mark_settings_hidden();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
fn read_pet_size<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> macos::PetSize {
    app.store(SETTINGS_STORE_PATH)
        .ok()
        .and_then(|store| store.get(PET_SIZE_KEY))
        .and_then(|v| v.as_str().map(macos::PetSize::from_str))
        .unwrap_or(macos::PetSize::Large)
}

#[cfg(target_os = "macos")]
fn read_target_screen_id<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    app.store(SETTINGS_STORE_PATH).ok().and_then(|store| {
        store
            .get(TARGET_SCREEN_ID_KEY)
            .and_then(|v| v.as_str().map(str::to_owned))
    })
}

#[cfg(target_os = "macos")]
fn read_notch_mode<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> macos::NotchMode {
    // S16 fallback: any error reading the store is logged and treated
    // as Auto, which itself degrades to "no notch" when the OS does not
    // expose `safeAreaInsets`.
    match app.store(SETTINGS_STORE_PATH) {
        Ok(store) => store
            .get(NOTCH_MODE_KEY)
            .and_then(|v| v.as_str().map(macos::NotchMode::from_str))
            .unwrap_or(macos::NotchMode::Auto),
        Err(err) => {
            eprintln!("[T1.3] settings store unavailable, defaulting notchMode=auto: {err}");
            macos::NotchMode::Auto
        }
    }
}

/// SPEC §4 S8 + S19 startup placement:
///   1. read remembered `windowPosition` from the store
///   2. require `screenId` to match the current main screen
///   3. require the whole 240×240 window to fit inside `visibleFrame`
///      with a 10 px safety margin
///   4. otherwise (no record, mismatched screen, or off-screen) fall
///      back to `pet_target_position` and clear the memorised entry
#[cfg(target_os = "macos")]
fn place_pet_window_at_startup<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    pet: &tauri::WebviewWindow<R>,
    mode: macos::NotchMode,
    target_screen_id: Option<&str>,
    pet_size: macos::PetSize,
) {
    let mut use_default = true;

    if let Ok(store) = app.store(SETTINGS_STORE_PATH) {
        if let Some(value) = store.get(WINDOW_POSITION_KEY) {
            if !value.is_null() {
                let stored_x = value.get("x").and_then(|v| v.as_f64());
                let stored_y = value.get("y").and_then(|v| v.as_f64());
                let stored_screen = value.get("screenId").and_then(|v| v.as_str()).map(str::to_owned);
                let active_screen = target_screen_id
                    .map(str::to_owned)
                    .or_else(macos::read_main_screen_id);

                let screen_matches = match (&stored_screen, &active_screen) {
                    (Some(a), Some(b)) => a == b,
                    _ => false,
                };

                if let (Some(x), Some(y), true) = (stored_x, stored_y, screen_matches) {
                    if macos::is_pet_window_onscreen_for_size(target_screen_id, x, y, pet_size) {

                        if let Err(err) = pet.set_position(LogicalPosition::new(x, y)) {
                            eprintln!("[T1.6] failed to restore pet window: {err}");
                        } else {
                            use_default = false;
                        }
                    }
                }

                if use_default {
                    store.set(WINDOW_POSITION_KEY, serde_json::Value::Null);
                }
            }
        }
    }

    if use_default {
        if let Err(err) = macos::position_pet_window_on_size(pet, mode, target_screen_id, pet_size) {
            eprintln!("[T1.3] failed to position pet window: {err}");
        }
    }
}
