import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Tabs, TabPanel, type TabItem } from "./components/Tabs";
import { OverviewPanel } from "./components/OverviewPanel";
import { SessionsPanel } from "./components/SessionsPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { PetPanel } from "./components/PetPanel";
import { useT } from "./hooks/useT";

const OPEN_SETTINGS_TAB_EVENT = "settings:open-tab";
// v1.3 hardening — pet window emits this once when macOS denies the
// notification permission. We surface a top-of-window banner so the
// user can deep-link to System Settings → Notifications.
const NOTIFICATIONS_DENIED_EVENT = "pet:notifications-denied";

interface OpenTabPayload {
  tab?: string;
}

function SettingsApp() {
  const t = useT();
  const TABS: ReadonlyArray<TabItem> = [
    { id: "overview", label: t.nav.overview },
    { id: "sessions", label: t.nav.sessions },
    { id: "pet", label: t.nav.pet },
    { id: "settings", label: t.nav.settings },
  ];

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
        <h1>{t.app.title}</h1>
        <p className="settings-window-sub">{t.app.subtitle}</p>
      </header>

      {notifDenied ? (
        <div className="settings-banner-warn" role="status">
          <span className="settings-banner-warn-text">{t.notif.denied}</span>
          <button
            className="settings-banner-warn-btn"
            type="button"
            onClick={() => {
              void invoke("open_macos_notifications_settings");
            }}
          >
            {t.notif.openSettings}
          </button>
          <button
            className="settings-banner-warn-dismiss"
            type="button"
            aria-label={t.notif.dismiss}
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
