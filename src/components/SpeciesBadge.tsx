import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// SPEC §3 v1.2 — language-driven species badge. We can't ship multiple
// Live2D models in the MVP, so the species is surfaced as an emoji
// chip docked top-left of the pet window. Hover reveals dominant
// language + lock progress for the next species threshold.

interface SpeciesStatus {
  species: "cat" | "crab" | "gopher" | "snake" | "fox" | "other";
  emoji: string;
  language: string | null;
  top_project: string | null;
  total_tokens: number;
  lock_progress: number;
}

const REFRESH_MS = 5 * 60 * 1000;

export function SpeciesBadge() {
  const [status, setStatus] = useState<SpeciesStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await invoke<SpeciesStatus>("species_status");
        if (!cancelled) setStatus(next);
      } catch (err) {
        console.error("[species] status failed", err);
      }
    };
    void load();
    const t = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  if (!status) return null;

  const isUnlocked = status.species !== "cat" || status.lock_progress >= 1;
  const tooltip = buildTooltip(status);

  return (
    <div
      className={
        "species-badge species-" +
        status.species +
        (isUnlocked ? " is-unlocked" : "")
      }
      title={tooltip}
      role="img"
      aria-label={tooltip}
    >
      <span className="species-emoji" aria-hidden="true">
        {status.emoji}
      </span>
      {!isUnlocked && status.lock_progress > 0 ? (
        <span
          className="species-progress"
          style={{ width: `${Math.round(status.lock_progress * 100)}%` }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

function buildTooltip(s: SpeciesStatus): string {
  if (s.species === "cat") {
    if (s.language) {
      return `Cat · ${formatTokens(s.total_tokens)} tokens · keep coding to evolve`;
    }
    if (s.total_tokens > 0) {
      const pct = Math.round(s.lock_progress * 100);
      return `Cat · ${formatTokens(s.total_tokens)} tokens · ${pct}% to next form`;
    }
    return "Cat · no activity yet";
  }
  const lang = s.language ?? capitalise(s.species);
  return `${capitalise(s.species)} · ${lang} · ${formatTokens(s.total_tokens)} tokens`;
}

function capitalise(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}
