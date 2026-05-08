# v0.2 #3 Hooks Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run an embedded HTTP server on `127.0.0.1:<random>` that receives Claude Code hook events (PreToolUse / PostToolUse / Stop) and triggers 600ms transient pet expressions. Expose a Settings toggle that one-click installs/uninstalls the hook commands into `~/.claude/settings.json`.

**Architecture:** axum server spawned in `lib.rs::setup`. Three POST routes emit `pet:hook-event` to the frontend. Install module reads/writes user's settings.json with a `marker: "notchi"` field for surgical uninstall. Hooks events stay transient — never written to SQLite.

**Tech Stack:** Rust + axum + tokio · Tauri events · React 19 · `serde_json` for settings.json merge.

**Design doc:** `docs/plans/2026-05-08-v02-bundle-design.md`

**Prerequisites:** None — fully orthogonal to Plans #1 and #2.

---

## Task 1: Add axum dep + skeleton hooks module

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/hooks/mod.rs`
- Create: `src-tauri/src/hooks/server.rs`
- Modify: `src-tauri/src/lib.rs` (`mod hooks;`)

**Step 1: Add axum to Cargo.toml**

In `src-tauri/Cargo.toml`, under `[dependencies]`:

```toml
axum = "0.8"
tower = "0.5"
```

(`tokio` is already there with rt-multi-thread.)

**Step 2: Create the module skeleton**

`src-tauri/src/hooks/mod.rs`:

```rust
pub mod install;
pub mod server;

pub use install::{install_hooks, is_installed, uninstall_hooks};
pub use server::{start_server, ServerHandle};
```

`src-tauri/src/hooks/server.rs` — minimal stub:

```rust
//! v0.2 #3 — embedded HTTP server for Claude Code hook callbacks.
use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::State,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;

#[derive(Clone)]
pub struct ServerHandle {
    pub port: u16,
}

#[derive(Debug, Deserialize)]
pub struct HookPayload {
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub stop_reason: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub timestamp: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct HookEvent {
    pub kind: &'static str,
    pub tool_name: Option<String>,
    pub stop_reason: Option<String>,
    pub duration_ms: Option<u64>,
}

pub async fn start_server(app: AppHandle) -> Result<ServerHandle, String> {
    let app_arc = Arc::new(app);
    let router = Router::new()
        .route("/hooks/pre-tool-use",
            post({
                let a = app_arc.clone();
                move |Json(p): Json<HookPayload>| {
                    let a = a.clone();
                    async move {
                        let _ = a.emit("pet:hook-event", &HookEvent {
                            kind: "pre_tool_use",
                            tool_name: p.tool_name,
                            stop_reason: None,
                            duration_ms: None,
                        });
                        "ok"
                    }
                }
            }))
        .route("/hooks/post-tool-use",
            post({
                let a = app_arc.clone();
                move |Json(p): Json<HookPayload>| {
                    let a = a.clone();
                    async move {
                        let _ = a.emit("pet:hook-event", &HookEvent {
                            kind: "post_tool_use",
                            tool_name: p.tool_name,
                            stop_reason: None,
                            duration_ms: p.duration_ms,
                        });
                        "ok"
                    }
                }
            }))
        .route("/hooks/stop",
            post({
                let a = app_arc.clone();
                move |Json(p): Json<HookPayload>| {
                    let a = a.clone();
                    async move {
                        let _ = a.emit("pet:hook-event", &HookEvent {
                            kind: "stop",
                            tool_name: None,
                            stop_reason: p.stop_reason,
                            duration_ms: p.duration_ms,
                        });
                        "ok"
                    }
                }
            }));

    let listener = TcpListener::bind("127.0.0.1:0").await
        .map_err(|e| format!("bind: {e}"))?;
    let addr: SocketAddr = listener.local_addr()
        .map_err(|e| format!("local_addr: {e}"))?;
    let port = addr.port();

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            eprintln!("[hooks-server] {e}");
        }
    });

    // Persist port for diagnostics
    let _ = std::fs::create_dir_all(
        std::env::var_os("HOME")
            .map(|h| std::path::PathBuf::from(h).join(".notchi"))
            .unwrap_or_default(),
    );
    let _ = std::env::var_os("HOME").map(|h| {
        std::fs::write(
            std::path::PathBuf::from(h).join(".notchi/port.txt"),
            format!("{port}"),
        )
    });

    Ok(ServerHandle { port })
}
```

`src-tauri/src/hooks/install.rs` — stub for now:

```rust
//! Install / uninstall Notchi hook commands into ~/.claude/settings.json.
pub fn install_hooks(_port: u16) -> Result<(), String> {
    Err("not implemented".into())
}
pub fn uninstall_hooks() -> Result<(), String> { Err("not implemented".into()) }
pub fn is_installed() -> bool { false }
```

In `src-tauri/src/lib.rs`, alongside existing `mod data;` add:

```rust
mod hooks;
```

**Step 3: Verify**

```bash
cd /Users/a58/Documents/personal/ai-coding/notchi
PATH=/usr/bin:$HOME/.cargo/bin:$PATH cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10
```

Expected: clean (axum will download).

**Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/hooks/ src-tauri/src/lib.rs
git commit -m "feat(hooks): add axum server skeleton + install/uninstall stubs"
```

