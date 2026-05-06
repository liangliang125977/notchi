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

// mao: Idle(1) + unnamed group(6)
// Motion data: mtn_01(5.6s,swing=5.4) mtn_02(3.5s,3.5) mtn_03(4.4s,15) mtn_04(4.2s,17)
//              special_01(7.8s,14) special_02(9.4s,23) special_03(9.2s,8.5)
// idle=calm loop, coding=medium active, waiting=very calm, done=most energetic
const maoMotions: ActionMotions = {
  idle:    { group: "Idle", index: 0 }, // mtn_01 5.6s swing=5.4
  coding:  { group: "",     index: 1 }, // mtn_03 4.4s swing=15
  waiting: { group: "",     index: 0 }, // mtn_02 3.5s swing=3.5 (subtle, patient)
  done:    { group: "",     index: 4 }, // special_02 9.4s swing=23 (most energetic)
};

// haru: Idle(2) + TapBody(4)
// Idle[0]=10.0s,12  Idle[1]=5.3s,30
// TapBody[0]=5.0s,9  [1]=4.5s,21  [2]=6.0s,30  [3]=4.0s,4
const haruMotions: ActionMotions = {
  idle:    { group: "Idle",    index: 0 }, // 10.0s swing=12 (long calm loop)
  coding:  { group: "TapBody", index: 0 }, // 5.0s swing=9  (moderate, focused)
  waiting: { group: "TapBody", index: 3 }, // 4.0s swing=4  (very subtle, patient)
  done:    { group: "TapBody", index: 2 }, // 6.0s swing=30 (energetic celebration)
};

// hiyori: Idle(9) + TapBody(1)
// Idle[0]=4.7s,16  [1]=5.9s,30  [2]=4.2s,17  [3]=8.6s,30  [4]=5.4s,25
// [5]=1.9s,8  [6]=2.1s,15  [7]=1.6s,1.6  [8]=4.2s,8.1
// TapBody[0]=4.4s,18
const hiyoriMotions: ActionMotions = {
  idle:    { group: "Idle",    index: 0 }, // 4.7s swing=16 (standard calm)
  coding:  { group: "Idle",    index: 5 }, // 1.9s swing=8  (short, focused)
  waiting: { group: "Idle",    index: 7 }, // 1.6s swing=1.6 (barely moving, still)
  done:    { group: "TapBody", index: 0 }, // 4.4s swing=18 (reactive, celebratory)
};

// mark: Idle(6) only
// Idle[0]=10.4s,13  [1]=4.8s,30  [2]=2.0s,14  [3]=4.8s,27.9  [4]=4.0s,30  [5]=1.4s,12
const markMotions: ActionMotions = {
  idle:    { group: "Idle", index: 0 }, // 10.4s swing=13 (long calm loop)
  coding:  { group: "Idle", index: 5 }, // 1.4s  swing=12 (short, sharp, focused)
  waiting: { group: "Idle", index: 2 }, // 2.0s  swing=14 (short, mild movement)
  done:    { group: "Idle", index: 4 }, // 4.0s  swing=30 (most energetic)
};

// natori: Idle(3) + TapBody(5)
// Idle[0]=8.0s,8  [1]=5.0s,14  [2]=5.5s,5.5
// TapBody[0]=5.0s,10  [1]=3.3s,4  [2]=5.0s,7.2  [3]=3.3s,10  [4]=4.0s,4
const natoriMotions: ActionMotions = {
  idle:    { group: "Idle",    index: 0 }, // 8.0s swing=8  (long, very calm)
  coding:  { group: "Idle",    index: 1 }, // 5.0s swing=14 (active, engaged)
  waiting: { group: "Idle",    index: 2 }, // 5.5s swing=5.5 (subdued, patient)
  done:    { group: "TapBody", index: 0 }, // 5.0s swing=10 (tap reaction = done!)
};

// rice: Idle(1) + TapBody(3)
// Idle[0]=4.0s,4
// TapBody[0]=6.0s,30  [1]=5.0s,9  [2]=8.0s,30
const riceMotions: ActionMotions = {
  idle:    { group: "Idle",    index: 0 }, // 4.0s swing=4  (calm baseline)
  coding:  { group: "TapBody", index: 1 }, // 5.0s swing=9  (moderate active)
  waiting: { group: "TapBody", index: 0 }, // 6.0s swing=30 (chibi bouncy impatience)
  done:    { group: "TapBody", index: 2 }, // 8.0s swing=30 (longest celebration)
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
