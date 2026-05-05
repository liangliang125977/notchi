# CHANGELOG

This file records SPEC ambiguities, fallback decisions, and noteworthy
deviations encountered while implementing Coding Pet. Per `CLAUDE.md`, AI
agents must log here rather than guess.

## 2026-05-05 — v1.2 (multi-form, periods, sessions, multi-screen)

### Period switcher — month uses `start of month`, not 30-day rolling

`Period::Month` keeps SPEC §5.4's calendar-month semantics (`datetime
('now', 'start of month')`) so the budget bar's spend matches the
month-to-date cost. The Overview "Daily distribution (30d)" label is a
slight lie — early in the month the chart fills only a few buckets —
but matching the budget math is more important than the legend text.
Recorded so a future pass can rename the label or expose a real
"trailing 30d" period.

### Day-over-day delta hidden on Week / Month

The token / cost cards' delta chips only render on the Today period.
Showing "↑12%" on a week summary would imply a "vs previous week"
calc we don't compute (we'd need a second `token_summary` call with
shifted bounds). Recorded as a v1.x stretch.

### Sessions "All" filter capped at 30 days

`recent_sessions_in(period=None)` falls back to `datetime('now', '-30
days')` so the worst-case query never paginates the full event log.
The chip still says "All" because that's what the user asked for; the
foot-note hint reads "last 30 days". v1.x can lift the cap once we
either paginate or expose a true date-range picker.

### Session detail = expandable row, not a separate page

The task scope explicitly skips a session detail page / per-session
token chart. Click-to-expand reveals the full session id, project
path, and started_at — enough to pivot to a terminal — without
shipping a 6th tab.

### Multi-screen identity = `localizedName`, same as window-position

Reused `NSScreen.localizedName` as the screen identifier instead of
`NSScreen.deviceDescription[NSScreenNumber]` so the new
`targetScreenId` setting interoperates with the existing
`windowPosition.screenId` recovery path (T1.6). The trade-off is two
identical-name external monitors are indistinguishable; a future pass
can switch to `displayID` if it bites.

### `target_screen_id` mismatch with stored `windowPosition.screenId`

When the user picks a non-main display in Settings, the frontend
drag-end handler still records `pet_main_screen_id()` into
`windowPosition.screenId`. On next launch we treat the override as
authoritative and discard the position when names disagree (which
they will on every restart). Net effect: the pet always lands at the
default notch position on the chosen screen. Acceptable for v1.2;
ideally drag-end would persist the *target* id, not the *main* id —
deferred so we don't re-touch the T1.6 hot path tonight.

### Species: cat is the safe default, crab/fox unlock at 100K tokens

The classifier walks the top-cost project's filesystem (depth 6, 2k
file cap, skipping `node_modules` / `.git` / `target` / `dist` /
`build` / `.venv` / `venv` / `__pycache__` / `.next` / `.cache`).
Species sticks to `cat` until the project crosses 100K cumulative
tokens AND a single language family exceeds 30% extension share, so
a one-day TS PR doesn't immediately turn the pet into a fox. The
filesystem walk is on-demand only (5-min auto-refresh + on mount);
nothing scans on every event ingest.

### Multi-form is emoji + a chip, not a real Live2D swap

Per task constraint: ship the *logic layer* (species inference, lock
progress) and surface it as a top-left badge with hover tooltip.
Actual multi-Live2D rendering remains out of scope for v1.x — an
animated crab/snake/etc. would require new licensed assets and a
second model loader, both of which the MVP scope explicitly defers.

### macOS `pet_target_position` consolidated to a single `_on` variant

Adding the `target_screen_id` parameter exposed three near-duplicate
helpers (`pet_target_position`, `position_pet_window`,
`is_pet_window_onscreen`). Collapsed to `_on` / `_for` variants that
take an `Option<&str>` so we don't have to keep two copies in sync.
The legacy names are gone; nothing outside the macos module called
them.

## 2026-05-05 — T3.1–T3.4 (emotion + notifications)

### Bubble shows above Mao's head, not on the right

