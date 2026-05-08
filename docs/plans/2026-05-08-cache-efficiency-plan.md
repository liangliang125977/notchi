# Cache Efficiency Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a cache hit-rate KPI card to the overview page, a cache % column to the by-tool / by-model bar lists, and feed the 1-hour rolling cache hit rate into the existing pet mood pipeline.

**Architecture:** Hybrid — backend computes savings (needs `pricing` JOIN) and the 1-hour pulse for pet mood; frontend computes period-aware hit rate from raw fields already on `TokenSummary` / `GroupRow`. The 1-hour pulse is **not** exposed to the panel UI; it only flows through `pet_status` into the existing `mood` string. Pet mood = `min(feed_mood, cache_mood)`.

**Tech Stack:** Rust + sqlx + Tauri commands · React 19 + TypeScript · existing locales infra · `cargo test` for the one new unit test.

**Design doc:** `docs/plans/2026-05-08-cache-efficiency-design.md`

---

## Task 1: Backend — extend `TokenSummary` with `cache_savings_usd`

**Files:**
- Modify: `src-tauri/src/data/queries.rs` (struct `TokenSummary` ~line 41; fn `token_summary` ~line 51)

**Step 1: Add the field to the struct**

In `src-tauri/src/data/queries.rs`, add `pub cache_savings_usd: String` to the `TokenSummary` struct:

```rust
#[derive(Debug, Serialize)]
pub struct TokenSummary {
    pub total_input: i64,
    pub total_output: i64,
    pub total_cache_read: i64,
    pub total_cache_creation: i64,
    pub total_cost_usd: String,
    pub session_count: i64,
    pub dominant_model: Option<String>,
    pub cache_savings_usd: String,  // NEW
}
```

**Step 2: Compute savings inside `token_summary()`**

Add a savings query after the existing `dominant_model` query, before the `Ok(TokenSummary { ... })` line. Use a JOIN against `pricing` keyed on (model, endpoint_id='default'). Fallback to median input price when missing.

Append this block in `token_summary` after fetching `dominant`:

```rust
let savings_sql = format!(
    "SELECT COALESCE(SUM(
        e.cache_read_input_tokens / 1000000.0
        * (CAST(p.input_per_mtok AS REAL) - CAST(p.cache_read_per_mtok AS REAL))
     ), 0.0)
     FROM events e
     LEFT JOIN pricing p
       ON p.model = e.model AND p.endpoint_id = 'default'
     WHERE e.timestamp >= {lb}
       AND e.cache_read_input_tokens > 0
       AND p.model IS NOT NULL"
);
let (savings,): (f64,) = sqlx::query_as(&savings_sql).fetch_one(pool).await?;
```

Then add `cache_savings_usd: format!("{savings:.2}")` to the returned struct.

**Step 3: Build to verify compilation**

```bash
cd /Users/a58/Documents/personal/ai-coding/notchi
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20
```

Expected: clean compile; warnings OK; **no errors**.

**Step 4: Update frontend type**

In `src/lib/dataTypes.ts`, add to `TokenSummary`:

```ts
cache_savings_usd: string;
```

**Step 5: Commit**

```bash
git add src-tauri/src/data/queries.rs src/lib/dataTypes.ts
git commit -m "feat(data): add cache_savings_usd to TokenSummary

JOIN pricing on (model, endpoint_id='default') and sum
cache_read × (input_price - cache_read_price). Models without
pricing are silently skipped (LEFT JOIN + NULL guard)."
```

---

## Task 2: Backend — extend `GroupRow` with `cache_hit_pct`

**Files:**
- Modify: `src-tauri/src/data/queries.rs` (struct `GroupRow` ~line 131; fn `group_by` ~line 167; fn `token_by_project` ~line 145)

**Step 1: Extend the struct**

```rust
#[derive(Debug, Serialize)]
pub struct GroupRow {
    pub key: String,
    pub tokens: i64,
    pub percentage: f64,
    pub cache_hit_pct: f64,  // NEW
}
```

**Step 2: Update `group_by` SQL to also return cache fields**

Replace the inner `group_by` implementation. New SQL fetches `cache_read` and `total_input_for_cache` per row:

