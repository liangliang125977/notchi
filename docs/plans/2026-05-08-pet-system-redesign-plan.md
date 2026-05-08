# Pet System Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hardcoded `petModels.ts` registry with a manifest-driven multi-engine pet system. Adding a new pet = drop a folder + `manifest.json` under `public/assets/pets/`. Live2D continues to work; Lottie + GIF/APNG become first-class.

**Architecture:** Single `PetRenderer` component switches by `manifest.engine` between three React engines (`Live2DEngine`, `LottieEngine`, `SpriteEngine`) sharing the same `PetEngineProps` shape. Vite's `import.meta.glob` scans `manifest.json` files at build time. Existing `petModels.ts` becomes a deprecation shim that derives from the new registry.

**Tech Stack:** React 19 + TypeScript · Vite glob imports · `pixi-live2d-display` (existing) · `lottie-react` (new) · plain `<img>` for GIF/APNG.

**Design doc:** `docs/plans/2026-05-08-pet-system-redesign.md`

---

## Task 1: PetManifest schema + manual validator

**Files:**
- Create: `src/lib/petManifest.ts`

**Step 1: Define types and validator**

```ts
// Manifest schema for pet assets. See docs/plans/2026-05-08-pet-system-redesign.md.
//
// Validation is manual (no zod) because the schema is small and we want to
// keep the bundle lean. Loading happens once at build time via
// import.meta.glob — invalid manifests are dropped with a console warning.

export type PetAction = "idle" | "coding" | "waiting" | "done" | "sleep";

export type PetEngine = "live2d" | "lottie" | "sprite";

export interface ActionSpec {
  /** Path relative to the manifest's directory. */
  src: string;
  /** Whether the engine should loop this action (default true). */
  loop?: boolean;
  /** Engine-specific options (group/index for live2d, fps/duration for others). */
  options?: Record<string, unknown>;
}

export interface PetManifest {
  /** Unique id; must equal the directory name. */
  id: string;
  /** Display name shown in the picker. */
  name: string;
  /** One-liner shown on hover / in the picker subtitle. */
  description?: string;
  /** Which engine renders this pet. */
  engine: PetEngine;
  /** Optional thumbnail (24x24+ PNG) — falls back to a default chip. */
  thumbnail?: string;
  /** Action → asset mapping. All five actions are required. */
  actions: Record<PetAction, ActionSpec>;
  /** Author / license attribution. */
  credits?: { author?: string; license?: string; sourceUrl?: string };
}

export const PET_ACTIONS: readonly PetAction[] = [
  "idle",
  "coding",
  "waiting",
  "done",
  "sleep",
] as const;

const ENGINES: readonly PetEngine[] = ["live2d", "lottie", "sprite"] as const;

/** Returns null if invalid; logs a warning describing why. */
export function validateManifest(raw: unknown, sourcePath: string): PetManifest | null {
  if (!raw || typeof raw !== "object") {
    console.warn(`[petManifest] ${sourcePath}: not an object`);
    return null;
  }
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== "string" || !m.id) {
    console.warn(`[petManifest] ${sourcePath}: missing id`);
    return null;
  }
  if (typeof m.name !== "string" || !m.name) {
    console.warn(`[petManifest] ${sourcePath}: missing name`);
    return null;
  }
  if (typeof m.engine !== "string" || !ENGINES.includes(m.engine as PetEngine)) {
    console.warn(`[petManifest] ${sourcePath}: bad engine "${String(m.engine)}"`);
    return null;
  }
  const actions = m.actions;
  if (!actions || typeof actions !== "object") {
    console.warn(`[petManifest] ${sourcePath}: missing actions`);
    return null;
  }
  for (const action of PET_ACTIONS) {
    const spec = (actions as Record<string, unknown>)[action];
    if (!spec || typeof spec !== "object") {
      console.warn(`[petManifest] ${sourcePath}: missing action.${action}`);
      return null;
    }
    if (typeof (spec as { src?: unknown }).src !== "string") {
      console.warn(`[petManifest] ${sourcePath}: action.${action}.src not a string`);
      return null;
    }
  }
  return raw as PetManifest;
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd /Users/a58/Documents/personal/ai-coding/notchi
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck 2>&1 | tail -3
```

Expected: 0 errors.

**Step 3: Commit**

```bash
git add src/lib/petManifest.ts
git commit -m "feat(pets): add PetManifest schema + manual validator"
```

---

## Task 2: petRegistry with import.meta.glob