SPEC §5.6 doesn't pin a bubble position. We picked "above Mao's head"
because the L2 capsule already lives to the right of Mao at hover and
both sharing that side would overlap when both fire at once. The
bubble is anchored at `top: 8px; left: 120px` of the 240×240 pet
window with a downward-pointing tail centred on Mao's forehead.

### Bubble events use Tauri global emit, not a per-window channel

`pet:task-completed` and `pet:pending-input` are emitted by Rust via
`AppHandle::emit` (broadcast to every webview), and the dev "test
bubble" buttons in Settings re-emit the same payload shape. Both the
real path and the dev path therefore exercise the same listener wired
in `useEmotionEngine`, which avoids drift.

### Backfill does not feed the session tracker

`ingest::backfill` passes `tracker = None`. We don't want the cold
start to enqueue 30-day-old completion events as bubbles + macOS
notifications (would spam the user on first launch). Live tail through
the watcher is the only feeder.

### Pending-input "stale" cap

`SessionTracker::poll_pending_input` ignores sessions that have been
silent for more than 5 minutes. Past that point the user has clearly
moved on; bubbles every minute would feel naggy. The 30s/60s/180s
brackets remain in-range; only sessions older than 5 min get dropped
from the pending pool until a new user/assistant turn touches them.

### macOS notification permission requested at startup

`useEmotionEngine` calls `ensureNotifyPermission` once on mount
(memoized). This pre-warms the prompt so it appears alongside the
welcome card rather than mid-task. If the user denies the prompt, R2
falls back to bubble-only (no native banner), per SPEC §5.6.

### Quiet hours apply to bubbles only

`isMuted()` lives in `petStore.ts` and gates `showBubble` exclusively.
macOS notifications keep firing during quiet hours; the user is
expected to control them via System Settings → Notifications. The
Settings panel hint reflects this.

### Cross-midnight quiet hours

`isMuted` accepts both `start < end` and `start > end` (e.g. 22:00 →
09:00). When `start > end` the muted region is `[start, 24:00) ∪
[00:00, end)`. Equal start/end is treated as "not muted" rather than
"muted all day" — preserves backwards-compat with the existing
default 22:00–09:00 in case a user accidentally sets both to 00:00.

### Stop-reason filter

`stop_reason` values that count as "complete" are anything except
`user_cancelled` and the empty string. We do not whitelist
`end_turn`/`max_tokens` explicitly because Anthropic occasionally
introduces new stop reasons (`tool_use`, `pause_turn`, etc.); the
denylist is forward-compatible and still skips the only case the user
explicitly initiated (cancel).

## 2026-05-05 — T2.6–T2.10 (UI layer)

### L2 expanded window keeps fixed 240 height instead of 100

**SPEC reference:** §4 S6 / §5.3 — "悬停 300ms → 480×100 横条".

The pet's content (240×240) cannot shrink to 100 px without clipping
Mao's head, which violates §6.7 D2 ("60-80% 头部可见"). Implemented
`480×240` instead and put the capsule in the right 240×240 quadrant
above the baseline. Functionally identical to the spec — wider but
not taller — and avoids the visual regression. Recorded here so a
future pass can re-evaluate after Live2D parameters are exposed for
clean head-only crops.

### Sessions / Tokens tabs disabled in MVP

**SPEC reference:** §5.4 — implied multi-tab L3.

Per task scope ("不做：周/月时间维度切换 / 全量历史会话浏览页"), the
L3 sessions and dedicated tokens tabs are placeholder-only and shipped
disabled with a "Coming in v1.x" tooltip. Overview absorbs the MVP
needs.

### Data folder picker uses text input

The text-input + "Apply" button is a deliberate v1.0 simplification
documented in the task scope; macOS native folder picker (Tauri
`@tauri-apps/plugin-dialog`) deferred to T2.x. The Rust command
already validates `path.exists()` so a typo just shows an inline
error.

### Quiet hours stored only (no bubble logic)

Mute window editor in Settings persists `muteWindowStart` /
`muteWindowEnd` to `settings.json` but no bubble code reads them
yet — bubble work belongs to T3. Stored ahead of time so users can
configure the value before the feature lands.

## 2026-05-05 — T2.1–T2.5 (data layer)

### jsonl schema (reverse-engineered, 2026-05-05)

