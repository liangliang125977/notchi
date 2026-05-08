# v0.2 #2 Burn-rate Predictor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a "$X/h · 月底 ~$Y / $Z" capsule overlay near the pet, drive pet mood from a 30-minute rolling burn-rate projected against a user-set monthly budget.

**Architecture:** Pure derivation from existing `events` (after #1 adds `agent_id`). Background task computes BurnRate every 30s, emits `pet:burn-rate-changed`. fuse_mood gains a third signal. Settings exposes `monthly_budget_usd`.

**Tech Stack:** Rust + sqlx · chrono for month math · React 19 · Tauri events.

**Design doc:** `docs/plans/2026-05-08-v02-bundle-design.md`

**Prerequisites:** Plan #1 complete (events.agent_id column exists).

---

## Task 1: BurnRate struct + queries.rs::burn_rate_now

**Files:**
- Create: `src-tauri/src/data/burn_rate.rs`
- Modify: `src-tauri/src/data/mod.rs` (add `pub mod burn_rate;`)

**Step 1: Write the failing test**

Create `src-tauri/src/data/burn_rate.rs`:

```rust
use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize)]
pub struct BurnRate {
    pub tokens_per_min: f64,
    pub usd_per_min: f64,
    pub usd_today: f64,
    pub usd_budget_month: f64,
    pub usd_projected_month: f64,
    pub status: String,  // "calm" | "warm" | "hot" | "scorching"
}

pub async fn burn_rate_now(
    pool: &SqlitePool,
    monthly_budget_usd: f64,
) -> Result<BurnRate, sqlx::Error> {
    // 30-minute window (excluding subagents to avoid double-count)
    let row: (i64, f64) = sqlx::query_as(
        "SELECT
            COALESCE(SUM(input_tokens + output_tokens
                       + cache_read_input_tokens + cache_creation_input_tokens), 0),
            COALESCE(SUM(CAST(cost_usd AS REAL)), 0.0)
         FROM events
         WHERE timestamp >= datetime('now', '-30 minutes')
           AND agent_id IS NULL"
    ).fetch_one(pool).await?;
    let (tokens_30, usd_30) = row;

    let tokens_per_min = (tokens_30 as f64) / 30.0;
    let usd_per_min = usd_30 / 30.0;

    // Today's USD (since start of day, agent_id IS NULL)
    let (usd_today,): (f64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(CAST(cost_usd AS REAL)), 0.0)
         FROM events
         WHERE timestamp >= datetime('now', 'start of day')
           AND agent_id IS NULL"
    ).fetch_one(pool).await?;

    // Linear extrapolation to month-end based on day-of-month progress
    let now = chrono::Utc::now();
    let day = now.format("%-d").to_string().parse::<i32>().unwrap_or(1);
    let days_in_month = days_in_current_month();
    let usd_projected_month = if day > 0 {
        usd_today * (days_in_month as f64) / (day as f64)
    } else {
        0.0
    };

    let ratio = if monthly_budget_usd > 0.0 {
        usd_projected_month / monthly_budget_usd
    } else {
        0.0
    };
    let status = burn_status(ratio);

    Ok(BurnRate {
        tokens_per_min,
        usd_per_min,
        usd_today,
        usd_budget_month: monthly_budget_usd,
        usd_projected_month,
        status: status.into(),
    })
}

pub(crate) fn burn_status(ratio: f64) -> &'static str {
    if ratio < 0.7 { "calm" }
    else if ratio < 1.0 { "warm" }
    else if ratio < 1.5 { "hot" }
    else { "scorching" }
}

fn days_in_current_month() -> u32 {
    use chrono::Datelike;
    let now = chrono::Utc::now();
    let next_month_first = if now.month() == 12 {
        chrono::NaiveDate::from_ymd_opt(now.year() + 1, 1, 1).unwrap()
    } else {
        chrono::NaiveDate::from_ymd_opt(now.year(), now.month() + 1, 1).unwrap()
    };
    let this_first = chrono::NaiveDate::from_ymd_opt(now.year(), now.month(), 1).unwrap();
    next_month_first.signed_duration_since(this_first).num_days() as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[test]
    fn status_thresholds() {
        assert_eq!(burn_status(0.5), "calm");
        assert_eq!(burn_status(0.69), "calm");
        assert_eq!(burn_status(0.7), "warm");
        assert_eq!(burn_status(0.99), "warm");
        assert_eq!(burn_status(1.0), "hot");
        assert_eq!(burn_status(1.49), "hot");
        assert_eq!(burn_status(1.5), "scorching");
        assert_eq!(burn_status(99.9), "scorching");
    }

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
    async fn burn_rate_excludes_subagents() {
        let pool = fresh_pool().await;
        // Insert main row + subagent row in last 30min, both $1 cost
        let now_iso = chrono::Utc::now().to_rfc3339();
        for (agent, sess) in [(None::<&str>, "main"), (Some("agent_a"), "main")] {
            let agent_val: Option<&str> = agent;
            sqlx::query(
                "INSERT INTO events (timestamp,source,model,input_tokens,output_tokens,
                                     cache_read_input_tokens,cache_creation_input_tokens,
                                     cost_usd,session_id,is_third_party,
                                     agent_id,parent_session_id,ingested_at)
                 VALUES (?1,'claude-code','m',1000,500,0,0,'1.00',?2,0,?3,'p',?1)"
            ).bind(&now_iso).bind(sess).bind(agent_val).execute(&pool).await.unwrap();
        }
        let br = burn_rate_now(&pool, 50.0).await.unwrap();
        // usd_today should be $1 (main only), not $2
        assert!((br.usd_today - 1.0).abs() < 0.01,
                "usd_today expected ~1.0, got {}", br.usd_today);
    }
}
```

Add `pub mod burn_rate;` to `src-tauri/src/data/mod.rs`.

**Step 2: Run tests**

```bash
PATH=/usr/bin:$HOME/.cargo/bin:$PATH cargo test --manifest-path src-tauri/Cargo.toml burn_rate 2>&1 | tail -10
```

Expected: 2 tests pass.

**Step 3: Commit**

```bash
git add src-tauri/src/data/burn_rate.rs src-tauri/src/data/mod.rs
git commit -m "feat(data): burn_rate_now with 30min window + month projection"
```

---

## Task 2: Settings — monthly_budget_usd + Tauri command

**Files:**
- Modify: `src-tauri/src/lib.rs` (constants + invoke_handler)
- Modify: `src-tauri/src/data/commands.rs` (add command)

**Step 1: Add settings key**

In `src-tauri/src/lib.rs`, alongside existing settings keys (~line 14):

```rust
const MONTHLY_BUDGET_KEY: &str = "monthlyBudgetUsd";
```

**Step 2: Add `burn_rate_now` Tauri command**

In `src-tauri/src/data/commands.rs`, append:

```rust
#[tauri::command]
pub async fn burn_rate_now(
    app: AppHandle,
    state: State<'_, DataState>,
) -> Result<crate::data::burn_rate::BurnRate, String> {
    let budget = read_monthly_budget(&app);
    crate::data::burn_rate::burn_rate_now(&state.pool, budget)
        .await
        .map_err(|e| e.to_string())
}

fn read_monthly_budget(app: &AppHandle) -> f64 {
    use tauri_plugin_store::StoreExt;
    app.store("settings.json").ok()
        .and_then(|s| s.get("monthlyBudgetUsd"))
        .and_then(|v| v.as_f64())
        .unwrap_or(50.0)
}

#[tauri::command]
pub async fn set_monthly_budget(
    app: AppHandle,
    usd: f64,
) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    store.set("monthlyBudgetUsd", serde_json::Value::from(usd));
    Ok(())
}
```

Register in `lib.rs::run` invoke_handler:

```rust
data::commands::burn_rate_now,
data::commands::set_monthly_budget,
```

**Step 3: Verify + commit**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3
git add src-tauri/src/lib.rs src-tauri/src/data/commands.rs
git commit -m "feat(commands): expose burn_rate_now + set_monthly_budget"
```

---

## Task 3: Background task emits pet:burn-rate-changed

**Files:**
- Modify: `src-tauri/src/lib.rs` (setup block, near subagent task from Plan #1)

**Step 1: Add polling task**

```rust
// v0.2 #2: burn-rate predictor
{
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        use std::time::Duration;
        let mut prev_status: Option<String> = None;
        loop {
            let state = app_handle.state::<crate::data::commands::DataState>();
            let budget = app_handle.store("settings.json").ok()
                .and_then(|s| s.get("monthlyBudgetUsd"))
                .and_then(|v| v.as_f64())
                .unwrap_or(50.0);
            match crate::data::burn_rate::burn_rate_now(&state.pool, budget).await {
                Ok(br) => {
                    let _ = app_handle.emit("pet:burn-rate-changed", &br);
                    if prev_status.as_deref() != Some(&br.status) {
                        prev_status = Some(br.status.clone());
                    }
                }
                Err(e) => eprintln!("[burn_rate] {e}"),
            }
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
}
```

**Step 2: Build + commit**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3
git add src-tauri/src/lib.rs
git commit -m "feat(pet): emit pet:burn-rate-changed every 30s"
```

---

## Task 4: Extend fuse_mood with burn signal + test

**Files:**
- Modify: `src-tauri/src/data/evolution.rs` (fuse_mood ~line 165, pet_status ~line 215, record_feed ~line 305)

**Step 1: Write the failing test (extend existing fuse_mood test)**

In `evolution.rs` tests block, append:

```rust
#[test]
fn fuse_mood_with_burn() {
    use crate::data::queries::CachePulse;
    use crate::data::burn_rate::BurnRate;

    let pulse = CachePulse { hit_pct: 95.0, samples: 50 };  // happy cache
    let burn = |s: &str| BurnRate {
        tokens_per_min: 0.0, usd_per_min: 0.0, usd_today: 0.0,
        usd_budget_month: 50.0, usd_projected_month: 0.0,
        status: s.to_string(),
    };

    // calm burn + happy cache + happy feed → happy
    assert_eq!(fuse_mood("happy", &pulse, &burn("calm")), "happy");

    // scorching burn forces hungry regardless
    assert_eq!(fuse_mood("happy", &pulse, &burn("scorching")), "hungry");

    // hot burn → content
    assert_eq!(fuse_mood("happy", &pulse, &burn("hot")), "content");

    // warm + happy mood + happy cache → happy unchanged
    assert_eq!(fuse_mood("happy", &pulse, &burn("warm")), "happy");
}
```

**Step 2: Run test, verify it fails (signature mismatch)**

```bash
cargo test --manifest-path src-tauri/Cargo.toml fuse_mood_with_burn 2>&1 | tail -5
```

Expected: FAIL — `fuse_mood` only takes 2 args.

**Step 3: Extend fuse_mood signature**

Replace existing `fuse_mood` body:

```rust
pub(crate) fn fuse_mood(
    feed_mood: &str,
    cache: &crate::data::queries::CachePulse,
    burn: &crate::data::burn_rate::BurnRate,
) -> &'static str {
    let fm: &'static str = match feed_mood {
        "hungry" => "hungry",
        "happy" => "happy",
        _ => "content",
    };
    let cm = if cache.samples < 5 {
        fm
    } else {
        cache_mood_for(cache.hit_pct)
    };
    let bm: &'static str = match burn.status.as_str() {
        "scorching" => "hungry",
        "hot"       => "content",
        _           => fm,  // calm/warm — don't lower
    };
    *[fm, cm, bm].iter().min_by_key(|m| mood_rank(m)).unwrap()
}
```

**Step 4: Update existing `fuse_mood_truth_table` test**

The old test calls `fuse_mood(feed, cache)` — add a calm-burn placeholder:

```rust
let calm = crate::data::burn_rate::BurnRate {
    tokens_per_min: 0.0, usd_per_min: 0.0, usd_today: 0.0,
    usd_budget_month: 50.0, usd_projected_month: 0.0,
    status: "calm".to_string(),
};
// then every fuse_mood call becomes:
assert_eq!(fuse_mood("happy", &p(95.0, 50), &calm), "happy");
// ... apply to all 7 cases
```

**Step 5: Update both call sites in pet_status + record_feed**

In `pet_status`, after fetching `pulse`, also fetch a burn rate:

```rust
let budget = state.0.store_for_budget()  // helper or inline
    .ok()
    .and_then(|s| s.get("monthlyBudgetUsd"))
    .and_then(|v| v.as_f64())
    .unwrap_or(50.0);
let burn = crate::data::burn_rate::burn_rate_now(&state.pool, budget)
    .await
    .unwrap_or(crate::data::burn_rate::BurnRate {
        tokens_per_min: 0.0, usd_per_min: 0.0, usd_today: 0.0,
        usd_budget_month: budget, usd_projected_month: 0.0,
        status: "calm".to_string(),
    });
```

Then change:
```rust
mood: fuse_mood(mood_for(level), &pulse, &burn).to_string(),
```

Same in `record_feed`.

For `state.0.store_for_budget()` — in practice just inline the `app.store("settings.json")` helper used elsewhere.

**Step 6: Run all tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: ALL pass (including 2 fuse_mood variants and burn_rate tests).

**Step 7: Commit**

```bash
git add src-tauri/src/data/evolution.rs
git commit -m "feat(pet): fuse burn-rate status into mood (worst-of-three)"
```

---

## Task 5: Frontend — types + useBurnRate hook

**Files:**
- Modify: `src/lib/dataTypes.ts`
- Create: `src/hooks/useBurnRate.ts`

**Step 1: Add type**

```ts
export type BurnRate = {
  tokens_per_min: number;
  usd_per_min: number;
  usd_today: number;
  usd_budget_month: number;
  usd_projected_month: number;
  status: "calm" | "warm" | "hot" | "scorching";
};
```

**Step 2: Hook**

```ts
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { BurnRate } from "../lib/dataTypes";

export function useBurnRate(): BurnRate | null {
  const [br, setBr] = useState<BurnRate | null>(null);
  useEffect(() => {
    void invoke<BurnRate>("burn_rate_now").then(setBr).catch(() => {});
    const unlisten = listen<BurnRate>("pet:burn-rate-changed", (e) => {
      setBr(e.payload);
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, []);
  return br;
}
```

**Step 3: Commit**

```bash
git add src/lib/dataTypes.ts src/hooks/useBurnRate.ts
git commit -m "feat(ui): useBurnRate hook + invoke + event listener"
```

---

## Task 6: BurnRateOverlay capsule

**Files:**
- Create: `src/components/BurnRateOverlay.tsx`
- Create: `src/components/BurnRateOverlay.css`
- Modify: `src/App.tsx` (mount)

**Step 1: Component**

```tsx
import { useBurnRate } from "../hooks/useBurnRate";
import "./BurnRateOverlay.css";

export function BurnRateOverlay() {
  const br = useBurnRate();
  if (!br) return null;
  // Hide when no traffic at all
  if (br.usd_today < 0.001 && br.usd_per_min < 1e-6) return null;

  const usdPerH = br.usd_per_min * 60;
  const cls = `burn-capsule burn-${br.status}`;

  return (
    <div className={cls}>
      <span className="burn-rate">${usdPerH.toFixed(2)}/h</span>
      <span className="burn-sep">·</span>
      <span className="burn-projected">
        月底 ~${br.usd_projected_month.toFixed(0)} / ${br.usd_budget_month.toFixed(0)}
      </span>
    </div>
  );
}
```

**Step 2: CSS**

```css
.burn-capsule {
  position: absolute;
  bottom: 8px;
  right: 8px;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(0,0,0,0.6);
  color: white;
  font-variant-numeric: tabular-nums;
  display: flex;
  gap: 6px;
  pointer-events: none;
  z-index: 6;
  transition: background 400ms;
}
.burn-calm     { background: rgba(52,199,89,0.85); }
.burn-warm     { background: rgba(255,149,0,0.85); }
.burn-hot      { background: rgba(255,59,48,0.9); }
.burn-scorching {
  background: rgba(255,59,48,0.95);
  animation: burn-pulse 1.5s ease-in-out infinite;
}
@keyframes burn-pulse {
  0%, 100% { box-shadow: 0 0 4px rgba(255,59,48,0.4); }
  50%      { box-shadow: 0 0 16px rgba(255,59,48,0.9); }
}

.burn-sep { opacity: 0.6; }
```

**Step 3: Mount in App**

Sibling to PetCanvas / SubagentDots:

```tsx
import { BurnRateOverlay } from "./components/BurnRateOverlay";
// ...
<BurnRateOverlay />
```

**Step 4: typecheck + commit**

```bash
pnpm typecheck 2>&1 | tail -3
git add src/components/BurnRateOverlay.* src/App.tsx
git commit -m "feat(ui): BurnRateOverlay capsule with status-coloured pill"
```

---

## Task 7: Settings — monthly budget input

**Files:**
- Modify: settings panel (`src/components/SettingsApp.tsx` or wherever main settings live)
- Modify: `src/lib/locales.ts` (add `settings.monthlyBudget*` strings)

**Step 1: Locate settings panel**

```bash
grep -rn "muteWindow\|claudeCodeDataDir" src/components/ | head -5
```

Pick the panel that shows other settings inputs, e.g. `SettingsApp.tsx` or `SettingsPanel.tsx`.

**Step 2: Add a numeric input bound to settings store**

```tsx
const [budget, setBudget] = useState<number>(50);
useEffect(() => {
  // load existing value via invoke('get_settings') if such command exists,
  // otherwise call a new one. Inline read on mount:
  void invoke<{ monthly_budget_usd?: number }>("get_settings")
    .then((s) => { if (s.monthly_budget_usd) setBudget(s.monthly_budget_usd); })
    .catch(() => {});
}, []);

const onSave = () => {
  void invoke("set_monthly_budget", { usd: budget });
};

// JSX:
<div className="sp-row">
  <label>{t.settings.monthlyBudget}</label>
  <input
    type="number" min="0" step="5" value={budget}
    onChange={(e) => setBudget(Number(e.target.value))}
    onBlur={onSave}
  />
  <span className="sp-hint">{t.settings.monthlyBudgetHint}</span>
</div>
```

**Step 3: Add i18n strings**

In `src/lib/locales.ts`:

```ts
// type interface settings:
monthlyBudget: string;
monthlyBudgetHint: string;

// en:
monthlyBudget: "Monthly budget (USD)",
monthlyBudgetHint: "Pet gets agitated when the projected month-end spend approaches this number.",

// zh:
monthlyBudget: "月度预算（USD）",
monthlyBudgetHint: "当预测的月底花费接近此数字时，宠物会进入警觉状态。",
```

**Step 4: typecheck + commit**

```bash
pnpm typecheck 2>&1 | tail -3
git add src/components/ src/lib/locales.ts
git commit -m "feat(settings): monthly budget input + i18n"
```

---

## Task 8: Manual E2E

**Step 1: Run dev**

```bash
PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:$HOME/.cargo/bin:$PATH pnpm tauri dev
```

**Step 2: Verify capsule shows current rate**

You should see the BurnRateOverlay in green ("$X/h · 月底 ~$Y / $50") if there's been any token traffic today.

**Step 3: Force scorching status**

Set `monthly_budget_usd` very low to trigger scorching:

```bash
sqlite3 "$HOME/Library/Application Support/com.notchi.app/data.db" "" 2>&1
# OR via Settings UI: set monthly budget to $1
```

The pet mood should drop to "hungry" and the capsule should pulse red.

**Step 4: All gates green**

```bash
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
cargo clippy --manifest-path src-tauri/Cargo.toml 2>&1 | grep -c "^error" || true
pnpm typecheck 2>&1 | tail -3
```

**Step 5: Commit + push**

```bash
git push origin feature/v02-bundle
git push new feature/v02-bundle
```

---

## Done definition

- [ ] `cargo test burn_rate` PASS
- [ ] `cargo test fuse_mood_with_burn` PASS
- [ ] Capsule visible with sensible $X/h
- [ ] Setting low budget → capsule pulses red + pet mood drops
- [ ] All gates green
