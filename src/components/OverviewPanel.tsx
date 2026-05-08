import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type {
  GroupRow,
  Period,
  SessionRow,
  TimeseriesPoint,
  TokenSummary,
} from "../lib/dataTypes";
import { GrowthSection } from "./GrowthSection";
import {
  formatModel,
  formatPercent,
  formatPercentDelta,
  formatSavings,
  formatSource,
  formatTimeHM,
  formatTokens,
  percentChange,
  shortProjectPath,
  todayDateLabel,
} from "../lib/format";
import { useT } from "../hooks/useT";

interface OverviewState {
  summary: TokenSummary | null;
  // For yesterday-compare we always pull the week timeseries' daily
  // buckets — independent of the period selection.
  weekSeries: TimeseriesPoint[];
  series: TimeseriesPoint[];
  bySource: GroupRow[];
  byModel: GroupRow[];
  byProject: GroupRow[];
  recent: SessionRow[];
  loading: boolean;
  err: string | null;
}

const EMPTY: OverviewState = {
  summary: null,
  weekSeries: [],
  series: [],
  bySource: [],
  byModel: [],
  byProject: [],
  recent: [],
  loading: true,
  err: null,
};

const REFRESH_MS = 60_000;


export function OverviewPanel() {
  const t = useT();

  const PERIOD_OPTIONS: ReadonlyArray<{ id: Period; label: string }> = [
    { id: "today", label: t.period.today },
    { id: "week", label: t.period.week },
    { id: "month", label: t.period.month },
  ];

  const PERIOD_DIST_TITLE: Record<Period, string> = {
    today: t.overview.hourly,
    week: t.overview.daily7,
    month: t.overview.daily30,
  };

  const PERIOD_EMPTY: Record<Period, string> = {
    today: t.overview.noDataToday,
    week: t.overview.noDataWeek,
    month: t.overview.noDataMonth,
  };

  const [period, setPeriod] = useState<Period>("today");
  const [s, setS] = useState<OverviewState>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const load = async () => {
      // Show a quick loading state when the period changes; the spinner
      // flicker is bounded to <200ms on the worst path because every
      // call hits the local SQLite pool.
      setS((prev) => ({ ...prev, loading: true }));
      try {
        const [summary, series, weekSeries, bySource, byModel, byProject, recent] =
          await Promise.all([
            invoke<TokenSummary>("token_summary", { period }),
            invoke<TimeseriesPoint[]>("token_timeseries", { period }),
            invoke<TimeseriesPoint[]>("token_timeseries", { period: "week" }),
            invoke<GroupRow[]>("token_by_source", { period }),
            invoke<GroupRow[]>("token_by_model", { period }),
            invoke<GroupRow[]>("token_by_project", { period }),
            invoke<SessionRow[]>("recent_sessions", { limit: 5 }),
          ]);
        if (cancelled) return;
        setS({
          summary,
          weekSeries,
          series,
          bySource,
          byModel,
          byProject,
          recent,
          loading: false,
          err: null,
        });
      } catch (err) {
        if (cancelled) return;
        setS((prev) => ({ ...prev, loading: false, err: String(err) }));
      }
    };

    void load();
    timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [period]);

  const yesterday = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const key = d.toISOString().slice(0, 10);
    return s.weekSeries.find((p) => p.bucket === key) ?? null;
  }, [s.weekSeries]);

  if (s.err) {
    return (
      <section className="ov-error">
        <p>{t.overview.failedToLoad(s.err)}</p>
      </section>
    );
  }

  const totalTokens =
    s.summary != null ? s.summary.total_input + s.summary.total_output : 0;
  // Day-over-day delta only makes sense for the Today period.
  const yTokens = yesterday?.tokens ?? 0;
  const tokenDelta =
    period === "today" ? percentChange(totalTokens, yTokens) : undefined;
  const eyebrow =
    period === "today"
      ? t.overview.today
      : period === "week"
        ? t.overview.week
        : t.overview.month;

  const cacheRead = s.summary?.total_cache_read ?? 0;
  const cacheWrite = s.summary?.total_cache_creation ?? 0;

  return (
    <div className="ov-root">
      <header className="ov-header">
        <div>
          <span className="ov-eyebrow">{eyebrow}</span>
          <h2 className="ov-title">Notchi</h2>
        </div>
        <span className="ov-date">{todayDateLabel()}</span>
      </header>

      <div className="ov-cards">
        <Card
          label={t.overview.tokens}
          value={formatTokens(totalTokens)}
          delta={tokenDelta}
          sub={
            cacheRead > 0 || cacheWrite > 0
              ? [
                  { label: t.overview.cacheRead, value: formatTokens(cacheRead) },
                  { label: t.overview.cacheWrite, value: formatTokens(cacheWrite) },
                ]
              : undefined
          }
        />
        <Card
          label={t.overview.sessions}
          value={s.summary ? `${s.summary.session_count}` : "—"}
        />
        <Card
          label={t.overview.topModel}
          value={formatModel(s.summary?.dominant_model ?? null)}
          mono={false}
        />
        <CacheCard summary={s.summary} t={t} />
      </div>

      <section className="ov-section">
        <header className="ov-section-head">
          <h3>{PERIOD_DIST_TITLE[period]}</h3>
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={
                "ov-pill ov-pill-btn" + (opt.id === period ? " is-active" : "")
              }
              aria-pressed={opt.id === period}
              onClick={() => setPeriod(opt.id)}
            >
              {opt.label}
            </button>
          ))}
          {s.loading ? (
            <span className="ov-loading-dot" aria-hidden="true" />
          ) : null}
        </header>
        <DistributionChart period={period} series={s.series} />
      </section>

      <div className="ov-grid-2">
        <section className="ov-section">
          <header className="ov-section-head">
            <h3>{t.overview.byTool}</h3>
          </header>
          <BarList
            rows={s.bySource}
            period={period}
            formatKey={(k) => formatSource(k)}
            emptyText={PERIOD_EMPTY[period]}
          />
        </section>
        <section className="ov-section">
          <header className="ov-section-head">
            <h3>{t.overview.byModel}</h3>
          </header>
          <BarList
            rows={s.byModel}
            period={period}
            formatKey={(k) => formatModel(k)}
            emptyText={PERIOD_EMPTY[period]}
          />
        </section>
      </div>

      <section className="ov-section">
        <header className="ov-section-head">
          <h3>{t.overview.byProject}</h3>
        </header>
        <BarList
          rows={s.byProject}
          period={period}
          formatKey={(k) => shortProjectPath(k)}
          emptyText={PERIOD_EMPTY[period]}
        />
      </section>

      <section className="ov-section">
        <header className="ov-section-head">
          <h3>{t.overview.recentSessions}</h3>
          <span className="ov-section-aside">{t.overview.last(s.recent.length)}</span>
        </header>
        <RecentSessions rows={s.recent} t={t} />
      </section>

      <GrowthSection />
    </div>
  );
}