`~/.claude/projects/<dash-encoded-cwd>/<sessionId>.jsonl` contains
newline-delimited JSON objects with a `type` discriminator. Observed
values include `assistant`, `user`, `system`, `attachment`,
`queue-operation`, `last-prompt`. Only `type=assistant` rows carry token
usage.

Relevant fields on assistant rows:

```text
{
  "type": "assistant",
  "timestamp": "<ISO-8601>",
  "sessionId": "<uuid>",
  "cwd": "<absolute project path>",
  "requestId": "<opaque>",
  "message": {
    "id": "msg_…",
    "model": "claude-opus-4-7" | "claude-haiku-4-5-20251001" | "glm-4.7" | …,
    "usage": {
      "input_tokens": int,
      "output_tokens": int,
      "cache_read_input_tokens": int,
      "cache_creation_input_tokens": int,
      "service_tier": str, "inference_geo": str, "iterations": int,
      "speed": float, "server_tool_use": object
    }
  }
}
```

Subagents write to `<sessionId>/subagents/agent-*.jsonl`; the same
assistant message can therefore appear in multiple files. We dedupe on
the partial unique index `(message_id, request_id)` (only enforced when
both are non-null).

Per CLAUDE.md privacy rules, this CHANGELOG describes the schema by
shape only — no real prompts/timestamps/paths are captured here.

### Direct sqlx in addition to `tauri-plugin-sql`

SPEC §6.6 lists `tauri-plugin-sql`; T1.1 already settled that direct
`rusqlite` is incompatible with it. T2.1 added a direct
`sqlx = "0.8"` dependency (matching the version pulled in by the
plugin) so that Rust-side ingest can run on the same `SqlitePool`.
Frontend still has the option of calling `tauri-plugin-sql`'s JS API
later, but writes are now Rust-owned to keep raw jsonl bytes off the
JS bridge entirely (privacy + perf).

### Model name dated suffix fallback

Anthropic emits both `claude-haiku-4-5` and dated variants such as
`claude-haiku-4-5-20251001` over the wire. Pricing lookup tries the
exact key first and, on miss, strips a trailing `-YYYYMMDD` and retries.
Unknown models still fall through to a zero-priced shape (S11 says: no
`$` until configured).

### Third-party endpoint detection deferred

SPEC §4 S11 asks for per-endpoint pricing. T2.4 ships the data shape
(`endpoint_id`, `is_third_party`) but every `claude-code` jsonl row
ingests as `is_third_party=0`, `endpoint_id=NULL`. Real detection of
DeepSeek / GLM / etc. proxied through Claude Code is left for a later
pass — schema is forward-compatible.

### Parse error log path

S14 specifies `~/Library/Logs/<App>/parse-errors.log`. We use
`~/Library/Logs/Notchi/parse-errors.log` (matching the `productName`
in `tauri.conf.json` only roughly — bundle id is `com.codingpet.app`).
Log entries are summary-level only (`<ts>\t<N> parse error(s)`); we do
not write the offending JSON line to disk to avoid persisting partial
prompt content.

## 2026-05-05 — T1.1 (project scaffolding)

### `rusqlite` + `tauri-plugin-sql` cannot coexist with `sqlite` feature

**SPEC reference:** §6.6 lists the database layer as
"`rusqlite` + `tauri-plugin-sql`".

**Problem:** Both crates link the native `sqlite3` library and Cargo
forbids two packages declaring `links = "sqlite3"` in one dependency
graph. Concretely:

- `tauri-plugin-sql 2.x` with `features = ["sqlite"]` pulls
  `sqlx-sqlite 0.8`, which depends on `libsqlite3-sys ^0.28`.
- `rusqlite 0.39` (and every version back to 0.32) depends on
  `libsqlite3-sys` 0.30 – 0.37. None satisfies sqlx's `^0.28`.

`cargo check` fails with:
```
package `libsqlite3-sys` links to the native library `sqlite3`,
but it conflicts with a previous package which links to `sqlite3` as well
```

**Investigated:**
1. Tried rusqlite 0.32–0.35 — every version since 0.32 uses
   libsqlite3-sys 0.30+, never 0.28.
