import { usePetStatus, type Mood } from "../hooks/usePetStatus";

const STAGE_EMOJI: Record<number, string> = {
  0: "🥚",
  1: "🐣",
  2: "✨",
};

const MOOD_EMOJI: Record<Mood, string> = {
  hungry: "😣",
  content: "🙂",
  happy: "😊",
};

const MOOD_LABEL: Record<Mood, string> = {
  hungry: "Hungry",
  content: "Content",
  happy: "Happy",
};

function formatThousands(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}

function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diffMs = Date.now() - t;
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 60) return "just now";
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// v1.1 — Growth panel section. Shows current stage + progress, feed
// level + mood, and the recent feed log. Renders inside OverviewPanel.
export function GrowthSection() {
  const { status, err } = usePetStatus();

  if (err) {
    return (
      <section className="ov-section">
        <header className="ov-section-head">
          <h3>Growth</h3>
        </header>
        <p className="ov-empty">Could not load pet status: {err}</p>
      </section>
    );
  }

  if (!status) {
    return (
      <section className="ov-section">
        <header className="ov-section-head">
          <h3>Growth</h3>
        </header>
        <p className="ov-empty">Loading…</p>
      </section>
    );
  }

  const { evolution, feed_level, mood, recent_feeds } = status;
  const stageEmoji = STAGE_EMOJI[evolution.stage] ?? "🥚";
  const nextLabel =
    evolution.next_threshold != null
      ? `${formatThousands(evolution.total_tokens)} / ${formatThousands(
          evolution.next_threshold,
        )} to ${evolution.stage === 0 ? "Hatchling" : "Adult"}`
      : `Adult · ${formatThousands(evolution.total_tokens)} tokens lifetime`;

  return (
    <section className="ov-section gw-section">
      <header className="ov-section-head">
        <h3>Growth</h3>
      </header>

      <div className="gw-grid">
        <div className="gw-stage">
          <span className="gw-stage-emoji" aria-hidden="true">
            {stageEmoji}
          </span>
          <div className="gw-stage-meta">
            <span className="gw-stage-name">{evolution.name}</span>
            <span className="gw-stage-progress-label">{nextLabel}</span>
            <div className="gw-bar" aria-hidden="true">
              <div
                className="gw-bar-fill"
                style={{
                  width: `${Math.min(100, evolution.progress_pct)}%`,
                }}
              />
            </div>
          </div>
        </div>

        <div className="gw-stat">
          <span className="gw-stat-label">Saturation</span>
          <span className="gw-stat-value">{feed_level} / 100</span>
          <div className="gw-bar" aria-hidden="true">
            <div
              className={"gw-bar-fill gw-bar-feed-" + mood}
              style={{ width: `${Math.min(100, feed_level)}%` }}
            />
          </div>
        </div>

        <div className="gw-stat">
          <span className="gw-stat-label">Mood</span>
          <span className="gw-mood">
            <span aria-hidden="true">{MOOD_EMOJI[mood]}</span>{" "}
            {MOOD_LABEL[mood]}
          </span>
        </div>
      </div>

      <div className="gw-feed-log">
        <span className="gw-feed-log-title">Recent meals</span>
        {recent_feeds.length === 0 ? (
          <p className="ov-empty">
            No meals yet. Each completed task feeds the pet +10.
          </p>
        ) : (
          <ul className="gw-feed-list">
            {recent_feeds.map((entry, i) => (
              <li key={`${entry.at}-${i}`} className="gw-feed-row">
                <span className="gw-feed-time">
                  {formatRelativeTime(entry.at)}
                </span>
                <span className="gw-feed-source">
                  {entry.source ?? "claude-code"}
                </span>
                <span className="gw-feed-model">{entry.model ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
