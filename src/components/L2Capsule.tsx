import { AnimatePresence, motion } from "framer-motion";
import { useTokenSnapshot, snapshotDeltaPct } from "../hooks/useTokenSnapshot";
import {
  formatCost,
  formatModel,
  formatPercentDelta,
  formatRelativeMinutes,
  formatTokens,
  shortProjectPath,
} from "../lib/format";

// SPEC §5.3 — second-level glanceable card. Apple-flavoured: SF Pro,
// vibrancy backdrop, tabular-nums, minimal chrome. Two stacked rows:
//   Today 2.3M  ↑12%   $4.21   ●Sonnet 4.6
//   Now: ai-coding · 185k tokens · 14m elapsed
// Sits in the right 240×240 of the expanded 480×240 pet window.

interface Props {
  visible: boolean;
}

const SPRING = { type: "spring" as const, stiffness: 400, damping: 30 };

export function L2Capsule({ visible }: Props) {
  const snap = useTokenSnapshot(visible);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          className="l2-capsule"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 16 }}
          transition={SPRING}
        >
          <Row1 snap={snap} />
          <Row2 snap={snap} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Row1({ snap }: { snap: ReturnType<typeof useTokenSnapshot> }) {
  const tokens =
    snap.summary != null
      ? snap.summary.total_input + snap.summary.total_output
      : null;
  const delta = snapshotDeltaPct(snap);
  return (
    <div className="l2-row l2-row-1">
      <span className="l2-label">Today</span>
      <span className="l2-num l2-tokens">
        {tokens === null ? "—" : formatTokens(tokens)}
      </span>
      <span
        className={
          "l2-delta " +
          (delta == null
            ? ""
            : delta > 0
              ? "is-up"
              : delta < 0
                ? "is-down"
                : "is-flat")
        }
      >
        {formatPercentDelta(delta)}
      </span>
      <span className="l2-cost">
        {snap.summary ? formatCost(snap.summary.total_cost_usd) : "—"}
      </span>
      <span className="l2-model">
        <span className="l2-model-dot" aria-hidden="true">
          ●
        </span>
        {formatModel(snap.summary?.dominant_model ?? null)}
      </span>
    </div>
  );
}

function Row2({ snap }: { snap: ReturnType<typeof useTokenSnapshot> }) {
  const r = snap.recent;
  if (!r) {
    return (
      <div className="l2-row l2-row-2">
        <span className="l2-row-2-text">No sessions yet today.</span>
      </div>
    );
  }
  return (
    <div className="l2-row l2-row-2">
      <span
        className={
          "l2-row-2-prefix " + (snap.recentActive ? "is-active" : "is-idle")
        }
      >
        {snap.recentActive ? "Now" : "Last"}
      </span>
      <span className="l2-row-2-project">
        {shortProjectPath(r.project_path)}
      </span>
      <span className="l2-row-2-sep">·</span>
      <span className="l2-num">{formatTokens(r.total_tokens)}</span>
      <span className="l2-row-2-tail">
        {" "}
        tokens · {formatRelativeMinutes(snap.recentRelativeIso)}
      </span>
    </div>
  );
}
