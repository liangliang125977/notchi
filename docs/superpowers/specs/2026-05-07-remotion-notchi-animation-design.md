# Remotion Notchi Animation Design

## Goal

Create a Remotion animation package for Notchi with two rendered compositions:

- `NotchiProductTeaser`: a polished 16:9 product teaser for README, launch pages, and demo embeds.
- `NotchiSocialLoop`: a 9:16 vertical social loop for short-form sharing.

Both compositions use the same visual language and reusable Remotion components. The chosen story structure is a **notch-first reveal**: Notchi appears below the Mac notch first, then token activity, L2 capsule, L3 dashboard, and local-only privacy details unfold around it.

## Scope

In scope:

- Add Remotion to the existing React/Vite repo without changing the Tauri app runtime.
- Build two deterministic compositions using React components, static fallback pet images, and product-inspired UI shapes.
- Provide scripts for previewing, rendering, and one-frame checks.
- Render-friendly animation only: use Remotion frame interpolation, `Sequence`, and static assets from `public/`.

Out of scope:

- Real Live2D runtime rendering inside Remotion.
- Capturing real user token data, local paths, prompts, code, or session contents.
- Adding new Notchi product features.
- Any outbound network request during animation render.

## Deliverables

### Product Teaser

- Composition id: `NotchiProductTeaser`
- Size: `1920x1080`
- FPS: `30`
- Duration: `1260` frames, about `42s`
- Purpose: product demo and launch asset

Storyboard:

1. **Notch reveal**: a clean Mac-like top bar appears with a black notch. Notchi softly drops into the notch area.
2. **Local activity wakes Notchi**: local AI coding activity lines move inward as abstract signals. The pet enters a coding state.
3. **L2 glance layer**: a Dynamic Island style capsule expands near the pet with model, token, delta, and current session hints.
4. **L3 dashboard proof**: a settings window slides in with overview cards, hourly bars, source/model distribution, recent sessions, and growth section.
5. **Privacy close**: visual emphasis returns to the pet and the final line reinforces local-only awareness.

### Social Loop

- Composition id: `NotchiSocialLoop`
- Size: `1080x1920`
- FPS: `30`
- Duration: `420` frames, about `14s`
- Purpose: vertical social preview

Storyboard:

1. Notchi idles under the notch.
2. Coding signal lights up.
3. L2 capsule pops with `Sonnet 4`, `509K`, and `↑12%`.
4. A done/growth burst plays.
5. The scene eases back to the opening idle pose so the clip loops cleanly.

## Visual System

- Style: premium macOS product motion, soft glass surfaces, restrained gradients, precise spacing.
- Palette: charcoal/graphite base, cyan and green signal accents, warm growth burst accent.
- Typography: system font stack to match the app.
- Pet imagery: use existing fallback PNG assets from `public/assets/fallback/`.
- UI fidelity: inspired by the real app, not a screenshot recreation. The animation should communicate the product behavior clearly without depending on Tauri APIs.

## Architecture

Create a dedicated `remotion-video/` source tree so the video code stays separate from the desktop app. The directory is intentionally not named `remotion/` because this repo uses TypeScript `baseUrl`, and a root folder named `remotion` shadows the npm package import.

- `remotion-video/Root.tsx`: registers both compositions.
- `remotion-video/ProductTeaser.tsx`: product teaser timeline.
- `remotion-video/SocialLoop.tsx`: vertical loop timeline.
- `remotion-video/components/*`: reusable visual pieces such as the Mac frame, pet sprite, L2 capsule, dashboard panel, signal lines, and typography.
- `remotion-video/styles.ts`: shared tokens and helpers.
- `remotion-video/index.ts`: Remotion entry point.

Use frame-driven animation only. CSS transitions, CSS animations, and Tailwind animation utilities are not used because they do not render reliably in Remotion.

## Data Model

The videos use static demo values:

- Model: `Sonnet 4`
- Tokens: `509K`
- Delta: `↑12%`
- Current session: `ai-coding/notchi`
- Cost: `$4.21`
- Privacy copy: `Local-only. Nothing leaves your Mac.`

These values are hard-coded animation props, not connected to the app database.

## Testing And Verification

Verification commands:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm remotion:still -- NotchiProductTeaser --frame=360`
- `pnpm remotion:still -- NotchiSocialLoop --frame=120`

Manual review:

- Open Remotion Studio and inspect both compositions.
- Confirm no blank frames.
- Confirm text is readable in both 16:9 and 9:16.
- Confirm social loop returns visually close to its opening state.

## Risks

- Installing Remotion adds dependencies to `package.json`; the desktop app must remain unaffected.
- Existing `.gitignore` currently ignores lockfiles. If dependency installation produces or updates a lockfile, keep the repo convention unless the user explicitly changes package-management policy.
- Live2D assets are intentionally not rendered directly to avoid runtime and licensing complexity.
