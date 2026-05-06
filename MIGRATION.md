# Migrating Notchi to a new machine

This document is the playbook for taking Notchi (and the Claude Code
host it sits next to) from one Mac to another. The core insight is
that **almost nothing should be physically copied** — the GitHub repo
is the single source of truth, and Notchi's local data store will
re-populate itself from the new machine's own jsonl files.

If your scenario is "the old Mac is staying online and I want both
machines to work in parallel", scroll down to the **Parallel
machines** section.

---

## TL;DR

```sh
# On the NEW Mac
xcode-select --install
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install git gh node pnpm
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env
gh auth login
gh repo clone liangliang1259/notchi
cd notchi
pnpm install
pnpm tauri dev
```

If `which cc` returns `/opt/homebrew/bin/cc` (e.g. you have
`claude-code-switcher` installed), prefix every `cargo` / `pnpm tauri`
invocation with `PATH=/usr/bin:$HOME/.cargo/bin:$PATH`.

---

## Old machine — finish line

Run these once, before you walk away from the old Mac.

### 1. Verify everything is on GitHub

```sh
cd <path-to-notchi>
git status                       # working tree should be clean
git fetch --all
git log --oneline origin/main..HEAD  # should print nothing
```

If the second command prints any commits, you have unpushed work:

```sh
git push --all origin            # push every local branch
git push --tags origin
```

### 2. Decide what stays on `main`

By default `main` already includes all v1.x features (PRs #1–#4 and
the all-merged branch were fast-forwarded into it). The active
feature branches (`claude/v1.0-multi-source`, `claude/v1.1-evolution`,
`claude/v1.2-multiform`, `claude/v1.3-hardening`, `claude/all-merged`,
plus the historical `claude/T*` series) stay in the remote as review
history — don't delete them.

If you'd rather start a fresh chapter, you can prune the historical
branches **after the new machine is verified working**:

```sh
# Only after you've confirmed the new Mac is good
for b in claude/T1.1-project-init claude/T1.2-window claude/T1.3-notch \
         claude/T1.4-live2d claude/T1.5-actions claude/T1.6-drag \
         claude/T1.7-fallback claude/T2-data-layer claude/T2-ui-layer \
         claude/T3-emotion claude/v1.0-multi-source \
         claude/v1.1-evolution claude/v1.2-multiform \
         claude/v1.3-hardening claude/all-merged; do
  git push origin --delete "$b"
done
```

### 3. Stop using the old machine for Notchi work

Two parallel machines on the same git repo creates conflicts. Either
shut down the old `pnpm tauri dev` and stop committing on the old Mac,
or follow the **Parallel machines** section below for a controlled
hand-off.

---

## New machine — first run

### 0. Pre-flight check

```sh
xcode-select -p            # /Library/Developer/CommandLineTools
brew --version             # ≥ 4
git --version              # ≥ 2.30
gh --version               # any
node --version             # ≥ 18
pnpm --version             # ≥ 8
rustc --version            # ≥ 1.77
```

Anything missing — install it:

```sh
xcode-select --install
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install git gh node pnpm
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env
```

### 1. Authenticate and clone

```sh
gh auth login                      # github.com / HTTPS / browser
gh repo clone liangliang1259/notchi
cd notchi
```

### 2. Install dependencies

```sh
pnpm install                       # ~30-60s, prefetches every npm dep
```

`cargo` deps are fetched on the first `pnpm tauri dev`.

### 3. First run

```sh
pnpm tauri dev
```

If the build fails with `cc: error: ...` or a linker error, your `cc`
is shadowed:

```sh
which cc                           # /opt/homebrew/bin/cc → bad
PATH=/usr/bin:$HOME/.cargo/bin:$PATH pnpm tauri dev
```

Expect the first compile to take **5–10 minutes** (cargo cold cache).
Subsequent runs are seconds.

### 4. Visual smoke test

When the dev window opens you should see:

- A 240×240 transparent window anchored under the notch (or the
  virtual notch island if your display has none) showing the Mao
  Live2D character.
- The `Notchi` settings window opens via the menubar tray icon.
- Five tabs in the settings window: Overview / Sessions / Tokens /
  Pet / Settings.
- Hovering the pet for ~300 ms expands the window into a Dynamic
  Island-style capsule with today's tokens / cost / model.

If any of those are missing see **Troubleshooting** below.

---

## Data — what comes with you, what doesn't

**You should not copy any of these from the old machine. They will
be re-built on the new machine automatically.**