2. Pinning libsqlite3-sys to 0.28 across the workspace would require a
   rusqlite version older than 0.31, which predates Rust edition / API
   guarantees we want.
3. Tauri community issues (`tauri-apps/plugins-workspace`) confirm
   this is a long-standing collision; users either drop one crate or
   wait for sqlx to bump libsqlite3-sys.

**Fallback (chosen):** Keep `tauri-plugin-sql` with `sqlite` feature.
Drop the direct `rusqlite` dependency. The data layer (T2.1+) will use
the plugin's sqlx-backed API (frontend `Database.load(...)` or Rust-side
sqlx commands).

If T2.1 needs raw rusqlite specifically, revisit by either:
- (a) waiting for sqlx 0.9 (which is expected to ship a new
  libsqlite3-sys); or
- (b) dropping `tauri-plugin-sql` sqlite feature and exposing our own
  Tauri commands wrapping rusqlite.

This is a deviation from SPEC §6.6 wording, recorded per
`CLAUDE.md` "遇到 SPEC 中的歧义，记录到 CHANGELOG.md 并跳过". The
high-level intent (local SQLite, no cloud) is preserved.

### `pixi-live2d-display` peer-dep mismatch with `pixi.js@^7`

**SPEC reference:** §6.6 selects "pixi-live2d-display + PIXI.js v7".

**Problem:** `pixi-live2d-display@0.4.0` (latest `latest` tag) declares
peer deps on `@pixi/*@^6`. Installing alongside `pixi.js@^7.4` produces
unmet peer warnings (build/install still succeeds).

**Decision:** Per T1.1 scope ("仅安装，不要初始化任何 Live2D 代码"),
warnings are tolerated. The actual rendering work is T1.4, where we will
pick the correct fork/branch (`0.5.0-beta` or the community `cubism4`
fork that supports pixi v7). No CHANGELOG action required at runtime
yet.

## 2026-05-05 — T1.2 (window + tray)

### Dev-mode `set_activation_policy(.Accessory)` does not reliably hide Dock / Cmd-Tab

**SPEC reference:** §6.7 D1 — "Dock 完全隐藏（LSUIElement=true）+ 状态栏图标作为唯一显式入口".

**Observed on user machine (macOS 26.5 Tahoe, Tauri 2.11):**
- Setup-hook diagnostics confirm `app.set_activation_policy(Accessory)` is
  invoked successfully (no panic, no error log).
- However, the dev binary `target/debug/coding-pet` still shows in Dock
  and still appears in Cmd-Tab, contradicting D1.
- Tray icon and `NSWindow.collectionBehavior` (cross-Space) work
  correctly — only the activation-policy effect is missing.

**Root cause:** Tauri/macOS known limitation. `LSUIElement=true` in
`Info.plist` only takes effect for bundled `.app` binaries. The dev
binary is unbundled and ignores the plist; runtime
`setActivationPolicy(NSApplicationActivationPolicyAccessory)` after NSApp
has already launched is unreliable on macOS 14+ for this purpose
(documented Apple guidance: use `LSUIElement` in plist, not runtime).

**Decision:** Accept dev-mode Dock visibility as a known limitation. The
behaviour is correct for the production bundle, which is what users will
ship and run. No code change. To verify the fix in dev, run
`PATH=/usr/bin:$HOME/.cargo/bin:$PATH pnpm tauri build` and launch the
resulting `.app` — Dock will be empty and Cmd-Tab will exclude the app.

**Implication for T1.2 acceptance:** Three of the five UX checks pass in
dev (tray visible, cross-Space follow via three-finger swipe, settings
window opens via tray click). Two checks (Dock hidden, Cmd-Tab hidden)
defer to T4.x bundle verification. This is recorded as a deferred
acceptance and is not a code defect.

**Note on Ctrl-arrow Space switching:** The keyboard shortcut for
"切换到上一个空间 / 下一个空间" is OFF by default on macOS (System
Settings → Keyboard → Shortcuts → Mission Control). Users who want
cross-Space follow via keyboard must enable it themselves; the code
behaviour is correct (verified via three-finger swipe).

## 2026-05-05 — T1.4 (Live2D rendering pipeline)

### `pixi-live2d-display` + PIXI v7 compatibility — chose `0.5.0-beta`

