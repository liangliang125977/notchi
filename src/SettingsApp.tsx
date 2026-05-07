import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Tabs, TabPanel, type TabItem } from "./components/Tabs";
import { OverviewPanel } from "./components/OverviewPanel";
import { SessionsPanel } from "./components/SessionsPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { PetPanel } from "./components/PetPanel";

const OPEN_SETTINGS_TAB_EVENT = "settings:open-tab";
// v1.3 hardening — pet window emits this once when macOS denies the
// notification permission. We surface a top-of-window banner so the
// user can deep-link to System Settings → Notifications.
const NOTIFICATIONS_DENIED_EVENT = "pet:notifications-denied";

const TABS: ReadonlyArray<TabItem> = [
  { id: "overview", label: "Overview" },
  { id: "sessions", label: "Sessions" },
  {
    id: "tokens",
    label: "Tokens",
    disabled: true,
    hint: "Merged into Overview for the MVP",
  },
  { id: "pet", label: "Pet" },
  { id: "settings", label: "Settings" },
];

interface OpenTabPayload {
  tab?: string;
}

function SettingsApp() {
  const [active, setActive] = useState<string>("overview");
  const [notifDenied, setNotifDenied] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        unlisten = await listen<OpenTabPayload>(
          OPEN_SETTINGS_TAB_EVENT,
          (event) => {
            const next = event.payload?.tab;
            if (typeof next === "string") {
              const allowed = TABS.find((t) => t.id === next && !t.disabled);
              if (allowed) setActive(next);
            }
          },
        );
      } catch (err) {
        console.error("[settings] open-tab listener failed", err);
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        unlisten = await listen(NOTIFICATIONS_DENIED_EVENT, () => {
          setNotifDenied(true);
        });
      } catch (err) {
        console.error("[settings] notifications-denied listener failed", err);
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <main className="settings-window">
      <header className="settings-window-head">
        <h1>Notchi</h1>
        <p className="settings-window-sub">
          Local-only AI coding companion · v0.1.0
        </p>
      </header>

      {notifDenied ? (
        <div className="settings-banner-warn" role="status">
          <span className="settings-banner-warn-text">
            ⚠️ macOS 通知权限被拒。任务完成时不会发送系统通知（气泡仍工作）。
          </span>
          <button
            className="settings-banner-warn-btn"
            type="button"
            onClick={() => {
              void invoke("open_macos_notifications_settings");
            }}
          >
            打开系统设置
          </button>
          <button
            className="settings-banner-warn-dismiss"
            type="button"
            aria-label="dismiss"
            onClick={() => setNotifDenied(false)}
          >
            ×
          </button>
        </div>
      ) : null}

      <Tabs items={TABS} active={active} onChange={setActive} />

      <div className="settings-window-body">
        <TabPanel id="overview" active={active}>
          <OverviewPanel />
        </TabPanel>
        <TabPanel id="sessions" active={active}>
          <SessionsPanel />
        </TabPanel>
        <TabPanel id="pet" active={active}>
          <PetPanel />
        </TabPanel>
        <TabPanel id="settings" active={active}>
          <SettingsPanel />
        </TabPanel>
      </div>
    </main>
  );
}

export default SettingsApp;
