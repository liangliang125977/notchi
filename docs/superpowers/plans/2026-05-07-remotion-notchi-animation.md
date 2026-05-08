# Remotion Notchi Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two Remotion compositions for Notchi: a 16:9 product teaser and a 9:16 social loop.

**Architecture:** Keep video code isolated under `remotion-video/` so the desktop app remains unchanged. Register two compositions in `remotion-video/Root.tsx`, share visual primitives from `remotion-video/components/`, and drive all movement with Remotion frame interpolation. The folder is not named `remotion/` because this repo's TypeScript `baseUrl` would shadow the npm package named `remotion`.

**Tech Stack:** Remotion `4.0.457`, React 19, TypeScript, existing static fallback PNG assets from `public/assets/fallback/`.

---

## File Structure

- Modify `package.json`: add Remotion dependencies and scripts.
- Create `remotion-video/index.ts`: Remotion entry point.
- Create `remotion-video/Root.tsx`: registers both compositions.
- Create `remotion-video/styles.ts`: visual tokens, interpolation helpers, text styles.
- Create `remotion-video/data.ts`: static demo values and timeline constants.
- Create `remotion-video/components/MacFrame.tsx`: Mac top bar, notch, and screen surface.
- Create `remotion-video/components/PetSprite.tsx`: fallback pet image renderer with bob, glow, and state switching.
- Create `remotion-video/components/SignalLines.tsx`: local activity signal lines.
- Create `remotion-video/components/L2CapsuleMock.tsx`: Dynamic Island style token capsule.
- Create `remotion-video/components/DashboardMock.tsx`: L3 overview dashboard mock.
- Create `remotion-video/components/GrowthBurst.tsx`: done/growth burst.
- Create `remotion-video/components/SceneText.tsx`: consistent titles and captions.
- Create `remotion-video/ProductTeaser.tsx`: 42s horizontal timeline.
- Create `remotion-video/SocialLoop.tsx`: 14s vertical looping timeline.

## Task 1: Remotion Project Wiring

**Files:**
- Modify: `package.json`
- Create: `remotion-video/index.ts`
- Create: `remotion-video/Root.tsx`

- [ ] **Step 1: Add Remotion dependencies and scripts**

Update `package.json` with:

```json
{
  "scripts": {
    "remotion:studio": "remotion studio remotion-video/index.ts",
    "remotion:still": "remotion still remotion-video/index.ts",
    "remotion:render": "remotion render remotion-video/index.ts"
  },
  "devDependencies": {
    "@remotion/cli": "4.0.457",
    "remotion": "4.0.457"
  }
}
```

Preserve existing scripts and dependencies.

- [ ] **Step 2: Install dependencies**

Run: `pnpm install`

Expected: dependencies install successfully and `package.json` remains valid.

- [ ] **Step 3: Create Remotion entry point**

Create `remotion-video/index.ts`:

```ts
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
```

- [ ] **Step 4: Register both compositions**

Create `remotion-video/Root.tsx`:

```tsx
import { Composition } from "remotion";
import { ProductTeaser } from "./ProductTeaser";
import { SocialLoop } from "./SocialLoop";

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="NotchiProductTeaser"
        component={ProductTeaser}
        durationInFrames={1260}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="NotchiSocialLoop"
        component={SocialLoop}
        durationInFrames={420}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
}
```

- [ ] **Step 5: Add temporary minimal components**

Create `remotion-video/ProductTeaser.tsx`:

```tsx
import { AbsoluteFill } from "remotion";

export function ProductTeaser() {
  return (
    <AbsoluteFill style={{ background: "#0c0f14", color: "white", display: "grid", placeItems: "center" }}>
      NotchiProductTeaser
    </AbsoluteFill>
  );
}
```

Create `remotion-video/SocialLoop.tsx`:

```tsx
import { AbsoluteFill } from "remotion";

export function SocialLoop() {
  return (
    <AbsoluteFill style={{ background: "#0c0f14", color: "white", display: "grid", placeItems: "center" }}>
      NotchiSocialLoop
    </AbsoluteFill>
  );
}
```

- [ ] **Step 6: Verify wiring**

Run: `pnpm typecheck`

Expected: TypeScript passes.

Run: `pnpm remotion:still -- NotchiProductTeaser --frame=30 --output=/private/tmp/notchi-product-teaser.png`

