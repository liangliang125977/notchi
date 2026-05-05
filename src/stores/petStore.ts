import { create } from "zustand";

export type PetRenderMode = "live2d" | "fallback";

interface PetState {
  renderMode: PetRenderMode;
  setRenderMode: (mode: PetRenderMode) => void;
}

export const usePetStore = create<PetState>((set) => ({
  renderMode: "live2d",
  setRenderMode: (mode) => set({ renderMode: mode }),
}));
