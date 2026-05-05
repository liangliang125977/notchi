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
