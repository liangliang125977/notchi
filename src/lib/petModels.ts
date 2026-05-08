// Deprecated. Pet metadata now lives in public/assets/pets/<id>/manifest.json
// and is loaded via petRegistry. This file derives the legacy shape from
// the registry so older call sites (PetPanel.tsx) keep working until
// they migrate. Removed in v0.3.

import { listPets, getPet, defaultPet } from "./petRegistry";
import type { PetManifest } from "./petManifest";

export interface ActionMapping {
  group: string;
  index: number;
}

export type ActionMotions = Record<
  "idle" | "coding" | "waiting" | "done",
  ActionMapping
>;

export interface PetModel {
  id: string;
  name: string;
  description: string;
  modelPath: string;
  actionMotions: ActionMotions;
}

function manifestToModel(m: PetManifest): PetModel {
  const opts = (k: keyof ActionMotions): ActionMapping => {
    const o = m.actions[k].options;
    if (
      o &&
      typeof o === "object" &&
      "group" in o &&
      "index" in o &&
      typeof (o as { group: unknown }).group === "string" &&
      typeof (o as { index: unknown }).index === "number"
    ) {
      return o as unknown as ActionMapping;
    }
    // Non-Live2D pets do not carry group/index — return a neutral default
    // so legacy callers do not crash. They should not be using these
    // fields anyway when the engine is not "live2d".
    return { group: "Idle", index: 0 };
  };
  return {
    id: m.id,
    name: m.name,
    description: m.description ?? "",
    modelPath: m.actions.idle.src,
    actionMotions: {
      idle: opts("idle"),
      coding: opts("coding"),
      waiting: opts("waiting"),
      done: opts("done"),
    },
  };
}

/** @deprecated Use listPets() from petRegistry. */
export const PET_MODELS: PetModel[] = listPets().map(manifestToModel);

/** @deprecated */
export const DEFAULT_MODEL_ID: string = defaultPet()?.id ?? "mao";

/** @deprecated Use getPet() from petRegistry. */
export function getModelById(id: string): PetModel {
  const m = getPet(id) ?? defaultPet();
  if (!m) {
    throw new Error("[petModels] no pets registered");
  }
  return manifestToModel(m);
}
