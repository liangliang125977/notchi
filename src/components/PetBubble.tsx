import { AnimatePresence, motion } from "framer-motion";
import { usePetStore } from "../stores/petStore";

// SPEC §5.6 — single-line bubble that floats above Mao's head.
// `position: absolute` so it lives outside the L2 capsule's flex flow
// and the pet window's drag target. Pointer events disabled so the
// bubble itself never swallows clicks intended for Mao or the L2.
export function PetBubble() {
  const bubble = usePetStore((s) => s.bubble);

  return (
    <AnimatePresence>
      {bubble ? (
        <motion.div
          key={bubble.id}
          className="pet-bubble"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, scale: 0.85, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 2 }}
          transition={{
            type: "spring",
            stiffness: 400,
            damping: 30,
            opacity: { duration: 0.18 },
          }}
        >
          <span className="pet-bubble-text">{bubble.text}</span>
          <span className="pet-bubble-arrow" aria-hidden="true" />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
