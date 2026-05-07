import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import type { SettingsBundle, SourceStatus } from "../lib/dataTypes";

const DEFAULT_MUTE_FROM = "22:00";
const DEFAULT_MUTE_TO = "09:00";

export function SettingsPanel() {
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [dirInput, setDirInput] = useState<string>("");
  const [muteFrom, setMuteFrom] = useState<string>(DEFAULT_MUTE_FROM);
  const [muteTo, setMuteTo] = useState<string>(DEFAULT_MUTE_TO);
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
      flash("Data folder updated.");
    } catch (err) {
      setDirErr(String(err));
    } finally {
      setSavingDir(false);
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
      // Tell the pet window to refresh its in-memory mute schedule
      // (T3.4 — bubbles read from petStore which mirrors these values).
      void emit("settings:mute-changed", {
        mute_window_start: muteFrom,
        mute_window_end: muteTo,
      });
      flash("Quiet hours saved.");
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
      flash("All data cleared.");
    } catch (err) {
      console.error("[settings] clear failed", err);
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="sp-root">
      {statusMsg ? <div className="sp-toast">{statusMsg}</div> : null}

      <Section
        title="Data folder"
        hint="Notchi watches this directory recursively for *.jsonl writes."
      >
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
            {savingDir ? "Saving…" : "Apply"}
          </button>
        </div>
        {dirErr ? <p className="sp-err">{dirErr}</p> : null}
        {bundle && !bundle.claude_code_found ? (
          <p className="sp-warn">
            Claude Code not auto-detected. Paste the absolute path to your
            <code> ~/.claude/projects </code>folder above.
          </p>
        ) : null}
      </Section>

      <Section
        title="Data sources"
        hint="AI tools Notchi has detected on this Mac. Each runs its own watcher and dedupes against the same SQLite cache."
      >
        {sources.length === 0 ? (
          <p className="sp-empty">
            No data sources detected yet. Notchi auto-discovers Claude Code (
            <code>~/.claude/projects</code>) and Codex CLI (
            <code>~/.codex/sessions</code>) on launch.
          </p>
        ) : (
          <ul className="sp-source-list">
            {sources.map((s) => (
              <li key={s.name} className="sp-source-row">
                <span className="sp-source-name">
                  {formatSourceName(s.name)}
                </span>
                <span className="sp-source-stat">
                  {s.events_count.toLocaleString()} events
                </span>
                <span className="sp-source-stat">
                  {s.last_ingest_at
                    ? `ingested ${new Date(s.last_ingest_at).toLocaleTimeString()}`
                    : "idle"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Quiet hours"
        hint="Bubbles are suppressed during this window. macOS notifications are unaffected — adjust those independently in System Settings → Notifications."
      >
        <div className="sp-row">
          <label className="sp-time-label">
            From
            <input
              type="time"
              className="sp-input sp-input-time"
              value={muteFrom}
              onChange={(e) => setMuteFrom(e.target.value)}
            />
          </label>
          <label className="sp-time-label">
            To
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
            Save
          </button>
        </div>
      </Section>

      <Section
        title="Danger zone"
        hint="Wipes the local events table. Notchi will rebuild from existing jsonl files automatically."
      >
        {!confirmClear ? (
          <button
            type="button"
            className="sp-btn sp-btn-danger"
            onClick={() => setConfirmClear(true)}
          >
            Clear all data…
          </button>
        ) : (
          <div className="sp-confirm">
            <p>This will permanently delete the local SQLite cache.</p>
            <div className="sp-row">
              <button
                type="button"
                className="sp-btn"
                onClick={() => setConfirmClear(false)}
                disabled={clearing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sp-btn sp-btn-danger"
                onClick={() => void handleClearAll()}
                disabled={clearing}
              >
                {clearing ? "Clearing…" : "Yes, clear everything"}
              </button>
            </div>
          </div>
        )}
      </Section>

      <Section title="About">
        <ul className="sp-meta">
          <li>
            <span>Version</span>
            <strong>0.1.0 (T2 MVP)</strong>
          </li>
          <li>
            <span>Privacy</span>
            <strong>
              Nothing leaves this Mac. No telemetry, no uploads, ever.
            </strong>
          </li>
          <li>
            <span>Spec</span>
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
