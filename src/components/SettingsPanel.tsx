import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import type { SettingsBundle, SourceStatus } from "../lib/dataTypes";
import { useT } from "../hooks/useT";
import { useLangStore } from "../stores/langStore";
import type { Locale } from "../lib/locales";

const DEFAULT_MUTE_FROM = "22:00";
const DEFAULT_MUTE_TO = "09:00";

export function SettingsPanel() {
  const t = useT();
  const locale = useLangStore((s) => s.locale);
  const setLocale = useLangStore((s) => s.setLocale);

  const [bundle, setBundle] = useState<SettingsBundle | null>(null);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [dirInput, setDirInput] = useState<string>("");
  const [muteFrom, setMuteFrom] = useState<string>(DEFAULT_MUTE_FROM);
  const [muteTo, setMuteTo] = useState<string>(DEFAULT_MUTE_TO);
  const [budget, setBudget] = useState<number>(50);
  const [savingDir, setSavingDir] = useState(false);
  const [dirErr, setDirErr] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [b, src] = await Promise.all([
        invoke<SettingsBundle>("get_settings"),
        invoke<SourceStatus[]>("detected_sources"),
      ]);
      setBundle(b);
      setSources(src);
      setDirInput(b.claude_code_data_dir ?? "");
      setMuteFrom(b.mute_window_start ?? DEFAULT_MUTE_FROM);
      setMuteTo(b.mute_window_end ?? DEFAULT_MUTE_TO);
      // Load monthly budget from a separate settings command since it
      // is not part of the existing SettingsBundle shape (added v0.2).
      try {
        const br = await invoke<{ usd_budget_month: number }>("burn_rate_now");
        if (br && typeof br.usd_budget_month === "number") {
          setBudget(br.usd_budget_month);
        }
      } catch {
        /* burn_rate_now may fail on cold start; default 50 stays */
      }
    } catch (err) {
      console.error("[settings] reload failed", err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await reload();
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const flash = (msg: string) => {
    setStatusMsg(msg);
    window.setTimeout(() => setStatusMsg(null), 1800);
  };

  async function handleSaveDir() {
    if (!dirInput.trim()) return;
    setSavingDir(true);
    setDirErr(null);
    try {
      await invoke("set_claude_code_data_dir", { path: dirInput.trim() });
      await reload();
      flash(t.settings.dataFolderUpdated);
    } catch (err) {
      setDirErr(String(err));
    } finally {
      setSavingDir(false);
    }
  }

  async function handleSaveBudget() {
    try {
      await invoke("set_monthly_budget", { usd: budget });
      flash(t.settings.monthlyBudgetSaved);
    } catch (err) {
      console.error("[settings] save budget", err);
    }
  }

  async function handleSaveMute() {
    try {
      await invoke("set_settings", {
        patch: {
          mute_window_start: muteFrom,
          mute_window_end: muteTo,
        },
      });
      void emit("settings:mute-changed", {
        mute_window_start: muteFrom,
        mute_window_end: muteTo,
      });
      flash(t.settings.quietHoursSaved);
    } catch (err) {
      console.error("[settings] save mute", err);
    }
  }

  async function handleClearAll() {
    setClearing(true);
    try {
      await invoke("clear_all_events");
      setConfirmClear(false);
      await reload();
      flash(t.settings.cleared);
    } catch (err) {
      console.error("[settings] clear failed", err);
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="sp-root">
      {statusMsg ? <div className="sp-toast">{statusMsg}</div> : null}

      <Section title={t.settings.dataFolder} hint={t.settings.dataFolderHint}>
        <div className="sp-row">
          <input
            type="text"
            className="sp-input sp-input-flex"
            value={dirInput}
            placeholder="~/.claude/projects"
            onChange={(e) => setDirInput(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <button
            type="button"
            className="sp-btn"
            disabled={savingDir || dirInput.trim().length === 0}
            onClick={() => void handleSaveDir()}
          >
            {savingDir ? t.settings.applying : t.settings.apply}
          </button>
        </div>
        {dirErr ? <p className="sp-err">{dirErr}</p> : null}
        {bundle && !bundle.claude_code_found ? (
          <p className="sp-warn">{t.settings.claudeNotFound}</p>
        ) : null}
      </Section>

      <Section title={t.settings.dataSources} hint={t.settings.dataSourcesHint}>
        {sources.length === 0 ? (
          <p className="sp-empty">{t.settings.noSourcesYet}</p>
        ) : (
          <ul className="sp-source-list">
            {sources.map((s) => (
              <li key={s.name} className="sp-source-row">
                <span className="sp-source-name">
                  {formatSourceName(s.name)}
                </span>
                <span className="sp-source-stat">
                  {t.settings.eventsCount(s.events_count)}
                </span>
                <span className="sp-source-stat">
                  {s.last_ingest_at
                    ? t.settings.ingested(
                        new Date(s.last_ingest_at).toLocaleTimeString(),
                      )
                    : t.settings.idle}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t.settings.quietHours} hint={t.settings.quietHoursHint}>
        <div className="sp-row">
          <label className="sp-time-label">
            {t.settings.from}
            <input
              type="time"
              className="sp-input sp-input-time"
              value={muteFrom}
              onChange={(e) => setMuteFrom(e.target.value)}
            />
          </label>
          <label className="sp-time-label">
            {t.settings.to}
            <input
              type="time"
              className="sp-input sp-input-time"
              value={muteTo}
              onChange={(e) => setMuteTo(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="sp-btn"
            onClick={() => void handleSaveMute()}
          >
            {t.settings.save}
          </button>
        </div>
      </Section>

      <Section
        title={t.settings.monthlyBudget}
        hint={t.settings.monthlyBudgetHint}
      >
        <div className="sp-row">
          <input
            type="number"
            min="0"
            step="5"
            className="sp-input"
            style={{ width: 120 }}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value) || 0)}
          />
          <span className="sp-input-prefix">USD</span>
          <button
            type="button"
            className="sp-btn"
            onClick={() => void handleSaveBudget()}
          >
            {t.settings.save}
          </button>
        </div>
      </Section>

      <Section title={t.settings.language} hint={t.settings.languageHint}>
        <div className="sp-row">
          {(["zh", "en"] as Locale[]).map((lang) => (
            <button
              key={lang}
              type="button"
              className={"sp-chip" + (locale === lang ? " is-active" : "")}
              onClick={() => setLocale(lang)}
            >
              {lang === "zh" ? "中文" : "English"}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t.settings.dangerZone} hint={t.settings.dangerZoneHint}>
        {!confirmClear ? (
          <button
            type="button"
            className="sp-btn sp-btn-danger"
            onClick={() => setConfirmClear(true)}
          >
            {t.settings.clearAll}
          </button>
        ) : (
          <div className="sp-confirm">
            <p>{t.settings.clearConfirm}</p>
            <div className="sp-row">
              <button
                type="button"
                className="sp-btn"
                onClick={() => setConfirmClear(false)}
                disabled={clearing}
              >
                {t.settings.cancel}
              </button>
              <button
                type="button"
                className="sp-btn sp-btn-danger"
                onClick={() => void handleClearAll()}
                disabled={clearing}
              >
                {clearing ? t.settings.clearing : t.settings.yesClear}
              </button>
            </div>
          </div>
        )}
      </Section>

      <Section title={t.settings.about}>
        <ul className="sp-meta">
          <li>
            <span>{t.settings.version}</span>
            <strong>0.1.0 (T2 MVP)</strong>
          </li>
          <li>
            <span>{t.settings.privacy}</span>
            <strong>{t.settings.privacyValue}</strong>
          </li>
          <li>
            <span>{t.settings.spec}</span>
            <strong>SPEC.md §4 / §5 / §6</strong>
          </li>
        </ul>
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="sp-section">
      <header className="sp-section-head">
        <h3>{title}</h3>
        {hint ? <p className="sp-section-hint">{hint}</p> : null}
      </header>
      <div className="sp-section-body">{children}</div>
    </section>
  );
}

function formatSourceName(name: string): string {
  switch (name) {
    case "claude-code":
      return "Claude Code";
    case "codex":
      return "Codex CLI";
    case "opencode":
      return "OpenCode";
    case "cursor":
      return "Cursor";
    default:
      return name;
  }
}
