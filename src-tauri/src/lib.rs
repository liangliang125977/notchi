// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

#[cfg(target_os = "macos")]
mod macos;

use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet]);

    #[cfg(target_os = "macos")]
    let builder = builder.setup(|app| {
        // SPEC §6.7 D1: hide from Dock and Cmd-Tab. Mirrors the
        // LSUIElement=true bundled Info.plist for the dev build,
        // where the dev binary runs unbundled and would otherwise
        // appear in the Dock.
        app.set_activation_policy(tauri::ActivationPolicy::Accessory);

        if let Some(pet) = app.get_webview_window("pet") {
            macos::apply_pet_window_behaviour(&pet)?;
        }

        Ok(())
    });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
