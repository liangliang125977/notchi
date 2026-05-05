# CHANGELOG

This file records SPEC ambiguities, fallback decisions, and noteworthy
deviations encountered while implementing Coding Pet. Per `CLAUDE.md`, AI
agents must log here rather than guess.

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
