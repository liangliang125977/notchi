import { useEffect, useRef } from "react";
import "./App.css";
import { listen } from "@tauri-apps/api/event";
import { load } from "@tauri-apps/plugin-store";
import { PetCanvas } from "./components/PetCanvas";
import { PetFallbackImage } from "./components/PetFallbackImage";
import { L2Capsule } from "./components/L2Capsule";
import { SpeciesBadge } from "./components/SpeciesBadge";
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
import { usePetStore, PET_SIZE_SMALL, type PetSize } from "./stores/petStore";

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
  const petSize = usePetStore((s) => s.petSize);
  const setPetSize = usePetStore((s) => s.setPetSize);
  const petDim = petSize === "small" ? PET_SIZE_SMALL : 240;

  // Read initial size from settings.json and listen for live changes
  // from the Settings webview (two separate JS contexts — no shared store).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const store = await load("settings.json", { defaults: {}, autoSave: false });
        const stored = await store.get<PetSize>("petSize");
        if (!cancelled && stored) setPetSize(stored);
      } catch {
        // settings.json not yet created — default "large" is fine
      }
    })();
    return () => { cancelled = true; };
  }, [setPetSize]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ size: PetSize }>("pet:size-changed", (e) => {
      setPetSize(e.payload.size);
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, [setPetSize]);

  // Drag is wired to the pet slot so the expanded capsule never gets
  // dragged with it (SPEC §4 S8 + S15 — fallback must keep all
  // functionality).
  usePetWindowDrag({ targetRef: petSlotRef });
  useFallbackEvents();
  useEmotionEngine();

  const { filter } = useColorTone();
  const { expanded } = usePetHoverExpand({ rootRef: wrapperRef, petSize });
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
          width: petDim,
          height: petDim,
          flex: `0 0 ${petDim}px`,
          overflow: "hidden",
          filter: composedFilter || "none",
          transition: "filter 1.5s ease",
        }}
      >
        {renderMode === "live2d"
          ? <PetCanvas key={petSize} size={petDim} />
          : <PetFallbackImage size={petDim} />}
      </div>
      <L2Capsule visible={expanded} />
      <SpeciesBadge />
      <PetBubble />
      <EvolutionBadge />
      <EvolutionBurst stage={evolutionUp} onDone={acknowledgeEvolutionUp} />
      <WelcomeCard />
    </div>
  );
}

export default App;