**Files:**
- Create: `src/lib/petRegistry.ts`

**Step 1: Implement registry**

```ts
import {
  validateManifest,
  type PetManifest,
} from "./petManifest";

// Vite glob runs at build time. The path must be a literal so Vite can
// statically analyze it. Each match is the parsed manifest.json content.
const RAW: Record<string, unknown> = import.meta.glob(
  "/public/assets/pets/*/manifest.json",
  { eager: true, import: "default" },
);

const REGISTRY: Map<string, PetManifest> = (() => {
  const out = new Map<string, PetManifest>();
  for (const [path, raw] of Object.entries(RAW)) {
    const manifest = validateManifest(raw, path);
    if (!manifest) continue;
    // Sanity: directory name must equal manifest.id
    const dir = path.split("/").slice(-2, -1)[0];
    if (manifest.id !== dir) {
      console.warn(
        `[petRegistry] ${path}: id "${manifest.id}" does not match dir "${dir}", skipping`,
      );
      continue;
    }
    if (out.has(manifest.id)) {
      console.warn(
        `[petRegistry] duplicate id "${manifest.id}" — later wins`,
      );
    }
    out.set(manifest.id, manifest);
  }
  return out;
})();

export function listPets(): PetManifest[] {
  return Array.from(REGISTRY.values());
}

export function getPet(id: string): PetManifest | null {
  return REGISTRY.get(id) ?? null;
}

/** Default pet — first registered alphabetically by id. */
export function defaultPet(): PetManifest | null {
  const all = listPets();
  if (all.length === 0) return null;
  return [...all].sort((a, b) => a.id.localeCompare(b.id))[0];
}

/** Resolve an asset path relative to a manifest. */
export function petAssetUrl(manifest: PetManifest, relSrc: string): string {
  return `/assets/pets/${manifest.id}/${relSrc}`;
}
```

**Step 2: Verify**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck 2>&1 | tail -3
```

Expected: clean (registry is empty for now since no manifests exist yet — that is fine, exports compile).

**Step 3: Commit**

```bash
git add src/lib/petRegistry.ts
git commit -m "feat(pets): petRegistry — import.meta.glob scans manifest.json"
```

---

## Task 3: Generate manifest.json for the 6 existing Live2D pets

**Files:**
- Create: `public/assets/pets/mao/manifest.json`
- Create: `public/assets/pets/haru/manifest.json`
- Create: `public/assets/pets/hiyori/manifest.json`
- Create: `public/assets/pets/mark/manifest.json`
- Create: `public/assets/pets/natori/manifest.json`
- Create: `public/assets/pets/rice/manifest.json`

**Note:** Right now Live2D assets live at `public/assets/live2d/<id>/`. We do NOT move them — manifests reference them via relative `../live2d/<id>/...` so the heavy bundle layout is undisturbed. Future redesigns can co-locate.

**Step 1: Write each manifest**

For each pet read the existing `actionMotions` from `src/lib/petModels.ts` (lines 22-77) and translate into manifest format.

`public/assets/pets/mao/manifest.json`:

```json
{
  "id": "mao",
  "name": "Mao",
  "description": "Live2D Cubism sample · magical girl",
  "engine": "live2d",
  "actions": {
    "idle":    { "src": "../live2d/mao/runtime/mao_pro.model3.json", "loop": true,  "options": { "group": "Idle", "index": 0 } },
    "coding":  { "src": "../live2d/mao/runtime/mao_pro.model3.json", "loop": true,  "options": { "group": "",     "index": 1 } },
    "waiting": { "src": "../live2d/mao/runtime/mao_pro.model3.json", "loop": true,  "options": { "group": "",     "index": 0 } },
    "done":    { "src": "../live2d/mao/runtime/mao_pro.model3.json", "loop": false, "options": { "group": "",     "index": 4 } },
    "sleep":   { "src": "../live2d/mao/runtime/mao_pro.model3.json", "loop": true,  "options": { "group": "Idle", "index": 0 } }
  },
  "credits": {
    "author": "Live2D Inc.",
    "license": "Live2D Free Material License (personal/small enterprise)",
    "sourceUrl": "https://www.live2d.com/en/learn/sample/"
  }
}
```

Now repeat the same shape for haru / hiyori / mark / natori / rice. **Use the action mappings from `petModels.ts` for each pet** — copy `group` and `index` exactly.

To find the right `model3.json` filename: `ls public/assets/live2d/<id>/runtime/`. Examples (verify before writing):
- mao  → `runtime/mao_pro.model3.json`
- haru → `runtime/haru_greeter_t05.model3.json`
- hiyori → `runtime/hiyori_pro_t11.model3.json`
- mark → `runtime/mark_t02.model3.json`
- natori → `runtime/natori_pro_t06.model3.json`
- rice → `runtime/Rice.model3.json`

If any filename differs, use whatever `ls` reveals.

**Step 2: Verify all 6 manifests parse**

```bash
for d in mao haru hiyori mark natori rice; do
  python3 -c "import json; json.load(open('public/assets/pets/$d/manifest.json'))" && echo "$d: OK"
