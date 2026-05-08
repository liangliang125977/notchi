# v0.2 #1 Subagent Radar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render orbital dots around the main pet representing live Claude Code subagents, color-coded by their session token totals, fading in/out by 60-second jsonl liveness.

**Architecture:** Extend existing claude_code adapter to walk `subagents/agent-*.jsonl`. Add `agent_id` + `parent_session_id` columns to `events`. Background task polls `active_subagents()` every 5s and emits `pet:subagents-changed` to the frontend. PetCanvas overlays absolutely-positioned color dots animated via requestAnimationFrame.

**Tech Stack:** Rust + sqlx · Tauri 2.x events · React 19 · CSS transforms.

**Design doc:** `docs/plans/2026-05-08-v02-bundle-design.md`

**Prerequisites:** None — this plan owns the events-table migration (other v0.2 plans depend on it).

---

## Task 1: Schema migration — add agent_id + parent_session_id

**Files:**
- Modify: `src-tauri/src/data/db.rs` (SCHEMA_SQL ~line 17, init_pool ~line 98)

**Step 1: Add columns to SCHEMA_SQL**

Append to the events `CREATE TABLE` body (still inside `IF NOT EXISTS` for fresh installs):

```sql
agent_id TEXT,                  -- NULL for main session events
parent_session_id TEXT,         -- NULL except for subagent events
```

Place them right before `ingested_at TEXT NOT NULL`.

**Step 2: Add idempotent ALTER for existing DBs**

After the `sqlx::query(SCHEMA_SQL).execute(&pool).await?;` call in `init_pool`, append a small migration helper:

```rust
// Idempotent ALTER for v0.2: agent_id / parent_session_id were added
// after v0.1.0 shipped. SQLite has no `ADD COLUMN IF NOT EXISTS`, so
// query pragma first and only ALTER when missing.
add_column_if_missing(&pool, "events", "agent_id", "TEXT").await?;
add_column_if_missing(
    &pool, "events", "parent_session_id", "TEXT",
).await?;
sqlx::query(
    "CREATE INDEX IF NOT EXISTS idx_events_agent
     ON events(agent_id) WHERE agent_id IS NOT NULL",
).execute(&pool).await?;
```

And the helper at module bottom:

```rust
async fn add_column_if_missing(
    pool: &SqlitePool,
    table: &str,
    column: &str,
    type_decl: &str,
) -> Result<(), sqlx::Error> {
    let rows: Vec<(String,)> =
        sqlx::query_as(&format!("SELECT name FROM pragma_table_info('{table}')"))
            .fetch_all(pool)
            .await?;
    if rows.iter().any(|(n,)| n == column) {
        return Ok(());
    }
    sqlx::query(&format!("ALTER TABLE {table} ADD COLUMN {column} {type_decl}"))
        .execute(pool)
        .await?;
    Ok(())
}
```

**Step 3: Verify**

