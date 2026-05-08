// v0.2 redesign — sprite engine. Renders any browser-decodable image
// asset (animated SVG, GIF, APNG) through a plain <img> tag. Browsers
// do not expose a "playback ended" event for these formats, so a
// one-shot action ends after a fixed timeout (default 1500ms, override
// via manifest options.duration).

import { useEffect } from "react";
import type { PetEngineProps } from "../PetEngineProps";
import { petAssetUrl } from "../../../lib/petRegistry";

export function SpriteEngine({
  size,
  action,
  manifest,
  onActionEnd,
}: PetEngineProps) {
  const spec = manifest.actions[action];
  const url = petAssetUrl(manifest, spec.src);

  useEffect(() => {
    if (spec.loop !== false) return;
    const ms =
      typeof spec.options?.["duration"] === "number"
        ? (spec.options["duration"] as number)
        : 1500;
    const t = setTimeout(() => onActionEnd?.(action), ms);
    return () => clearTimeout(t);
  }, [action, spec.loop, spec.options, onActionEnd]);

  return (
    <img
      key={action}
      src={url}
      width={size}
      height={size}
      draggable={false}
      style={{
        width: size,
        height: size,
        pointerEvents: "none",
        userSelect: "none",
      }}
      alt=""
    />
  );
}
