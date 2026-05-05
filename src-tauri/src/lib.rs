// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

#[cfg(target_os = "macos")]
mod macos;
mod tray;

use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri_plugin_store::StoreExt;

/// Filename of the JSON-backed settings store managed by
/// `tauri-plugin-store`. Lives under the OS app-data dir.
const SETTINGS_STORE_PATH: &str = "settings.json";
/// Settings key for the SPEC §4 S16 manual notch override.
const NOTCH_MODE_KEY: &str = "notchMode";

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![greet])
        .setup(|app| {
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
                    if let Err(err) = macos::position_pet_window(&pet, mode) {
                        eprintln!("[T1.3] failed to position pet window: {err}");
                    }
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
