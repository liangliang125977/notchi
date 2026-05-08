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
    async fn active_window_60s() {
        let pool = fresh_pool().await;
        let now = chrono::Utc::now();
        let alive_ts = (now - chrono::Duration::seconds(30)).to_rfc3339();
        let dead_ts = (now - chrono::Duration::seconds(90)).to_rfc3339();
        for (agent, ts) in [("alive_a", alive_ts), ("dead_a", dead_ts)] {
            sqlx::query(
                "INSERT INTO events (timestamp,source,model,input_tokens,output_tokens,
                                     cache_read_input_tokens,cache_creation_input_tokens,
                                     cost_usd,session_id,is_third_party,
                                     agent_id,parent_session_id,ingested_at)
                 VALUES (?1,'claude-code','test',100,50,0,0,'0','sess1',0,?2,'parent1',?3)",
            )
            .bind(&ts)
            .bind(agent)
            .bind(&ts)
            .execute(&pool)
            .await
            .unwrap();
        }
        let result = active_subagents(&pool).await.unwrap();
        assert_eq!(result.len(), 2);
        let alive = result.iter().find(|r| r.agent_id == "alive_a").unwrap();
        let dead = result.iter().find(|r| r.agent_id == "dead_a").unwrap();
        assert!(alive.is_alive);
        assert!(!dead.is_alive);
    }
}
