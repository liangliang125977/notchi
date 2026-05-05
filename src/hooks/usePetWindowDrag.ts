import { useEffect, useRef, type RefObject } from "react";
import { animate } from "framer-motion";
import { LogicalPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";

// SPEC §6.7 D4: 100 px snap radius around the default notch position.
const SNAP_RADIUS_PX = 100;
// SPEC §4 S8: 5 px movement threshold before a press becomes a drag.
const DRAG_THRESHOLD_PX = 5;
// One-frame throttle (≈60 Hz) for `set_position` IPC. SPEC §6.1.
const SET_POSITION_THROTTLE_MS = 16;

const STORE_PATH = "settings.json";
const WINDOW_POSITION_KEY = "windowPosition";

// Spring animation config — same family as SPEC §6.6 listed for
// Framer Motion (stiffness 400 / damping 30).
const SNAP_SPRING = { stiffness: 400, damping: 30 } as const;

interface DefaultTarget {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OnDragStateChange {
  (dragging: boolean): void;
}

export interface UsePetWindowDragOptions {
  /** Element to attach pointer listeners to (e.g. the pet canvas wrapper). */
  targetRef: RefObject<HTMLElement | null>;
  /** Optional callback invoked when the drag state changes. */
  onDragStateChange?: OnDragStateChange;
}

interface DragSession {
  pointerId: number;
  /** Logical-pixel offset of the pointer inside the pet window at pointerdown. */
  offsetX: number;
  offsetY: number;
  /** Pointer's screen position at pointerdown (CSS px). */
  startScreenX: number;
  startScreenY: number;
  /** Whether the 5 px threshold has been crossed. */
  active: boolean;
  lastSetAt: number;
  pendingX: number | null;
  pendingY: number | null;
  rafHandle: number | null;
}

/**
 * Wire pointer events on `targetRef` to drag the underlying Tauri
 * window. SPEC §4 S8 + S19, §6.7 D4.
 *
 * - 5 px threshold before drag begins
 * - 16 ms IPC throttle on `set_position`
 * - on release: snap (with spring) when within 100 px of the default
 *   notch / status-bar position, otherwise persist the new spot
 *
 * Position memory is stored in `settings.json::windowPosition`; clearing
 * it (on snap) means "use default".
 */
export function usePetWindowDrag({
  targetRef,
  onDragStateChange,
}: UsePetWindowDragOptions) {
  const sessionRef = useRef<DragSession | null>(null);
  const storeRef = useRef<Store | null>(null);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void load(STORE_PATH, { defaults: {}, autoSave: true }).then((s) => {
      if (cancelled) return;
      storeRef.current = s;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    const win = getCurrentWindow();

    const setDragState = (next: boolean) => {
      if (isDraggingRef.current === next) return;
      isDraggingRef.current = next;
      onDragStateChange?.(next);
    };

    const flushPending = (session: DragSession) => {
      session.rafHandle = null;
      if (session.pendingX === null || session.pendingY === null) return;
      const x = session.pendingX;
      const y = session.pendingY;
      session.pendingX = null;
      session.pendingY = null;
      session.lastSetAt = performance.now();
      void win.setPosition(new LogicalPosition(x, y));
    };

    const scheduleSetPosition = (
      session: DragSession,
      x: number,
      y: number,
    ) => {
      const now = performance.now();
      const elapsed = now - session.lastSetAt;
      if (elapsed >= SET_POSITION_THROTTLE_MS) {
        session.lastSetAt = now;
        void win.setPosition(new LogicalPosition(x, y));
        return;
      }
      session.pendingX = x;
      session.pendingY = y;
      if (session.rafHandle === null) {
        session.rafHandle = window.setTimeout(
          () => flushPending(session),
          SET_POSITION_THROTTLE_MS - elapsed,
        );
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Capture so we keep getting pointermove even when the cursor
      // outruns the moving window. Required because the window is
      // chasing the cursor — without capture the browser will deliver
      // events to whatever DOM node ends up under the cursor.
      el.setPointerCapture(e.pointerId);
      sessionRef.current = {
        pointerId: e.pointerId,
        offsetX: e.clientX,
        offsetY: e.clientY,
        startScreenX: e.screenX,
        startScreenY: e.screenY,
        active: false,
        lastSetAt: 0,
        pendingX: null,
        pendingY: null,
        rafHandle: null,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== e.pointerId) return;

      if (!session.active) {
        const dx = e.screenX - session.startScreenX;
        const dy = e.screenY - session.startScreenY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        session.active = true;
        setDragState(true);
      }

      // Screen-space target of the window's top-left corner.
      const targetX = e.screenX - session.offsetX;
      const targetY = e.screenY - session.offsetY;
      scheduleSetPosition(session, targetX, targetY);
    };

    const finishDrag = async (session: DragSession) => {
      if (session.rafHandle !== null) {
        window.clearTimeout(session.rafHandle);
        session.rafHandle = null;
      }
      // Flush any pending move so the user's actual release point is
      // applied before we read the window position back.
      if (session.pendingX !== null && session.pendingY !== null) {
        await win.setPosition(
          new LogicalPosition(session.pendingX, session.pendingY),
        );
        session.pendingX = null;
        session.pendingY = null;
      }

      let target: DefaultTarget | null = null;
      try {
        target = await invoke<DefaultTarget>("pet_default_target_position");
      } catch (err) {
        console.error("[T1.6] pet_default_target_position failed", err);
      }

      const scale = await win.scaleFactor();
      const physical = await win.outerPosition();
      const finalX = physical.x / scale;
      const finalY = physical.y / scale;

      const distance = target
        ? Math.hypot(finalX - target.x, finalY - target.y)
        : Number.POSITIVE_INFINITY;

      if (target && distance < SNAP_RADIUS_PX) {
        await snapToTarget(win, finalX, finalY, target);
        await clearStoredPosition(storeRef.current);
      } else {
        await persistPosition(storeRef.current, finalX, finalY);
      }
    };

    const onPointerEnd = (e: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== e.pointerId) return;
      sessionRef.current = null;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // ignore: capture may already be released after window jump
      }

      const wasActive = session.active;
      setDragState(false);
      if (!wasActive) return;
      void finishDrag(session);
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerEnd);
    el.addEventListener("pointercancel", onPointerEnd);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerEnd);
      el.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [targetRef, onDragStateChange]);

  return { isDraggingRef };
}

async function snapToTarget(
  win: ReturnType<typeof getCurrentWindow>,
  fromX: number,
  fromY: number,
  target: DefaultTarget,
): Promise<void> {
  // Drive the spring on `progress` from 0 → 1 and lerp the window
  // position each frame; framer-motion handles the easing curve.
  return new Promise<void>((resolve) => {
    let lastSetAt = 0;
    let lastX = fromX;
    let lastY = fromY;
    const controls = animate(0, 1, {
      type: "spring",
      stiffness: SNAP_SPRING.stiffness,
      damping: SNAP_SPRING.damping,
      onUpdate: (t) => {
        const x = fromX + (target.x - fromX) * t;
        const y = fromY + (target.y - fromY) * t;
        const now = performance.now();
        if (now - lastSetAt < SET_POSITION_THROTTLE_MS) {
          lastX = x;
          lastY = y;
          return;
        }
        lastSetAt = now;
        lastX = x;
        lastY = y;
        void win.setPosition(new LogicalPosition(x, y));
      },
      onComplete: () => {
        // Ensure the final landing point is exact.
        void win
          .setPosition(new LogicalPosition(target.x, target.y))
          .finally(() => resolve());
      },
    });
    // Suppress unused-variable lint while documenting that we keep
    // the controls reference in scope for the duration of the spring.
    void controls;
    void lastX;
    void lastY;
  });
}

async function clearStoredPosition(store: Store | null) {
  if (!store) return;
  try {
    await store.set(WINDOW_POSITION_KEY, null);
  } catch (err) {
    console.error("[T1.6] failed to clear windowPosition", err);
  }
}

async function persistPosition(store: Store | null, x: number, y: number) {
  if (!store) return;
  let screenId: string | null = null;
  try {
    screenId = await invoke<string | null>("pet_main_screen_id");
  } catch (err) {
    console.error("[T1.6] pet_main_screen_id failed", err);
  }
  try {
    await store.set(WINDOW_POSITION_KEY, {
      x,
      y,
      screenId,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[T1.6] failed to persist windowPosition", err);
  }
}
