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
