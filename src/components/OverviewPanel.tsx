import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type {
  GroupRow,
  SessionRow,
  SettingsBundle,
  TimeseriesPoint,
  TokenSummary,
} from "../lib/dataTypes";
import { GrowthSection } from "./GrowthSection";
import {
  formatCost,
  formatModel,
  formatPercentDelta,
  formatTimeHM,
  formatTokens,
  percentChange,
  shortProjectPath,
  todayDateLabel,
} from "../lib/format";

interface OverviewState {
  today: TokenSummary | null;
  // For yesterday compare we use the week timeseries' daily buckets.
  weekSeries: TimeseriesPoint[];
  todaySeries: TimeseriesPoint[];
  bySource: GroupRow[];
  byModel: GroupRow[];
  recent: SessionRow[];
  settings: SettingsBundle | null;
  loading: boolean;
  err: string | null;
}

const EMPTY: OverviewState = {
  today: null,
  weekSeries: [],
  todaySeries: [],
  bySource: [],
  byModel: [],
  recent: [],
  settings: null,
  loading: true,
  err: null,
};

const REFRESH_MS = 60_000;

interface Props {
  onJumpToBudget: () => void;
}

export function OverviewPanel({ onJumpToBudget }: Props) {
  const [s, setS] = useState<OverviewState>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const load = async () => {
      try {
        const [
          today,
          weekSeries,
          todaySeries,
          bySource,
          byModel,
          recent,
          settings,
        ] = await Promise.all([
          invoke<TokenSummary>("token_summary", { period: "today" }),
          invoke<TimeseriesPoint[]>("token_timeseries", { period: "week" }),
          invoke<TimeseriesPoint[]>("token_timeseries", { period: "today" }),
          invoke<GroupRow[]>("token_by_source", { period: "today" }),
          invoke<GroupRow[]>("token_by_model", { period: "today" }),
          invoke<SessionRow[]>("recent_sessions", { limit: 5 }),
          invoke<SettingsBundle>("get_settings"),
        ]);
        if (cancelled) return;
        setS({
          today,
          weekSeries,
          todaySeries,
          bySource,
          byModel,
          recent,
          settings,
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
  }, []);

  const yesterday = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const key = d.toISOString().slice(0, 10);
    return s.weekSeries.find((p) => p.bucket === key) ?? null;
  }, [s.weekSeries]);

  // Month spend for budget bar (separate IPC, refreshed on load).
  const [monthCost, setMonthCost] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const month = await invoke<TokenSummary>("token_summary", {
          period: "month",
        });
        if (cancelled) return;
        setMonthCost(Number.parseFloat(month.total_cost_usd) || 0);
      } catch (err) {
        console.error("[overview] month summary failed", err);
      }
    };
    void load();
    const t = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  if (s.err) {
    return (
      <section className="ov-error">
        <p>Failed to load overview: {s.err}</p>
      </section>
    );
  }

  const todayTokens =
    s.today != null ? s.today.total_input + s.today.total_output : 0;
  const todayCost = s.today ? Number.parseFloat(s.today.total_cost_usd) : 0;
  const yTokens = yesterday?.tokens ?? 0;
  const yCost = yesterday ? Number.parseFloat(yesterday.cost_usd) : 0;
  const tokenDelta = percentChange(todayTokens, yTokens);
  const costDelta = percentChange(todayCost, yCost);

  return (
    <div className="ov-root">
      <header className="ov-header">
        <div>
          <span className="ov-eyebrow">Today</span>
          <h2 className="ov-title">Notchi</h2>
        </div>
        <span className="ov-date">{todayDateLabel()}</span>
      </header>

      <div className="ov-cards">
        <Card
          label="Tokens"
          value={formatTokens(todayTokens)}
          delta={tokenDelta}
        />
        <Card label="Cost" value={formatCost(todayCost)} delta={costDelta} />
        <Card
          label="Sessions"
          value={s.today ? `${s.today.session_count}` : "—"}
        />
        <Card
          label="Top model"
          value={formatModel(s.today?.dominant_model ?? null)}
          mono={false}
        />
      </div>

      <section className="ov-section">
        <header className="ov-section-head">
          <h3>Hourly distribution</h3>
          <span className="ov-pill is-active">Today</span>
          <span className="ov-pill is-disabled" title="Coming in v1.x">
            Week
          </span>
          <span className="ov-pill is-disabled" title="Coming in v1.x">
            Month
          </span>
        </header>
        <HourlyChart series={s.todaySeries} />
      </section>

      <div className="ov-grid-2">
        <section className="ov-section">
          <header className="ov-section-head">
            <h3>By tool</h3>
          </header>
          <BarList rows={s.bySource} formatKey={(k) => k} />
        </section>
        <section className="ov-section">
          <header className="ov-section-head">
            <h3>By model</h3>
          </header>
          <BarList rows={s.byModel} formatKey={(k) => formatModel(k)} />
        </section>
      </div>

      <section className="ov-section">
        <header className="ov-section-head">
          <h3>Monthly budget</h3>
          <button
            type="button"
            className="ov-link-btn"
            onClick={onJumpToBudget}
          >
            Edit
          </button>
        </header>
        <BudgetBar
          spentUsd={monthCost}
          budgetUsd={s.settings?.monthly_budget_usd ?? null}
        />
      </section>

      <section className="ov-section">
        <header className="ov-section-head">
          <h3>Recent sessions</h3>
          <span className="ov-section-aside">Last {s.recent.length}</span>
        </header>
        <RecentSessions rows={s.recent} />
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
}: {
  label: string;
  value: string;
  delta?: number | null;
  mono?: boolean;
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
    </div>
  );
}