```rust
async fn group_by(
    pool: &SqlitePool,
    period: Period,
    col: &str,
) -> Result<Vec<GroupRow>, sqlx::Error> {
    let lb = period.lower_bound_sql();
    let sql = format!(
        "SELECT {col} AS key,
                COALESCE(SUM(input_tokens + output_tokens
                             + cache_read_input_tokens + cache_creation_input_tokens),0) AS tokens,
                COALESCE(SUM(cache_read_input_tokens),0) AS cache_read,
                COALESCE(SUM(input_tokens + cache_read_input_tokens
                             + cache_creation_input_tokens),0) AS total_for_hit
         FROM events WHERE timestamp >= {lb}
         GROUP BY {col} ORDER BY tokens DESC"
    );
    let rows: Vec<(String, i64, i64, i64)> = sqlx::query_as(&sql).fetch_all(pool).await?;
    let total: i64 = rows.iter().map(|(_, t, _, _)| *t).sum();
    Ok(rows
        .into_iter()
        .map(|(k, t, cache_read, total_for_hit)| GroupRow {
            key: k,
            tokens: t,
            percentage: if total > 0 { (t as f64) * 100.0 / (total as f64) } else { 0.0 },
            cache_hit_pct: if total_for_hit > 0 {
                (cache_read as f64) * 100.0 / (total_for_hit as f64)
            } else {
                0.0
            },
        })
        .collect())
}
```

**Step 3: Update `token_by_project` similarly**

`token_by_project` has its own SQL block (separate from `group_by` because of NULL handling). Mirror the same change there:

```rust
pub async fn token_by_project(pool: &SqlitePool, period: Period) -> Result<Vec<GroupRow>, sqlx::Error> {
    let lb = period.lower_bound_sql();
    let sql = format!(
        "SELECT COALESCE(project_path, '(unknown)') AS key,
                COALESCE(SUM(input_tokens + output_tokens
                             + cache_read_input_tokens + cache_creation_input_tokens),0) AS tokens,
                COALESCE(SUM(cache_read_input_tokens),0) AS cache_read,
                COALESCE(SUM(input_tokens + cache_read_input_tokens
                             + cache_creation_input_tokens),0) AS total_for_hit
         FROM events WHERE timestamp >= {lb}
         GROUP BY project_path ORDER BY tokens DESC"
    );
    let rows: Vec<(String, i64, i64, i64)> = sqlx::query_as(&sql).fetch_all(pool).await?;
    let total: i64 = rows.iter().map(|(_, t, _, _)| *t).sum();
    Ok(rows
        .into_iter()
        .map(|(k, t, cache_read, total_for_hit)| GroupRow {
            key: k,
            tokens: t,
            percentage: if total > 0 { (t as f64) * 100.0 / (total as f64) } else { 0.0 },
            cache_hit_pct: if total_for_hit > 0 {
                (cache_read as f64) * 100.0 / (total_for_hit as f64)
            } else {
                0.0
            },
        })
        .collect())
}
```

**Step 4: Build to verify**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10
```

Expected: clean compile.

**Step 5: Update frontend type**

In `src/lib/dataTypes.ts`:

```ts
export type GroupRow = {
  key: string;
  tokens: number;
  percentage: number;
  cache_hit_pct: number;  // NEW
};
```

**Step 6: Commit**

```bash
git add src-tauri/src/data/queries.rs src/lib/dataTypes.ts
git commit -m "feat(data): add cache_hit_pct to GroupRow"
```

---

## Task 3: Backend — `cache_pulse_1h` for pet mood

**Files:**
- Modify: `src-tauri/src/data/queries.rs` (append to bottom)

**Step 1: Add the struct + function**

Append at the end of `queries.rs`:

```rust
/// 1-hour rolling cache hit rate. Used internally by pet mood. Not
/// exposed via Tauri command — `cache_hit_pct` per period covers the
/// UI need; this one is for the live emotional pulse.
#[derive(Debug, Clone, Copy)]
pub struct CachePulse {
    pub hit_pct: f64,
    pub samples: i64,
}

