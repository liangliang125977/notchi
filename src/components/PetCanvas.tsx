import { useEffect, useRef } from "react";
import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display/cubism4";
import { usePetStore } from "../stores/petStore";

const CANVAS_SIZE = 240;
const MODEL_URL = "/assets/live2d/mao/mao_pro.model3.json";
const IDLE_GROUP = "Idle";

Live2DModel.registerTicker(PIXI.Ticker);

export function PetCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    if (!containerRef.current) return;
    initializedRef.current = true;

    const container = containerRef.current;
    const setRenderMode = usePetStore.getState().setRenderMode;

    const app = new PIXI.Application({
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    container.appendChild(app.view as HTMLCanvasElement);

    let model: Live2DModel | null = null;
    let cancelled = false;

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        app.ticker.stop();
      } else {
        app.ticker.start();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    (async () => {
      try {
        const loaded = await Live2DModel.from(MODEL_URL);
        if (cancelled) {
          loaded.destroy();
          return;
        }
        model = loaded;

        const scale = Math.min(
          CANVAS_SIZE / loaded.width,
          CANVAS_SIZE / loaded.height,
        );
        loaded.scale.set(scale);
        loaded.anchor.set(0.5, 0.5);
        loaded.position.set(CANVAS_SIZE / 2, CANVAS_SIZE / 2);

        app.stage.addChild(loaded);

        const motions = loaded.internalModel.motionManager.definitions as
          | Record<string, unknown[] | undefined>
          | undefined;
        if (motions && Array.isArray(motions[IDLE_GROUP])) {
          await loaded.motion(IDLE_GROUP);
        }
      } catch (err) {
        console.error("[PetCanvas] failed to load Live2D model", err);
        setRenderMode("fallback");
      }
    })();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (model) {
        model.destroy({ children: true, texture: true, baseTexture: true });
        model = null;
      }
      app.destroy(true, { children: true, texture: true, baseTexture: true });
      initializedRef.current = false;
    };
  }, []);

  return <div ref={containerRef} className="pet-canvas" />;
}
