//! macOS-specific NSWindow + NSScreen helpers for the pet overlay.
//!
//! Tauri does not expose collectionBehavior / window level / NSScreen
//! geometry richly enough for this app (SPEC §6.7 D1, D2 and §5.5):
//! we need the window to follow the user across Spaces, float above
//! ordinary application windows, and dock its head into the notch (or
//! to the top of the menu bar on non-notch hardware). The cleanest way
//! is a small `objc2` bridge.

use objc2::rc::Retained;
use objc2::{MainThreadMarker, Message};
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

/// Read the main screen's stable-ish identifier (its `localizedName`),
/// used by SPEC §4 S19 to decide whether a remembered window position
/// still belongs to the current display setup.
pub fn read_main_screen_id() -> Option<String> {
    let mtm = MainThreadMarker::new()?;
    NSScreen::mainScreen(mtm).map(|s| s.localizedName().to_string())
}

/// SPEC §3 v1.2 — info on every connected display so the user can
/// choose which one Notchi docks into. The id is `localizedName`,
/// matching what we already persist for window position recovery.
#[derive(Debug, serde::Serialize, Clone)]
pub struct ScreenInfo {
    pub id: String,
    pub name: String,
    pub is_main: bool,
    pub has_notch: bool,
    pub width: f64,
    pub height: f64,
}

pub fn list_all_screens() -> Vec<ScreenInfo> {
    let Some(mtm) = MainThreadMarker::new() else {
        return Vec::new();
    };
    let main_id = NSScreen::mainScreen(mtm).map(|s| s.localizedName().to_string());
    NSScreen::screens(mtm)
        .iter()
        .map(|screen| {
            let frame = screen.frame();
            let insets = screen.safeAreaInsets();
            let name = screen.localizedName().to_string();
            ScreenInfo {
                id: name.clone(),
                name,
                is_main: main_id.as_deref() == Some(&*screen.localizedName().to_string()),
                has_notch: insets.top > 0.0,
                width: frame.size.width,
                height: frame.size.height,
            }
        })
        .collect()
}

/// Resolve the target screen the user picked in Settings. Returns
/// `None` when no override is stored or when the stored screen is
/// no longer connected (caller falls back to `mainScreen()`).
fn screen_by_id(target_id: &str) -> Option<Retained<NSScreen>> {
    let mtm = MainThreadMarker::new()?;
    NSScreen::screens(mtm)
        .iter()
        .find(|s| s.localizedName().to_string() == target_id)
        .map(|s| s.retain())
}

/// `read_main_screen_geometry`/`read_main_screen_visible_frame`
/// equivalents that pick a specific screen by its `localizedName`.
/// Both fall through to the main screen when the id is unknown so
/// the rest of the placement code never has to special-case None.
pub fn read_screen_geometry(target_id: Option<&str>) -> Option<ScreenGeometryPublic> {
    let mtm = MainThreadMarker::new()?;
    let screen = match target_id.and_then(screen_by_id) {
        Some(s) => s,
        None => NSScreen::mainScreen(mtm)?,
    };

    let frame = screen.frame();
    let visible = screen.visibleFrame();
    let insets = screen.safeAreaInsets();

    let frame_max_y = frame.origin.y + frame.size.height;
    let visible_max_y = visible.origin.y + visible.size.height;
    let menu_bar_height = (frame_max_y - visible_max_y).max(0.0);

    Some(ScreenGeometryPublic {
        frame_x: frame.origin.x,
        frame_width: frame.size.width,
        safe_area_top: insets.top.max(0.0),
        menu_bar_height,
        visible_frame: VisibleFrame {
            x: visible.origin.x,
            y: (frame_max_y - visible_max_y).max(0.0),
            width: visible.size.width,
            height: visible.size.height,
        },
    })
}

/// Geometry snapshot for one screen, used by the placement code.
/// Coordinates are Tauri logical pixels (top-left origin) for
/// `visible_frame`, Cocoa points for `frame_*`.
pub struct ScreenGeometryPublic {
    pub frame_x: f64,
    pub frame_width: f64,
    pub safe_area_top: f64,
    pub menu_bar_height: f64,
    pub visible_frame: VisibleFrame,
}

/// Returns true if the 240×240 pet window placed at top-left `(x, y)`
/// fits entirely inside `target_id`'s visibleFrame (or the main
/// screen's, when `target_id` is `None`) after applying the SPEC
/// §4 S19 safety margin.
pub fn is_pet_window_onscreen_for(target_id: Option<&str>, x: f64, y: f64) -> bool {
    let Some(geom) = read_screen_geometry(target_id) else {
        return false;
    };
    let vf = geom.visible_frame;
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
/// pixels (top-left origin), per SPEC §5.5 / §6.7 D2 + v1.2 multi-screen.
///
/// `mode` controls S16 fallback / manual override:
/// - `Auto`: trust `safeAreaInsets.top`; if 0 / unavailable, treat as
///   "no notch".
/// - `ForceNotch` / `ForceNoNotch`: override regardless of detection.
///
/// `target_screen_id` selects which display to dock into; `None`
/// means the current main screen.
pub fn pet_target_position_on<R: Runtime>(
    _window: &WebviewWindow<R>,
    mode: NotchMode,
    target_screen_id: Option<&str>,
) -> tauri::Result<(f64, f64)> {
    let Some(geom) = read_screen_geometry(target_screen_id) else {
        return Ok(screen_topleft_to_tauri(0.0, MENUBAR_BUFFER_PX));
    };

    let detected_notch = geom.safe_area_top > 0.0;
    let treat_as_notched = match mode {
        NotchMode::Auto => detected_notch,
        NotchMode::ForceNotch => true,
        NotchMode::ForceNoNotch => false,
    };

    // Cocoa screens form one continuous coordinate space. The chosen
    // screen's frame.origin.x positions us on the correct display.
    let x_left = geom.frame_x + ((geom.frame_width - PET_WINDOW_WIDTH) / 2.0).max(0.0);

    let y_top = if treat_as_notched {
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

/// Apply `pet_target_position_on` to the window.
pub fn position_pet_window_on<R: Runtime>(
    window: &WebviewWindow<R>,
    mode: NotchMode,
    target_screen_id: Option<&str>,
) -> tauri::Result<()> {
    let (x, y) = pet_target_position_on(window, mode, target_screen_id)?;
    window.set_position(LogicalPosition::new(x, y))?;
    Ok(())
}