function Card({
  label,
  value,
  delta,
  mono = true,
  sub,
}: {
  label: string;
  value: string;
  delta?: number | null;
  mono?: boolean;
  sub?: { label: string; value: string }[];
}) {
  return (
    <div className="ov-card">
      <span className="ov-card-label">{label}</span>
      <span className={"ov-card-value " + (mono ? "is-mono" : "")}>
        {value}
      </span>
      {delta !== undefined ? (
        <span
          className={
            "ov-card-delta " +
            (delta == null
              ? "is-flat"
              : delta > 0
                ? "is-up"
                : delta < 0
                  ? "is-down"
                  : "is-flat")
          }
        >
          {formatPercentDelta(delta ?? null)}
        </span>
      ) : null}
      {sub && sub.length > 0 ? (
        <div className="ov-card-sub">
          {sub.map((item) => (
            <span key={item.label} className="ov-card-sub-row">
              <span className="ov-card-sub-label">{item.label}</span>
              <span className="ov-card-sub-value">{item.value}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CacheCard({
  summary,
  t,
}: {
  summary: TokenSummary | null;
  t: ReturnType<typeof useT>;
}) {
  if (!summary) {
    return (
      <div className="ov-card">
        <span className="ov-card-label">{t.overview.cacheEfficiency}</span>
        <span className="ov-card-value is-mono">—</span>
      </div>
    );
  }
  // Weighted hit rate: cache_read / (input + cache_read + cache_creation).
  const totalForHit =
    summary.total_input + summary.total_cache_read + summary.total_cache_creation;
  const hitPct = totalForHit > 0 ? (summary.total_cache_read * 100) / totalForHit : 0;

  return (
    <div className="ov-card">
      <span className="ov-card-label">{t.overview.cacheEfficiency}</span>
      <span className="ov-card-value is-mono">{formatPercent(hitPct)}</span>
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

function DistributionChart({
  period,
  series,
}: {
  period: Period;
  series: TimeseriesPoint[];
}) {
  // Today → 24 hourly buckets. Week → trailing 7 daily buckets.
  // Month → daily buckets from the start of the current calendar
  // month (matches `Period::Month`'s `start of month` lower bound).
  const data = useMemo(() => {
    if (period === "today") {
      const byHour = new Map<number, number>();
      for (const p of series) {
        const h = new Date(p.bucket).getHours();
        byHour.set(h, (byHour.get(h) ?? 0) + p.tokens);
      }
      return Array.from({ length: 24 }, (_, i) => ({
        key: String(i).padStart(2, "0"),
        label: `${String(i).padStart(2, "0")}:00`,
        tokens: byHour.get(i) ?? 0,
      }));
    }

    const byDay = new Map<string, number>();
    for (const p of series) {
      byDay.set(p.bucket, (byDay.get(p.bucket) ?? 0) + p.tokens);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days: { key: string; label: string; tokens: number }[] = [];
    if (period === "week") {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        days.push({
          key,
          label: `${d.getMonth() + 1}/${d.getDate()}`,
          tokens: byDay.get(key) ?? 0,
        });
      }
    } else {
      // month: from the 1st of the current month through today.
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      for (let d = new Date(first); d <= today; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        days.push({
          key,
          label: `${d.getDate()}`,
          tokens: byDay.get(key) ?? 0,
        });
      }
    }
    return days;
  }, [period, series]);

  const xInterval = period === "today" ? 5 : period === "week" ? 0 : 4;

  return (
    <div className="ov-chart-wrap">
      <ResponsiveContainer width="100%" height={88}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--ov-axis)" }}
            tickLine={false}
            axisLine={false}
            interval={xInterval}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            contentStyle={{
              fontSize: 11,
              borderRadius: 8,
              border: "0.5px solid rgba(0,0,0,0.1)",
              backdropFilter: "blur(20px)",
            }}
            formatter={(v) => [formatTokens(Number(v) || 0), "tokens"]}
            labelFormatter={(label) => String(label)}
          />
          <Bar dataKey="tokens" fill="var(--ov-accent)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function BarList({
  rows,
  formatKey,
  emptyText,
}: {
  rows: GroupRow[];
  period: Period;
  formatKey: (k: string) => string;
  emptyText: string;
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
        </li>
      ))}
    </ul>
  );
}

function RecentSessions({
  rows,
  t,
}: {
  rows: SessionRow[];
  t: ReturnType<typeof useT>;
}) {
  if (rows.length === 0) {
    return <p className="ov-empty">No recent sessions.</p>;
  }
  return (
    <table className="ov-table">
      <thead>
        <tr>
          <th className="ov-th">{t.overview.colTime}</th>
          <th className="ov-th">{t.overview.colProject}</th>
          <th className="ov-th ov-td-tokens">{t.overview.colTokens}</th>
          <th className="ov-th">{t.overview.colModel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.session_id}>
            <td className="ov-td-time">{formatTimeHM(r.started_at)}</td>
            <td className="ov-td-project">
              {shortProjectPath(r.project_path)}
            </td>
            <td className="ov-td-tokens">{formatTokens(r.total_tokens)}</td>
            <td className="ov-td-model">{formatModel(r.model)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
