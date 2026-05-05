import { create } from "zustand";

export type PetRenderMode = "live2d" | "fallback";

export type PetAction = "idle" | "coding" | "waiting" | "done" | "sleep";

export const PET_ACTIONS: readonly PetAction[] = [
  "idle",
  "coding",
  "waiting",
  "done",
  "sleep",
] as const;

export const PET_SET_ACTION_EVENT = "pet:set-action";

// SPEC §4 S15 dev-only path: settings emits this so the pet window
// can flip into the static-PNG fallback render mode without us
// having to physically break the Live2D assets.
export const PET_FORCE_FALLBACK_EVENT = "pet:force-fallback";

// SPEC §4 S15: pet broadcasts its renderMode (on change + on
// startup) so the settings window can show / hide the degraded
// banner. Two webviews share no in-process state, so we ride a
// Tauri event instead of a shared Zustand store.
export const PET_RENDER_MODE_EVENT = "pet:render-mode";

export interface PetRenderModePayload {
  renderMode: PetRenderMode;
}

export interface PetSetActionPayload {
  action: PetAction;
}

interface PetState {
  renderMode: PetRenderMode;
  currentAction: PetAction;
  setRenderMode: (mode: PetRenderMode) => void;
  setAction: (action: PetAction) => void;
}

export const usePetStore = create<PetState>((set) => ({
  renderMode: "live2d",
  currentAction: "idle",
  setRenderMode: (mode) => set({ renderMode: mode }),
  setAction: (action) => set({ currentAction: action }),
}));
