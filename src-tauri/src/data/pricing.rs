//! T2.4 — built-in Anthropic price seed + cost calculation.
//!
//! Prices are USD per 1M tokens, encoded as `rust_decimal::Decimal` and
//! stored as TEXT in SQLite to preserve precision. On every startup we
//! check whether the `pricing` table is empty and, if so, seed it. We
//! intentionally do NOT overwrite user edits — once a row exists, we
//! leave it alone.

use rust_decimal::Decimal;
use sqlx::SqlitePool;

/// (model, endpoint_id, input, output, cache_read, cache_write)
/// USD per 1M tokens. Source: SPEC §5.7 + T2.4 task brief.
///
/// OpenAI rows come from <https://openai.com/api/pricing/> (snapshot
/// 2026-05). `gpt-5` / `gpt-5-mini` use the published list price; the
/// `cache_read` column maps to OpenAI's "cached input" rate (only
/// `input` is discounted on the OpenAI side, so `cache_write` stays
/// at "0"). Codex emits these exact ids via `turn_context.model`.
const SEED: &[(&str, &str, &str, &str, &str, &str)] = &[
    ("claude-opus-4-7", "", "15.00", "75.00", "1.50", "0.30"),
    ("claude-opus-4-6", "", "15.00", "75.00", "1.50", "0.30"),
    ("claude-opus-4", "", "15.00", "75.00", "1.50", "0.30"),
    ("claude-sonnet-4-6", "", "3.00", "15.00", "0.30", "0.06"),
    ("claude-sonnet-4", "", "3.00", "15.00", "0.30", "0.06"),
    ("claude-haiku-4-5", "", "0.80", "4.00", "0.08", "0.016"),
    ("claude-3-5-sonnet", "", "3.00", "15.00", "0.30", "0.06"),
    ("claude-3-5-haiku", "", "0.80", "4.00", "0.08", "0.016"),
    ("claude-3-opus", "", "15.00", "75.00", "1.50", "0.30"),
    // OpenAI / Codex
    ("gpt-5", "", "10.00", "30.00", "1.25", "0"),
    ("gpt-5-mini", "", "0.25", "2.00", "0.025", "0"),
    ("gpt-5-nano", "", "0.05", "0.40", "0.005", "0"),
    ("gpt-4o", "", "2.50", "10.00", "1.25", "0"),
    ("gpt-4o-mini", "", "0.15", "0.60", "0.075", "0"),
    ("o3", "", "5.00", "20.00", "1.25", "0"),
    ("o3-mini", "", "1.10", "4.40", "0.55", "0"),
    ("o4-mini", "", "1.10", "4.40", "0.275", "0"),
];

/// Seed the built-in price list. Uses `INSERT OR IGNORE` per-row so
/// that adding new built-in models in later releases (e.g. v1.0
/// adding the OpenAI / Codex rows) is additive — user-edited rows
/// for an existing model are left untouched, but missing built-in
/// rows are filled in.
pub async fn seed_if_empty(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    let mut inserted = 0usize;
    for row in SEED {
        let res = sqlx::query(
            "INSERT OR IGNORE INTO pricing
                (model, endpoint_id, input_per_mtok, output_per_mtok,
                 cache_read_per_mtok, cache_write_per_mtok)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(row.0)
        .bind(row.1)
        .bind(row.2)
        .bind(row.3)
        .bind(row.4)
        .bind(row.5)
        .execute(&mut *tx)
        .await?;
        if res.rows_affected() > 0 {
            inserted += 1;
        }
    }
    tx.commit().await?;
    if inserted > 0 {
        eprintln!("[pricing] seeded {inserted} new row(s) ({} total)", SEED.len());
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct Pricing {
    pub input: Decimal,
    pub output: Decimal,
    pub cache_read: Decimal,
    pub cache_write: Decimal,
}

impl Default for Pricing {
    fn default() -> Self {
        Self {
            input: Decimal::ZERO,
            output: Decimal::ZERO,
            cache_read: Decimal::ZERO,
            cache_write: Decimal::ZERO,
        }
    }
}

/// Resolve unit price for a (model, endpoint_id) pair. Falls back to
/// a zero-priced shape when the model is unknown — UI will then show
/// tokens but no `$` (S11).
///
/// Anthropic frequently appends dated suffixes to the model name on the
/// wire (e.g. `claude-haiku-4-5-20251001`). We try the exact match
/// first, then strip a trailing `-<8-digit-date>` and retry — this is
/// purely additive and never overrides a user-supplied row.
pub async fn lookup(pool: &SqlitePool, model: &str, endpoint_id: &str) -> Pricing {
    let row: Option<(String, String, String, String)> = sqlx::query_as(
        "SELECT input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok
         FROM pricing WHERE model = ?1 AND endpoint_id = ?2",
    )
    .bind(model)
    .bind(endpoint_id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);
    let row = match row {
        Some(r) => Some(r),
        None => {
            let trimmed = strip_date_suffix(model);
            if trimmed != model {
                sqlx::query_as(
                    "SELECT input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok
                     FROM pricing WHERE model = ?1 AND endpoint_id = ?2",
                )
                .bind(trimmed)
                .bind(endpoint_id)
                .fetch_optional(pool)
                .await
                .unwrap_or(None)
            } else {
                None
            }
        }
    };
    match row {
        Some((i, o, cr, cw)) => Pricing {
            input: Decimal::from_str_exact(&i).unwrap_or_default(),
            output: Decimal::from_str_exact(&o).unwrap_or_default(),
            cache_read: Decimal::from_str_exact(&cr).unwrap_or_default(),
            cache_write: Decimal::from_str_exact(&cw).unwrap_or_default(),
        },
        None => Pricing::default(),
    }
}

fn strip_date_suffix(model: &str) -> &str {
    // Strip trailing `-YYYYMMDD` (8 digits after a dash) if present.
    if let Some(idx) = model.rfind('-') {
        let tail = &model[idx + 1..];
        if tail.len() == 8 && tail.chars().all(|c| c.is_ascii_digit()) {
            return &model[..idx];
        }
    }
    model
}

/// Returns USD cost for one assistant turn, using rust_decimal so we
/// can store the result as TEXT without losing pennies.
pub fn cost_for_turn(
    p: &Pricing,
    input_tokens: i64,
    output_tokens: i64,
    cache_read: i64,
    cache_write: i64,
) -> Decimal {
    let mtok = Decimal::new(1_000_000, 0);
    let dec = |n: i64| Decimal::new(n, 0);
    p.input * dec(input_tokens) / mtok
        + p.output * dec(output_tokens) / mtok
        + p.cache_read * dec(cache_read) / mtok
        + p.cache_write * dec(cache_write) / mtok
}