| Path | Why not | What happens on new machine |
|---|---|---|
| `~/Library/Application Support/com.codingpet.app/data.db` | Token / event SQLite. Embeds old machine's project paths and timestamps. | Notchi backfills the last 30 days from local jsonl on first run. |
| `~/.claude/projects/**/*.jsonl` | Claude Code session log. **100 % local, never synced** by Anthropic by design. | New machine has its own. |
| `~/.codex/sessions/**` | Codex CLI session log. Same as above. | Same. |
| `~/Library/Application Support/Claude/local-agent-mode-sessions/` | Claude Desktop's embedded agent sessions. | Same. |

**These are settings you'll want to re-enter** in the new machine's
Notchi UI:

- Monthly budget (Settings → Monthly budget)
- Quiet hours (Settings → Quiet hours)
- Per-model pricing overrides if you customised any
- Notch mode override if you forced it

**These reset to defaults**, intentionally:

- Pet drag position
- Evolution stage (resets to Egg, climbs as you accumulate tokens)
- Feed level / mood
- Species (re-derived from your top project)

---

## Verifying the new machine before you commit to it

Run through this checklist once before treating the new Mac as your
primary:

1. `pnpm tauri dev` launches without error.
2. Mao renders (not the static fallback PNG).
3. Pet window can be dragged; releasing within 100 px of the notch
   snaps back; releasing far away persists across restarts.
4. Settings → Pet → "Force evolution-up" plays the burst animation.
5. Settings → Pet → "Test bubble" → done triggers a bubble + (first
   time) a macOS notification permission prompt; grant it.
6. Settings → Overview → today's numbers are non-zero after a few
   minutes of using Claude Code on the new Mac.
7. Settings → Pet → Data summary lists at least `claude-code` (and
   `codex` / `claude-desktop` if you use those tools).

Any failure → see **Troubleshooting**, then ping the conversation
that produced this repo with the specific symptom.

---

## Daily workflow on the new machine

```sh
# Start a feature
git checkout -b claude/<feature-name>

# Work, commit, push, open PR
git add -A
git -c user.name="leon" -c user.email="liangliang1259@gmail.com" \
  commit -m "feat: ..."
git push -u origin claude/<feature-name>
gh pr create --base main --draft
```

Don't push directly to `main`. The repo expects PRs (per
[CLAUDE.md](./CLAUDE.md) §Git 规范).

---

## Parallel machines

If both Macs need to be live at once (e.g. handing the old Mac to a
teammate, or you're not ready to migrate fully):

- **Code** is fine — git push/pull keeps both in sync. Always pull
  before starting work on either machine.
- **Notchi data** (`data.db` and the SQLite events table) deliberately
  diverges per machine. There is no cross-machine sync. Each machine
  shows its own usage.
- **Claude Code session history** also stays per-machine. Anthropic
  does not sync `~/.claude/projects/` and we don't either.

If you really need shared session history across both machines, the
least-bad option is Syncthing pointed at `~/.claude/projects/`, with
the rule "only one machine has Claude Code open at a time" to avoid
race conditions on jsonl writes. We do not officially support this.

---

## Troubleshooting

### `cc: error: linker exited with non-zero status`

Your `cc` is the `claude-code-switcher` shim. Workaround:

```sh
PATH=/usr/bin:$HOME/.cargo/bin:$PATH pnpm tauri dev
```

Or, permanently, prepend `/usr/bin` ahead of `/opt/homebrew/bin` in
your shell profile.

### `Port 1420 is already in use`

A previous `pnpm tauri dev` (or its child binary) didn't exit:

```sh
lsof -ti:1420 | xargs kill -9
```

### Settings window's Overview shows `Failed to load overview … decoding column 4 …`

The fix landed in v1.0+ (`COALESCE(... ,0.0)`). If you somehow ended
up with an old binary against an empty SQLite, restart `pnpm tauri
dev` after `git pull`.

### Mao does not render — only the static PNG appears

The Live2D Cubism Core SDK script failed to load. Open the WebView
devtools (`Cmd-Opt-I`) and check the console for asset 404s. The SDK
file lives at `public/assets/live2d/runtime/live2dcubismcore.min.js`
and the model under `public/assets/live2d/mao/`. If they aren't in
your clone, your `git lfs` setup may have stripped them — re-pull:

```sh
git lfs install
git pull
```

(Notchi doesn't actually use git-lfs, but mention is here for
completeness.)

### Notification banner says "macOS notifications denied"

```sh
open "x-apple.systempreferences:com.apple.preference.notifications"
```

Find Notchi, set permission to Allow.

### Pet window jumps to a weird position after restart

The position store decided your previous coordinates are off-screen
(common after disconnecting an external display). It auto-recovers to
the default notch position; nothing to do.

### `cargo` complains about `links="sqlite3"`

You added `rusqlite` as a direct dep again. Don't — the data layer
goes through `tauri-plugin-sql`'s sqlx. See `CHANGELOG.md` 2026-05-05
T1.1 entry.
