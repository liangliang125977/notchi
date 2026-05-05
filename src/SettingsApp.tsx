import { useCallback, useEffect, useState } from "react";
import { load, type Store } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  PET_ACTIONS,
  PET_FORCE_FALLBACK_EVENT,
  PET_RENDER_MODE_EVENT,
  PET_SET_ACTION_EVENT,
  type PetAction,
  type PetRenderMode,
  type PetRenderModePayload,
  type PetSetActionPayload,
} from "./stores/petStore";

type IngestStatus = {
  events_count: number;
  jsonl_files_watched: number;
  last_ingest_at: string | null;
  errors_today: number;
  claude_code_data_dir: string | null;
  claude_code_found: boolean;
};

type TokenSummary = {
  total_input: number;
  total_output: number;
  total_cache_read: number;
  total_cache_creation: number;
  total_cost_usd: string;
  session_count: number;
  dominant_model: string | null;
};

type NotchMode = "auto" | "force-notch" | "force-no-notch";

const NOTCH_MODE_KEY = "notchMode";
const STORE_PATH = "settings.json";
const DEFAULT_MODE: NotchMode = "auto";

const NOTCH_MODE_OPTIONS: ReadonlyArray<{ value: NotchMode; label: string }> = [
  { value: "auto", label: "自动检测（推荐）" },
  { value: "force-notch", label: "强制按有刘海定位" },
  { value: "force-no-notch", label: "强制按无刘海定位" },
];

const PET_ACTION_LABELS: Record<PetAction, string> = {
  idle: "Idle",
  coding: "Coding",
  waiting: "Waiting",
  done: "Done",
  sleep: "Sleep",
};

