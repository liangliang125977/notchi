import { useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { EvolutionStage } from "../hooks/usePetStatus";

// v1.1 polish — one-shot "you evolved" cinematic. Twelve sparkle / star
// emoji burst out from the pet's centre, spring + fade, ~3.5 s total.
// Mounted unconditionally; the `stage` prop drives AnimatePresence.

interface Props {
  stage: EvolutionStage | null;
  onDone: () => void;
}

const STAGE_EMOJI: Record<EvolutionStage, string> = {
  0: "🥚",
  1: "🐣",
  2: "✨",
};

const PARTICLE_GLYPHS = [
  "✨",
  "⭐",
  "🌟",
  "💫",
  "✨",
  "⭐",
  "🌟",
  "💫",
  "✨",
  "⭐",
  "🌟",
  "💫",
];

const BURST_MS = 3500;

export function EvolutionBurst({ stage, onDone }: Props) {
  // Twelve evenly-spaced angles + a stage-dependent phase shift so
  // consecutive evolutions don't look identical. Pure — kept inside
  // useMemo only so the trig isn't recomputed on every render.
  const angles = useMemo(() => {
    const phase = ((stage ?? 0) + 1) * 0.13;
    return PARTICLE_GLYPHS.map(
      (_, i) => (i / PARTICLE_GLYPHS.length) * Math.PI * 2 + phase,
    );
  }, [stage]);

  useEffect(() => {
    if (stage == null) return;
    const t = window.setTimeout(onDone, BURST_MS);
    return () => window.clearTimeout(t);
  }, [stage, onDone]);

  return (
    <AnimatePresence>
      {stage != null ? (
        <motion.div
          className="evolution-burst"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          aria-hidden
        >
          {PARTICLE_GLYPHS.map((glyph, i) => {
            const angle = angles[i];
            const distance = 70 + (i % 3) * 14;
            const dx = Math.cos(angle) * distance;
            const dy = Math.sin(angle) * distance;
            return (
              <motion.span
                key={`${stage}-${i}`}
                className="evolution-burst-glyph"
                initial={{ x: 0, y: 0, scale: 0.4, opacity: 0 }}
                animate={{
                  x: dx,
                  y: dy,
                  scale: [0.4, 1.1, 0.85],
                  opacity: [0, 1, 0],
                }}
                transition={{
                  duration: 1.6,
                  ease: [0.34, 1.56, 0.64, 1],
                  times: [0, 0.4, 1],
                  delay: i * 0.04,
                }}
              >
                {glyph}
              </motion.span>
            );
          })}
          <motion.div
            className="evolution-burst-center"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{
              scale: [0.4, 1.4, 1.1],
              opacity: [0, 1, 1],
            }}
            transition={{
              duration: 1.0,
              ease: [0.34, 1.56, 0.64, 1],
              times: [0, 0.5, 1],
            }}
          >
            {STAGE_EMOJI[stage]}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
