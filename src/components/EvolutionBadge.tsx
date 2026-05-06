import { useState } from "react";
import { usePetStatus, type EvolutionStage } from "../hooks/usePetStatus";

const STAGE_EMOJI: Record<EvolutionStage, string> = {
  0: "🥚",
  1: "🐣",
  2: "✨",
};

function formatThousands(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}

// v1.1 — small evolution chip pinned to the top-right of the pet
// window, away from the L2 capsule that occupies the right-of-pet
// region during hover-expand. Shows current stage emoji + a tooltip
// with the progress towards the next threshold.
export function EvolutionBadge() {
  const { status } = usePetStatus();
  const [hover, setHover] = useState(false);

  if (!status) return null;
  const { evolution } = status;
  const emoji = STAGE_EMOJI[evolution.stage as EvolutionStage] ?? "🥚";

  const tooltip =
    evolution.next_threshold != null
      ? `${formatThousands(evolution.total_tokens)} / ${formatThousands(
          evolution.next_threshold,
        )} to ${evolution.stage === 0 ? "Hatchling" : "Adult"}`
      : `Adult · ${formatThousands(evolution.total_tokens)} tokens lifetime`;

  return (
    <div
      className="evo-badge"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={tooltip}
      data-stage={evolution.stage}
    >
      <span className="evo-badge-emoji" aria-hidden="true">
        {emoji}
      </span>
      <span className="evo-badge-name">{evolution.name}</span>
      {hover ? (
        <div className="evo-badge-tooltip">
          <div className="evo-badge-tooltip-row">{tooltip}</div>
          <div className="evo-badge-bar" aria-hidden="true">
            <div
              className="evo-badge-bar-fill"
              style={{ width: `${Math.min(100, evolution.progress_pct)}%` }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
