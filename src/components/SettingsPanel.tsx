import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { formatModel } from "../lib/format";
import type {
  PricingEntry,
  SettingsBundle,
  SourceStatus,
} from "../lib/dataTypes";

const DEFAULT_MUTE_FROM = "22:00";
const DEFAULT_MUTE_TO = "09:00";

interface Props {
  highlightBudget: boolean;
}

export function SettingsPanel({ highlightBudget }: Props) {
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);
  const [pricing, setPricing] = useState<PricingEntry[]>([]);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [dirInput, setDirInput] = useState<string>("");
  const [budgetInput, setBudgetInput] = useState<string>("");
  const [muteFrom, setMuteFrom] = useState<string>(DEFAULT_MUTE_FROM);
  const [muteTo, setMuteTo] = useState<string>(DEFAULT_MUTE_TO);
  const [savingDir, setSavingDir] = useState(false);
  const [dirErr, setDirErr] = useState<string | null>(null);
  const [savingBudget, setSavingBudget] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const budgetInputRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    try {
      const [b, p, src] = await Promise.all([
        invoke<SettingsBundle>("get_settings"),
        invoke<PricingEntry[]>("get_pricing_config"),
        invoke<SourceStatus[]>("detected_sources"),
      ]);
      setBundle(b);
      setPricing(p);
      setSources(src);
      setDirInput(b.claude_code_data_dir ?? "");
      setBudgetInput(
        b.monthly_budget_usd != null ? `${b.monthly_budget_usd}` : "",
      );
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

  useEffect(() => {
    if (highlightBudget && budgetInputRef.current) {
      budgetInputRef.current.focus();
      budgetInputRef.current.select();
    }
  }, [highlightBudget]);

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

  async function handleSaveBudget() {
    setSavingBudget(true);
    try {
      const n = Number.parseFloat(budgetInput);
      const value = Number.isFinite(n) && n >= 0 ? n : 0;
      await invoke("set_settings", {
        patch: { monthly_budget_usd: value },
      });
      // v1.3 hardening — let the pet window know so the L1 colour
      // tone updates immediately instead of waiting for the next
      // 60s poll. Otherwise a fresh budget edit feels broken.
      void emit("settings:budget-changed", { monthly_budget_usd: value });
      await reload();
      flash("Budget saved.");
    } catch (err) {
      console.error("[settings] save budget", err);
      flash(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingBudget(false);
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

  async function handlePricingEdit(
    entry: PricingEntry,
    field: keyof PricingEntry,
    value: string,
  ) {
    const updated = { ...entry, [field]: value };
    setPricing((rows) =>
      rows.map((r) =>
        r.model === entry.model && r.endpoint_id === entry.endpoint_id
          ? updated
          : r,
      ),
    );
  }

  async function handlePricingSave(entry: PricingEntry) {
    // v1.3 hardening — frontend validation. We accept decimal strings
    // and write them as-is; reject anything that wouldn't parse to a
    // finite, non-negative number. Backend stores as TEXT so this is
    // the gate that prevents `cost_usd` calculations from later
    // exploding.
    const fields: Array<{ key: keyof PricingEntry; label: string }> = [
      { key: "input_per_mtok", label: "input" },
      { key: "output_per_mtok", label: "output" },
      { key: "cache_read_per_mtok", label: "cache read" },
      { key: "cache_write_per_mtok", label: "cache write" },
    ];
    for (const { key, label } of fields) {
      const raw = entry[key];
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (trimmed === "") {
        flash(`${label} price cannot be empty.`);
        return;
      }
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) {
        flash(`${label} price must be a non-negative number (got "${raw}").`);
        return;
      }
    }
    try {
      await invoke("set_pricing_entry", { entry });
      flash(`Saved ${formatModel(entry.model)}.`);
    } catch (err) {
      console.error("[settings] save pricing", err);
      flash(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
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
        title="Monthly budget"
        hint="Drives the pet's color tone (50/80/100% thresholds)."
      >
        <div className="sp-row">
          <span className="sp-prefix">$</span>
          <input
            ref={budgetInputRef}
            type="number"
            min={0}
            step={5}
            className="sp-input sp-input-num"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            placeholder="200"
          />
          <span className="sp-suffix">USD / month</span>
          <button
            type="button"
            className="sp-btn"
            onClick={() => void handleSaveBudget()}
            disabled={savingBudget}
          >
            {savingBudget ? "Saving…" : "Save"}
          </button>
        </div>
      </Section>

      <Section
        title="Pricing"
        hint="Built-in Anthropic prices ship by default. Override here to track third-party endpoints."
      >
        <div className="sp-pricing">
          <div className="sp-pricing-head">
            <span>Model</span>
            <span>Endpoint</span>
            <span>Input</span>
            <span>Output</span>
            <span>Cache R</span>
            <span>Cache W</span>
            <span></span>
          </div>
          {pricing.map((entry) => (
            <div
              key={`${entry.model}::${entry.endpoint_id}`}
              className="sp-pricing-row"
            >
              <span className="sp-pricing-model">
                {formatModel(entry.model)}
              </span>
              <span className="sp-pricing-endpoint">
                {entry.endpoint_id || "—"}
              </span>
              <PriceInput
                value={entry.input_per_mtok}
                onChange={(v) =>
                  void handlePricingEdit(entry, "input_per_mtok", v)
                }
              />
              <PriceInput
                value={entry.output_per_mtok}
                onChange={(v) =>
                  void handlePricingEdit(entry, "output_per_mtok", v)
                }
              />
              <PriceInput
                value={entry.cache_read_per_mtok}
                onChange={(v) =>
                  void handlePricingEdit(entry, "cache_read_per_mtok", v)
                }
              />
              <PriceInput
                value={entry.cache_write_per_mtok}
                onChange={(v) =>
                  void handlePricingEdit(entry, "cache_write_per_mtok", v)
                }
              />
              <button
                type="button"
                className="sp-btn sp-btn-tiny"
                onClick={() => void handlePricingSave(entry)}
              >
                Save
              </button>
            </div>
          ))}
          {pricing.length === 0 ? (
            <p className="sp-empty">Pricing seed not loaded yet.</p>
          ) : null}
          <p className="sp-hint">
            Prices are USD per million tokens. Empty endpoint = official
            Anthropic API.
          </p>
        </div>
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

function PriceInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      className="sp-input sp-input-price"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
