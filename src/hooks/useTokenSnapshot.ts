import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  IngestStatus,
  SessionRow,
  TimeseriesPoint,
  TokenSummary,
} from "../lib/dataTypes";
import { percentChange } from "../lib/format";

// L2 capsule snapshot. We pull today + a 7-day series so we can compute
// the simple delta vs. yesterday SPEC §5.3 wants ("Today X ↑12%").
// Refreshes every 30s while expanded → SPEC §6.1 numbers stay tame.

export interface TokenSnapshot {
  summary: TokenSummary | null;
  status: IngestStatus | null;
  recent: SessionRow | null;
  recentActive: boolean;
  recentRelativeIso: string | null;
  yesterdayTokens: number | null;
  yesterdayCost: number | null;
  loading: boolean;
}

const REFRESH_MS = 30_000;

export function useTokenSnapshot(active: boolean): TokenSnapshot {
  const [snap, setSnap] = useState<TokenSnapshot>({
    summary: null,
    status: null,
    recent: null,
    recentActive: false,
    recentRelativeIso: null,
    yesterdayTokens: null,
    yesterdayCost: null,
    loading: false,
  });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: number | null = null;

    const load = async () => {
      setSnap((s) => ({ ...s, loading: true }));
      try {
        const [summary, series, sessions, status] = await Promise.all([
          invoke<TokenSummary>("token_summary", { period: "today" }),
          invoke<TimeseriesPoint[]>("token_timeseries", { period: "week" }),
          invoke<SessionRow[]>("recent_sessions", { limit: 1 }),
          invoke<IngestStatus>("ingest_status"),
        ]);
        if (cancelled) return;

        // The week timeseries returns daily buckets `YYYY-MM-DD`.
        // Yesterday = today's local date minus 1 day.
        const today = new Date();
        const y = new Date(today);
        y.setDate(y.getDate() - 1);
        const yKey = y.toISOString().slice(0, 10);
        const yRow = series.find((p) => p.bucket === yKey);

        const recent = sessions[0] ?? null;
        let recentActive = false;
        let recentRelativeIso: string | null = null;
        if (recent) {
          const sessionStart = Date.parse(recent.started_at);
          const ingestAt = status.last_ingest_at
            ? Date.parse(status.last_ingest_at)
            : 0;
          const now = Date.now();
          const ageMin = (now - sessionStart) / 60_000;
          const ingestStaleMin = (now - ingestAt) / 60_000;
          recentActive = ageMin < 30 && ingestStaleMin < 5;
          recentRelativeIso = status.last_ingest_at ?? recent.started_at;
        }

        setSnap({
          summary,
          status,
          recent,
          recentActive,
          recentRelativeIso,
          yesterdayTokens: yRow ? yRow.tokens : 0,
          yesterdayCost: yRow ? Number.parseFloat(yRow.cost_usd) : 0,
          loading: false,
        });
      } catch (err) {
        if (cancelled) return;
        console.error("[useTokenSnapshot] failed", err);
        setSnap((s) => ({ ...s, loading: false }));
      }
    };

    void load();
    timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [active]);

  return snap;
}

export function snapshotDeltaPct(s: TokenSnapshot): number | null {
  if (!s.summary || s.yesterdayTokens === null) return null;
  const todayTokens = s.summary.total_input + s.summary.total_output;
  return percentChange(todayTokens, s.yesterdayTokens);
}
