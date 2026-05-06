import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { load, type Store } from "@tauri-apps/plugin-store";
import { usePetStore, type PetSize } from "../stores/petStore";
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
import type { SourceStatus } from "../lib/dataTypes";

type NotchMode = "auto" | "force-notch" | "force-no-notch";

interface ScreenInfo {
  id: string;
  name: string;
  is_main: boolean;
  has_notch: boolean;
  width: number;
  height: number;
}

const NOTCH_MODE_KEY = "notchMode";
const TARGET_SCREEN_ID_KEY = "targetScreenId";
const PET_SIZE_KEY = "petSize";
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
  const petSize = usePetStore((s) => s.petSize);
  const setPetSizeStore = usePetStore((s) => s.setPetSize);
  const [activeAction, setActiveAction] = useState<PetAction>("idle");
  const [renderMode, setRenderMode] = useState<PetRenderMode>("live2d");
  const [screens, setScreens] = useState<ScreenInfo[]>([]);
  const [targetScreen, setTargetScreen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await load(STORE_PATH, {
          defaults: { [NOTCH_MODE_KEY]: DEFAULT_MODE, [PET_SIZE_KEY]: "large" },
          autoSave: true,
        });
        const stored = await s.get<NotchMode>(NOTCH_MODE_KEY);
        const storedTarget = await s.get<string | null>(TARGET_SCREEN_ID_KEY);
        const storedSize = await s.get<PetSize>(PET_SIZE_KEY);
        if (cancelled) return;
        setStore(s);
        setMode(stored ?? DEFAULT_MODE);
        setTargetScreen(storedTarget ?? null);
        if (storedSize) setPetSizeStore(storedSize);
        setReady(true);
      } catch (err) {
        console.error("[pet-panel] failed to load store", err);
        if (!cancelled) setReady(true);
      }

      try {
        const list = await invoke<ScreenInfo[]>("list_screens");
        if (!cancelled) setScreens(list);
      } catch (err) {
        console.error("[pet-panel] failed to list screens", err);
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

  async function handlePetSizeChange(next: PetSize) {
    setPetSizeStore(next);
    try {
      await invoke("set_pet_size", { size: next });
    } catch (err) {
      console.error("[pet-panel] set_pet_size failed", err);
    }
  }

  async function handleNotchModeChange(next: NotchMode) {
    setMode(next);
    if (!store) return;
    try {
      await store.set(NOTCH_MODE_KEY, next);
    } catch (err) {
      console.error("[pet-panel] failed to persist notchMode", err);
    }
  }

  async function handleTargetScreenChange(next: string | null) {
    setTargetScreen(next);
    try {
      await invoke("set_target_screen_id", { id: next });
    } catch (err) {
      console.error("[pet-panel] failed to persist targetScreenId", err);
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

  async function handleTestBubble(kind: "waiting" | "done") {
    try {
      // The pet window owns the petStore and the bubble component, so
      // we can't call `showBubble` here directly. Forward over a Tauri
      // event the pet window already listens to (or fakes one of the
      // T3 events the emotion engine is already wired for).
      const eventName =
        kind === "done" ? "pet:task-completed" : "pet:pending-input";
      const payload =
        kind === "done"
          ? {
              session_id: "dev",
              model: "claude-sonnet-4-6",
              stop_reason: "end_turn",
              duration_secs: 12,
              total_tokens: 1234,
            }
          : { session_id: "dev", idle_secs: 35, bracket: 30 };
      await emit(eventName, payload);
    } catch (err) {
      console.error("[pet-panel] failed to emit test bubble", err);
    }
  }

  async function handleForceEvolution(stage: 0 | 1 | 2) {
    try {
      // usePetStatus listens for this in dev/prod alike — we only
      // expose the trigger from a dev-guarded section so reviewers
      // can preview the burst without devtools / localStorage hacks.
      await emit("pet:force-evolution-up", { stage });
    } catch (err) {
      console.error("[pet-panel] failed to emit force-evolution-up", err);
    }
  }

  const isDev = import.meta.env.DEV;

  const [sources, setSources] = useState<SourceStatus[]>([]);
  useEffect(() => {
    if (!isDev) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await invoke<SourceStatus[]>("detected_sources");
        if (!cancelled) setSources(list);
      } catch (err) {
        console.error("[pet-panel] detected_sources failed", err);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isDev]);

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
          <h3>Pet size</h3>
          <p className="sp-section-hint">
            Large (240 px) or Small (120 px). Takes effect immediately.
          </p>
        </header>
        <div className="sp-section-body">
          <div className="sp-action-row">
            <button
              type="button"
              className={"sp-chip" + (petSize === "large" ? " is-active" : "")}
              disabled={!ready}
              onClick={() => void handlePetSizeChange("large")}
            >
              Large
            </button>
            <button
              type="button"
              className={"sp-chip" + (petSize === "small" ? " is-active" : "")}
              disabled={!ready}
              onClick={() => void handlePetSizeChange("small")}
            >
              Small
            </button>
          </div>
        </div>
      </section>

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

      <section className="sp-section">
        <header className="sp-section-head">
          <h3>Target display</h3>
          <p className="sp-section-hint">
            Pick which screen Notchi docks onto. Defaults to the current main
            display.
          </p>
        </header>
        <div className="sp-section-body">
          <select
            className="sp-input sp-input-select"
            value={targetScreen ?? ""}
            disabled={!ready}
            onChange={(e) =>
              void handleTargetScreenChange(
                e.target.value === "" ? null : e.target.value,
              )
            }
          >
            <option value="">Main (follow active display)</option>
            {screens.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.name}
                {sc.is_main ? " · main" : ""}
                {sc.has_notch ? " · notch" : ""} · {Math.round(sc.width)}×
                {Math.round(sc.height)}
              </option>
            ))}
          </select>
          {screens.length === 0 ? (
            <p className="sp-hint">No additional displays detected.</p>
          ) : null}
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
              Test bubble <span className="sp-tag">dev only</span>
            </h3>
            <p className="sp-section-hint">
              Fakes a Rust-side R1/R2 event so you can preview the bubble
              animation + macOS notification permission flow without waiting for
              a real Claude Code turn.
            </p>
          </header>
          <div className="sp-section-body">
            <div className="sp-row">
              <button
                type="button"
                className="sp-btn"
                onClick={() => void handleTestBubble("waiting")}
              >
                Trigger waiting bubble
              </button>
              <button
                type="button"
                className="sp-btn"
                onClick={() => void handleTestBubble("done")}
              >
                Trigger done bubble + notification
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {isDev ? (
        <section className="sp-section">
          <header className="sp-section-head">
            <h3>
              Force evolution-up <span className="sp-tag">dev only</span>
            </h3>
            <p className="sp-section-hint">
              Plays the v1.1 break-shell cinematic immediately. Picks the stage
              you click and bumps the pet straight to it without waiting for the
              token threshold.
            </p>
          </header>
          <div className="sp-section-body">
            <div className="sp-row">
              <button
                type="button"
                className="sp-btn"
                onClick={() => void handleForceEvolution(0)}
              >
                🥚 Egg
              </button>
              <button
                type="button"
                className="sp-btn"
                onClick={() => void handleForceEvolution(1)}
              >
                🐣 Hatchling
              </button>
              <button
                type="button"
                className="sp-btn"
                onClick={() => void handleForceEvolution(2)}
              >
                ✨ Adult
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {isDev ? (
        <section className="sp-section">
          <header className="sp-section-head">
            <h3>
              Data summary <span className="sp-tag">dev only</span>
            </h3>
            <p className="sp-section-hint">
              Per-source ingest counters. Updates every 5 s.
            </p>
          </header>
          <div className="sp-section-body">
            {sources.length === 0 ? (
              <p className="sp-empty">No data sources detected yet.</p>
            ) : (
              <ul className="sp-source-list">
                {sources.map((s) => (
                  <li key={s.name} className="sp-source-row">
                    <span className="sp-source-name">{s.name}</span>
                    <span className="sp-source-stat">
                      {s.events_count.toLocaleString()} events
                    </span>
                    <span className="sp-source-stat">
                      {s.last_ingest_at
                        ? new Date(s.last_ingest_at).toLocaleTimeString()
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
