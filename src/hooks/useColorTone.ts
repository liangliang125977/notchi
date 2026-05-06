import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SettingsBundle, TokenSummary } from "../lib/dataTypes";

// v1.3 hardening — the settings window emits this after saving a
// new monthly budget so the pet window can refresh its tone filter
// without waiting up to 60 s for the next poll.
const BUDGET_CHANGED_EVENT = "settings:budget-changed";

// SPEC §4 S3 + §5.2 — pet color reflects monthly spend / monthly
// budget. We poll the cheap aggregate every minute (IPC + a single
// SQL `SUM`) which is well inside SPEC §6.1's CPU budget. The filter
// is computed once per ratio change and applied in the parent
// wrapper so it covers both Live2D canvas and the static fallback.

const REFRESH_MS = 60_000;

export type ColorToneFilter = string | null;

interface ToneState {
  filter: ColorToneFilter;
  ratio: number | null;
}

export function useColorTone(): ToneState {
  const [state, setState] = useState<ToneState>({ filter: null, ratio: null });

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const [summary, settings] = await Promise.all([
          invoke<TokenSummary>("token_summary", { period: "month" }),
          invoke<SettingsBundle>("get_settings"),
        ]);
        if (cancelled) return;
        const budget = settings.monthly_budget_usd ?? 0;
        if (!budget || budget <= 0) {
          setState({ filter: null, ratio: null });
        } else {
          const cost = Number.parseFloat(summary.total_cost_usd) || 0;
          const ratio = cost / budget;
          setState({ filter: filterFor(ratio), ratio });
        }
      } catch (err) {
        // Keep last good filter — SPEC §6.1 says color must always
        // resolve in <100ms, but a transient IPC blip should not
        // strobe the pet.
        console.error("[useColorTone] refresh failed", err);
      }
    };

    void tick();
    timer = window.setInterval(() => void tick(), REFRESH_MS);

    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        unlisten = await listen(BUDGET_CHANGED_EVENT, () => {
          void tick();
        });
      } catch (err) {
        console.error("[useColorTone] budget-changed listen failed", err);
      }
    })();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      unlisten?.();
    };
  }, []);

  return state;
}

function filterFor(ratio: number): ColorToneFilter {
  if (ratio < 0.5) return null;
  if (ratio < 0.8) return "sepia(0.2) hue-rotate(-15deg) saturate(1.1)";
  if (ratio < 1.0) return "sepia(0.35) hue-rotate(-30deg) saturate(1.3)";
  return "grayscale(0.4) brightness(0.85)";
}
