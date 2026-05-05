import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { load, type Store } from "@tauri-apps/plugin-store";
import {
  PET_ACTIONS,
  PET_FORCE_FALLBACK_EVENT,
  PET_RENDER_MODE_EVENT,
  PET_SET_ACTION_EVENT,
  type PetAction,
  type PetRenderMode,
  type PetRenderModePayload,
  type PetSetActionPayload,
} from "../stores/petStore";

type NotchMode = "auto" | "force-notch" | "force-no-notch";

const NOTCH_MODE_KEY = "notchMode";
const STORE_PATH = "settings.json";
const DEFAULT_MODE: NotchMode = "auto";

const NOTCH_MODE_OPTIONS: ReadonlyArray<{ value: NotchMode; label: string }> = [
  { value: "auto", label: "Auto-detect (recommended)" },
  { value: "force-notch", label: "Force notch layout" },
  { value: "force-no-notch", label: "Force no-notch layout" },
];

const PET_ACTION_LABELS: Record<PetAction, string> = {
  idle: "Idle",
  coding: "Coding",
  waiting: "Waiting",
  done: "Done",
  sleep: "Sleep",
};

export function PetPanel() {
  const [store, setStore] = useState<Store | null>(null);
  const [mode, setMode] = useState<NotchMode>(DEFAULT_MODE);
  const [ready, setReady] = useState(false);
  const [activeAction, setActiveAction] = useState<PetAction>("idle");
  const [renderMode, setRenderMode] = useState<PetRenderMode>("live2d");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await load(STORE_PATH, {
          defaults: { [NOTCH_MODE_KEY]: DEFAULT_MODE },
          autoSave: true,
        });
        const stored = await s.get<NotchMode>(NOTCH_MODE_KEY);
        if (cancelled) return;
        setStore(s);
        setMode(stored ?? DEFAULT_MODE);
        setReady(true);
      } catch (err) {
        console.error("[pet-panel] failed to load store", err);
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        unlisten = await listen<PetRenderModePayload>(
          PET_RENDER_MODE_EVENT,
          (event) => {
            const next = event.payload?.renderMode;
            if (next) setRenderMode(next);
          },
        );
      } catch (err) {
        console.error("[pet-panel] failed to subscribe to render mode", err);
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  async function handleNotchModeChange(next: NotchMode) {
    setMode(next);
    if (!store) return;
    try {
      await store.set(NOTCH_MODE_KEY, next);
    } catch (err) {
      console.error("[pet-panel] failed to persist notchMode", err);
    }
  }

  async function handleActionClick(action: PetAction) {
    setActiveAction(action);
    try {
      const payload: PetSetActionPayload = { action };
      await emit(PET_SET_ACTION_EVENT, payload);
    } catch (err) {
      console.error("[pet-panel] failed to emit pet action", err);
    }
  }

  async function handleForceFallback() {
    try {
      await emit(PET_FORCE_FALLBACK_EVENT);
    } catch (err) {
      console.error("[pet-panel] failed to emit force-fallback", err);
    }
  }

  const isDev = import.meta.env.DEV;

  return (
    <div className="sp-root">
      {renderMode === "fallback" ? (
        <div className="sp-banner sp-banner-warn" role="alert">
          Live2D failed to load — currently rendering the static PNG fallback.
          Restart Notchi or check the console for details.
        </div>
      ) : null}

      <section className="sp-section">
        <header className="sp-section-head">
          <h3>Notch layout</h3>
          <p className="sp-section-hint">
            Apply on next launch. Auto-detect handles most Macs correctly.
          </p>
        </header>
        <div className="sp-section-body">
          <select
            className="sp-input sp-input-select"
            value={mode}
            disabled={!ready}
            onChange={(e) =>
              void handleNotchModeChange(e.target.value as NotchMode)
            }
          >
            {NOTCH_MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {isDev ? (
        <section className="sp-section">
          <header className="sp-section-head">
            <h3>
              Action debug <span className="sp-tag">dev only</span>
            </h3>
            <p className="sp-section-hint">
              Triggers the pet's action via a Tauri event. Hidden in production
              builds.
            </p>
          </header>
          <div className="sp-section-body">
            <div className="sp-action-row">
              {PET_ACTIONS.map((action) => (
                <button
                  key={action}
                  type="button"
                  className={
                    "sp-chip" + (action === activeAction ? " is-active" : "")
                  }
                  onClick={() => void handleActionClick(action)}
                >
                  {PET_ACTION_LABELS[action]}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {isDev ? (
        <section className="sp-section">
          <header className="sp-section-head">
            <h3>
              Force fallback <span className="sp-tag">dev only</span>
            </h3>
            <p className="sp-section-hint">
              Validates the SPEC §4 S15 degraded-render path without breaking
              Live2D assets.
            </p>
          </header>
          <div className="sp-section-body">
            <div className="sp-row">
              <button
                type="button"
                className="sp-btn"
                disabled={renderMode === "fallback"}
                onClick={() => void handleForceFallback()}
              >
                Force static fallback
              </button>
              <span className="sp-hint">
                Current mode:{" "}
                <strong>
                  {renderMode === "fallback" ? "fallback" : "Live2D"}
                </strong>
              </span>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
