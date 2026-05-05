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

// SPEC §5.6 R1/R2 — bubble bookkeeping. We keep the entire bubble
// surface in the pet store because PetBubble lives next to PetCanvas
// in the pet window, and both R1 (waiting) and R2 (done) need to call
// setAction + showBubble together.
export interface PetBubble {
  id: number;
  text: string;
  expiresAt: number;
}

interface PetState {
  renderMode: PetRenderMode;
  currentAction: PetAction;
  bubble: PetBubble | null;
  muteWindowStart: string | null;
  muteWindowEnd: string | null;
  setRenderMode: (mode: PetRenderMode) => void;
  setAction: (action: PetAction) => void;
  setMuteWindow: (start: string | null, end: string | null) => void;
  showBubble: (text: string, durationMs?: number) => void;
  hideBubble: () => void;
}

const DEFAULT_BUBBLE_MS = 3500;
let bubbleSeq = 0;

// SPEC §4 S9 — quiet hours apply to bubbles only. macOS notifications
// stay on (system-managed). Window may cross midnight: 22:00 → 09:00.
export function isMuted(
  start: string | null,
  end: string | null,
  now: Date = new Date(),
): boolean {
  if (!start || !end) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const s = parseHm(start);
  const e = parseHm(end);
  if (s == null || e == null) return false;
  if (s === e) return false;
  if (s < e) {
    return cur >= s && cur < e;
  }
  // Crosses midnight: e.g. 22:00 → 09:00 → muted from 22:00 until 24:00
  // and from 00:00 until 09:00.
  return cur >= s || cur < e;
}

function parseHm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number.parseInt(m[1], 10);
  const min = Number.parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export const usePetStore = create<PetState>((set, get) => ({
  renderMode: "live2d",
  currentAction: "idle",
  bubble: null,
  muteWindowStart: null,
  muteWindowEnd: null,
  setRenderMode: (mode) => set({ renderMode: mode }),
  setAction: (action) => set({ currentAction: action }),
  setMuteWindow: (start, end) =>
    set({ muteWindowStart: start, muteWindowEnd: end }),
  showBubble: (text, durationMs = DEFAULT_BUBBLE_MS) => {
    const { muteWindowStart, muteWindowEnd } = get();
    if (isMuted(muteWindowStart, muteWindowEnd)) return;
    const id = ++bubbleSeq;
    const expiresAt = Date.now() + durationMs;
    set({ bubble: { id, text, expiresAt } });
    window.setTimeout(() => {
      const cur = get().bubble;
      if (cur && cur.id === id) {
        set({ bubble: null });
      }
    }, durationMs);
  },
  hideBubble: () => set({ bubble: null }),
}));