pub async fn cache_pulse_1h(pool: &SqlitePool) -> Result<CachePulse, sqlx::Error> {
    let row: (i64, i64, i64) = sqlx::query_as(
        "SELECT
            COALESCE(SUM(cache_read_input_tokens), 0),
            COALESCE(SUM(input_tokens + cache_read_input_tokens
                         + cache_creation_input_tokens), 0),
            COUNT(*)
         FROM events
         WHERE timestamp >= datetime('now', '-1 hour')"
    )
    .fetch_one(pool)
    .await?;
    let (cache_read, total_for_hit, samples) = row;
    let hit_pct = if total_for_hit > 0 {
        (cache_read as f64) * 100.0 / (total_for_hit as f64)
    } else {
        100.0  // No data → don't penalize
    };
    Ok(CachePulse { hit_pct, samples })
}
```

**Step 2: Build to verify**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add src-tauri/src/data/queries.rs
git commit -m "feat(data): add cache_pulse_1h for pet mood signal"
```

---

## Task 4: Backend — fuse cache mood into `pet_status` + unit test

**Files:**
- Modify: `src-tauri/src/data/evolution.rs` (`mood_for` ~line 137; `pet_status` ~line 207; tests block ~line 330)

**Step 1: Write the failing test**

Append to the existing `#[cfg(test)] mod tests` block in `evolution.rs`:

```rust
#[test]
fn fuse_mood_truth_table() {
    use crate::data::queries::CachePulse;

    // Helper: build pulse with given hit_pct + samples
    let p = |pct, samples| CachePulse { hit_pct: pct, samples };

    // Below sample threshold → cache ignored, feed_mood passes through
    assert_eq!(fuse_mood("happy", &p(10.0, 4)), "happy");
    assert_eq!(fuse_mood("hungry", &p(99.0, 4)), "hungry");

    // Cache happy + feed happy → happy
    assert_eq!(fuse_mood("happy", &p(95.0, 50)), "happy");

    // Cache hungry overrides feed happy → hungry
    assert_eq!(fuse_mood("happy", &p(40.0, 50)), "hungry");

    // Feed hungry overrides cache happy → hungry
    assert_eq!(fuse_mood("hungry", &p(95.0, 50)), "hungry");

    // Both content → content
    assert_eq!(fuse_mood("content", &p(80.0, 50)), "content");

    // Cache content + feed happy → content (take worse)
    assert_eq!(fuse_mood("happy", &p(80.0, 50)), "content");
}
```

**Step 2: Run the test, verify it fails**

```bash
cargo test --manifest-path src-tauri/Cargo.toml fuse_mood_truth_table 2>&1 | tail -10
```

Expected: FAIL — `fuse_mood` not defined.

**Step 3: Add `fuse_mood` and rank helper near `mood_for`**

Insert immediately after `mood_for` in `evolution.rs`:

```rust
/// Order moods worst → best. Used by `fuse_mood` to take the
/// pessimistic min of two signals.
fn mood_rank(m: &str) -> u8 {
    match m {
        "hungry" => 0,
        "content" => 1,
        "happy" => 2,
        _ => 1, // unknown → neutral
    }
}

fn cache_mood_for(hit_pct: f64) -> &'static str {
    if hit_pct >= 90.0 {
        "happy"
    } else if hit_pct >= 70.0 {
        "content"
    } else {
        "hungry"
    }
}

/// Fuse feed-derived mood with cache-pulse mood, taking the worse of
/// the two. Returns `feed_mood` unchanged when there are not enough
/// recent samples to trust the cache signal (avoids cold-start
/// false alarms).
pub(crate) fn fuse_mood(feed_mood: &str, cache: &crate::data::queries::CachePulse) -> &'static str {
    if cache.samples < 5 {
        return match feed_mood {
            "hungry" => "hungry",
            "happy" => "happy",
            _ => "content",
        };
    }
    let cm = cache_mood_for(cache.hit_pct);
    let fm = match feed_mood {
        "hungry" => "hungry",
        "happy" => "happy",
        _ => "content",
    };
    if mood_rank(cm) < mood_rank(fm) { cm } else { fm }
}
```

