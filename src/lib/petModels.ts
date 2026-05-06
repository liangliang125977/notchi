import type { PetAction } from "../stores/petStore";

export interface ActionMapping {
  group: string;
  index: number;
}

export type ActionMotions = Record<Exclude<PetAction, "sleep">, ActionMapping>;

export interface PetModel {
  id: string;
  name: string;
  description: string;
  modelPath: string;
  actionMotions: ActionMotions;
}

// mao: Idle(1) + unnamed group(6). Indices 0-5 in the unnamed group.
const maoMotions: ActionMotions = {
  idle:    { group: "Idle", index: 0 },
  coding:  { group: "",     index: 3 },
  waiting: { group: "",     index: 4 },
  done:    { group: "",     index: 5 },
};

// haru: Idle(2) + TapBody(4)
const haruMotions: ActionMotions = {
  idle:    { group: "Idle",    index: 0 },
  coding:  { group: "TapBody", index: 0 },
  waiting: { group: "TapBody", index: 1 },
  done:    { group: "TapBody", index: 3 },
};

// hiyori: Idle(9) + TapBody(1)
const hiyoriMotions: ActionMotions = {
  idle:    { group: "Idle",    index: 0 },
  coding:  { group: "Idle",    index: 2 },
  waiting: { group: "Idle",    index: 4 },
  done:    { group: "TapBody", index: 0 },
};

// mark: Idle(6) only
const markMotions: ActionMotions = {
  idle:    { group: "Idle", index: 0 },
  coding:  { group: "Idle", index: 2 },
  waiting: { group: "Idle", index: 3 },
  done:    { group: "Idle", index: 4 },
};

// natori: Idle(3) + TapBody(5)
const natoriMotions: ActionMotions = {
  idle:    { group: "Idle",    index: 0 },
  coding:  { group: "TapBody", index: 0 },
  waiting: { group: "TapBody", index: 1 },
  done:    { group: "TapBody", index: 4 },
};

// rice: Idle(1) + TapBody(3)
const riceMotions: ActionMotions = {
  idle:    { group: "Idle",    index: 0 },
  coding:  { group: "TapBody", index: 0 },
  waiting: { group: "TapBody", index: 1 },
  done:    { group: "TapBody", index: 2 },
};

export const PET_MODELS: PetModel[] = [
  {
    id: "mao",
    name: "Mao",
    description: "猫耳少女",
    modelPath: "/assets/live2d/mao/mao_pro.model3.json",
    actionMotions: maoMotions,
  },
  {
    id: "haru",
    name: "Haru",
    description: "活泼少女",
    modelPath: "/assets/live2d/haru/Haru.model3.json",
    actionMotions: haruMotions,
  },
  {
    id: "hiyori",
    name: "Hiyori",
    description: "长发少女",
    modelPath: "/assets/live2d/hiyori/Hiyori.model3.json",
    actionMotions: hiyoriMotions,
  },
  {
    id: "mark",
    name: "Mark",
    description: "青年男性",
    modelPath: "/assets/live2d/mark/Mark.model3.json",
    actionMotions: markMotions,
  },
  {
    id: "natori",
    name: "Natori",
    description: "优雅女性",
    modelPath: "/assets/live2d/natori/Natori.model3.json",
    actionMotions: natoriMotions,
  },
  {
    id: "rice",
    name: "Rice",
    description: "chibi 少女",
    modelPath: "/assets/live2d/rice/Rice.model3.json",
    actionMotions: riceMotions,
  },
];

export const DEFAULT_MODEL_ID = "mao";

export function getModelById(id: string): PetModel {
  return PET_MODELS.find((m) => m.id === id) ?? PET_MODELS[0];
}
