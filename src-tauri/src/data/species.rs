//! v1.2 — multi-form (species) detection.
//!
//! The pet's "race" is decided by the language mix of the top-cost
//! project the user has been working on. We deliberately keep this
//! cheap and wrong-but-friendly: walk the project dir, count file
//! extensions to a small cap, pick the family that crosses 30 %, and
//! gate it behind a 100 K token threshold so a one-off PR doesn't
//! flip the species the moment it lands.

use serde::Serialize;
use sqlx::SqlitePool;
use std::path::Path;
use walkdir::WalkDir;

const TOKEN_THRESHOLD: i64 = 100_000;
const DOMINANCE_PCT: f64 = 30.0;
const MAX_WALK_FILES: usize = 2_000;
const MAX_WALK_DEPTH: usize = 6;

#[derive(Debug, Serialize, Clone)]
pub struct SpeciesStatus {
    pub species: &'static str,
    pub emoji: &'static str,
    pub language: Option<String>,
    pub top_project: Option<String>,
    pub total_tokens: i64,
    pub lock_progress: f64,
}

impl SpeciesStatus {
    fn cat(top_project: Option<String>, tokens: i64, language: Option<String>) -> Self {
        Self {
            species: "cat",
            emoji: "🐱",
            language,
            top_project,
            total_tokens: tokens,
            lock_progress: (tokens as f64 / TOKEN_THRESHOLD as f64).clamp(0.0, 1.0),
        }
    }
}

/// Aggregate (project_path, total_tokens) over all time and pick the
/// project with the highest cumulative cost. Project paths that ingest
/// missed (NULL) are dropped.
async fn top_project(pool: &SqlitePool) -> Result<Option<(String, i64)>, sqlx::Error> {
    let row: Option<(String, i64)> = sqlx::query_as(
        "SELECT project_path, COALESCE(SUM(input_tokens + output_tokens),0) AS tokens
         FROM events
         WHERE project_path IS NOT NULL
         GROUP BY project_path
         ORDER BY SUM(CAST(cost_usd AS REAL)) DESC
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Walk `project_path` (depth-capped, file-capped) and count source
/// file extensions. Skips obvious noise dirs.
fn extension_counts(project_path: &Path) -> std::collections::HashMap<String, usize> {
    let mut counts = std::collections::HashMap::<String, usize>::new();
    let mut seen = 0usize;
    for entry in WalkDir::new(project_path)
        .max_depth(MAX_WALK_DEPTH)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !matches!(
                name.as_ref(),
                "node_modules"
                    | ".git"
                    | "target"
                    | "dist"
                    | "build"
                    | ".venv"
                    | "venv"
                    | "__pycache__"
                    | ".next"
                    | ".cache"
            )
        })
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }
        if let Some(ext) = entry.path().extension().and_then(|e| e.to_str()) {
            *counts.entry(ext.to_lowercase()).or_default() += 1;
        }
        seen += 1;
        if seen >= MAX_WALK_FILES {
            break;
        }
    }
    counts
}

/// Maps extension → (species id, emoji, friendly language label).
fn classify_extension(ext: &str) -> Option<(&'static str, &'static str, &'static str)> {
    match ext {
        "rs" => Some(("crab", "🦀", "Rust")),
        "go" => Some(("gopher", "🐹", "Go")),
        "py" | "pyi" => Some(("snake", "🐍", "Python")),
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" => Some(("fox", "🦊", "JavaScript/TypeScript")),
        "swift" => Some(("other", "🦅", "Swift")),
        "java" | "kt" | "kts" => Some(("other", "☕", "Java/Kotlin")),
        "c" | "h" | "cpp" | "cc" | "hpp" | "hh" | "cxx" => Some(("other", "🦫", "C/C++")),
        _ => None,
    }
}

pub async fn compute(pool: &SqlitePool) -> Result<SpeciesStatus, sqlx::Error> {
    let Some((project, tokens)) = top_project(pool).await? else {
        return Ok(SpeciesStatus::cat(None, 0, None));
    };

    if tokens < TOKEN_THRESHOLD {
        return Ok(SpeciesStatus::cat(Some(project), tokens, None));
    }

    let path = Path::new(&project);
    if !path.exists() {
        // Project path was renamed or removed; we can't classify the
        // language so we stay with the friendly default.
        return Ok(SpeciesStatus::cat(Some(project), tokens, None));
    }

    let ext_counts = extension_counts(path);
    let total_classified: usize = ext_counts
        .iter()
        .filter_map(|(ext, n)| classify_extension(ext).map(|_| *n))
        .sum();
    if total_classified == 0 {
        return Ok(SpeciesStatus::cat(Some(project), tokens, None));
    }

    // Sum counts per family, then pick the dominant one (>30 %).
    let mut family_counts =
        std::collections::HashMap::<&'static str, (usize, &'static str, &'static str)>::new();
    for (ext, n) in &ext_counts {
        if let Some((sp, emoji, lang)) = classify_extension(ext) {
            let entry = family_counts.entry(sp).or_insert((0, emoji, lang));
            entry.0 += n;
        }
    }
    let Some((&sp, &(count, emoji, lang))) =
        family_counts.iter().max_by_key(|(_, v)| v.0)
    else {
        return Ok(SpeciesStatus::cat(Some(project), tokens, None));
    };
    let pct = (count as f64) * 100.0 / (total_classified as f64);
    if pct < DOMINANCE_PCT {
        return Ok(SpeciesStatus::cat(Some(project), tokens, None));
    }

    Ok(SpeciesStatus {
        species: sp,
        emoji,
        language: Some(lang.to_string()),
        top_project: Some(project),
        total_tokens: tokens,
        lock_progress: 1.0,
    })
}
