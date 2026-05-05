import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// v1.1 — shape mirrors src-tauri/src/data/evolution.rs::PetStatus.
export type EvolutionStage = 0 | 1 | 2;

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

export function usePetStatus() {
  const [status, setStatus] = useState<PetStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
        if (!cancelled) {
          setStatus(next);
          setErr(null);
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

  return { status, err, refresh };
}