done
```

Expected: 6 lines of `<id>: OK`.

**Step 3: Verify dev server detects them**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck 2>&1 | tail -3
```

(typecheck does not load manifests but confirms code still compiles)

**Step 4: Commit**

```bash
git add public/assets/pets/
git commit -m "feat(pets): manifest.json for 6 existing Live2D pets"
```

---

## Task 4: Live2DEngine — extract from PetCanvas

**Files:**
- Create: `src/components/pets/PetEngineProps.ts`
- Create: `src/components/pets/engines/Live2DEngine.tsx`
- Modify: `src/components/PetCanvas.tsx` (becomes a thin alias)

**Step 1: Define shared props interface**

`src/components/pets/PetEngineProps.ts`:

```ts
import type { PetAction, PetManifest } from "../../lib/petManifest";

export interface PetEngineProps {
  /** Side length in CSS pixels. Engines render to a square. */
  size: number;
  /** Current animation state. */
  action: PetAction;
  /** The pet to render. */
  manifest: PetManifest;
  /** Optional callback when a non-loop action completes naturally. */
  onActionEnd?: (action: PetAction) => void;
}
```

**Step 2: Move PetCanvas internals into Live2DEngine**

Read the entire current `src/components/PetCanvas.tsx`. Copy its body into `src/components/pets/engines/Live2DEngine.tsx` with these adaptations:

