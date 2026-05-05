//! macOS-specific NSWindow + NSScreen helpers for the pet overlay.
//!
//! Tauri does not expose collectionBehavior / window level / NSScreen
//! geometry richly enough for this app (SPEC §6.7 D1, D2 and §5.5):
//! we need the window to follow the user across Spaces, float above
//! ordinary application windows, and dock its head into the notch (or
//! to the top of the menu bar on non-notch hardware). The cleanest way
//! is a small `objc2` bridge.

use objc2::rc::Retained;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSScreen, NSWindow, NSWindowCollectionBehavior};
use tauri::{LogicalPosition, Runtime, WebviewWindow};

/// `NSStatusWindowLevel` (Apple-defined constant). Keeps the pet floating
/// above ordinary application windows but below the menu bar.
const NS_STATUS_WINDOW_LEVEL: isize = 25;

/// Pet window width (logical pixels) — kept in sync with
/// `tauri.conf.json`'s `pet` window. SPEC §6.7 D2 pegs the head at
/// the top ~50% of the 240 px-tall window (i.e. ~120 px of head).
pub const PET_WINDOW_WIDTH: f64 = 240.0;

/// Pet window height (logical pixels) — kept in sync with
/// `tauri.conf.json`'s `pet` window.
pub const PET_WINDOW_HEIGHT: f64 = 240.0;

/// SPEC §4 S19: minimum on-screen margin (logical px) when checking a
/// remembered window position against the current main screen's
/// visibleFrame. The whole 240×240 window must fit inside
/// `visibleFrame` after accounting for this margin.
pub const ONSCREEN_SAFETY_MARGIN_PX: f64 = 10.0;

/// How far the window's top edge tucks under the notch on notched
/// hardware. ~25% of the 120 px head → 75% remains visible, which
/// lands inside SPEC §6.7 D2's 60–80% band.
const NOTCH_HEAD_OVERLAP_PX: f64 = 30.0;

/// Vertical buffer below the menu bar on non-notch hardware so the
/// pet doesn't visually clip the menu bar's bottom stroke.
const MENUBAR_BUFFER_PX: f64 = 8.0;

/// User-visible setting that lets users override notch auto-detection
/// (SPEC §4 S16).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotchMode {
    Auto,
    ForceNotch,
    ForceNoNotch,
}

impl NotchMode {
    pub fn from_str(value: &str) -> Self {
        match value {
            "force-notch" => NotchMode::ForceNotch,
            "force-no-notch" => NotchMode::ForceNoNotch,
            _ => NotchMode::Auto,
        }
    }
}

/// Make `window` join every Space, stay put when the user switches Space,
/// and float above standard application windows.
pub fn apply_pet_window_behaviour<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
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

/// Geometry snapshot for the current main screen — all values in
/// logical points / left-bottom origin (Cocoa convention) except where
/// noted.
struct ScreenGeometry {
    /// Full screen width including menu bar, in Cocoa logical points.
    frame_width: f64,
    /// `safeAreaInsets.top` — non-zero only on notched displays
    /// (macOS 12+, Apple Silicon). 0 means "no notch".
    safe_area_top: f64,
    /// Distance between `frame.maxY` and `visibleFrame.maxY`, i.e.
    /// the menu-bar height in logical points. ~24 on non-notch, ~38
    /// on notched displays.
    menu_bar_height: f64,
    /// `localizedName` of the screen, used as a stable-ish identifier
    /// for SPEC §4 S19's "did the user change main display?" check.
    localized_name: String,
}

/// Visible-frame rectangle in Tauri logical pixels with top-left
/// origin (the same coordinate system `WebviewWindow::set_position`
/// uses). All four values are inclusive bounds in logical pixels.
#[derive(Debug, Clone, Copy)]
pub struct VisibleFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn read_main_screen_geometry() -> Option<ScreenGeometry> {
    // NSScreen requires the main thread; Tauri's setup hook runs there.
    let mtm = MainThreadMarker::new()?;
    let screen = NSScreen::mainScreen(mtm)?;

    let frame = screen.frame();
    let visible = screen.visibleFrame();
    let insets = screen.safeAreaInsets();

    let frame_max_y = frame.origin.y + frame.size.height;
    let visible_max_y = visible.origin.y + visible.size.height;
    let menu_bar_height = (frame_max_y - visible_max_y).max(0.0);

    let localized_name = screen.localizedName().to_string();

    Some(ScreenGeometry {
        frame_width: frame.size.width,
        safe_area_top: insets.top.max(0.0),
        menu_bar_height,
        localized_name,
    })
}

