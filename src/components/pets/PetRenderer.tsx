import type { PetEngineProps } from "./PetEngineProps";
import { Live2DEngine } from "./engines/Live2DEngine";
import { LottieEngine } from "./engines/LottieEngine";
import { SpriteEngine } from "./engines/SpriteEngine";

export function PetRenderer(props: PetEngineProps) {
  switch (props.manifest.engine) {
    case "live2d":
      return <Live2DEngine {...props} />;
    case "lottie":
      return <LottieEngine {...props} />;
    case "sprite":
      return <SpriteEngine {...props} />;
  }
}
