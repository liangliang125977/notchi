# Notchi

> A macOS Apple Silicon Live2D coding companion that lives below your notch and
> tracks token usage for AI coding tools. Built locally — nothing leaves your
> machine.

<p align="left">
  <em>"Codex Pets, but for Claude Code, and prettier."</em>
</p>

## What it is

Notchi is a small desktop pet that:

- Renders a Live2D character anchored under your MacBook notch (or a virtual
  notch island on non-notched displays).
- Watches the local jsonl trails of supported AI coding tools (Claude Code,
  Codex CLI, Claude Desktop) and surfaces real-time token / cost data.
- Reacts emotionally — bubbles when you're idle, plays a "done" animation +
  macOS notification when an assistant finishes a task.
- Stays out of your way: hidden from Dock & Cmd-Tab when bundled, transparent
  window, follows you across Spaces, drag-and-snap to the notch.

Three data layers are exposed in the settings window:

- **L1** — colour temperature on the pet itself (greener under budget, redder
  over).
- **L2** — Dynamic-Island style hover capsule with today's tokens / cost /
  active session.
- **L3** — full settings tab with overview cards, hourly histogram, by-tool
  pie, recent sessions list, pricing editor.

## Status

Currently in heavy development. The MVP (stages 1–3) is feature-complete on
`main`; v1.0 / v1.1 / v1.2 / v1.3 ship as branches under draft pull requests.

| Stage | Scope | Status |
|---|---|---|
| 1 | Shell, Live2D rendering, drag/snap, notch positioning, fallback PNG | ✅ on `main` |
| 2 | SQLite ingest, three-tier UI, pricing | ✅ on `main` |
| 3 | Bubbles, macOS notifications, quiet hours | ✅ on `main` |
| 4 | Performance verification, dmg packaging, GitHub release | ⏸ deferred |
| v1.0 | Multi-source: Codex CLI + Claude Desktop adapters | 🟡 PR #1 |
| v1.1 | Evolution stages + feeding/mood | 🟡 PR pending |
| v1.2 | Time dimensions + sessions page + species badges | 🟡 PR pending |
| v1.3 | Notification-permission banner + pricing validation | 🟡 PR #2 |

## Supported data sources

| Tool | Status | Path |
|---|---|---|
| Claude Code CLI | ✅ | `~/.claude/projects/**/*.jsonl` |
| Codex CLI | ✅ (v1.0) | `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl` |
| Claude Desktop | ✅ (v1.0) | `~/Library/Application Support/Claude/local-agent-mode-sessions/**/audit.jsonl` |
| OpenCode CLI | 🟡 stub (no local sample) | TBD |
| Cursor | 🟡 stub (no local sample) | TBD |

Pricing seeded for the major Anthropic and OpenAI models; users can override
per row or add custom third-party endpoints in the settings window.

## Privacy

Notchi is **local-only**:

- All data stays in `~/Library/Application Support/com.codingpet.app/data.db`.
- No outbound network traffic except (a) optional version check (off by
  default), and (b) the one-time Live2D Cubism Core SDK download at install.
- jsonl content (your prompts, code, model output) is parsed in-process and
  reduced to numeric counts before being written to SQLite.
- See [SPEC.md](./SPEC.md) §S12 for the full privacy contract.

## Build

Requires:

- macOS 13+ on Apple Silicon (M1+).
- Rust ≥ 1.77 via `rustup`.
- Node ≥ 18, pnpm ≥ 8.
- Xcode Command Line Tools.

```bash
pnpm install
pnpm tauri dev      # development with HMR
pnpm tauri build    # release .app + .dmg under src-tauri/target/release/bundle/
```

> If your `cc` is shadowed by a Homebrew shim (e.g. `claude-code-switcher`),
> prefix every `cargo` / `pnpm tauri` invocation with `PATH=/usr/bin:$HOME/.cargo/bin:$PATH`.

## Repository layout

```
src/                          React 19 + TypeScript + Tailwind + shadcn/ui
src-tauri/src/                Rust core
  data/                       SQLite + ingest + pricing + queries
  data/sources/               Per-tool jsonl adapters (claude_code, codex, claude_desktop, …)
  macos.rs                    NSScreen geometry + objc2 bridges
  tray.rs                     status-bar item
public/assets/live2d/         Mao_Pro Cubism sample (LICENSE-3RD-PARTY.md)
SPEC.md                       full product specification (Chinese)
CLAUDE.md                     AI agent guardrails for the repo
CHANGELOG.md                  fallback decisions and reverse-engineered schemas
```

## Live2D asset license

The bundled Mao_Pro model is the official Live2D Cubism sample, redistributable
under the Live2D Free Material License for personal / small-scale-enterprise
use. See [LICENSE-3RD-PARTY.md](./LICENSE-3RD-PARTY.md) for details. Per the
SPEC §6.4 / D3, this asset must be replaced with a self-authored, CC0, or
commercially licensed model before any Mac App Store distribution.

## Acknowledgements

- [Live2D Cubism](https://www.live2d.com/) for the Mao_Pro sample model.
- [`pixi-live2d-display`](https://github.com/RaSan147/pixi-live2d-display) for
  the Cubism 4 web runtime over PIXI.
- [Tauri](https://tauri.app/) for keeping the binary small.