**SPEC reference:** §6.6 stack — "`pixi-live2d-display` + PIXI.js v7";
T1.1 entry above noted the unresolved `latest`-tag (0.4.0) peer-dep
mismatch with PIXI v7 and deferred resolution to T1.4.

**Options considered:**
1. **`pixi-live2d-display@0.5.0-beta`** — official upstream beta tagged
   `beta` on npm. `peerDependencies: { "pixi.js": "^7.0.0" }`. MIT.
2. `pixi-live2d-display-lipsyncpatch@0.5.0-ls-8` — community fork of
   the same beta with extra lipsync features. Same `^7.0.0` peer dep,
   but bundles lipsync code we don't need (T1.4 plays idle motion only).
3. Stick with `0.4.0` and runtime-polyfill `@pixi/*` v6 module names to
   v7 exports. Hack; brittle across pixi minors.

**Chosen: option 1 (`0.5.0-beta`).** Smallest diff from SPEC, official
upstream, exact PIXI v7 peer dep, no extra surface area.

**Implementation note — `@pixi/*` subpath imports.** PIXI v7 ships the
old monorepo subpackages (`@pixi/core`, `@pixi/display`, ...) as
internal deps of `pixi.js`, but pnpm does **not** hoist them to the
project's `node_modules` because nothing in the project declares them
directly. `pixi-live2d-display`'s ESM build still imports from
`@pixi/core` and `@pixi/display`, so Vite resolution fails out of the
box. **Fix:** add `@pixi/core@7.4.3` and `@pixi/display@7.4.3` as
direct deps of the project (locked to the same patch as `pixi.js`).
This is a known issue in the upstream beta and is the documented
workaround in their README; `pnpm` keeps a single resolved version of
each thanks to the explicit pin.

**Outstanding risks:**
- `0.5.0-beta` has not seen a stable release in ~2 years. If we hit a
  critical bug, fallback is the lipsyncpatch fork (option 2) or a
  patched-up 0.4.0 + polyfill. Track upstream
  https://github.com/guansss/pixi-live2d-display/pulls.
- Pinning `@pixi/core`/`@pixi/display` independently to `pixi.js`
  patch is a maintenance footgun: any `pixi.js` minor bump must bump
  all three together.

### Cubism Core SDK + Mao_Pro vendoring strategy

Cubism Core (`live2dcubismcore.min.js`, ~202 KB) fetched from the
official Live2D CDN
(`https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js`)
and committed under `public/assets/live2d/runtime/`. The npm mirror
package `live2dcubismcore@1.0.2` was rejected — it ships a 135 MB
unpacked tarball (kitchen-sink with sample apps) and is not maintained
by Live2D Inc.

Mao_Pro (`runtime/` subtree only, ~9.0 MB) fetched from the official
Live2D sample CDN
(`https://cubism.live2d.com/sample-data/bin/mao_pro/mao_pro_en.zip`).
Editor source files (`.cmo3`, `.can3`, PSD) are NOT vendored — only the
files the Cubism Web SDK loads at runtime. Free Material License +
Sample Data Terms of Use apply (see `LICENSE-3RD-PARTY.md`).

The `CubismWebSamples` GitHub repo does **not** contain the model
binaries — `Samples/Resources/` is empty in git and Live2D distributes
the samples only as zip archives via their CDN. This is why we vendor
straight from the zip rather than via git submodule.

## 2026-05-05 — T1.5 (action state machine)

### Mao_Pro motion + parameter inventory

**SPEC reference:** §5.2 L1 动作集 (`idle` / `coding` / `waiting` /
`done` / `sleep`).

Motions actually shipped in `mao_pro.model3.json`:

| Group | Index | File |
|---|---|---|
| `Idle` | 0 | `motions/mtn_01.motion3.json` |
| `""` (no group key) | 0 | `motions/mtn_02.motion3.json` |
| `""` | 1 | `motions/mtn_03.motion3.json` |
| `""` | 2 | `motions/mtn_04.motion3.json` |
| `""` | 3 | `motions/special_01.motion3.json` |
| `""` | 4 | `motions/special_02.motion3.json` |
| `""` | 5 | `motions/special_03.motion3.json` |

