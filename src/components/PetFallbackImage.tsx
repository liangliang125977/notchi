import { usePetStore, type PetAction } from "../stores/petStore";

// SPEC §4 S15: when Live2D fails to load we render a static PNG of
// the same character. SPEC text calls for "idle/coding/done 三张";
// waiting/sleep are mapped onto idle for the MVP.
const ACTION_TO_FALLBACK: Record<PetAction, string> = {
  idle: "/assets/fallback/idle@2x.png",
  coding: "/assets/fallback/coding@2x.png",
  waiting: "/assets/fallback/idle@2x.png",
  done: "/assets/fallback/done@2x.png",
  sleep: "/assets/fallback/idle@2x.png",
};

export function PetFallbackImage() {
  const action = usePetStore((s) => s.currentAction);
  const src = ACTION_TO_FALLBACK[action];
  return (
    <img
      className="pet-fallback-img"
      src={src}
      alt={`Notchi (${action}, fallback render)`}
      draggable={false}
    />
  );
}