Expected: still image renders and contains the placeholder text.

- [ ] **Step 7: Commit**

```bash
git add package.json remotion-video
git commit -m "feat(remotion): add animation project wiring"
```

## Task 2: Shared Visual Components

**Files:**
- Create: `remotion-video/styles.ts`
- Create: `remotion-video/data.ts`
- Create: `remotion-video/components/MacFrame.tsx`
- Create: `remotion-video/components/PetSprite.tsx`
- Create: `remotion-video/components/SignalLines.tsx`
- Create: `remotion-video/components/L2CapsuleMock.tsx`
- Create: `remotion-video/components/DashboardMock.tsx`
- Create: `remotion-video/components/GrowthBurst.tsx`
- Create: `remotion-video/components/SceneText.tsx`

- [ ] **Step 1: Create static data and timing**

Create `remotion-video/data.ts` with static demo copy:

```ts
export const demo = {
  model: "Sonnet 4",
  tokens: "509K",
  delta: "↑12%",
  session: "ai-coding/notchi",
  cost: "$4.21",
  privacy: "Local-only. Nothing leaves your Mac.",
};

export const teaser = {
  notchReveal: 0,
  activity: 180,
  capsule: 360,
  dashboard: 570,
  privacy: 960,
};

export const social = {
  intro: 0,
  activity: 90,
  capsule: 150,
  burst: 270,
};
```

- [ ] **Step 2: Create style helpers**

Create `remotion-video/styles.ts` with shared tokens and helper functions:

```ts
import { Easing, interpolate } from "remotion";

export const colors = {
  bg: "#0b0f14",
  panel: "rgba(255,255,255,0.08)",
  panelStrong: "rgba(255,255,255,0.13)",
  stroke: "rgba(255,255,255,0.16)",
  text: "rgba(255,255,255,0.94)",
  muted: "rgba(255,255,255,0.62)",
  cyan: "#5ac8fa",
  green: "#30d158",
  warm: "#ffd166",
};

export const fontFamily =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif';

export function enter(frame: number, start: number, duration: number) {
  return interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
}

export function exit(frame: number, start: number, duration: number) {
  return interpolate(frame, [start, start + duration], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.7, 0, 0.84, 0),
  });
}

export function px(n: number) {
  return `${n}px`;
}
```

- [ ] **Step 3: Implement visual primitives**

Create each component with explicit props:

```ts
export type PetMood = "idle" | "coding" | "done";
```

`PetSprite` must use `staticFile("assets/fallback/idle@2x.png")`, `coding@2x.png`, and `done@2x.png` through Remotion's `<Img>` component.

`MacFrame`, `SignalLines`, `L2CapsuleMock`, `DashboardMock`, `GrowthBurst`, and `SceneText` should be pure React components receiving `progress` or `visible` style props. They must not use CSS transitions or keyframe animations.

- [ ] **Step 4: Verify components compile**

Run: `pnpm typecheck`

Expected: TypeScript passes.

- [ ] **Step 5: Commit**

```bash
git add remotion
git commit -m "feat(remotion): add shared animation components"
```

## Task 3: Product Teaser Composition

**Files:**
- Modify: `remotion-video/ProductTeaser.tsx`
- Modify as needed: `remotion-video/components/*`

- [ ] **Step 1: Replace placeholder with full teaser timeline**

Use `useCurrentFrame()`, `AbsoluteFill`, and `Sequence` to build:

```tsx
<AbsoluteFill style={{ background: colors.bg, fontFamily, overflow: "hidden" }}>
  <MacFrame variant="wide" />
  <SignalLines progress={enter(frame, teaser.activity, 90)} />
  <PetSprite mood={moodFromFrame(frame)} size={260} progress={enter(frame, teaser.notchReveal, 60)} />
  <L2CapsuleMock progress={enter(frame, teaser.capsule, 60)} />
  <DashboardMock progress={enter(frame, teaser.dashboard, 90)} />
  <SceneText progress={enter(frame, teaser.privacy, 60)} title="Notchi" subtitle={demo.privacy} />
</AbsoluteFill>
```

Define `moodFromFrame(frame)` inside the file:

```ts
function moodFromFrame(frame: number): "idle" | "coding" | "done" {
  if (frame >= 870) return "done";
  if (frame >= 210) return "coding";
  return "idle";
}
```

