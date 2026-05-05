import { useEffect, useState } from "react";
import { load, type Store } from "@tauri-apps/plugin-store";

type NotchMode = "auto" | "force-notch" | "force-no-notch";

const NOTCH_MODE_KEY = "notchMode";
const STORE_PATH = "settings.json";
const DEFAULT_MODE: NotchMode = "auto";

const NOTCH_MODE_OPTIONS: ReadonlyArray<{ value: NotchMode; label: string }> = [
  { value: "auto", label: "自动检测（推荐）" },
  { value: "force-notch", label: "强制按有刘海定位" },
  { value: "force-no-notch", label: "强制按无刘海定位" },
];

function SettingsApp() {
  const [store, setStore] = useState<Store | null>(null);
  const [mode, setMode] = useState<NotchMode>(DEFAULT_MODE);
  const [ready, setReady] = useState(false);

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

  async function handleNotchModeChange(next: NotchMode) {
    setMode(next);
    if (!store) return;
    try {
      await store.set(NOTCH_MODE_KEY, next);
    } catch (err) {
      console.error("[settings] failed to persist notchMode", err);
    }
  }

  return (
    <main className="settings-window">
      <h1>Notchi 设置</h1>

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

      <p className="settings-placeholder">其他设置项将在 T2.x 阶段填充。</p>
    </main>
  );
}

export default SettingsApp;
