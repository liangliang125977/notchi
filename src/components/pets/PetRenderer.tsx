import type { PetEngineProps } from "./PetEngineProps";
import { Live2DEngine } from "./engines/Live2DEngine";

export function PetRenderer(props: PetEngineProps) {
  switch (props.manifest.engine) {
    case "live2d":
      return <Live2DEngine {...props} />;
    case "lottie":
    case "sprite":
      // Engines added in Tasks 7/8 — stub for now to keep the build green.
      return <div style={{ width: props.size, height: props.size }} />;
  }
}