---

## Task 2: Wire server start at app launch

**Files:**
- Modify: `src-tauri/src/lib.rs` (setup block)

**Step 1: Spawn server**

In `setup`, after the data layer install:

```rust
// v0.2 #3: hooks HTTP server
{
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        match crate::hooks::start_server(app_handle).await {
            Ok(handle) => {
                println!("[hooks-server] listening on 127.0.0.1:{}", handle.port);
            }
            Err(e) => {
                eprintln!("[hooks-server] failed to start: {e}");
            }
        }
    });
}
```

**Step 2: Verify launch path**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3
```

**Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(hooks): start HTTP server during app setup"
```

---

## Task 3: install_hooks — read/merge/write settings.json

**Files:**
- Modify: `src-tauri/src/hooks/install.rs`

**Step 1: Write the failing test (idempotent install)**

Replace stub with a proper implementation skeleton:

```rust
use std::path::PathBuf;
use serde_json::{json, Value};

const HOOK_MARKER: &str = "notchi";

fn settings_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".claude/settings.json"))
}

pub fn install_hooks(port: u16) -> Result<(), String> {
    install_hooks_at(&settings_path().ok_or("HOME unset")?, port)
}

pub fn uninstall_hooks() -> Result<(), String> {
    uninstall_hooks_at(&settings_path().ok_or("HOME unset")?)
}

pub fn is_installed() -> bool {
    settings_path()
        .as_deref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .map(|v| settings_has_marker(&v))
        .unwrap_or(false)
}

fn settings_has_marker(v: &Value) -> bool {
    let hooks = match v.get("hooks") { Some(h) => h, None => return false };
    for kind in ["PreToolUse", "PostToolUse", "Stop"] {
        let Some(arr) = hooks.get(kind).and_then(|h| h.as_array()) else { continue };
        if arr.iter().any(|item| {
            item.get("hooks")
                .and_then(|h| h.as_array())
                .map(|hooks| hooks.iter().any(|h| h.get("marker").and_then(|m| m.as_str()) == Some(HOOK_MARKER)))
                .unwrap_or(false)
        }) {
            return true;
        }
    }
    false
}

pub(crate) fn install_hooks_at(path: &std::path::Path, port: u16) -> Result<(), String> {
    let mut root: Value = if path.exists() {
        let raw = std::fs::read_to_string(path).map_err(|e| format!("read: {e}"))?;
        // backup before mutating
        let _ = std::fs::write(path.with_extension("json.notchi-backup"), raw.as_bytes());
        serde_json::from_str(&raw).map_err(|e| format!("parse: {e}"))?
    } else {
        if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
        json!({})
    };

    if !root.is_object() { root = json!({}); }
    let hooks = root.as_object_mut().unwrap()
        .entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() { *hooks = json!({}); }

    for (event, route) in [
        ("PreToolUse", "pre-tool-use"),
        ("PostToolUse", "post-tool-use"),
        ("Stop", "stop"),
    ] {
        let arr = hooks.as_object_mut().unwrap()
            .entry(event).or_insert_with(|| json!([]));
        if !arr.is_array() { *arr = json!([]); }
        let arr = arr.as_array_mut().unwrap();

        // Idempotency: skip if any matcher contains a hook with our marker
        let already = arr.iter().any(|item| {
            item.get("hooks").and_then(|h| h.as_array())
                .map(|hooks| hooks.iter().any(|h| h.get("marker").and_then(|m| m.as_str()) == Some(HOOK_MARKER)))
                .unwrap_or(false)
        });
        if already { continue; }

        arr.push(json!({
            "matcher": "*",
            "hooks": [{
                "type": "command",
                "command": format!(
                    "curl -s -X POST -H 'Content-Type: application/json' \
                     -d \"@${{CLAUDE_HOOK_PAYLOAD_FILE:-/dev/stdin}}\" \
                     http://127.0.0.1:{port}/hooks/{route} > /dev/null 2>&1 || true"
                ),
                "marker": HOOK_MARKER,
            }]
        }));
    }

    let pretty = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(path, pretty).map_err(|e| format!("write: {e}"))?;
    Ok(())
}

pub(crate) fn uninstall_hooks_at(path: &std::path::Path) -> Result<(), String> {
    if !path.exists() { return Ok(()); }
    let raw = std::fs::read_to_string(path).map_err(|e| format!("read: {e}"))?;
    let mut root: Value = serde_json::from_str(&raw).map_err(|e| format!("parse: {e}"))?;
    let Some(obj) = root.as_object_mut() else { return Ok(()); };
    let Some(hooks) = obj.get_mut("hooks").and_then(|h| h.as_object_mut()) else { return Ok(()); };
    for kind in ["PreToolUse", "PostToolUse", "Stop"] {
        if let Some(arr) = hooks.get_mut(kind).and_then(|a| a.as_array_mut()) {
            arr.retain(|item| {
                let has_our_marker = item.get("hooks").and_then(|h| h.as_array())
                    .map(|hs| hs.iter().any(|h| h.get("marker").and_then(|m| m.as_str()) == Some(HOOK_MARKER)))
                    .unwrap_or(false);
                !has_our_marker
            });
        }
    }
    let pretty = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(path, pretty).map_err(|e| format!("write: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tempfile() -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("notchi-hooks-test-{}.json",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)));
        p
    }

    #[test]
    fn install_idempotent() {
        let p = tempfile();
        install_hooks_at(&p, 9999).unwrap();
        let after_first = std::fs::read_to_string(&p).unwrap();
        install_hooks_at(&p, 9999).unwrap();
        let after_second = std::fs::read_to_string(&p).unwrap();
        // Same hooks present, no duplicates
        assert_eq!(after_first, after_second);
        let v: Value = serde_json::from_str(&after_first).unwrap();
        assert!(settings_has_marker(&v));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn uninstall_preserves_other_hooks() {
        let p = tempfile();
        // Pre-existing user hook
        std::fs::write(&p, r#"{
            "hooks": {
                "PreToolUse": [
                    { "matcher": "Bash", "hooks": [
                        { "type": "command", "command": "echo user-hook" }
                    ]}
                ]
            }
        }"#).unwrap();
        install_hooks_at(&p, 9999).unwrap();
        uninstall_hooks_at(&p).unwrap();
        let raw = std::fs::read_to_string(&p).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        // User hook preserved
        let user_present = v.pointer("/hooks/PreToolUse")
            .and_then(|a| a.as_array())
            .map(|arr| arr.iter().any(|i|
                i.get("hooks").and_then(|h| h.as_array())
                    .map(|hooks| hooks.iter().any(|h|
                        h.get("command").and_then(|c| c.as_str())
                            .map(|c| c.contains("user-hook")).unwrap_or(false)))
                    .unwrap_or(false)
            ))
            .unwrap_or(false);
        assert!(user_present, "user hook was dropped during uninstall");
        // Notchi marker gone
        assert!(!settings_has_marker(&v));
        let _ = std::fs::remove_file(&p);
    }
}
```