```bash
cd /Users/a58/Documents/personal/ai-coding/notchi
PATH=/usr/bin:$HOME/.cargo/bin:$PATH cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: clean.

**Step 4: Commit**

```bash
git add src-tauri/src/data/db.rs
git commit -m "feat(db): add agent_id + parent_session_id to events"
```

---

## Task 2: Extend ParsedEvent + ingest with agent fields

**Files:**
- Modify: `src-tauri/src/data/sources/mod.rs` (ParsedEvent struct)
- Modify: `src-tauri/src/data/ingest.rs` (insert SQL)

**Step 1: Extend `ParsedEvent`**

In `src-tauri/src/data/sources/mod.rs`, add to `ParsedEvent`:

```rust
/// Subagent-mode only: the agent UUID from the jsonl filename or
/// inline field. NULL for main-session rows.
pub agent_id: Option<String>,
/// Subagent-mode only: the parent session UUID. NULL for main rows.
pub parent_session_id: Option<String>,
```

Default `None` in every adapter's existing `ParsedEvent { ... }` literal (claude_code.rs, codex.rs, claude_desktop.rs, opencode.rs — grep for `ParsedEvent {`).

**Step 2: Run cargo check to find every literal needing the new fields**

```bash
PATH=/usr/bin:$HOME/.cargo/bin:$PATH cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | grep "missing.*field" | head -20
```

Add `agent_id: None, parent_session_id: None,` to each one reported.

**Step 3: Update ingest INSERT to write the columns**

In `src-tauri/src/data/ingest.rs`, find the `INSERT INTO events (...)` SQL and:
- Add `agent_id, parent_session_id` to the column list
- Add 2 corresponding `?` placeholders
- Bind `event.agent_id` and `event.parent_session_id` after the existing binds

**Step 4: Build + commit**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3
git add src-tauri/src/data/sources/mod.rs src-tauri/src/data/ingest.rs \
        src-tauri/src/data/sources/*.rs
git commit -m "feat(data): plumb agent_id + parent_session_id through ingest"
```

---

## Task 3: claude_code adapter — discover subagents/agent-*.jsonl

**Files:**
- Modify: `src-tauri/src/data/sources/claude_code.rs` (discover_paths ~line 103, parse_line ~line 126)

**Step 1: discover_paths returns subagent root too**

`discover_paths` currently returns `[~/.claude/projects]`. The walker recursively scans for `*.jsonl`, so it WILL find `subagents/agent-*.jsonl` already — no change needed. Verify by grep:

```bash
grep -n "walkdir\|WalkDir" src-tauri/src/data/ingest.rs | head -5
```

If walker already does recursive scanning (it does, per existing v1.0 wiring), skip this step.

**Step 2: parse_line — extract agent_id from path**

The existing `parse_line` doesn't get the file path. To know if a row is a subagent, we need the file path context. Two options:
- A. Add a 3rd parameter `file_path: &Path` to `parse_line` (changes trait, more refactor)
- B. Detect the agentId from inline fields in the jsonl (cheaper)

Use option B. Inspect a real subagent line: agentId is at top level (verified during brainstorming). Add at the top of `parse_line`:

```rust
// Subagent lines have a top-level `agentId`. Detect via untyped peek.
let agent_id: Option<String> = serde_json::from_slice::<serde_json::Value>(line)
    .ok()
    .and_then(|v| v.get("agentId").and_then(|a| a.as_str()).map(str::to_owned));
```

Then in BOTH the `UserEnvelope` branch and the `AssistantEnvelope` branch, populate the fields:

```rust
agent_id: agent_id.clone(),
parent_session_id: agent_id.as_ref().and_then(|_| /* sessionId */),
```

`parent_session_id` = the existing top-level `sessionId` of the same line (which the existing code reads). When the line has agentId, that sessionId is the parent. When not, leave both None.

**Step 3: Verify on real data**

```bash
sqlite3 "$HOME/Library/Application Support/com.notchi.app/data.db" \
  "SELECT COUNT(*) FROM events WHERE agent_id IS NOT NULL" 2>&1
```

Expected: 0 right now (no rebuild yet). After running `pnpm tauri dev` once: > 0.

**Step 4: Commit**

```bash
git add src-tauri/src/data/sources/claude_code.rs
git commit -m "feat(claude_code): extract agent_id + parent_session_id from subagent jsonl"
```

---

## Task 4: queries.rs — `active_subagents` + tests

**Files:**
- Create: `src-tauri/src/data/subagents.rs`
- Modify: `src-tauri/src/data/mod.rs` (add `pub mod subagents;`)

**Step 1: Write the failing test**

Create `src-tauri/src/data/subagents.rs`:

```rust
use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize)]
pub struct ActiveSubagent {
    pub agent_id: String,
    pub parent_session_id: Option<String>,
    pub model: Option<String>,
    pub total_tokens: i64,
    pub last_seen_iso: String,
    pub is_alive: bool,
}

pub async fn active_subagents(pool: &SqlitePool) -> Result<Vec<ActiveSubagent>, sqlx::Error> {
    let rows: Vec<(String, Option<String>, Option<String>, i64, String)> = sqlx::query_as(
        "SELECT
            agent_id,
            parent_session_id,
            (SELECT model FROM events e2
             WHERE e2.agent_id = events.agent_id
             GROUP BY model
             ORDER BY SUM(input_tokens + output_tokens
                        + cache_read_input_tokens + cache_creation_input_tokens) DESC
             LIMIT 1) AS model,
            COALESCE(SUM(input_tokens + output_tokens
                        + cache_read_input_tokens + cache_creation_input_tokens), 0) AS tokens,
            MAX(timestamp) AS last_seen
         FROM events
         WHERE agent_id IS NOT NULL
           AND timestamp >= datetime('now', '-2 minutes')
         GROUP BY agent_id, parent_session_id
         ORDER BY last_seen DESC",
    )
    .fetch_all(pool)
    .await?;
    let now_secs = chrono::Utc::now().timestamp();
    Ok(rows
        .into_iter()
        .map(|(agent_id, parent, model, tokens, last_seen)| {
            let alive = chrono::DateTime::parse_from_rfc3339(&last_seen)
                .map(|t| now_secs - t.timestamp() < 60)
                .unwrap_or(false);
            ActiveSubagent {
                agent_id,
                parent_session_id: parent,
                model,
                total_tokens: tokens,
                last_seen_iso: last_seen,
                is_alive: alive,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn fresh_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new().max_connections(1)
            .connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE events (
                id INTEGER PRIMARY KEY,
                timestamp TEXT, source TEXT, model TEXT,
                input_tokens INT, output_tokens INT,
                cache_read_input_tokens INT, cache_creation_input_tokens INT,
                cost_usd TEXT, project_path TEXT, session_id TEXT,
                is_third_party INT, agent_id TEXT, parent_session_id TEXT,
                ingested_at TEXT
            )"
        ).execute(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn active_window_60s() {
        let pool = fresh_pool().await;
        // Insert one row 30s ago (alive) + one row 90s ago (dead)
        let now = chrono::Utc::now();
        let alive_ts = (now - chrono::Duration::seconds(30)).to_rfc3339();
        let dead_ts  = (now - chrono::Duration::seconds(90)).to_rfc3339();
        for (agent, ts) in [("alive_a", alive_ts), ("dead_a", dead_ts)] {
            sqlx::query(
                "INSERT INTO events (timestamp,source,model,input_tokens,output_tokens,
                                     cache_read_input_tokens,cache_creation_input_tokens,
                                     cost_usd,session_id,is_third_party,
                                     agent_id,parent_session_id,ingested_at)
                 VALUES (?1,'claude-code','test',100,50,0,0,'0','sess1',0,?2,'parent1',?3)"
            ).bind(&ts).bind(agent).bind(&ts).execute(&pool).await.unwrap();
        }
        let result = active_subagents(&pool).await.unwrap();
        // Both within 2-minute window, but only one alive (60s)
        assert_eq!(result.len(), 2);
        let alive = result.iter().find(|r| r.agent_id == "alive_a").unwrap();
        let dead = result.iter().find(|r| r.agent_id == "dead_a").unwrap();
        assert!(alive.is_alive);
        assert!(!dead.is_alive);
    }
}
```

Add `pub mod subagents;` to `src-tauri/src/data/mod.rs`.

**Step 2: Run tests**

```bash
PATH=/usr/bin:$HOME/.cargo/bin:$PATH cargo test --manifest-path src-tauri/Cargo.toml active_window_60s 2>&1 | tail -10
```

Expected: PASS.

**Step 3: Commit**

```bash
git add src-tauri/src/data/subagents.rs src-tauri/src/data/mod.rs
git commit -m "feat(data): active_subagents query with 60s liveness gate"
```

---

## Task 5: Background task polls + emits event

**Files:**
- Modify: `src-tauri/src/lib.rs` (setup block ~line 206)

**Step 1: Spawn polling task**

In `setup`, after `app.manage(state)` and before macOS-specific blocks, add:

```rust
// v0.2 #1: subagent radar — poll every 5s and emit diff
{
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        use std::time::Duration;
        let mut prev_state: Vec<crate::data::subagents::ActiveSubagent> = Vec::new();
        loop {
            let state = app_handle.state::<crate::data::commands::DataState>();
            let pool = &state.pool;
            match crate::data::subagents::active_subagents(pool).await {
                Ok(curr) => {
                    // Diff via JSON serialisation — small enough payload
                    if serde_json::to_string(&curr).ok()
                        != serde_json::to_string(&prev_state).ok() {
                        let _ = app_handle.emit("pet:subagents-changed", &curr);
                        prev_state = curr;
                    }
                }
                Err(e) => eprintln!("[subagents] {e}"),
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}
```

**Step 2: Build + commit**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3
git add src-tauri/src/lib.rs
git commit -m "feat(pet): emit pet:subagents-changed every 5s"
```

---

## Task 6: Frontend type + hook to receive events

**Files:**
- Modify: `src/lib/dataTypes.ts` (add ActiveSubagent type)
- Create: `src/hooks/useSubagents.ts`

**Step 1: Add type**

```ts
export type ActiveSubagent = {
  agent_id: string;
  parent_session_id: string | null;
  model: string | null;
  total_tokens: number;
  last_seen_iso: string;
  is_alive: boolean;
};
```

**Step 2: Create the hook**

`src/hooks/useSubagents.ts`:

```ts
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ActiveSubagent } from "../lib/dataTypes";

