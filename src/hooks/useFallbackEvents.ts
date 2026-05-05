import { useEffect } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import {
  PET_FORCE_FALLBACK_EVENT,
  PET_RENDER_MODE_EVENT,
  usePetStore,
  type PetRenderModePayload,
} from "../stores/petStore";

// SPEC §4 S15. Two responsibilities:
// 1. Listen for the dev-only force-fallback event the settings window
//    emits, flip renderMode without touching Live2D.
// 2. Mirror our renderMode out so the settings window can show / hide
//    the "degraded" banner. We re-broadcast on every change and once
//    on mount (covers the case where settings opens after the auto
//    fallback already happened).
export function useFallbackEvents() {
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const broadcast = (mode: "live2d" | "fallback") => {
      const payload: PetRenderModePayload = { renderMode: mode };
      void emit(PET_RENDER_MODE_EVENT, payload);
    };

    broadcast(usePetStore.getState().renderMode);
    const unsubscribeStore = usePetStore.subscribe((state, prev) => {
      if (state.renderMode !== prev.renderMode) {
        broadcast(state.renderMode);
      }
    });

    void (async () => {
      try {
        unlisten = await listen(PET_FORCE_FALLBACK_EVENT, () => {
          usePetStore.getState().setRenderMode("fallback");
        });
      } catch (err) {
        console.error("[fallback] failed to subscribe", err);
      }
    })();

    return () => {
      unlisten?.();
      unsubscribeStore();
    };
  }, []);
}