**Step 2: Run tests**

```bash
PATH=/usr/bin:$HOME/.cargo/bin:$PATH cargo test --manifest-path src-tauri/Cargo.toml install_idempotent uninstall_preserves 2>&1 | tail -10
```

Expected: 2 tests pass.

**Step 3: Commit**

```bash
git add src-tauri/src/hooks/install.rs
git commit -m "feat(hooks): install/uninstall settings.json with idempotency + marker preservation"
```

---

## Task 4: Tauri commands for install / uninstall / status

**Files:**
- Modify: `src-tauri/src/data/commands.rs` (or add new `hooks_commands.rs`)
- Modify: `src-tauri/src/lib.rs` (invoke handler)

**Step 1: Wire commands**

Append to `src-tauri/src/data/commands.rs`:

```rust
#[tauri::command]
pub async fn install_hooks_cmd(app: AppHandle) -> Result<u16, String> {
    let raw = std::fs::read_to_string(
        std::env::var_os("HOME")
            .map(|h| std::path::PathBuf::from(h).join(".notchi/port.txt"))
            .ok_or("HOME unset")?,
    ).map_err(|e| format!("read port: {e}"))?;
    let port: u16 = raw.trim().parse().map_err(|e| format!("parse port: {e}"))?;
    crate::hooks::install_hooks(port)?;
    let _ = app.emit("pet:hooks-installed", port);
    Ok(port)
}

#[tauri::command]
pub fn uninstall_hooks_cmd(app: AppHandle) -> Result<(), String> {
    crate::hooks::uninstall_hooks()?;
    let _ = app.emit("pet:hooks-uninstalled", ());
    Ok(())
}

#[tauri::command]
pub fn hooks_status_cmd() -> bool {
    crate::hooks::is_installed()
}
```