/// Read the main screen's `visibleFrame` (the rect excluding menu bar
/// and Dock) in Tauri logical pixels with top-left origin.
pub fn read_main_screen_visible_frame() -> Option<VisibleFrame> {
    let mtm = MainThreadMarker::new()?;
    let screen = NSScreen::mainScreen(mtm)?;

    let frame = screen.frame();
    let visible = screen.visibleFrame();

    // Cocoa visibleFrame is bottom-left origin within `frame`. Convert
    // its top-left corner to top-left-origin Tauri pixels.
    let frame_max_y = frame.origin.y + frame.size.height;
    let visible_max_y = visible.origin.y + visible.size.height;
    let y_top = frame_max_y - visible_max_y;

    Some(VisibleFrame {
        x: visible.origin.x,
        y: y_top.max(0.0),
        width: visible.size.width,
        height: visible.size.height,
    })
}

/// Read the main screen's stable-ish identifier (its `localizedName`),
/// used by SPEC §4 S19 to decide whether a remembered window position
/// still belongs to the current display setup.
pub fn read_main_screen_id() -> Option<String> {
    read_main_screen_geometry().map(|g| g.localized_name)
}

/// Returns true if the 240×240 pet window placed at top-left `(x, y)`
/// fits entirely inside the current main screen's visibleFrame after
/// applying the SPEC §4 S19 safety margin.
pub fn is_pet_window_onscreen(x: f64, y: f64) -> bool {
    let Some(vf) = read_main_screen_visible_frame() else {
        return false;
    };
    let m = ONSCREEN_SAFETY_MARGIN_PX;
    x >= vf.x + m
        && y >= vf.y + m
        && x + PET_WINDOW_WIDTH <= vf.x + vf.width - m
        && y + PET_WINDOW_HEIGHT <= vf.y + vf.height - m
}

/// Convert a "screen-top-left + Y down" coordinate into Tauri's
/// logical-pixel + top-left-origin coordinate. macOS logical pixels
/// equal logical points, so we do NOT multiply by `backingScaleFactor`
/// (Tauri's `set_position` already takes logical pixels).
///
/// Example: a window whose top sits 38 px below the screen top maps
/// directly to `(x, 38)` in Tauri coordinates — Tauri places the
/// origin at the top-left of the primary screen.
fn screen_topleft_to_tauri(x_left: f64, y_top_relative_to_screen: f64) -> (f64, f64) {
    (x_left, y_top_relative_to_screen)
}

/// Compute the pet window's target top-left position in Tauri logical
/// pixels (top-left origin), per SPEC §5.5 / §6.7 D2.
///
/// `mode` controls S16 fallback / manual override:
/// - `Auto`: trust `safeAreaInsets.top`; if 0 / unavailable, treat as
///   "no notch".
/// - `ForceNotch` / `ForceNoNotch`: override regardless of detection.
pub fn pet_target_position<R: Runtime>(
    _window: &WebviewWindow<R>,
    mode: NotchMode,
) -> tauri::Result<(f64, f64)> {
    // S16 default: if we cannot read the screen at all, assume no-notch
    // and place at (0, 0) — Tauri's tauri.conf.json default would already
    // have done that, but we still want a deterministic answer.
    let Some(geom) = read_main_screen_geometry() else {
        return Ok(screen_topleft_to_tauri(0.0, MENUBAR_BUFFER_PX));
    };

    let detected_notch = geom.safe_area_top > 0.0;
    let treat_as_notched = match mode {
        NotchMode::Auto => detected_notch,
        NotchMode::ForceNotch => true,
        NotchMode::ForceNoNotch => false,
    };

    let x_left = ((geom.frame_width - PET_WINDOW_WIDTH) / 2.0).max(0.0);

    let y_top = if treat_as_notched {
        // Use the detected inset when we have one; otherwise (force-notch
        // on a non-notch display) fall back to a sensible 38 px guess so
        // the user still sees the override take effect.
        let inset = if geom.safe_area_top > 0.0 {
            geom.safe_area_top
        } else {
            geom.menu_bar_height.max(38.0)
        };
        (inset - NOTCH_HEAD_OVERLAP_PX).max(0.0)
    } else {
        geom.menu_bar_height + MENUBAR_BUFFER_PX
    };

    Ok(screen_topleft_to_tauri(x_left, y_top))
}

/// Apply `pet_target_position` to the window. Convenience wrapper.
pub fn position_pet_window<R: Runtime>(
    window: &WebviewWindow<R>,
    mode: NotchMode,
) -> tauri::Result<()> {
    let (x, y) = pet_target_position(window, mode)?;
    window.set_position(LogicalPosition::new(x, y))?;
    Ok(())
}