export function useSubagents(): ActiveSubagent[] {
  const [list, setList] = useState<ActiveSubagent[]>([]);
  useEffect(() => {
    const unlisten = listen<ActiveSubagent[]>("pet:subagents-changed", (e) => {
      setList(e.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
  return list;
}
```

**Step 3: typecheck + commit**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck 2>&1 | tail -3
git add src/lib/dataTypes.ts src/hooks/useSubagents.ts
git commit -m "feat(ui): useSubagents hook subscribes to pet:subagents-changed"
```

---

## Task 7: SubagentDots overlay + CSS

**Files:**
- Create: `src/components/SubagentDots.tsx`
- Create: `src/components/SubagentDots.css`
- Modify: `src/App.tsx` (or wherever PetCanvas is rendered)

**Step 1: Component**

```tsx
import { useEffect, useRef, useState } from "react";
import type { ActiveSubagent } from "../lib/dataTypes";
import "./SubagentDots.css";

const RADIUS = 100;            // px from center
const ROTATION_PERIOD_MS = 30_000;

function colorFor(tokens: number): string {
  if (tokens < 10_000) return "#34C759";
  if (tokens < 100_000) return "#FF9500";
  return "#FF3B30";
}

export function SubagentDots({ subagents }: { subagents: ActiveSubagent[] }) {
  const [angle, setAngle] = useState(0);
  const startRef = useRef(performance.now());
  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      setAngle((elapsed / ROTATION_PERIOD_MS) * 360);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const alive = subagents.filter((s) => s.is_alive);
  if (alive.length === 0) return null;

  return (
    <div className="subagent-dots">
      {alive.map((s, i) => {
        const a = ((angle + (i * 360) / alive.length) * Math.PI) / 180;
        const x = Math.cos(a) * RADIUS;
        const y = Math.sin(a) * RADIUS;
        return (
          <span
            key={s.agent_id}
            className="subagent-dot"
            style={{
              transform: `translate(${x}px, ${y}px)`,
              backgroundColor: colorFor(s.total_tokens),
            }}
            title={`${s.model ?? "?"} · ${(s.total_tokens / 1000).toFixed(1)}K`}
          />
        );
      })}
    </div>
  );
}
```

**Step 2: CSS**

```css
.subagent-dots {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  pointer-events: none;
  z-index: 5;
}

.subagent-dot {
  position: absolute;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border-radius: 50%;
  box-shadow: 0 0 6px currentColor;
  transition: background-color 400ms;
  animation: subagent-fade-in 400ms ease-out;
}

@keyframes subagent-fade-in {
  from { opacity: 0; transform: scale(0.4) translate(0, 0); }
  to   { opacity: 1; }
}
```

**Step 3: Mount it next to PetCanvas**

In `src/App.tsx` (the pet entry), wrap or sibling the existing `<PetCanvas />`:

```tsx
import { SubagentDots } from "./components/SubagentDots";
import { useSubagents } from "./hooks/useSubagents";

// Inside App body:
const subagents = useSubagents();

// In JSX, sibling to PetCanvas:
<SubagentDots subagents={subagents} />
```

**Step 4: typecheck + commit**

```bash
pnpm typecheck 2>&1 | tail -3
git add src/components/SubagentDots.* src/App.tsx
git commit -m "feat(ui): orbital subagent dots overlay on PetCanvas"
```

---

## Task 8: Manual E2E

**Step 1: Run dev**

```bash
PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:$HOME/.cargo/bin:$PATH pnpm tauri dev
```

**Step 2: Trigger subagents**

In a separate Claude Code session, run a command that spawns subagents (e.g. invoke a research subagent). Watch the Notchi pet — within ~5 seconds, dots should appear orbiting.

**Step 3: Wait > 60s without activity**

Dots should fade out as `is_alive` flips false.

**Step 4: Sanity SQL**

```bash
sqlite3 "$HOME/Library/Application Support/com.notchi.app/data.db" \
  "SELECT COUNT(DISTINCT agent_id) FROM events WHERE agent_id IS NOT NULL"
```

Expected: > 0.

**Step 5: Final gates**

```bash
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings 2>&1 | grep -c "^error" || true
pnpm typecheck 2>&1 | tail -3
```

Expected: tests pass; clippy 0 new errors (pre-existing 3 warnings on opencode.rs OK); typecheck clean.

**Step 6: Push branch**

```bash
git push -u origin feature/v02-bundle
git push new feature/v02-bundle  # may need: gh auth switch -u liangliang125977
```

---

## Done definition

- [ ] Migration runs cleanly on existing data.db (no errors)
- [ ] Subagent rows now write `agent_id` + `parent_session_id`
- [ ] `cargo test active_window_60s` PASS
- [ ] Pet shows orbital dots when subagents active
- [ ] Dots fade out after 60s inactivity
- [ ] All gates green
