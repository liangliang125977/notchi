import { useRef } from "react";
import "./App.css";
import { PetCanvas } from "./components/PetCanvas";
import { PetFallbackImage } from "./components/PetFallbackImage";
import { L2Capsule } from "./components/L2Capsule";
import { WelcomeCard } from "./components/WelcomeCard";
import { PetBubble } from "./components/PetBubble";
import { EvolutionBadge } from "./components/EvolutionBadge";
import { usePetWindowDrag } from "./hooks/usePetWindowDrag";
import { useFallbackEvents } from "./hooks/useFallbackEvents";
import { useColorTone } from "./hooks/useColorTone";
import { usePetHoverExpand } from "./hooks/usePetHoverExpand";
import { useEmotionEngine } from "./hooks/useEmotionEngine";
import { usePetStore } from "./stores/petStore";

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
          filter: filter ?? "none",
          transition: "filter 1.5s ease",
        }}
      >
        {renderMode === "live2d" ? <PetCanvas /> : <PetFallbackImage />}
      </div>
      <L2Capsule visible={expanded} />
      <PetBubble />
      <EvolutionBadge />
      <WelcomeCard />
    </div>
  );
}

export default App;