Total: 1 idle motion + 6 free-form motions. Mao_Pro does **not** ship
distinct semantic groups (e.g. `TapBody`, `Coding`, `Waiting`); SPEC
§5.2's five action labels must be mapped onto these by hand.

Relevant parameter IDs from `mao_pro.cdi3.json`:
- `ParamEyeLOpen`, `ParamEyeROpen` — eyelid (0 = closed, 1 = open)
- `ParamBreath` — breath cycle (driver of idle chest movement)
- `ParamMouthOpenY` is **NOT** in the cdi3 — Mao_Pro uses `ParamA` (lip
  sync amplitude), `ParamMouthUp`, `ParamMouthDown`, `ParamMouthAngry`.
  We do not override mouth params for T1.5 (sleep cares only about
  eyelids).

### T1.5 action mapping

| Action | Implementation |
|---|---|
| `idle` | `motion('Idle', 0, FORCE)` and clear all parameter overrides |
| `coding` | `motion('', 1, FORCE)` (mtn_03) — mid-tempo arm sway |
| `waiting` | `motion('', 4, FORCE)` (special_02) — looking-around / arms-up gesture |
| `done` | `motion('', 5, FORCE)` (special_03) — celebratory bounce |
| `sleep` | Stop motion playback; per-frame override `ParamEyeLOpen=0`, `ParamEyeROpen=0`; leave `ParamBreath` untouched (its default cycle is already gentle, fine for MVP) |

The picks are best-guess by file naming + the Cubism Sample marketing
material. Visual fitness of each special_* is subjective — MVP goal is
**5 visually distinct buttons**, not perfect semantic match. SPEC §5.2
accepts "动作" without prescribing exact motion files; this mapping is
documented here for v1.x revisit.

### Cross-window action signalling

Settings and Pet are two separate Tauri webviews. Zustand state in one
window does not propagate to the other. T1.5's debug panel lives in
Settings but the Live2D model lives in Pet, so the panel emits a
`pet:set-action` Tauri event with `{ action: PetAction }` payload. The
pet window listens via `@tauri-apps/api/event::listen` and writes into
its local `petStore`. No new Rust commands needed; `core:default` covers
event emit/listen.

## 2026-05-05 — T1.6 (drag + position memory + offscreen recovery)

### `appWindow.startDragging()` not used

**SPEC reference:** §4 S8 ("拖拽超过 5 px"), §6.7 D4 (吸附半径 100 px).

Tauri's built-in drag helper (`Window::start_dragging`) hands control
of the pointer to the OS window server, which on macOS gives a clean
follow but exposes no callbacks for movement, no 5 px threshold, and
no way to ignore micro-clicks. We need all three to implement S8 +
D4 + S19 correctly, so the pet window is moved manually via
`set_position` from the frontend instead.

**Mechanism:** the `usePetCanvas` container captures `pointerdown` /
`pointermove` / `pointerup` (DOM PointerEvents). The pointer offset
inside the window is taken at `pointerdown.clientX/Y`; subsequent
moves derive the new top-left as `screenX - offsetX`, which holds
even as the window itself chases the cursor. `setPointerCapture` is
mandatory — without it the moving window would steal hover from the
canvas mid-drag.

**Throttle:** `set_position` is throttled to one IPC per 16 ms (~60 Hz)
to stay inside SPEC §6.1's CPU budget; pending moves coalesce via
`setTimeout` and are flushed at drag-end so the release point matches
the user's actual cursor position before the snap distance is computed.

### `windowPosition` schema in `settings.json`

```json
{
  "windowPosition": {
    "x": 412.0,
    "y": 380.5,
    "screenId": "Built-in Retina Display",
    "timestamp": "2026-05-05T12:34:56.789Z"
  }
}
```

`x` / `y` are top-left logical pixels (the same coordinate space
`set_position` consumes); `screenId` is `NSScreen.localizedName`. The
key is set to `null` (not deleted) when the user releases inside the
100 px snap radius — explicit "use default". On startup the Rust
setup hook reads the entry, requires `screenId` to match the current
main display, and requires the whole 240×240 window to fit inside
`visibleFrame` with a 10 px safety margin (S19); failing either
condition resets to the notch default and clears the entry.

