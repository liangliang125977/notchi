//! Read-side helpers used by the Tauri commands. Keep math here so the
//! frontend stays "show numbers as text" simple.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Clone, Copy)]
pub enum Period {
    Today,
    Week,
    Month,
}

impl Period {
    pub fn from_str(s: &str) -> Self {
        match s {
            "week" => Period::Week,
            "month" => Period::Month,
            _ => Period::Today,
        }
    }

    /// SQLite expression evaluating to the lower bound of the period
    /// (UTC). All `events.timestamp` values are ISO-8601 in UTC, so
    /// SQLite's `datetime()` ordering is correct.
    ///
    /// "Month" intentionally means **trailing 30 days**, not calendar
    /// start-of-month. Calendar months gave a confusing UX early in
    /// the month (sparse charts) and matched the chart's "Daily
    /// distribution (30d)" label only by accident.
    pub fn lower_bound_sql(self) -> &'static str {
        match self {
            Period::Today => "datetime('now', 'start of day')",
            Period::Week => "datetime('now', '-7 days')",
            Period::Month => "datetime('now', '-30 days')",
        }
    }
}

#[derive(Debug, Serialize)]
pub struct TokenSummary {
    pub total_input: i64,
    pub total_output: i64,
    pub total_cache_read: i64,
    pub total_cache_creation: i64,
    pub total_cost_usd: String,
    pub session_count: i64,
    pub dominant_model: Option<String>,
    /// Estimated USD saved by Anthropic-style prompt caching during
    /// the period: SUM(cache_read × (input_price - cache_read_price))
    /// across events whose model has a row in `pricing`. Models
    /// without pricing are silently skipped.
    pub cache_savings_usd: String,
}

pub async fn token_summary(pool: &SqlitePool, period: Period) -> Result<TokenSummary, sqlx::Error> {
    let lb = period.lower_bound_sql();
    // SQLite literal `0` is INTEGER. When SUM(...) is NULL (no rows
    // in window), COALESCE collapses to INTEGER and sqlx rejects the
    // f64 destination at decode time. Use `0.0` for REAL columns so
    // the COALESCE result is always REAL.
    let sql = format!(
        "SELECT
            COALESCE(SUM(input_tokens),0) AS i,
            COALESCE(SUM(output_tokens),0) AS o,
            COALESCE(SUM(cache_read_input_tokens),0) AS cr,
            COALESCE(SUM(cache_creation_input_tokens),0) AS cc,
            COALESCE(SUM(CAST(cost_usd AS REAL)),0.0) AS cost,
            COUNT(DISTINCT session_id) AS sessions
         FROM events WHERE timestamp >= {lb}"
    );
    let (i, o, cr, cc, cost, sessions): (i64, i64, i64, i64, f64, i64) =
        sqlx::query_as(&sql).fetch_one(pool).await?;

    // Include cache tokens so a heavily-cached Claude session is not
    // ranked below a non-cached model. cache_read represents actual
    // context processed by the model on behalf of the user.
    let dom_sql = format!(
        "SELECT model FROM events WHERE timestamp >= {lb}
         GROUP BY model
         ORDER BY SUM(input_tokens + output_tokens
                      + cache_read_input_tokens + cache_creation_input_tokens) DESC
         LIMIT 1"
    );
    let dominant: Option<(String,)> = sqlx::query_as(&dom_sql).fetch_optional(pool).await?;

    // Cache savings: cache_read × (input_price - cache_read_price) per
    // event row, joined to pricing on (model, endpoint_id='default').
    // LEFT JOIN + IS NOT NULL guard ensures rows for models without
    // pricing contribute 0 instead of failing.
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

    Ok(TokenSummary {
        total_input: i,
        total_output: o,
        total_cache_read: cr,
        total_cache_creation: cc,
        total_cost_usd: format!("{cost:.4}"),
        session_count: sessions,
        dominant_model: dominant.map(|(m,)| m),
        cache_savings_usd: format!("{savings:.2}"),
    })
}

#[derive(Debug, Serialize)]
pub struct TimeseriesPoint {
    pub bucket: String,
    pub tokens: i64,
    pub cost_usd: String,
}

pub async fn token_timeseries(
    pool: &SqlitePool,
    period: Period,
) -> Result<Vec<TimeseriesPoint>, sqlx::Error> {
    let lb = period.lower_bound_sql();
    // Today → hourly buckets, week/month → daily.
    let bucket_expr = match period {
        Period::Today => "strftime('%Y-%m-%dT%H:00:00Z', timestamp)",
        _ => "strftime('%Y-%m-%d', timestamp)",
    };
    let sql = format!(
        "SELECT {bucket_expr} AS bucket,
                COALESCE(SUM(input_tokens + output_tokens
                             + cache_read_input_tokens + cache_creation_input_tokens),0) AS tokens,
                COALESCE(SUM(CAST(cost_usd AS REAL)),0.0) AS cost
         FROM events
         WHERE timestamp >= {lb}
         GROUP BY bucket ORDER BY bucket ASC"
    );
    let rows: Vec<(String, i64, f64)> = sqlx::query_as(&sql).fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .map(|(b, t, c)| TimeseriesPoint {
            bucket: b,
            tokens: t,
            cost_usd: format!("{c:.4}"),
        })
        .collect())
}

#[derive(Debug, Serialize)]
pub struct GroupRow {
    pub key: String,
    pub tokens: i64,
    pub percentage: f64,
    /// Cache hit rate over `input + cache_read + cache_creation`
    /// across this group's events. 0.0 when the group has no
    /// cache-relevant events.
    pub cache_hit_pct: f64,
}