- [ ] **Step 2: Add teaser copy beats**

Add three short text beats:

- `A coding companion for your Mac notch`
- `Token awareness without breaking focus`
- `Local-only. Nothing leaves your Mac.`

Each beat should be readable for at least 2.5 seconds.

- [ ] **Step 3: Render still checks**

Run:

```bash
pnpm remotion:still -- NotchiProductTeaser --frame=120 --output=/private/tmp/notchi-teaser-120.png
pnpm remotion:still -- NotchiProductTeaser --frame=420 --output=/private/tmp/notchi-teaser-420.png
pnpm remotion:still -- NotchiProductTeaser --frame=720 --output=/private/tmp/notchi-teaser-720.png
```

Expected:

- Frame 120 shows notch and pet.
- Frame 420 shows L2 capsule.
- Frame 720 shows dashboard.

- [ ] **Step 4: Commit**

```bash
git add remotion-video/ProductTeaser.tsx remotion-video/components remotion-video/data.ts remotion-video/styles.ts
git commit -m "feat(remotion): build product teaser composition"
```

## Task 4: Social Loop Composition

**Files:**
- Modify: `remotion-video/SocialLoop.tsx`
- Modify as needed: `remotion-video/components/*`

- [ ] **Step 1: Replace placeholder with vertical loop**

Use `1080x1920` layout with a centered notch scene, large pet, and short readable copy:

```tsx
<AbsoluteFill style={{ background: colors.bg, fontFamily, overflow: "hidden" }}>
  <MacFrame variant="vertical" />
  <PetSprite mood={moodFromFrame(frame)} size={420} progress={1} />
  <SignalLines progress={enter(frame, social.activity, 45) * exit(frame, 330, 60)} />
  <L2CapsuleMock progress={enter(frame, social.capsule, 45) * exit(frame, 315, 45)} compact />
  <GrowthBurst progress={enter(frame, social.burst, 36) * exit(frame, 342, 42)} />
  <SceneText progress={loopTextProgress(frame)} title="Notchi" subtitle="A coding pet for your Mac notch" />
</AbsoluteFill>
```

Define helpers:

```ts
function moodFromFrame(frame: number): "idle" | "coding" | "done" {
  if (frame >= 270 && frame < 360) return "done";
  if (frame >= 90 && frame < 270) return "coding";
  return "idle";
}

function loopTextProgress(frame: number) {
  if (frame < 45) return frame / 45;
  if (frame > 360) return Math.max(0, (420 - frame) / 60);
  return 1;
}
```

- [ ] **Step 2: Check loop endpoints**

Render:

```bash
pnpm remotion:still -- NotchiSocialLoop --frame=0 --output=/private/tmp/notchi-loop-0.png
pnpm remotion:still -- NotchiSocialLoop --frame=390 --output=/private/tmp/notchi-loop-390.png
```

Expected: frame 390 visually approaches frame 0, with no dashboard left on screen.

- [ ] **Step 3: Commit**

```bash
git add remotion-video/SocialLoop.tsx remotion-video/components
git commit -m "feat(remotion): build social loop composition"
```

## Task 5: Final Verification And Render Notes

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add README animation commands**

Add a short section:

```md
## Remotion animations

Preview:

```bash
pnpm remotion:studio
```

Render:

```bash
pnpm remotion:render -- NotchiProductTeaser renders/notchi-product-teaser.mp4
pnpm remotion:render -- NotchiSocialLoop renders/notchi-social-loop.mp4
```
```

- [ ] **Step 2: Run final checks**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm remotion:still -- NotchiProductTeaser --frame=360 --output=/private/tmp/notchi-product-check.png
pnpm remotion:still -- NotchiSocialLoop --frame=120 --output=/private/tmp/notchi-social-check.png
```

Expected: commands pass and stills are nonblank.

- [ ] **Step 3: Commit**

```bash
git add README.md package.json remotion docs/superpowers/plans/2026-05-07-remotion-notchi-animation.md
git commit -m "docs(remotion): document animation workflow"
```

## Self-Review

- Spec coverage: both requested outputs are covered by Tasks 3 and 4; shared setup is covered by Tasks 1 and 2; verification and docs are covered by Task 5.
- Placeholder scan: no placeholder markers or deferred implementation steps remain.
- Type consistency: composition ids, filenames, demo data keys, and component names match across tasks.
