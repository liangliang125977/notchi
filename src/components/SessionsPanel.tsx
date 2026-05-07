import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Period, SessionRow } from "../lib/dataTypes";
import {
  formatModel,
  formatTimeHM,
  formatTokens,
  shortProjectPath,
} from "../lib/format";
import { useT } from "../hooks/useT";

// SPEC §3 v1.2 — full session browser. Lists up to 50 sessions for
// the chosen window. Backend caps "All" at 30 days for v1.2 scope;
// the chip still says "All" so we don't lie to the user but render a
// foot-note hint instead.

type FilterPeriod = Period | "all";

const ROW_LIMIT = 50;

interface State {
  rows: SessionRow[];
  loading: boolean;
  err: string | null;
}

export function SessionsPanel() {
  const t = useT();

  const FILTER_OPTIONS: ReadonlyArray<{ id: FilterPeriod; label: string }> = [
    { id: "today", label: t.period.today },
    { id: "week", label: t.period.week },
    { id: "month", label: t.period.month },
    { id: "all", label: t.period.all },
  ];

  const [period, setPeriod] = useState<FilterPeriod>("week");
  const [query, setQuery] = useState("");
  const [s, setS] = useState<State>({ rows: [], loading: true, err: null });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setS((prev) => ({ ...prev, loading: true }));
      try {
        const rows = await invoke<SessionRow[]>("recent_sessions", {
          limit: ROW_LIMIT,
          period,
        });
        if (cancelled) return;
        setS({ rows, loading: false, err: null });
      } catch (err) {
        if (cancelled) return;
        setS({ rows: [], loading: false, err: String(err) });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [period]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return s.rows;
    return s.rows.filter((r) =>
      (r.project_path ?? "").toLowerCase().includes(q),
    );
  }, [s.rows, query]);

  return (
    <div className="sx-root">
      <header className="sx-head">
        <div className="sx-head-row">
          <input
            type="search"
            className="sx-search"
            placeholder="Filter project path…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="sx-period">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={
                  "ov-pill ov-pill-btn" +
                  (opt.id === period ? " is-active" : "")
                }
                aria-pressed={opt.id === period}
                onClick={() => setPeriod(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <p className="sx-foot">
          {t.sessions.showing(
            filtered.length,
            s.rows.length,
            period === "all" ? t.sessions.last30days : t.period[period],
          )}
        </p>
      </header>

      {s.err ? (
        <p className="ov-error">{t.sessions.failedToLoad(s.err)}</p>
      ) : s.loading && s.rows.length === 0 ? (
        <p className="ov-empty">{t.sessions.loadingsessions}</p>
      ) : filtered.length === 0 ? (
        <p className="ov-empty">{t.sessions.noMatch}</p>
      ) : (
        <SessionTable rows={filtered} t={t} />
      )}
    </div>
  );
}

function SessionTable({ rows, t }: { rows: SessionRow[]; t: ReturnType<typeof useT> }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <table className="sx-table">
      <thead>
        <tr>
          <th>{t.sessions.colTime}</th>
          <th>{t.sessions.colProject}</th>
          <th>{t.sessions.colModel}</th>
          <th className="sx-num">{t.sessions.colTokens}</th>
          <th>{t.sessions.colSource}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const isOpen = expanded === r.session_id;
          return (
            <SessionRowView
              key={r.session_id}
              row={r}
              expanded={isOpen}
              onToggle={() => setExpanded(isOpen ? null : r.session_id)}
              t={t}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function SessionRowView({
  row,
  expanded,
  onToggle,
  t,
}: {
  row: SessionRow;
  expanded: boolean;
  onToggle: () => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <>
      <tr
        className={"sx-row" + (expanded ? " is-open" : "")}
        onClick={onToggle}
      >
        <td className="sx-td-time">
          <span className="sx-date">{shortDate(row.started_at)}</span>
          <span className="sx-time">{formatTimeHM(row.started_at)}</span>
        </td>
        <td className="sx-td-project" title={row.project_path ?? ""}>
          {shortProjectPath(row.project_path)}
        </td>
        <td className="sx-td-model">{formatModel(row.model)}</td>
        <td className="sx-num">{formatTokens(row.total_tokens)}</td>
        <td className="sx-td-source">{row.source}</td>
      </tr>
      {expanded ? (
        <tr className="sx-row-detail">
          <td colSpan={5}>
            <dl className="sx-detail">
              <div>
                <dt>{t.sessions.detailSessionId}</dt>
                <dd className="is-mono">{row.session_id}</dd>
              </div>
              <div>
                <dt>{t.sessions.detailProject}</dt>
                <dd className="is-mono">{row.project_path ?? "—"}</dd>
              </div>
              <div>
                <dt>{t.sessions.detailStarted}</dt>
                <dd>{row.started_at}</dd>
              </div>
            </dl>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return "—";
  }
}