pub async fn token_by_source(pool: &SqlitePool, period: Period) -> Result<Vec<GroupRow>, sqlx::Error> {
    group_by(pool, period, "source").await
}

pub async fn token_by_model(pool: &SqlitePool, period: Period) -> Result<Vec<GroupRow>, sqlx::Error> {
    group_by(pool, period, "model").await
}

pub async fn token_by_project(pool: &SqlitePool, period: Period) -> Result<Vec<GroupRow>, sqlx::Error> {
    let lb = period.lower_bound_sql();
    // Use COALESCE to bucket NULL project_path as "(unknown)".
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

async fn group_by(
    pool: &SqlitePool,
    period: Period,
    col: &str,
) -> Result<Vec<GroupRow>, sqlx::Error> {
    let lb = period.lower_bound_sql();
    // Include cache tokens so heavily-cached models/sources rank correctly.
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

#[derive(Debug, Serialize)]
pub struct SessionRow {
    pub session_id: String,
    pub started_at: String,
    pub total_tokens: i64,
    pub cost_usd: String,
    pub model: String,
    pub project_path: Option<String>,
    pub source: String,
}

/// Returns sessions whose first event falls inside `period`. A
/// `period == None` means "no period filter" — used by the Sessions
/// panel's "All" chip — and we still apply a 30-day floor so the
/// query never paginates the full event log.
pub async fn recent_sessions_in(
    pool: &SqlitePool,
    period: Option<Period>,
    limit: i64,
) -> Result<Vec<SessionRow>, sqlx::Error> {
    let lb = period
        .map(|p| p.lower_bound_sql())
        .unwrap_or("datetime('now', '-30 days')");
    let sql = format!(
        "SELECT session_id,
                started_at,
                tokens,
                cost,
                model,
                project_path,
                source
         FROM (
            SELECT session_id,
                   MIN(timestamp) AS started_at,
                   COALESCE(SUM(input_tokens + output_tokens
                                + cache_read_input_tokens + cache_creation_input_tokens),0) AS tokens,
                   COALESCE(SUM(CAST(cost_usd AS REAL)),0.0) AS cost,
                   (SELECT model FROM events e2 WHERE e2.session_id = e1.session_id
                    GROUP BY model ORDER BY SUM(input_tokens + output_tokens
                                               + cache_read_input_tokens + cache_creation_input_tokens) DESC LIMIT 1) AS model,
                   (SELECT project_path FROM events e3 WHERE e3.session_id = e1.session_id
                    AND project_path IS NOT NULL LIMIT 1) AS project_path,
                   (SELECT source FROM events e4 WHERE e4.session_id = e1.session_id
                    GROUP BY source ORDER BY SUM(input_tokens + output_tokens
                                                + cache_read_input_tokens + cache_creation_input_tokens) DESC LIMIT 1) AS source
            FROM events e1
            GROUP BY session_id
         )
         WHERE started_at >= {lb}
         ORDER BY started_at DESC
         LIMIT ?1"
    );
    let rows: Vec<(String, String, i64, f64, String, Option<String>, String)> =
        sqlx::query_as(&sql).bind(limit).fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .map(|(s, st, t, c, m, p, src)| SessionRow {
            session_id: s,
            started_at: st,
            total_tokens: t,
            cost_usd: format!("{c:.4}"),
            model: m,
            project_path: p,
            source: src,
        })
        .collect())
}


#[derive(Debug, Serialize, Deserialize)]
pub struct PricingEntry {
    pub model: String,
    pub endpoint_id: String,
    pub input_per_mtok: String,
    pub output_per_mtok: String,
    pub cache_read_per_mtok: String,
    pub cache_write_per_mtok: String,
}

pub async fn list_pricing(pool: &SqlitePool) -> Result<Vec<PricingEntry>, sqlx::Error> {
    let rows: Vec<(String, String, String, String, String, String)> =
        sqlx::query_as("SELECT model, endpoint_id, input_per_mtok, output_per_mtok,
                              cache_read_per_mtok, cache_write_per_mtok FROM pricing
                       ORDER BY model, endpoint_id")
            .fetch_all(pool)
            .await?;
    Ok(rows
        .into_iter()
        .map(|(m, e, i, o, cr, cw)| PricingEntry {
            model: m,
            endpoint_id: e,
            input_per_mtok: i,
            output_per_mtok: o,
            cache_read_per_mtok: cr,
            cache_write_per_mtok: cw,
        })
        .collect())
}

pub async fn upsert_pricing(pool: &SqlitePool, e: &PricingEntry) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO pricing (model, endpoint_id, input_per_mtok, output_per_mtok,
                              cache_read_per_mtok, cache_write_per_mtok)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(model, endpoint_id) DO UPDATE SET
            input_per_mtok = excluded.input_per_mtok,
            output_per_mtok = excluded.output_per_mtok,
            cache_read_per_mtok = excluded.cache_read_per_mtok,
            cache_write_per_mtok = excluded.cache_write_per_mtok",
    )
    .bind(&e.model)
    .bind(&e.endpoint_id)
    .bind(&e.input_per_mtok)
    .bind(&e.output_per_mtok)
    .bind(&e.cache_read_per_mtok)
    .bind(&e.cache_write_per_mtok)
    .execute(pool)
    .await?;
    Ok(())
}
