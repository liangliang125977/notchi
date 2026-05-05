import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import type { SettingsBundle } from "../lib/dataTypes";

// SPEC §4 S17 — first-run / empty-data overlay. Slides in below the
// pet (does not replace it), auto-dismisses once events arrive. The
// "open settings" CTA emits a tray-style event the Rust side already
// hooks up.

const REFRESH_MS = 5000;
const SPRING = { type: "spring" as const, stiffness: 380, damping: 32 };

export const OPEN_SETTINGS_TAB_EVENT = "settings:open-tab";

export function WelcomeCard() {
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const b = await invoke<SettingsBundle>("get_settings");
        if (cancelled) return;
        setBundle(b);
        // Once we have events the card disappears for good. Stop
        // polling to keep this hook free.
        if (b.events_count > 0 && timer !== null) {
          window.clearInterval(timer);
          timer = null;
        }
      } catch (err) {
        console.error("[welcome] get_settings failed", err);
      }
    };

    void tick();
    timer = window.setInterval(() => void tick(), REFRESH_MS);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, []);

  const visible = !!bundle && bundle.events_count === 0;

  return (
    <AnimatePresence>
      {visible ? (
        <motion.aside
          className="welcome-card"
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 32 }}
          transition={SPRING}
        >
          <div className="welcome-card-title">
            <span className="welcome-card-eyebrow">Welcome</span>
            <h2>Notchi</h2>
          </div>
          <p className="welcome-card-body">
            Notchi watches <code>~/.claude/projects/</code> to learn your
            AI-coding rhythm. Everything stays on this Mac — nothing is ever
            uploaded.
          </p>
          {!bundle?.claude_code_found ? (
            <div className="welcome-card-cta">
              <span className="welcome-card-warn">
                Claude Code not detected.
              </span>
              <button
                type="button"
                className="welcome-card-btn"
                onClick={() => {
                  void emit(OPEN_SETTINGS_TAB_EVENT, { tab: "settings" });
                }}
              >
                Choose data folder
              </button>
            </div>
          ) : (
            <p className="welcome-card-hint">
              Open Claude Code and start a session — the first numbers appear
              here within a few seconds.
            </p>
          )}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
