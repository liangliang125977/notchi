use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize)]
pub struct BurnRate {
    pub tokens_per_min: f64,
    pub usd_per_min: f64,
    pub usd_today: f64,
    pub usd_budget_month: f64,
    pub usd_projected_month: f64,
    pub status: String, // "calm" | "warm" | "hot" | "scorching"
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
           AND agent_id IS NULL",
    )
    .fetch_one(pool)
    .await?;
    let (tokens_30, usd_30) = row;

    let tokens_per_min = (tokens_30 as f64) / 30.0;
    let usd_per_min = usd_30 / 30.0;

    // Today's USD (since start of day, agent_id IS NULL)
    let (usd_today,): (f64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(CAST(cost_usd AS REAL)), 0.0)
         FROM events
         WHERE timestamp >= datetime('now', 'start of day')
           AND agent_id IS NULL",
    )
    .fetch_one(pool)
    .await?;

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
    if ratio < 0.7 {
        "calm"
    } else if ratio < 1.0 {
        "warm"
    } else if ratio < 1.5 {
        "hot"
    } else {
        "scorching"
    }
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
    next_month_first
        .signed_duration_since(this_first)
        .num_days() as u32
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
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE events (
                id INTEGER PRIMARY KEY,
                timestamp TEXT, source TEXT, model TEXT,
                input_tokens INT, output_tokens INT,
                cache_read_input_tokens INT, cache_creation_input_tokens INT,
                cost_usd TEXT, project_path TEXT, session_id TEXT,
                is_third_party INT, agent_id TEXT, parent_session_id TEXT,
                ingested_at TEXT
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn burn_rate_excludes_subagents() {
        let pool = fresh_pool().await;
        let now_iso = chrono::Utc::now().to_rfc3339();
        for (agent, sess) in [(None::<&str>, "main"), (Some("agent_a"), "main")] {
            let agent_val: Option<&str> = agent;
            sqlx::query(
                "INSERT INTO events (timestamp,source,model,input_tokens,output_tokens,
                                     cache_read_input_tokens,cache_creation_input_tokens,
                                     cost_usd,session_id,is_third_party,
                                     agent_id,parent_session_id,ingested_at)
                 VALUES (?1,'claude-code','m',1000,500,0,0,'1.00',?2,0,?3,'p',?1)",
            )
            .bind(&now_iso)
            .bind(sess)
            .bind(agent_val)
            .execute(&pool)
            .await
            .unwrap();
        }
        let br = burn_rate_now(&pool, 50.0).await.unwrap();
        assert!(
            (br.usd_today - 1.0).abs() < 0.01,
            "usd_today expected ~1.0, got {}",
            br.usd_today
        );
    }
}
