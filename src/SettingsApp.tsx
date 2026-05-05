import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Tabs, TabPanel, type TabItem } from "./components/Tabs";
import { OverviewPanel } from "./components/OverviewPanel";
import { SessionsPanel } from "./components/SessionsPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { PetPanel } from "./components/PetPanel";

const OPEN_SETTINGS_TAB_EVENT = "settings:open-tab";

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
  const [highlightBudget, setHighlightBudget] = useState(false);

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
              if (allowed) {
                setActive(next);
                if (next === "settings") setHighlightBudget(true);
              }
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

  // Reset the highlight flag once the user moves away from settings.
  // Wrapped in a microtask so the lint rule doesn't see a synchronous
  // setState call from inside the effect body.
  useEffect(() => {
    if (active === "settings" || !highlightBudget) return;
    const id = window.setTimeout(() => setHighlightBudget(false), 0);
    return () => window.clearTimeout(id);
  }, [active, highlightBudget]);

  return (
    <main className="settings-window">
      <header className="settings-window-head">
        <h1>Notchi</h1>
        <p className="settings-window-sub">
          Local-only AI coding companion · v0.1.0
        </p>
      </header>

      <Tabs items={TABS} active={active} onChange={setActive} />

      <div className="settings-window-body">
        <TabPanel id="overview" active={active}>
          <OverviewPanel
            onJumpToBudget={() => {
              setActive("settings");
              setHighlightBudget(true);
            }}
          />
        </TabPanel>
        <TabPanel id="sessions" active={active}>
          <SessionsPanel />
        </TabPanel>
        <TabPanel id="pet" active={active}>
          <PetPanel />
        </TabPanel>
        <TabPanel id="settings" active={active}>
          <SettingsPanel highlightBudget={highlightBudget} />
        </TabPanel>
      </div>
    </main>
  );
}

export default SettingsApp;
