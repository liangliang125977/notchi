//! Status-bar (NSStatusItem) tray icon — SPEC §6.7 D1 derived.
//!
//! Left-click toggles the settings window. Right-click reveals a menu
//! covering: about, show/hide pet, pause collection (placeholder), quit.
//! The collection-pause callback is intentionally a no-op; data
//! collection itself lands in T2.x.

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

const MENU_ABOUT: &str = "about_notchi";
const MENU_TOGGLE_PET: &str = "toggle_pet";
const MENU_PAUSE_COLLECTION: &str = "pause_collection";
const MENU_QUIT: &str = "quit";

pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build_menu(app)?;

    TrayIconBuilder::with_id("notchi-tray")
        .icon(
            app.default_window_icon()
                .cloned()
                .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?,
        )
        .icon_as_template(true)
        .tooltip("Notchi")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_menu_event(app, &event))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_settings_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = MenuItem::with_id(app, MENU_ABOUT, "关于 Notchi", true, None::<&str>)?;
    let toggle_pet = MenuItem::with_id(app, MENU_TOGGLE_PET, "显示 / 隐藏宠物", true, None::<&str>)?;
    let pause = MenuItem::with_id(
        app,
        MENU_PAUSE_COLLECTION,
        "暂停采集（占位）",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "退出 Notchi", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[&about, &separator, &toggle_pet, &pause, &separator, &quit],
    )
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: &MenuEvent) {
    match event.id().as_ref() {
        MENU_ABOUT => {
            // Placeholder — real about dialog lands in T4.x.
        }
        MENU_TOGGLE_PET => {
            if let Some(pet) = app.get_webview_window("pet") {
                let visible = pet.is_visible().unwrap_or(false);
                let _ = if visible { pet.hide() } else { pet.show() };
            }
        }
        MENU_PAUSE_COLLECTION => {
            // Placeholder — real pause toggle lands when T2.2 (jsonl
            // watcher) is implemented.
        }
        MENU_QUIT => {
            app.exit(0);
        }
        _ => {}
    }
}

fn toggle_settings_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("settings") else {
        return;
    };

    let visible = window.is_visible().unwrap_or(false);
    if visible {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}