**Step 4: Run the test, verify it passes**

```bash
cargo test --manifest-path src-tauri/Cargo.toml fuse_mood_truth_table 2>&1 | tail -5
```

Expected: PASS.

**Step 5: Wire `fuse_mood` into `pet_status`**

In `pet_status` (~line 207), replace this line:

```rust
mood: mood_for(level).to_string(),
```

with:

```rust
mood: {
    let pulse = crate::data::queries::cache_pulse_1h(&state.pool)
        .await
        .unwrap_or(crate::data::queries::CachePulse { hit_pct: 100.0, samples: 0 });
    fuse_mood(mood_for(level), &pulse).to_string()
},
```

Do the same in `record_feed` (~line 265) — replace `mood: mood_for(next).to_string(),` with the same fused expression (using `next` instead of `level`).

**Step 6: Build + run all tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -15
```

Expected: all pass; no warnings introduced.

**Step 7: Commit**

```bash
git add src-tauri/src/data/evolution.rs
git commit -m "feat(pet): fuse 1h cache hit rate into mood

Pet mood now = min(feed_mood, cache_mood) with a 5-sample warmup
gate. Sub-70% cache hit drops the pet to 'hungry' regardless of
feed level — early warning that cache discipline broke."
```

---

## Task 5: Frontend — `formatPercent` and `formatSavings` helpers

**Files:**
- Modify: `src/lib/format.ts`

**Step 1: Append helpers at the end of `format.ts`**

```ts
/** Format a percentage with one decimal — e.g. 96.4%. */
export function formatPercent(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return `${p.toFixed(1)}%`;
}

/** Format a savings amount as ~$X (with tilde to indicate estimate). */
export function formatSavings(usd: string | null | undefined): string {
  if (!usd) return "—";
  const n = parseFloat(usd);
  if (!Number.isFinite(n)) return "—";
  if (n < 0.01) return "$0";
  if (n < 100) return `~$${n.toFixed(2)}`;
  return `~$${Math.round(n)}`;
}
```

**Step 2: Commit**

```bash
git add src/lib/format.ts
git commit -m "feat(format): add formatPercent and formatSavings helpers"
```

---

## Task 6: Frontend — i18n strings for cache UI

**Files:**
- Modify: `src/lib/locales.ts`

**Step 1: Add to the `Strings` interface (overview namespace)**

Find the `overview:` block in the `Strings` type and append:

```ts
cacheEfficiency: string;
cacheSaved: string;
cacheReads: string;
cacheVsYesterday: (delta: number) => string;
cacheLabel: (pct: string) => string;
```

**Step 2: Add zh values**

In the `zh` locale's `overview:` block:

```ts
cacheEfficiency: "缓存效率",
cacheSaved: "节省",
cacheReads: "缓存读取",
cacheVsYesterday: (d) =>
  `${d > 0 ? "↑" : d < 0 ? "↓" : ""} ${Math.abs(d).toFixed(1)}% vs 昨天`,
cacheLabel: (pct) => `cache ${pct}`,
```

**Step 3: Add en values**

In the `en` locale's `overview:` block:

```ts
cacheEfficiency: "Cache Efficiency",
cacheSaved: "Saved",
cacheReads: "Cache reads",
cacheVsYesterday: (d) =>
  `${d > 0 ? "↑" : d < 0 ? "↓" : ""} ${Math.abs(d).toFixed(1)}% vs yesterday`,