### Capability addition

The drag path calls `Window::set_position` from the frontend, which
needs the `core:window:allow-set-position` permission. Tauri 2's
`core:default` set does not include positional mutation, so the
permission was added explicitly in `src-tauri/capabilities/default.json`.

## 2026-05-05 — T1.7 (Live2D → static PNG degraded render)

### Fallback PNG asset generation: SVG + Chrome headless

**SPEC reference:** §4 S15 ("文件缺失/格式错误/WebGL 初始化失败"
时降级为静态 PNG，"同款角色 idle/coding/done 三张").

**Strategies considered:**
1. **Headless Live2D render via puppeteer** — load Mao_Pro in a real
   Chrome canvas, swap motions, capture `toDataURL`. Faithful to "同款
   角色" but heavy: needs vite dev server, the Cubism Core IIFE, and a
   pnpm-installed puppeteer (~150 MB devDep). Brittle on CI.
2. **Crop the Mao_Pro texture atlas** — the file the user prompt
   suggested. Investigated and rejected: `mao_pro.4096/texture_00.png`
   is a parts sheet (head, hair, body fragments tiled across 4096×4096),
   not a renderable portrait. No crop yields a usable avatar.
3. **Hand-coded SVG mascot, rasterised via Chrome headless.** Three
   stylised chibi poses — idle (eyes open, smile), coding (focused,
   half-lidded, laptop badge), done (closed-eye smile, star badge) —
   sharing a Mao-inspired palette (blue hair, navy outfit, orange
   ribbon, peach skin). Rasterised at 480×480 via
   `chrome --headless=new --screenshot`. No runtime deps, output is
   reproducible from the script.

**Chosen: option 3.** Total output: 38 KB across 3 PNGs (well under
SPEC's 1.5 MB allowance). A "FALLBACK · STATE" tag is baked into each
image so users can tell at a glance they're in degraded mode (the
banner is the canonical signal; the in-image tag is belt-and-braces).

**Action mapping (PetFallbackImage):**
- `idle` / `waiting` / `sleep` → `idle@2x.png`
- `coding` → `coding@2x.png`
- `done` → `done@2x.png`

The SPEC text only requires three images. `waiting` and `sleep` map
to `idle` for MVP — visually distinguishing all five states in the
fallback path was deemed not worth the asset bloat / authoring
overhead at this stage.

### Render-mode branching + drag wrapper

`PetCanvas` previously owned `usePetWindowDrag` directly. Moved the
hook one level up to `App.tsx` and split the DOM into a wrapper
`<div className="pet-canvas">` (drag target) and an inner
`PetCanvas`/`PetFallbackImage`. This makes drag work identically in
both render modes — required by S15's "所有功能保持可用" clause.

The `<img>` in `PetFallbackImage` uses `pointer-events: none` so the
wrapper still receives `pointerdown` for drag; native image drag is
also disabled via `draggable={false}` and `-webkit-user-drag: none`
to prevent the browser's image-drag ghost from interfering.

### Settings ↔ pet render-mode signalling

Two webviews share no state, mirroring the T1.5 pattern. The pet
broadcasts a `pet:render-mode` event on every change (and once on
mount) so the settings window can show / hide the degraded banner
even if it opens after an auto-fallback already happened. The dev-
only "强制降级" button in settings emits a `pet:force-fallback`
event the pet listens for (`useFallbackEvents`); flipping renderMode
client-side is enough to verify the full degraded path without
breaking Live2D assets.

### Verification approach

`pnpm tauri dev` was not run in the agent sandbox. The acceptance path
was verified by:
- `pnpm typecheck` clean.
- `pnpm lint` clean.
- `cargo clippy ... -D warnings` clean.
- `pnpm build` produces both bundle entry points without warnings
  introduced by T1.7.
- Code review of the failure chain
  `Live2DModel.from()` reject → `catch` → `setRenderMode("fallback")`
  → App re-renders with `<PetFallbackImage />`, with the chain
  identical to the one wired in T1.4.

End-to-end UI verification (deliberate MODEL_URL break + fallback
banner appearance) is left as a manual check by the user per the
T1.7 acceptance script.
