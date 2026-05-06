import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// v1.1 — shape mirrors src-tauri/src/data/evolution.rs::PetStatus.
export type EvolutionStage = 0 | 1 | 2;

const LAST_STAGE_KEY = "notchi.evolution.lastStage";

export interface EvolutionStatus {
  stage: EvolutionStage;
  name: string;
  total_tokens: number;
  next_threshold: number | null;
  progress_pct: number;
}

export interface FeedLogEntry {
  at: string;
  source: string | null;
  model: string | null;
}

export type Mood = "hungry" | "content" | "happy";

export interface PetStatus {
  feed_level: number;
  mood: Mood;
  fed_at: string | null;
  evolution: EvolutionStatus;
  recent_feeds: FeedLogEntry[];
}

const REFRESH_MS = 60_000;

function readLastStage(): EvolutionStage | null {
  try {
    const raw = window.localStorage.getItem(LAST_STAGE_KEY);
    if (raw == null) return null;
    const n = Number.parseInt(raw, 10);
    if (n === 0 || n === 1 || n === 2) return n;
    return null;
  } catch {
    return null;
  }
}

function writeLastStage(stage: EvolutionStage): void {
  try {
    window.localStorage.setItem(LAST_STAGE_KEY, String(stage));
  } catch {
    /* private browsing / quota — non-fatal */
  }
}

export function usePetStatus() {
  const [status, setStatus] = useState<PetStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // v1.1 polish — when stage advances across the lifetime of the app
  // (including across cold restarts via localStorage), bump this so
  // App.tsx can fire a one-shot evolution burst animation. `null`
  // means "no pending transition"; a number means "stage just rose
  // to this value, please play the cinematic".
  const [evolutionUp, setEvolutionUp] = useState<EvolutionStage | null>(null);
  const prevStageRef = useRef<EvolutionStage | null>(readLastStage());

  const acknowledgeEvolutionUp = useCallback(() => {
    setEvolutionUp(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<PetStatus>("pet_status");
      setStatus(next);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlistenCompleted: (() => void) | null = null;

    const load = async () => {
      try {
        const next = await invoke<PetStatus>("pet_status");
        if (cancelled) return;
        setStatus(next);
        setErr(null);
        const cur = next.evolution.stage as EvolutionStage;
        const prev = prevStageRef.current;
        if (prev != null && cur > prev) {
          setEvolutionUp(cur);
        }
        if (prev !== cur) {
          prevStageRef.current = cur;
          writeLastStage(cur);
        }
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    };

    void load();
    const t = window.setInterval(() => void load(), REFRESH_MS);

    void (async () => {
      try {
        unlistenCompleted = await listen("pet:task-completed", () => {
          // Re-pull after the backend records the feed; small delay so
          // the record_feed round-trip lands first.
          window.setTimeout(() => void load(), 250);
        });
      } catch (e) {
        console.error("[pet-status] task-completed listen failed", e);
      }
    })();

    return () => {
      cancelled = true;
      window.clearInterval(t);
      unlistenCompleted?.();
    };
  }, []);

  return { status, err, refresh, evolutionUp, acknowledgeEvolutionUp };
}