In `lib.rs::run` invoke handler:

```rust
data::commands::install_hooks_cmd,
data::commands::uninstall_hooks_cmd,
data::commands::hooks_status_cmd,
```

**Step 2: Verify + commit**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3
git add src-tauri/src/data/commands.rs src-tauri/src/lib.rs
git commit -m "feat(commands): expose install/uninstall/status for hooks"
```

---

## Task 5: Settings UI — HooksToggle

**Files:**
- Create: `src/components/HooksToggle.tsx`
- Modify: settings panel to mount it

**Step 1: Component**

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "../hooks/useT";

export function HooksToggle() {
  const t = useT();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void invoke<boolean>("hooks_status_cmd").then(setInstalled).catch(() => setInstalled(false));
  }, []);

  const onToggle = async () => {
    setBusy(true); setErr(null);
    try {
      if (installed) {
        await invoke("uninstall_hooks_cmd");
        setInstalled(false);
      } else {
        await invoke("install_hooks_cmd");
        setInstalled(true);
      }
    } catch (e) {
      setErr(String(e));
    } finally { setBusy(false); }
  };

  if (installed === null) return null;

  return (
    <div className="sp-row">
      <label>{t.settings.hooksIntegration}</label>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        className={installed ? "sp-btn-on" : "sp-btn-off"}
      >
        {busy ? t.settings.applying : installed ? t.settings.disable : t.settings.enable}
      </button>
      <span className="sp-hint">{t.settings.hooksHint}</span>
      {err ? <span className="sp-err">{err}</span> : null}
    </div>
  );
}
```

**Step 2: i18n**

Add to `src/lib/locales.ts` settings interface:

```ts
hooksIntegration: string;
hooksHint: string;
enable: string;
disable: string;
```

en:

```ts
hooksIntegration: "Claude Code hooks",
hooksHint: "When enabled, Notchi reacts to your Claude Code tool calls (Bash → flexes; Edit → glasses on; Stop → done dance). Original ~/.claude/settings.json is backed up.",
enable: "Enable",
disable: "Disable",
```

zh:

```ts
hooksIntegration: "Claude Code hooks",
hooksHint: "启用后，Notchi 会随你的 Claude Code 工具调用做出反应（Bash → 撸袖子；Edit → 戴眼镜；Stop → 完成动画）。安装前会备份 ~/.claude/settings.json。",
enable: "启用",
disable: "禁用",
```

**Step 3: Mount + commit**

In settings panel, add `<HooksToggle />`.

```bash
pnpm typecheck 2>&1 | tail -3
git add src/components/HooksToggle.tsx src/lib/locales.ts src/components/
git commit -m "feat(settings): HooksToggle one-click install/uninstall"
```

---

## Task 6: PetExpressionLayer — react to pet:hook-event

**Files:**
- Create: `src/components/PetExpressionLayer.tsx`
- Modify: `src/App.tsx` (mount)

**Step 1: Component**

