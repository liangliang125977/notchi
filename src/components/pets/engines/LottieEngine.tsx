// v0.2 redesign — Lottie engine. Each manifest action points to a JSON
// file (or the same file across all five for v1 simplicity). We fetch
// once per (manifest, action) and feed the parsed animation data to
// lottie-react. `key={action}` forces an unmount when the action
// changes so the new clip starts from frame 0.

import { useEffect, useState } from "react";
import Lottie from "lottie-react";
import type { PetEngineProps } from "../PetEngineProps";
import { petAssetUrl } from "../../../lib/petRegistry";

export function LottieEngine({
  size,
  action,
  manifest,
  onActionEnd,
}: PetEngineProps) {
  const spec = manifest.actions[action];
  const url = petAssetUrl(manifest, spec.src);
  const [data, setData] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    void fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setData(j);
      })
      .catch((err) => {
        console.error(`[LottieEngine] failed to load ${url}`, err);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!data) {
    return <div style={{ width: size, height: size }} />;
  }

  return (
    <Lottie
      key={action}
      animationData={data}
      loop={spec.loop ?? true}
      autoplay
      onComplete={() => onActionEnd?.(action)}
      style={{
        width: size,
        height: size,
        pointerEvents: "none",
      }}
    />
  );
}