cacheLabel: (pct) => `cache ${pct}`,
```

**Step 4: Verify TypeScript compiles**

```bash
pnpm typecheck 2>&1 | tail -10
```

Expected: 0 errors.

**Step 5: Commit**

```bash
git add src/lib/locales.ts
git commit -m "feat(i18n): add cache efficiency strings (zh + en)"
```

---

## Task 7: Frontend — `<CacheCard>` component in OverviewPanel

**Files:**
- Modify: `src/components/OverviewPanel.tsx`

**Step 1: Add CacheCard inside OverviewPanel**

Add a new `CacheCard` function component at the bottom of the file (alongside `Card`, `BarList`, etc.):

```tsx
function CacheCard({
  summary,
  yesterday,
  period,
  t,
}: {
  summary: TokenSummary | null;
  yesterday: TimeseriesPoint | null;
  period: Period;
  t: ReturnType<typeof useT>;
}) {
  if (!summary) {
    return (
      <Card label={t.overview.cacheEfficiency} value="—" />
    );
  }
  const totalForHit =
    summary.total_input + summary.total_cache_read + summary.total_cache_creation;
  const hitPct =
    totalForHit > 0 ? (summary.total_cache_read * 100) / totalForHit : 0;

  // Yesterday delta only valid for today period — yesterday is a single
  // daily bucket, has no cache fields exposed; we approximate "today
  // vs running average" by comparing against the period's hit pct over
  // the trailing-week series. Skip delta for week/month.
  const delta = period === "today" ? null : null; // YAGNI: delta needs
  // a richer history shape; defer to a follow-up.

  return (
    <div className="ov-card">
      <span className="ov-card-label">{t.overview.cacheEfficiency}</span>
      <span className="ov-card-value is-mono">{formatPercent(hitPct)}</span>
      {delta !== null ? (
        <span className="ov-card-delta">{t.overview.cacheVsYesterday(delta)}</span>
      ) : null}
      <div className="ov-card-sub">
        <span className="ov-card-sub-row">
          <span className="ov-card-sub-label">{t.overview.cacheSaved}</span>
          <span className="ov-card-sub-value">
            {formatSavings(summary.cache_savings_usd)}
          </span>
        </span>
        <span className="ov-card-sub-row">
          <span className="ov-card-sub-label">{t.overview.cacheReads}</span>
          <span className="ov-card-sub-value">
            {formatTokens(summary.total_cache_read)}
          </span>
        </span>
      </div>
    </div>
  );
}
```

**Step 2: Render `<CacheCard>` inside the `.ov-cards` grid**

In the JSX of `OverviewPanel`, find the `<div className="ov-cards">` block and add `<CacheCard>` as a fourth card (after the existing `topModel` card):

```tsx
<div className="ov-cards">
  {/* existing Tokens / Sessions / topModel cards */}
  <CacheCard
    summary={s.summary}
    yesterday={yesterday}
    period={period}
    t={t}
  />
