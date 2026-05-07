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
import { type ActionMotions, getModelById } from "../lib/petModels";

const CANVAS_SIZE = 240;
const DEFAULT_MODEL_URL = "/assets/live2d/mao/mao_pro.model3.json";

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

async function playMotion(model: Live2DModel, action: PetAction, motions: ActionMotions) {
  if (action === "sleep") {
    return;
  }
  const mapping = motions[action];
  try {
    await model.motion(mapping.group, mapping.index, MotionPriority.FORCE);
  } catch (err) {
    console.error("[PetCanvas] motion() failed", { action, err });
  }
}

interface PetCanvasProps {
  size?: number;
  modelUrl?: string;
  actionMotions?: ActionMotions;
}

export function PetCanvas({
  size = CANVAS_SIZE,
  modelUrl = DEFAULT_MODEL_URL,
  actionMotions = getModelById("mao").actionMotions,
}: PetCanvasProps) {
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
    const canvas = app.view as HTMLCanvasElement;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    container.appendChild(canvas);

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
        const loaded = await Live2DModel.from(modelUrl);
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

        // Sleep override strategy (after several iterations):
        // 1. Disable the auto-blink controller when entering sleep so
        //    nothing automatically re-opens the eyes between motion ticks.
        // 2. Wrap `loaded.update` (the entry point that PIXI's ticker
        //    actually invokes) so our eye=0 write runs inline at the
        //    end of each frame's model update — guaranteed last
        //    writer before the renderer flushes the parameter buffer.
        const live2dModel = loaded as unknown as {
          update: (...args: unknown[]) => unknown;
        };
        const internalModelRef = loaded.internalModel as unknown as {
          eyeBlink: unknown;
        };
        const origUpdate = live2dModel.update.bind(live2dModel);
        const origEyeBlink = internalModelRef.eyeBlink;
        live2dModel.update = function (...args: unknown[]) {
          const ret = origUpdate(...args);
          if (usePetStore.getState().currentAction === "sleep") {
            applySleepEyelids(loaded);
          }
          return ret;
        };
        unsubscribeAfterMotion = () => {
          live2dModel.update = origUpdate;
          internalModelRef.eyeBlink = origEyeBlink;
        };

        await playMotion(loaded, usePetStore.getState().currentAction, actionMotions);

        let lastAction = usePetStore.getState().currentAction;
        unsubscribeStore = usePetStore.subscribe((state) => {
          if (state.currentAction === lastAction) return;
          const next = state.currentAction;
          lastAction = next;
          if (!model) return;
          if (next === "sleep") {
            loaded.internalModel.motionManager.stopAllMotions();
            internalModelRef.eyeBlink = null;
            applySleepEyelids(model);
          } else {
            internalModelRef.eyeBlink = origEyeBlink;
            void playMotion(model, next, actionMotions);
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

  return <div ref={containerRef} className="pet-canvas-inner" style={{ width: size, height: size }} />;
}