```tsx
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

type HookEvent = {
  kind: "pre_tool_use" | "post_tool_use" | "stop";
  tool_name?: string;
  stop_reason?: string;
  duration_ms?: number;
};

const TOOL_EXPR: Record<string, string> = {
  Bash: "💪",
  Edit: "🤓",
  Write: "🤓",
  Read: "📖",
  Grep: "🔍",
  Glob: "🔍",
  Task: "💭",
  Agent: "💭",
};

export function PetExpressionLayer() {
  const [emoji, setEmoji] = useState<string | null>(null);
  const [until, setUntil] = useState(0);

  useEffect(() => {
    const unlisten = listen<HookEvent>("pet:hook-event", (e) => {
      const ev = e.payload;
      let next: string | null = null;
      if (ev.kind === "pre_tool_use" || ev.kind === "post_tool_use") {
        next = TOOL_EXPR[ev.tool_name ?? ""] ?? null;
      } else if (ev.kind === "stop") {
        next = ev.stop_reason === "error" ? "⚠️" : "✨";
      }
      if (next) {
        setEmoji(next);
        setUntil(performance.now() + 600);
      }
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    if (emoji === null) return;
    const t = setTimeout(() => {
      if (performance.now() >= until) setEmoji(null);
    }, 700);
    return () => clearTimeout(t);
  }, [emoji, until]);

  if (!emoji) return null;
  return (
    <div className="pet-expression-layer" aria-hidden="true">
      <span className="pet-expression-emoji">{emoji}</span>
    </div>
  );
}
```

**Step 2: CSS** (inline or new file)

```css
.pet-expression-layer {
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 20px;
  pointer-events: none;
  z-index: 7;
  animation: pop 600ms ease-out;
}
@keyframes pop {
  0%   { opacity: 0; transform: scale(0.4); }
  20%  { opacity: 1; transform: scale(1.3); }
  100% { opacity: 0; transform: scale(1); }
}
```

**Step 3: Mount**

In `src/App.tsx`, sibling to other overlays:

```tsx
import { PetExpressionLayer } from "./components/PetExpressionLayer";
// ...
<PetExpressionLayer />
```

**Step 4: typecheck + commit**

```bash
pnpm typecheck 2>&1 | tail -3
git add src/components/PetExpressionLayer.tsx src/App.tsx src/components/
git commit -m "feat(ui): PetExpressionLayer transient emoji on hook events"
```

---

## Task 7: Manual E2E

**Step 1: Run dev**

```bash
PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:$HOME/.cargo/bin:$PATH pnpm tauri dev
```

Watch the log for `[hooks-server] listening on 127.0.0.1:<port>`.

**Step 2: Manually POST a hook event**

```bash
PORT=$(cat ~/.notchi/port.txt)
curl -X POST -H 'Content-Type: application/json' \
  -d '{"tool_name":"Bash","timestamp":"2026-05-08T12:00:00Z"}' \
  http://127.0.0.1:$PORT/hooks/pre-tool-use
```

Pet should briefly show 💪.

**Step 3: Install hooks**

In Settings, click "Enable" for Claude Code hooks.

```bash
cat ~/.claude/settings.json | jq '.hooks'
```

Expected: PreToolUse / PostToolUse / Stop entries with `marker: "notchi"`.

**Step 4: Trigger a real Claude Code tool call**

Open another terminal, start `claude`, run a tool (e.g. `ls`). Pet should react.

**Step 5: Uninstall**

Click "Disable". Verify settings.json no longer contains the notchi marker, but any user-defined hooks are preserved.

**Step 6: All gates green**

```bash
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
cargo clippy --manifest-path src-tauri/Cargo.toml 2>&1 | grep -c "^error" || true
pnpm typecheck 2>&1 | tail -3
```

**Step 7: Push**

```bash
git push origin feature/v02-bundle
git push new feature/v02-bundle
```

---

## Done definition

- [ ] HTTP server listens on random 127.0.0.1 port
- [ ] curl POST to /hooks/pre-tool-use triggers pet emoji
- [ ] Settings toggle one-click installs/uninstalls
- [ ] User-defined hooks preserved across install/uninstall cycle
- [ ] `cargo test install_idempotent uninstall_preserves` PASS
- [ ] All gates green
