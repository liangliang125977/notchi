// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod data;
#[cfg(target_os = "macos")]
mod macos;
mod tray;

use serde::Serialize;
use tauri::{LogicalPosition, Manager};
#[cfg(target_os = "macos")]
use tauri_plugin_store::StoreExt;

/// Filename of the JSON-backed settings store managed by
/// `tauri-plugin-store`. Lives under the OS app-data dir.
const SETTINGS_STORE_PATH: &str = "settings.json";
/// Settings key for the SPEC §4 S16 manual notch override.
const NOTCH_MODE_KEY: &str = "notchMode";
/// Settings key for SPEC §4 S8/S19 — last user-chosen pet window
/// position (`null` means "use the default notch position").
const WINDOW_POSITION_KEY: &str = "windowPosition";

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

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
        let (x, y) = macos::pet_target_position(&window, mode).map_err(|e| e.to_string())?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            pet_default_target_position,
            pet_main_screen_id,
            data::commands::token_summary,
            data::commands::token_timeseries,
            data::commands::token_by_source,
            data::commands::token_by_model,
            data::commands::recent_sessions,
            data::commands::get_pricing_config,
            data::commands::set_pricing_entry,
            data::commands::ingest_status,
            data::commands::get_settings,
            data::commands::set_settings,
            data::commands::set_claude_code_data_dir,
            data::commands::clear_all_events,
            data::commands::rescan_now,
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
            #[cfg(target_os = "macos")]
            {
                // SPEC §6.7 D1: hide from Dock and Cmd-Tab. Mirrors the
                // LSUIElement=true bundled Info.plist for the dev build,
                // where the dev binary runs unbundled and would otherwise
                // appear in the Dock.
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);

                if let Some(pet) = app.get_webview_window("pet") {
                    macos::apply_pet_window_behaviour(&pet)?;

                    let mode = read_notch_mode(app.handle());
                    place_pet_window_at_startup(app.handle(), &pet, mode);
                }
            }

            tray::install(app.handle())?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
) {
    let mut use_default = true;

    if let Ok(store) = app.store(SETTINGS_STORE_PATH) {
        if let Some(value) = store.get(WINDOW_POSITION_KEY) {
            if !value.is_null() {
                let stored_x = value.get("x").and_then(|v| v.as_f64());
                let stored_y = value.get("y").and_then(|v| v.as_f64());
                let stored_screen = value.get("screenId").and_then(|v| v.as_str()).map(str::to_owned);
                let current_screen = macos::read_main_screen_id();

                let screen_matches = match (&stored_screen, &current_screen) {
                    (Some(a), Some(b)) => a == b,
                    _ => false,
                };

                if let (Some(x), Some(y), true) = (stored_x, stored_y, screen_matches) {
                    if macos::is_pet_window_onscreen(x, y) {
                        if let Err(err) = pet.set_position(LogicalPosition::new(x, y)) {
                            eprintln!("[T1.6] failed to restore pet window: {err}");
                        } else {
                            use_default = false;
                        }
                    }
                }

                if use_default {
                    // Stale (off-screen / wrong display) — drop the entry.
                    store.set(WINDOW_POSITION_KEY, serde_json::Value::Null);
                }
            }
        }
    }

    if use_default {
        if let Err(err) = macos::position_pet_window(pet, mode) {
            eprintln!("[T1.3] failed to position pet window: {err}");
        }
    }
}