- New props: `PetEngineProps` (replace existing `size`, `modelUrl`, `actionMotions`).
- Compute `modelUrl` and `actionMotions` from the new `manifest`:
  ```ts
  const modelUrl = `/assets/pets/${manifest.id}/${manifest.actions.idle.src.replace(/^\.\.\//, "")}`;
  // OR more cleanly: resolve once per current action:
  const currentActionSpec = manifest.actions[action];
  ```
  (Live2D loads one `model3.json` per pet; all five actions point to the same file via the manifest.)
- Replace `actionMotions[action]` reads with `manifest.actions[action].options as { group: string; index: number }`.
- The function signature changes from `PetCanvas(props)` to `Live2DEngine(props: PetEngineProps)`.

**Step 3: Update PetCanvas.tsx to alias the engine**

```tsx
// Deprecated: PetCanvas is now a backwards-compat alias. New code should
// use PetRenderer (which selects the right engine from manifest.engine).
export { Live2DEngine as PetCanvas } from "./pets/engines/Live2DEngine";
```

**Step 4: Update one direct caller (App.tsx) to pass manifest**

Quick smoke — `App.tsx` currently does:

```tsx
<PetCanvas key={`${petSize}-${selectedModelId}`} size={petDim} modelUrl={currentModel.modelPath} actionMotions={currentModel.actionMotions} />
```

This will break because Live2DEngine now expects `manifest` + `action`. Defer the App.tsx fix to Task 5 (PetRenderer) which is what App.tsx will call instead. For this task, ensure typecheck would fail at App.tsx — that's expected; the alias preserves the *type signature* so the whole codebase recompiles cleanly only after Task 5.

To keep the build green between Task 4 and Task 5, **temporarily add a compat shim** at the alias:

```tsx
// src/components/PetCanvas.tsx
import { useMemo } from "react";
import { Live2DEngine } from "./pets/engines/Live2DEngine";
import type { ActionMotions } from "../lib/petModels";
import type { PetManifest } from "../lib/petManifest";
import { usePetStore, type PetAction } from "../stores/petStore";

interface LegacyProps {
  size: number;
  modelUrl?: string;
  actionMotions?: ActionMotions;
}

/** @deprecated Use PetRenderer + a manifest. */
export function PetCanvas({ size, modelUrl, actionMotions }: LegacyProps) {
  const action = usePetStore((s) => s.action) as PetAction;
  const manifest = useMemo<PetManifest>(() => {
    const base = modelUrl ?? "";
    const am = actionMotions ?? { idle: { group: "Idle", index: 0 }, coding: { group: "Idle", index: 0 }, waiting: { group: "Idle", index: 0 }, done: { group: "Idle", index: 0 } };
    return {
      id: "_legacy",
      name: "Legacy",
      engine: "live2d",
      actions: {
        idle:    { src: base, loop: true,  options: am.idle },
        coding:  { src: base, loop: true,  options: am.coding },
        waiting: { src: base, loop: true,  options: am.waiting },
        done:    { src: base, loop: false, options: am.done },
        sleep:   { src: base, loop: true,  options: am.idle },
      },
    };
  }, [modelUrl, actionMotions]);
  return <Live2DEngine size={size} action={action} manifest={manifest} />;
}
```

This lets App.tsx keep compiling. Task 5 deletes this shim.

**Step 5: typecheck + commit**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck 2>&1 | tail -3
git add src/components/pets/ src/components/PetCanvas.tsx
git commit -m "refactor(pets): extract Live2DEngine; PetCanvas becomes legacy shim"
```

---

## Task 5: PetRenderer + replace App.tsx call site

**Files:**
- Create: `src/components/pets/PetRenderer.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/PetCanvas.tsx` (remove the legacy shim)

**Step 1: PetRenderer dispatch**

```tsx
import type { PetEngineProps } from "./PetEngineProps";
import { Live2DEngine } from "./engines/Live2DEngine";

// Lazy require — placeholders for Tasks 6/7. Returning null for unsupported
// engines now is fine; once the engines land, the imports get added below.
export function PetRenderer(props: PetEngineProps) {
  switch (props.manifest.engine) {
    case "live2d":
      return <Live2DEngine {...props} />;
    case "lottie":
    case "sprite":
      return (
        <div style={{ width: props.size, height: props.size }} />
      );
  }
}
```

**Step 2: Migrate App.tsx**

Locate the `<PetCanvas .../>` usage in `src/App.tsx` (~line 133) and replace with:

```tsx
import { PetRenderer } from "./components/pets/PetRenderer";
import { getPet, defaultPet } from "./lib/petRegistry";
// ... existing imports above

// Inside the component body, replace currentModel with manifest lookup:
const manifest = getPet(selectedModelId) ?? defaultPet();

// In JSX:
{manifest && (
  renderMode === "live2d"
    ? <PetRenderer key={`${petSize}-${manifest.id}`} size={petDim} action={petAction} manifest={manifest} />
    : <PetFallbackImage size={petDim} />
)}
```

`petAction` comes from the existing pet store — `usePetStore((s) => s.action)`. Find the existing usage in App.tsx and reuse it.

**Step 3: Delete the legacy shim**

Replace `src/components/PetCanvas.tsx` with the simple re-export:

```tsx
// Deprecated alias. New code uses PetRenderer.
export { Live2DEngine as PetCanvas } from "./pets/engines/Live2DEngine";
```

**Step 4: Verify and clean up unused imports**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck 2>&1 | tail -5
```

Fix any "imported but unused" warnings (e.g., `getModelById` is no longer needed in App.tsx).

**Step 5: Commit**

```bash
git add src/components/pets/ src/components/PetCanvas.tsx src/App.tsx
git commit -m "feat(pets): PetRenderer dispatcher + App.tsx uses petRegistry"
```

---

## Task 6: petModels.ts deprecation shim

**Files:**
- Modify: `src/lib/petModels.ts`

**Step 1: Replace contents with shim**

```ts
// Deprecated. Pet metadata now lives in public/assets/pets/<id>/manifest.json
// and is loaded via petRegistry. This file derives the legacy shape from
// the registry so older call sites (PetPanel.tsx) keep working.

import { listPets, getPet, defaultPet } from "./petRegistry";
import type { PetManifest } from "./petManifest";

export interface ActionMapping {
  group: string;
  index: number;
}

export type ActionMotions = Record<"idle" | "coding" | "waiting" | "done", ActionMapping>;

export interface PetModel {
  id: string;
  name: string;
  description: string;
  modelPath: string;
  actionMotions: ActionMotions;
}

function manifestToModel(m: PetManifest): PetModel {
  const live2dActions = m.actions;
  const opts = (k: keyof ActionMotions): ActionMapping => {
    const o = live2dActions[k].options;
    if (o && typeof o === "object" && "group" in o && "index" in o) {
      return o as ActionMapping;
    }
    return { group: "Idle", index: 0 };
  };
  return {
    id: m.id,
    name: m.name,
    description: m.description ?? "",
    modelPath: live2dActions.idle.src,
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
```

**Step 2: Verify all old call sites still compile**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck 2>&1 | tail -5
```

Expected: clean. PetPanel.tsx still uses `PET_MODELS` and `DEFAULT_MODEL_ID` — they keep working.

**Step 3: Commit**

```bash
git add src/lib/petModels.ts
git commit -m "refactor(pets): petModels.ts becomes deprecation shim over petRegistry"
```

---

## Task 7: Lottie engine + 1 sample pet (ghost-coder)

**Files:**
- Modify: `package.json` (add `lottie-react`)
- Create: `src/components/pets/engines/LottieEngine.tsx`
- Modify: `src/components/pets/PetRenderer.tsx`
- Create: `public/assets/pets/ghost-coder/manifest.json`
- Create: `public/assets/pets/ghost-coder/{idle,coding,waiting,done,sleep}.json`

**Step 1: Add dependency**

```bash
cd /Users/a58/Documents/personal/ai-coding/notchi
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm add lottie-react
```

Check `package.json` shows `"lottie-react": "^x"` under dependencies.

**Step 2: Find a CC0 Lottie animation**

Visit [LottieFiles](https://lottiefiles.com/free-animations/ghost) and pick a single-loop ghost (or robot/cat/rocket — anything with a clear coding-companion vibe). Download the JSON.

**Important:** verify the license is CC0 / MIT / "Free for personal and commercial use". LottieFiles "Free" tier with attribution is typically CC-BY which is fine for distribution as long as we credit in the manifest's `credits.author`.

For the v1 sample, **you can use the SAME JSON for all 5 actions** — that produces a still-animated ghost regardless of state. Real per-action JSONs come in later sprints. Save it as `idle.json` and have all actions point to it.

**Step 3: Implement LottieEngine**

```tsx
// src/components/pets/engines/LottieEngine.tsx
import { useEffect, useState } from "react";
import Lottie from "lottie-react";
import type { PetEngineProps } from "../PetEngineProps";
import { petAssetUrl } from "../../../lib/petRegistry";

export function LottieEngine({ size, action, manifest, onActionEnd }: PetEngineProps) {
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
      style={{ width: size, height: size, pointerEvents: "none" }}
    />
  );
}
```

**Step 4: Wire into PetRenderer**

```tsx
// src/components/pets/PetRenderer.tsx — update imports + switch
import { LottieEngine } from "./engines/LottieEngine";

// ...
case "lottie":
  return <LottieEngine {...props} />;
```

**Step 5: Author the ghost-coder manifest**

`public/assets/pets/ghost-coder/manifest.json`:

```json
{
  "id": "ghost-coder",
  "name": "Ghost Coder",
  "description": "Lottie sample · soft glowing ghost mascot",
  "engine": "lottie",
  "actions": {
    "idle":    { "src": "idle.json",    "loop": true },
    "coding":  { "src": "idle.json",    "loop": true },
    "waiting": { "src": "idle.json",    "loop": true },
    "done":    { "src": "idle.json",    "loop": false },
    "sleep":   { "src": "idle.json",    "loop": true }
  },
  "credits": {
    "author": "<author from LottieFiles>",
    "license": "<as listed on LottieFiles>",
    "sourceUrl": "<the LottieFiles URL>"
  }
}
```

**Step 6: typecheck + dev smoke**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck 2>&1 | tail -3
```

Manually run dev (briefly) to confirm switching to ghost-coder shows the Lottie animation:

```bash
PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:$HOME/.cargo/bin:$PATH pnpm tauri dev
```

Open Settings → Pet picker → select Ghost Coder. Verify animation plays.

**Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/components/pets/engines/LottieEngine.tsx src/components/pets/PetRenderer.tsx public/assets/pets/ghost-coder/
git commit -m "feat(pets): add LottieEngine + ghost-coder sample"
```

---

## Task 8: Sprite engine + 1 sample GIF pet (pixel-cat)

**Files:**
- Create: `src/components/pets/engines/SpriteEngine.tsx`
- Modify: `src/components/pets/PetRenderer.tsx`
- Create: `public/assets/pets/pixel-cat/manifest.json`
- Create: `public/assets/pets/pixel-cat/{idle,coding,waiting,done,sleep}.gif`

**Step 1: Find a CC0 GIF**

[Giphy CC0 search](https://giphy.com/search/pixel%20cat) or [piskelapp CC0 sprites](https://www.piskelapp.com/explore/users/CC0). Download a small (< 200KB) animated GIF of a pixel cat / robot / typing-themed creature. License must be CC0 or CC-BY.

For v1 same-GIF-for-all-actions trick: drop the file as `idle.gif` and have all 5 actions reference it.

**Step 2: Implement SpriteEngine**

```tsx
// src/components/pets/engines/SpriteEngine.tsx
import { useEffect } from "react";
import type { PetEngineProps } from "../PetEngineProps";
import { petAssetUrl } from "../../../lib/petRegistry";

export function SpriteEngine({ size, action, manifest, onActionEnd }: PetEngineProps) {
  const spec = manifest.actions[action];
  const url = petAssetUrl(manifest, spec.src);

  // GIF/APNG playback ends are not exposed by browsers. Approximate with a
  // setTimeout when the action is one-shot (loop=false). Default 1500ms.
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
        WebkitUserDrag: "none" as unknown as undefined,
      }}
      alt=""
    />
  );
}
```

**Step 3: Wire into PetRenderer**

```tsx
import { SpriteEngine } from "./engines/SpriteEngine";

// ...
case "sprite":
  return <SpriteEngine {...props} />;
```

**Step 4: Author the pixel-cat manifest**

`public/assets/pets/pixel-cat/manifest.json`:

```json
{
  "id": "pixel-cat",
  "name": "Pixel Cat",
  "description": "GIF sample · 16-bit cat mascot",
  "engine": "sprite",
  "actions": {
    "idle":    { "src": "idle.gif", "loop": true },
    "coding":  { "src": "idle.gif", "loop": true },
    "waiting": { "src": "idle.gif", "loop": true },
    "done":    { "src": "idle.gif", "loop": false, "options": { "duration": 1500 } },
    "sleep":   { "src": "idle.gif", "loop": true }
  },
  "credits": {
    "author": "<author>",
    "license": "<license>",
    "sourceUrl": "<URL>"
  }
}
```

**Step 5: typecheck + dev smoke**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck 2>&1 | tail -3
```

**Step 6: Commit**

```bash
git add src/components/pets/engines/SpriteEngine.tsx src/components/pets/PetRenderer.tsx public/assets/pets/pixel-cat/
git commit -m "feat(pets): add SpriteEngine + pixel-cat GIF sample"
```

---

## Task 9: Manual E2E + final gates + push

**Step 1: Run final build gates**

```bash
cd /Users/a58/Documents/personal/ai-coding/notchi
PATH=/usr/bin:$HOME/.cargo/bin:$PATH cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | grep "test result" | head -3
PATH=/usr/bin:$HOME/.cargo/bin:$PATH cargo clippy --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "^(error|warning):" | wc -l
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck 2>&1 | tail -3
```

Expected: tests still 15 pass; clippy ≤ 5 warnings (baseline 4, allow 1 transient); typecheck clean.

**Step 2: Manual E2E checklist**

```bash
PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:$HOME/.cargo/bin:$PATH pnpm tauri dev
```

Verify:
- [ ] All 6 Live2D pets still appear in the picker
- [ ] Switching between mao / haru / hiyori / mark / natori / rice works
- [ ] Switching to **Ghost Coder** plays the Lottie animation
- [ ] Switching to **Pixel Cat** plays the GIF
- [ ] Triggering a "done" action (manually fire from PetPanel dev button if available) returns to idle after the action
- [ ] Renaming `public/assets/pets/mao/manifest.json` → `manifest.json.bak`, restarting dev: only 7 pets show, no crash, console warns about missing manifest
- [ ] Restore the file

**Step 3: Push to both remotes**

```bash
gh auth switch -u liangliang1259
git push -u origin feature/pet-system-redesign
gh auth switch -u liangliang125977
git push new feature/pet-system-redesign
```

---

## Done definition

- [ ] All 6 existing Live2D pets work via manifest
- [ ] Adding a new pet = drop a folder + `manifest.json` (no TS edit)
- [ ] Lottie sample (ghost-coder) renders via LottieEngine
- [ ] GIF sample (pixel-cat) renders via SpriteEngine
- [ ] PetCanvas is a one-line alias to Live2DEngine
- [ ] petModels.ts is a shim deriving from petRegistry
- [ ] All gates green
- [ ] Branch pushed to both remotes
