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
    pub fn lower_bound_sql(self) -> &'static str {
        match self {
            Period::Today => "datetime('now', 'start of day')",
            Period::Week => "datetime('now', '-7 days')",
            Period::Month => "datetime('now', 'start of month')",
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

    let dom_sql = format!(
        "SELECT model FROM events WHERE timestamp >= {lb}
         GROUP BY model
         ORDER BY SUM(input_tokens + output_tokens) DESC
         LIMIT 1"
    );
    let dominant: Option<(String,)> = sqlx::query_as(&dom_sql).fetch_optional(pool).await?;

    Ok(TokenSummary {
        total_input: i,
        total_output: o,
        total_cache_read: cr,
        total_cache_creation: cc,
        total_cost_usd: format!("{cost:.4}"),
        session_count: sessions,
        dominant_model: dominant.map(|(m,)| m),
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
                COALESCE(SUM(input_tokens + output_tokens),0) AS tokens,
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
}

pub async fn token_by_source(pool: &SqlitePool, period: Period) -> Result<Vec<GroupRow>, sqlx::Error> {
    group_by(pool, period, "source").await
}

pub async fn token_by_model(pool: &SqlitePool, period: Period) -> Result<Vec<GroupRow>, sqlx::Error> {
    group_by(pool, period, "model").await
}

async fn group_by(
    pool: &SqlitePool,
    period: Period,
    col: &str,
) -> Result<Vec<GroupRow>, sqlx::Error> {
    let lb = period.lower_bound_sql();
    let sql = format!(
        "SELECT {col} AS key,
                COALESCE(SUM(input_tokens + output_tokens),0) AS tokens
         FROM events WHERE timestamp >= {lb}
         GROUP BY {col} ORDER BY tokens DESC"
    );
    let rows: Vec<(String, i64)> = sqlx::query_as(&sql).fetch_all(pool).await?;
    let total: i64 = rows.iter().map(|(_, t)| *t).sum();
    Ok(rows
        .into_iter()
        .map(|(k, t)| GroupRow {
            key: k,
            tokens: t,
            percentage: if total > 0 { (t as f64) * 100.0 / (total as f64) } else { 0.0 },
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
}

pub async fn recent_sessions(pool: &SqlitePool, limit: i64) -> Result<Vec<SessionRow>, sqlx::Error> {
    let sql = "SELECT session_id,
                       MIN(timestamp) AS started_at,
                       COALESCE(SUM(input_tokens + output_tokens),0) AS tokens,
                       COALESCE(SUM(CAST(cost_usd AS REAL)),0.0) AS cost,
                       (SELECT model FROM events e2 WHERE e2.session_id = e1.session_id
                        GROUP BY model ORDER BY SUM(input_tokens + output_tokens) DESC LIMIT 1) AS model,
                       (SELECT project_path FROM events e3 WHERE e3.session_id = e1.session_id
                        AND project_path IS NOT NULL LIMIT 1) AS project_path
                FROM events e1
                GROUP BY session_id
                ORDER BY started_at DESC
                LIMIT ?1";
    let rows: Vec<(String, String, i64, f64, String, Option<String>)> =
        sqlx::query_as(sql).bind(limit).fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .map(|(s, st, t, c, m, p)| SessionRow {
            session_id: s,
            started_at: st,
            total_tokens: t,
            cost_usd: format!("{c:.4}"),
            model: m,
            project_path: p,
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
