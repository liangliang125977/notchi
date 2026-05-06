import { useEffect, useRef, useState, type RefObject } from "react";
import {
  LogicalPosition,
  LogicalSize,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { PET_SIZE_LARGE, PET_SIZE_SMALL, type PetSize } from "../stores/petStore";

// hover the pet 300ms → window grows downward, info card appears below.
// Leave → 1s linger → shrink back. Width stays constant.

const CARD_H = 96;

function getSizes(petSize: PetSize) {
  const pet = petSize === "small" ? PET_SIZE_SMALL : PET_SIZE_LARGE;
  return {
    COLLAPSED_W: pet,
    COLLAPSED_H: pet,
    EXPANDED_W: pet,
    EXPANDED_H: pet + CARD_H,
  };
}

const ENTER_DELAY_MS = 300;
const LEAVE_DELAY_MS = 1000;

export interface UsePetHoverExpandOptions {
  rootRef: RefObject<HTMLElement | null>;
  petSize: PetSize;
}

interface ExpandResult {
  expanded: boolean;
}

/** Animates the pet window between collapsed and expanded sizes on hover. */
export function usePetHoverExpand({
  rootRef,
  petSize,
}: UsePetHoverExpandOptions): ExpandResult {
  const [expanded, setExpanded] = useState(false);
  const enterTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);
  const isExpandedRef = useRef(false);
  const animatingRef = useRef(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const win = getCurrentWindow();
    const { COLLAPSED_W, COLLAPSED_H, EXPANDED_W, EXPANDED_H } = getSizes(petSize);

    const clearTimer = (slot: typeof enterTimer) => {
      if (slot.current !== null) {
        window.clearTimeout(slot.current);
        slot.current = null;
      }
    };

    const expand = async () => {
      if (isExpandedRef.current || animatingRef.current) return;
      animatingRef.current = true;
      try {
        // Anchor the resize to current top-left so the pet does not
        // visually shift. Tauri set_size grows from top-left already
        // on macOS, so we only re-set position when the user dragged
        // close to the right edge of the screen — for v1 we just
        // grow rightwards and accept the simple anchor.
        await win.setSize(new LogicalSize(EXPANDED_W, EXPANDED_H));
        isExpandedRef.current = true;
        setExpanded(true);
      } catch (err) {
        console.error("[L2] expand failed", err);
      } finally {
        animatingRef.current = false;
      }
    };

    const collapse = async () => {
      if (!isExpandedRef.current || animatingRef.current) return;
      animatingRef.current = true;
      try {
        await win.setSize(new LogicalSize(COLLAPSED_W, COLLAPSED_H));
        isExpandedRef.current = false;
        setExpanded(false);
      } catch (err) {
        console.error("[L2] collapse failed", err);
      } finally {
        animatingRef.current = false;
      }
    };

    const onEnter = () => {
      clearTimer(leaveTimer);
      if (isExpandedRef.current) return;
      clearTimer(enterTimer);
      enterTimer.current = window.setTimeout(() => {
        enterTimer.current = null;
        void expand();
      }, ENTER_DELAY_MS);
    };

    const onLeave = () => {
      clearTimer(enterTimer);
      if (!isExpandedRef.current) return;
      clearTimer(leaveTimer);
      leaveTimer.current = window.setTimeout(() => {
        leaveTimer.current = null;
        void collapse();
      }, LEAVE_DELAY_MS);
    };

    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);

    // If the user drags during expand, snap back to 240 immediately so
    // window movement math stays sane.
    const onPointerDown = () => {
      clearTimer(enterTimer);
      clearTimer(leaveTimer);
    };
    el.addEventListener("pointerdown", onPointerDown);

    return () => {
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onPointerDown);
      clearTimer(enterTimer);
      clearTimer(leaveTimer);
      if (isExpandedRef.current) {
        // Make sure we never leave the window stuck at 480 on hot
        // reload.
        void win
          .setSize(new LogicalSize(COLLAPSED_W, COLLAPSED_H))
          .catch(() => undefined);
        // Re-anchor at LogicalPosition with current physical pos to
        // avoid drift in dev hot-reload.
        void win.outerPosition().then(async (p) => {
          const scale = await win.scaleFactor();
          await win
            .setPosition(new LogicalPosition(p.x / scale, p.y / scale))
            .catch(() => undefined);
        });
      }
    };
  }, [rootRef, petSize]);

  return { expanded };
}