function HourlyChart({ series }: { series: TimeseriesPoint[] }) {
  // Densify to 24 hour buckets so the chart is always fully populated;
  // missing hours render as 0 bars.
  const data = useMemo(() => {
    const byHour = new Map<number, number>();
    for (const p of series) {
      const h = new Date(p.bucket).getHours();
      byHour.set(h, (byHour.get(h) ?? 0) + p.tokens);
    }
    return Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      tokens: byHour.get(i) ?? 0,
    }));
  }, [series]);

  return (
    <div className="ov-chart-wrap">
      <ResponsiveContainer width="100%" height={88}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <XAxis
            dataKey="hour"
            tick={{ fontSize: 10, fill: "var(--ov-axis)" }}
            tickLine={false}
            axisLine={false}
            interval={5}
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
            labelFormatter={(h) => `${String(h).padStart(2, "0")}:00`}
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
}: {
  rows: GroupRow[];
  formatKey: (k: string) => string;
}) {
  if (rows.length === 0) {
    return <p className="ov-empty">No data yet today.</p>;
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

function BudgetBar({
  spentUsd,
  budgetUsd,
}: {
  spentUsd: number;
  budgetUsd: number | null;
}) {
  if (!budgetUsd || budgetUsd <= 0) {
    return (
      <p className="ov-empty">
        Set a monthly budget to track spend visually on the pet.
      </p>
    );
  }
  const pct = Math.min(1.5, spentUsd / budgetUsd); // allow 150% overspend
  const tone =
    pct < 0.5 ? "ok" : pct < 0.8 ? "warn" : pct < 1.0 ? "hot" : "over";
  return (
    <div className={"ov-budget tone-" + tone}>
      <div className="ov-budget-track" aria-hidden="true">
        <div
          className="ov-budget-fill"
          style={{ width: `${Math.min(100, pct * 100)}%` }}
        />
      </div>
      <span className="ov-budget-text">
        {formatCost(spentUsd)} / {formatCost(budgetUsd)}
      </span>
    </div>
  );
}

function RecentSessions({ rows }: { rows: SessionRow[] }) {
  if (rows.length === 0) {
    return <p className="ov-empty">No sessions yet today.</p>;
  }
  return (
    <table className="ov-table">
      <tbody>
        {rows.map((r) => (
          <tr key={r.session_id}>
            <td className="ov-td-time">{formatTimeHM(r.started_at)}</td>
            <td className="ov-td-project">
              {shortProjectPath(r.project_path)}
            </td>
            <td className="ov-td-tokens">{formatTokens(r.total_tokens)}</td>
            <td className="ov-td-cost">{formatCost(r.cost_usd)}</td>
            <td className="ov-td-model">{formatModel(r.model)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
