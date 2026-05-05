import { useEffect, useRef } from "react";
import * as PIXI from "pixi.js";
import { Live2DModel, MotionPriority } from "pixi-live2d-display/cubism4";
import { listen } from "@tauri-apps/api/event";
import {
  PET_SET_ACTION_EVENT,
  usePetStore,
  type PetAction,
  type PetSetActionPayload,
} from "../stores/petStore";

const CANVAS_SIZE = 240;
const MODEL_URL = "/assets/live2d/mao/mao_pro.model3.json";

interface ActionMapping {
  group: string;
  index: number;
}

// SPEC §5.2 + CHANGELOG T1.5 — see `mao_pro.model3.json` for the
// underlying motion list. Mao_Pro ships only `Idle` + 6 unlabelled
// motions, so the four non-idle states are mapped to special_0x picks
// chosen for visual distinctness; the mapping is documented in
// CHANGELOG and intentionally heuristic for MVP.
const ACTION_MOTION: Record<Exclude<PetAction, "sleep">, ActionMapping> = {
  idle: { group: "Idle", index: 0 },
  coding: { group: "", index: 1 },
  waiting: { group: "", index: 4 },
  done: { group: "", index: 5 },
};

const EYE_PARAM_IDS = ["ParamEyeLOpen", "ParamEyeROpen"] as const;

Live2DModel.registerTicker(PIXI.Ticker);

interface CoreModelLike {
  setParameterValueById?: (id: string, value: number, weight?: number) => void;
}

function applySleepEyelids(model: Live2DModel) {
  const core = model.internalModel.coreModel as unknown as CoreModelLike;
  if (typeof core.setParameterValueById !== "function") return;
  for (const id of EYE_PARAM_IDS) {
    core.setParameterValueById(id, 0);
  }
}

async function playMotion(model: Live2DModel, action: PetAction) {
  if (action === "sleep") {
    return;
  }
  const mapping = ACTION_MOTION[action];
  try {
    await model.motion(mapping.group, mapping.index, MotionPriority.FORCE);
  } catch (err) {
    console.error("[PetCanvas] motion() failed", { action, err });
  }
}

export function PetCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    if (!containerRef.current) return;
    initializedRef.current = true;

    const container = containerRef.current;
    const setRenderMode = usePetStore.getState().setRenderMode;
    const setAction = usePetStore.getState().setAction;

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
    let unsubscribeStore: (() => void) | null = null;
    let unsubscribeAfterMotion: (() => void) | null = null;
    let unlistenTauri: (() => void) | null = null;

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

        // Sleep override: eyelid params have to be re-applied every
        // frame after the motion system writes them, otherwise the
        // active motion (or idle blink) re-opens the eyes.
        const onAfterMotionUpdate = () => {
          if (!model) return;
          if (usePetStore.getState().currentAction === "sleep") {
            applySleepEyelids(model);
          }
        };
        const motionEmitter = loaded.internalModel.motionManager as unknown as {
          on: (event: string, fn: () => void) => void;
          off: (event: string, fn: () => void) => void;
        };
        motionEmitter.on("afterMotionUpdate", onAfterMotionUpdate);
        unsubscribeAfterMotion = () => {
          motionEmitter.off("afterMotionUpdate", onAfterMotionUpdate);
        };

        await playMotion(loaded, usePetStore.getState().currentAction);

        let lastAction = usePetStore.getState().currentAction;
        unsubscribeStore = usePetStore.subscribe((state) => {
          if (state.currentAction === lastAction) return;
          const next = state.currentAction;
          lastAction = next;
          if (!model) return;
          if (next === "sleep") {
            // Halt any in-flight motion so the override is the only
            // writer of ParamEye*Open.
            loaded.internalModel.motionManager.stopAllMotions();
            applySleepEyelids(model);
          } else {
            void playMotion(model, next);
          }
        });

        unlistenTauri = await listen<PetSetActionPayload>(
          PET_SET_ACTION_EVENT,
          (event) => {
            const action = event.payload?.action;
            if (!action) return;
            setAction(action);
          },
        );
      } catch (err) {
        console.error("[PetCanvas] failed to load Live2D model", err);
        setRenderMode("fallback");
      }
    })();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      unsubscribeStore?.();
      unsubscribeAfterMotion?.();
      unlistenTauri?.();
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