</div>
```

**Step 3: Add the imports at the top of the file**

The component already imports `formatTokens`. Add `formatPercent`, `formatSavings`:

```ts
import {
  formatModel,
  formatPercent,    // NEW
  formatPercentDelta,
  formatSavings,    // NEW
  formatSource,
  formatTimeHM,
  formatTokens,
  // ...
} from "../lib/format";
```

**Step 4: Verify TypeScript compiles**

```bash
pnpm typecheck 2>&1 | tail -5
```

Expected: 0 errors.

**Step 5: Commit**

```bash
git add src/components/OverviewPanel.tsx
git commit -m "feat(ui): add Cache Efficiency KPI card to overview"
```

---

## Task 8: Frontend — per-tool cache % column in BarList

**Files:**
- Modify: `src/components/OverviewPanel.tsx` (BarList component)
- Modify: `src/settings.css` (add `.ov-bar-cache` style)

**Step 1: Add an optional `showCache` prop and render**

Modify `BarList` signature and JSX:

```tsx
function BarList({
  rows,
  formatKey,
  emptyText,
  showCache = false,  // NEW
}: {
  rows: GroupRow[];
  period: Period;
  formatKey: (k: string) => string;
  emptyText: string;
  showCache?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="ov-empty">{emptyText}</p>;
  }
  return (
    <ul className="ov-bars">
      {rows.slice(0, 5).map((r) => (
        <li key={r.key} className="ov-bar-row">
          <span className="ov-bar-key">{formatKey(r.key)}</span>
          <span
            className="ov-bar-fill"
            style={{ width: `${Math.max(2, r.percentage)}%` }}
            aria-hidden="true"
          />
          <span className="ov-bar-pct">{r.percentage.toFixed(0)}%</span>
          {showCache ? (
            <span className="ov-bar-cache">cache {r.cache_hit_pct.toFixed(1)}%</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
```

**Step 2: Set `showCache` on the by-tool and by-model BarLists in `OverviewPanel` JSX**

```tsx
<BarList ... formatKey={(k) => formatSource(k)} emptyText={...} showCache />
<BarList ... formatKey={(k) => formatModel(k)} emptyText={...} showCache />
{/* By-project: NO showCache (intentional, per design) */}
```

**Step 3: Add `.ov-bar-cache` CSS in `src/settings.css`**

Find the `.ov-bar-pct` rule (search for it) and add right after it:

```css
.ov-bar-cache {
  font-size: 11px;
  color: var(--sp-muted);
  font-variant-numeric: tabular-nums;
  margin-left: 8px;
  white-space: nowrap;
}
```

**Step 4: Verify TypeScript + visual sanity check via `pnpm typecheck`**

```bash
pnpm typecheck 2>&1 | tail -5
```

Expected: 0 errors.

**Step 5: Commit**

```bash
git add src/components/OverviewPanel.tsx src/settings.css
git commit -m "feat(ui): add cache hit % column to By tool / By model lists"
```

---

## Task 9: Manual E2E verification

**Step 1: Run the dev build**

```bash
PATH=/usr/bin:$HOME/.cargo/bin:$PATH pnpm tauri dev
```

Wait for the pet window + settings window to appear. The settings window should show the overview panel.

**Step 2: Verify Cache Card numbers**

Open settings → Overview. Verify:
- Cache Efficiency card visible alongside Tokens/Sessions/Top Model
- Hit pct number is sensible (should be 90%+ given the test DB)
- "Saved ~$X" reflects pricing × cache_read sum
- "Cache reads" shows formatted token count

Sanity check via SQL (in another terminal):

```bash
DB="$HOME/Library/Application Support/com.notchi.app/data.db"
sqlite3 "$DB" "SELECT
  ROUND(SUM(cache_read_input_tokens) * 100.0 /
        SUM(input_tokens + cache_read_input_tokens + cache_creation_input_tokens), 1)
  FROM events WHERE timestamp >= datetime('now', 'start of day')"
```

The number printed should match the card to within 0.1%.

**Step 3: Verify BarList cache columns**

In Overview, "By tool" rows should each show a trailing `cache 97.7%` style label. "By project" should NOT.

**Step 4: Verify pet mood**

Pet emoji/state in the header should reflect fused mood. With 90%+ hit rate, expect "happy"/"content". Force a low hit rate (optional) by inserting a synthetic event:

```bash
sqlite3 "$DB" "INSERT INTO events (
  source, model, session_id, timestamp,
  input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
  cost_usd
) VALUES (
  'claude-code', 'claude-sonnet-4-5', 'test-cache-leak', datetime('now', '-30 minutes'),
  500000, 100, 0, 0,
  '0'
)"
```

Restart the dev app or wait for the next refresh; pet should slip from "happy"/"content" to "hungry" because 1h cache hit rate dropped below 70%.

Clean up after the check:

```bash
sqlite3 "$DB" "DELETE FROM events WHERE session_id = 'test-cache-leak'"
```

**Step 5: Capture two screenshots**

Use `Cmd+Shift+4` (or any tool) to capture:
- `/tmp/notchi-cache-overview.png` — full overview panel showing the new card + bar lists
- `/tmp/notchi-cache-mood.png` — pet window showing happy state

**Step 6: Run typecheck + clippy as final gate**

```bash
pnpm typecheck 2>&1 | tail -5
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings 2>&1 | tail -10
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

All three must come back clean.

**Step 7: Push the branch**

```bash
git push -u origin feature/cache-efficiency
git push new feature/cache-efficiency
```

---

## Done definition

- [ ] All commits land on `feature/cache-efficiency`
- [ ] `pnpm typecheck` green
- [ ] `cargo clippy -D warnings` green
- [ ] `cargo test` green (including new `fuse_mood_truth_table`)
- [ ] Cache card visible with sensible numbers in `pnpm tauri dev`
- [ ] By-tool / By-model rows show cache % labels
- [ ] Pet mood reacts to forced low hit rate (manual verification)
- [ ] Two screenshots saved to `/tmp/`