function SettingsApp() {
  const [store, setStore] = useState<Store | null>(null);
  const [mode, setMode] = useState<NotchMode>(DEFAULT_MODE);
  const [ready, setReady] = useState(false);
  const [activeAction, setActiveAction] = useState<PetAction>("idle");
  const [renderMode, setRenderMode] = useState<PetRenderMode>("live2d");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await load(STORE_PATH, {
          defaults: { [NOTCH_MODE_KEY]: DEFAULT_MODE },
          autoSave: true,
        });
        const stored = await s.get<NotchMode>(NOTCH_MODE_KEY);
        if (cancelled) return;
        setStore(s);
        setMode(stored ?? DEFAULT_MODE);
        setReady(true);
      } catch (err) {
        console.error("[settings] failed to load store", err);
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        unlisten = await listen<PetRenderModePayload>(
          PET_RENDER_MODE_EVENT,
          (event) => {
            const next = event.payload?.renderMode;
            if (next) setRenderMode(next);
          },
        );
      } catch (err) {
        console.error("[settings] failed to subscribe to render mode", err);
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  async function handleNotchModeChange(next: NotchMode) {
    setMode(next);
    if (!store) return;
    try {
      await store.set(NOTCH_MODE_KEY, next);
    } catch (err) {
      console.error("[settings] failed to persist notchMode", err);
    }
  }

  async function handleActionClick(action: PetAction) {
    setActiveAction(action);
    try {
      const payload: PetSetActionPayload = { action };
      await emit(PET_SET_ACTION_EVENT, payload);
    } catch (err) {
      console.error("[settings] failed to emit pet action", err);
    }
  }

  async function handleForceFallback() {
    try {
      await emit(PET_FORCE_FALLBACK_EVENT);
    } catch (err) {
      console.error("[settings] failed to emit force-fallback", err);
    }
  }

  const isDev = import.meta.env.DEV;
  const [ingestStatus, setIngestStatus] = useState<IngestStatus | null>(null);
  const [todaySummary, setTodaySummary] = useState<TokenSummary | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const refreshDataPanel = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      const [status, summary] = await Promise.all([
        invoke<IngestStatus>("ingest_status"),
        invoke<TokenSummary>("token_summary", { period: "today" }),
      ]);
      setIngestStatus(status);
      setTodaySummary(summary);
    } catch (err) {
      setDataError(String(err));
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isDev) return;
    let cancelled = false;
    (async () => {
      try {
        const [status, summary] = await Promise.all([
          invoke<IngestStatus>("ingest_status"),
          invoke<TokenSummary>("token_summary", { period: "today" }),
        ]);
        if (cancelled) return;
        setIngestStatus(status);
        setTodaySummary(summary);
      } catch (err) {
        if (!cancelled) setDataError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDev]);

  return (
    <main className="settings-window">
      <h1>Notchi 设置</h1>

      {renderMode === "fallback" ? (
        <section className="settings-section">
          <div className="settings-banner settings-banner--warn" role="alert">
            <span className="settings-banner-icon" aria-hidden="true">
              ⚠️
            </span>
            <span>
              Live2D 加载失败，已降级为静态图。请重启应用，或检查控制台日志。
            </span>
          </div>
        </section>
      ) : null}

      <section className="settings-section">
        <label className="settings-field" htmlFor="notch-mode">
          <span className="settings-field-label">刘海模式</span>
          <select
            id="notch-mode"
            className="settings-select"
            value={mode}
            disabled={!ready}
            onChange={(e) => handleNotchModeChange(e.target.value as NotchMode)}
          >
            {NOTCH_MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <p className="settings-hint">改动将在下次启动 Notchi 时生效。</p>
      </section>

      {import.meta.env.DEV ? (
        <section className="settings-section">
          <span className="settings-field-label">动作调试（dev only）</span>
          <div className="action-debug-row">
            {PET_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                className={
                  "action-debug-btn" +
                  (action === activeAction ? " is-active" : "")
                }
                onClick={() => handleActionClick(action)}
              >
                {PET_ACTION_LABELS[action]}
              </button>
            ))}
          </div>
          <p className="settings-hint">
            通过 Tauri event 触发宠物窗口动作切换；生产构建不会出现。
          </p>
        </section>
      ) : null}

      {import.meta.env.DEV ? (
        <section className="settings-section">
          <span className="settings-field-label">渲染降级（dev only）</span>
          <div className="action-debug-row">
            <button
              type="button"
              className="action-debug-btn"
              disabled={renderMode === "fallback"}
              onClick={handleForceFallback}
            >
              强制降级（dev only）
            </button>
          </div>
          <p className="settings-hint">
            手动触发 SPEC §4 S15 路径；当前渲染模式：
            <strong>
              {" "}
              {renderMode === "fallback" ? "fallback" : "live2d"}
            </strong>
            。生产构建不会出现。
          </p>
        </section>
      ) : null}

      {isDev ? (
        <section className="settings-section">
          <span className="settings-field-label">数据摘要（dev only）</span>
          <div className="action-debug-row">
            <button
              type="button"
              className="action-debug-btn"
              onClick={() => void refreshDataPanel()}
              disabled={dataLoading}
            >
              {dataLoading ? "刷新中…" : "刷新"}
            </button>
          </div>
          {dataError ? (
            <p className="settings-hint" role="alert">
              错误：{dataError}
            </p>
          ) : null}
          <ul className="settings-data-list">
            <li>
              Claude Code 数据目录：
              <strong>
                {ingestStatus?.claude_code_found
                  ? "已找到"
                  : "未找到（S18 引导待 T2.10）"}
              </strong>
            </li>
            <li>
              已采集 events：
              <strong>{ingestStatus?.events_count ?? "—"}</strong>
            </li>
            <li>
              jsonl 监听文件数：
              <strong>{ingestStatus?.jsonl_files_watched ?? "—"}</strong>
            </li>
            <li>
              最近一次 ingest：
              <strong>{ingestStatus?.last_ingest_at ?? "—"}</strong>
            </li>
            <li>
              今日解析错误：
              <strong>{ingestStatus?.errors_today ?? 0}</strong>
            </li>
            <li>
              今日 input / output：
              <strong>
                {todaySummary
                  ? `${todaySummary.total_input.toLocaleString()} / ${todaySummary.total_output.toLocaleString()}`
                  : "—"}
              </strong>
            </li>
            <li>
              今日 cache_read / cache_creation：
              <strong>
                {todaySummary
                  ? `${todaySummary.total_cache_read.toLocaleString()} / ${todaySummary.total_cache_creation.toLocaleString()}`
                  : "—"}
              </strong>
            </li>
            <li>
              今日成本：
              <strong>
                {todaySummary ? `$${todaySummary.total_cost_usd}` : "—"}
              </strong>
            </li>
            <li>
              主导模型：
              <strong>{todaySummary?.dominant_model ?? "—"}</strong>
            </li>
            <li>
              今日会话数：
              <strong>{todaySummary?.session_count ?? "—"}</strong>
            </li>
          </ul>
          <p className="settings-hint">
            该面板仅 dev 构建可见，用于人工验证 T2.1–T2.5 数据通路。
          </p>
        </section>
      ) : null}

      <p className="settings-placeholder">其他设置项将在 T2.x 阶段填充。</p>
    </main>
  );
}

export default SettingsApp;
