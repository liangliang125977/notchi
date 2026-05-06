import { useEffect, useRef } from "react";
import "./App.css";
import { PetCanvas } from "./components/PetCanvas";
import { PetFallbackImage } from "./components/PetFallbackImage";
import { L2Capsule } from "./components/L2Capsule";
import { WelcomeCard } from "./components/WelcomeCard";
import { PetBubble } from "./components/PetBubble";
import { EvolutionBadge } from "./components/EvolutionBadge";
import { EvolutionBurst } from "./components/EvolutionBurst";
import { usePetWindowDrag } from "./hooks/usePetWindowDrag";
import { useFallbackEvents } from "./hooks/useFallbackEvents";
import { useColorTone } from "./hooks/useColorTone";
import { usePetHoverExpand } from "./hooks/usePetHoverExpand";
import { useEmotionEngine } from "./hooks/useEmotionEngine";
import { usePetStatus, type EvolutionStage } from "./hooks/usePetStatus";
import { usePetStore } from "./stores/petStore";

const STAGE_BUBBLE: Record<EvolutionStage, string> = {
  0: "孵化中…🥚",
  1: "破壳啦！🐣",
  2: "成体了！✨",
};

// v1.1 — three stage outline filters. Egg gets a soft warm aura,
// Hatchling a brighter golden glow, Adult a stronger blue-shifted halo.
// Combined with the SPEC §5.2 budget tone filter via space-join.
function stageFilter(stage: number | undefined): string | null {
  switch (stage) {
    case 0:
      return "drop-shadow(0 0 2px rgba(255, 230, 180, 0.55))";
    case 1:
      return "drop-shadow(0 0 4px rgba(255, 215, 100, 0.85))";
    case 2:
      return "drop-shadow(0 0 5px rgba(120, 180, 255, 0.85)) drop-shadow(0 0 12px rgba(120, 180, 255, 0.4))";
    default:
      return null;
  }
}

function App() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const petSlotRef = useRef<HTMLDivElement | null>(null);
  const renderMode = usePetStore((s) => s.renderMode);

  // Drag is wired to the pet slot so the expanded capsule never gets
  // dragged with it (SPEC §4 S8 + S15 — fallback must keep all
  // functionality).
  usePetWindowDrag({ targetRef: petSlotRef });
  useFallbackEvents();
  useEmotionEngine();

  const { filter } = useColorTone();
  const { expanded } = usePetHoverExpand({ rootRef: wrapperRef });
  const {
    status: petStatus,
    evolutionUp,
    acknowledgeEvolutionUp,
  } = usePetStatus();
  const stageOutline = stageFilter(petStatus?.evolution.stage);
  const composedFilter = [filter, stageOutline].filter(Boolean).join(" ");

  const showBubble = usePetStore((s) => s.showBubble);
  const setAction = usePetStore((s) => s.setAction);
  useEffect(() => {
    if (evolutionUp == null) return;
    setAction("done");
    showBubble(STAGE_BUBBLE[evolutionUp], 4000);
  }, [evolutionUp, setAction, showBubble]);

  return (
    <div
      className="pet-window"
      ref={wrapperRef}
      data-expanded={expanded ? "true" : "false"}
    >
      <div
        ref={petSlotRef}
        className="pet-canvas"
        style={{
          filter: composedFilter || "none",
          transition: "filter 1.5s ease",
        }}
      >
        {renderMode === "live2d" ? <PetCanvas /> : <PetFallbackImage />}
      </div>
      <L2Capsule visible={expanded} />
      <PetBubble />
      <EvolutionBadge />
      <EvolutionBurst stage={evolutionUp} onDone={acknowledgeEvolutionUp} />
      <WelcomeCard />
    </div>
  );
}

export default App;
