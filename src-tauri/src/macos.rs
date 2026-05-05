//! macOS-specific NSWindow tweaks for the pet overlay.
//!
//! Tauri does not expose collectionBehavior or window level configuration
//! that is rich enough for the pet window (SPEC §6.7 D1, §5.5): we need
//! the window to follow the user across Spaces and to float above
//! ordinary application windows. The cleanest way is a small `objc2`
//! bridge that grabs the underlying `NSWindow` and toggles two bits.

use objc2::rc::Retained;
use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
use tauri::WebviewWindow;

/// `NSStatusWindowLevel` (Apple-defined constant). Keeps the pet floating
/// above ordinary application windows but below the menu bar.
const NS_STATUS_WINDOW_LEVEL: isize = 25;

/// Make `window` join every Space, stay put when the user switches Space,
/// and float above standard application windows.
pub fn apply_pet_window_behaviour(window: &WebviewWindow) -> tauri::Result<()> {
    let ns_window_ptr = window.ns_window()? as *mut NSWindow;
    if ns_window_ptr.is_null() {
        return Ok(());
    }

    // SAFETY: `ns_window()` returns a valid, retained NSWindow pointer for
    // the lifetime of the Tauri window. We immediately wrap it in a
    // `Retained` (which bumps the refcount) so the temporary reference here
    // is balanced and Cocoa keeps ownership.
    let ns_window: Retained<NSWindow> = unsafe { Retained::retain(ns_window_ptr) }
        .expect("ns_window pointer should be non-null after the null check above");

    let behaviour = NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::Stationary
        | NSWindowCollectionBehavior::IgnoresCycle
        | NSWindowCollectionBehavior::FullScreenAuxiliary;

    ns_window.setCollectionBehavior(behaviour);
    // NSStatusWindowLevel keeps the pet above ordinary floating panels
    // but still below the menu bar / native alerts.
    ns_window.setLevel(NS_STATUS_WINDOW_LEVEL);

    Ok(())
}
