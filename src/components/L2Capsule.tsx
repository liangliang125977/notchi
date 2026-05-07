import { AnimatePresence, motion } from "framer-motion";
import { useTokenSnapshot, snapshotDeltaPct } from "../hooks/useTokenSnapshot";
import {
  formatModel,
  formatRelativeMinutes,
  formatTokens,
  modelFamily,
  shortSessionLabel,
} from "../lib/format";

// SPEC §5.3 — second-level glanceable card, two-row Dynamic Island variant
// to match macOS Sonoma / Raycast / iStat Menus style. Sits in the right
// half of the expanded pet window, hugging the pet's right edge.
//
//   [● Sonnet 4]  509K  ↑12%
//   ● ai-coding  14m
//
// Empty fields collapse rather than render placeholders.

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
          initial={{ opacity: 0, scale: 0.95, y: -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -4 }}
          transition={SPRING}
        >
          <CapsuleRow snap={snap} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function CapsuleRow({ snap }: { snap: ReturnType<typeof useTokenSnapshot> }) {
  const tokens =
    snap.summary != null
      ? snap.summary.total_input + snap.summary.total_output
      : null;
  const delta = snapshotDeltaPct(snap);
  const modelName = snap.summary?.dominant_model ?? null;
  const family = modelFamily(modelName);
  const recent = snap.recent;
  const sessionLabel = shortSessionLabel(recent?.project_path);
  const elapsed = recent ? formatRelativeMinutes(snap.recentRelativeIso) : null;

  // Collapse the whole capsule to a quiet idle state when there's no
  // signal at all — better than a row of "—" placeholders.
  const empty = tokens === null && !recent;
  if (empty) {
    return (
      <div className="l2-rows">
        <div className="l2-row">
          <span className="l2-idle">No activity yet today</span>
        </div>
      </div>
    );
  }

  const hasPrimary = modelName !== null || tokens !== null;
  const hasSecondary = sessionLabel !== null;

  return (
    <div className="l2-rows">
      {hasPrimary ? (
        <div className="l2-row l2-row-primary">
          {modelName ? (
            <span className={"l2-chip-model l2-fam-" + family}>
              <span className="l2-chip-dot" aria-hidden="true" />
              {formatModel(modelName)}
            </span>
          ) : null}

          {tokens !== null ? (
            <span className="l2-num l2-tokens">{formatTokens(tokens)}</span>
          ) : null}

          {delta !== null ? (
            <span
              className={
                "l2-delta " +
                (delta > 0 ? "is-up" : delta < 0 ? "is-down" : "is-flat")
              }
            >
              {delta > 0 ? "↑" : delta < 0 ? "↓" : "·"}
              {Math.abs(delta).toFixed(0)}%
            </span>
          ) : null}
        </div>
      ) : null}

      {hasSecondary ? (
        <div className="l2-row l2-row-secondary">
          {sessionLabel ? (
            <>
              <span
                className={
                  "l2-session " + (snap.recentActive ? "is-active" : "is-idle")
                }
              >
                {snap.recentActive ? (
                  <span className="l2-pulse" aria-hidden="true" />
                ) : null}
                {sessionLabel}
              </span>
              {elapsed ? <span className="l2-elapsed">{elapsed}</span> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
