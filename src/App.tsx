import { useRef } from "react";
import "./App.css";
import { PetCanvas } from "./components/PetCanvas";
import { PetFallbackImage } from "./components/PetFallbackImage";
import { usePetWindowDrag } from "./hooks/usePetWindowDrag";
import { useFallbackEvents } from "./hooks/useFallbackEvents";
import { usePetStore } from "./stores/petStore";

function App() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const renderMode = usePetStore((s) => s.renderMode);

  // Drag is wired to the wrapper so both render modes get it (SPEC
  // §4 S8 + S15 — fallback must keep all functionality).
  usePetWindowDrag({ targetRef: wrapperRef });
  useFallbackEvents();

  return (
    <div className="pet-window">
      <div ref={wrapperRef} className="pet-canvas">
        {renderMode === "live2d" ? <PetCanvas /> : <PetFallbackImage />}
      </div>
    </div>
  );
}

export default App;
