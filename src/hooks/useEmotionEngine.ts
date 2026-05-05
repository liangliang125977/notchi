import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { usePetStore } from "../stores/petStore";
import type { SettingsBundle } from "../lib/dataTypes";

const TASK_COMPLETED_EVENT = "pet:task-completed";
const PENDING_INPUT_EVENT = "pet:pending-input";

interface CompletionPayload {
  session_id: string;
  model: string | null;
  stop_reason: string;
  duration_secs: number;
  total_tokens: number;
}

interface PendingInputPayload {
  session_id: string;
  idle_secs: number;
  bracket: number;
}

function pendingCopy(bracket: number): string {
  if (bracket >= 180) return "我先去睡一会...";
  if (bracket >= 60) return "怎么发呆了？";
  return "我在等你哦~";
}

function completionCopy(durationSecs: number): string {
  if (durationSecs < 30) return "搞定啦！🎉";
  if (durationSecs < 120) return "完成 ✨";
  return "终于做完啦~ 😮‍💨";
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

let notifyPermissionPromise: Promise<boolean> | null = null;

async function ensureNotifyPermission(): Promise<boolean> {
  if (notifyPermissionPromise) return notifyPermissionPromise;
  notifyPermissionPromise = (async () => {
    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const next = await requestPermission();
        granted = next === "granted";
      }
      return granted;
    } catch (err) {
      console.error("[emotion] notify permission check failed", err);
      return false;
    }
  })();
  return notifyPermissionPromise;
}

// SPEC §4 S4 / S5 / S9 — wires together pending-input + completion
// events from Rust and turns them into bubble + native-notification UX.
// Also keeps the pet store's mute-window in sync with `settings.json`
// (T3.4).
export function useEmotionEngine() {
  useEffect(() => {
    let cancelled = false;
    const setMuteWindow = usePetStore.getState().setMuteWindow;
    const setAction = usePetStore.getState().setAction;
    const showBubble = usePetStore.getState().showBubble;

    const unlisteners: Array<() => void> = [];

    void (async () => {
      // Initial settings load — bubble logic relies on these.
      try {
        const s = await invoke<SettingsBundle>("get_settings");
        if (cancelled) return;
        setMuteWindow(s.mute_window_start, s.mute_window_end);
      } catch (err) {
        console.error("[emotion] initial settings load failed", err);
      }

      try {
        const off = await listen<PendingInputPayload>(
          PENDING_INPUT_EVENT,
          (event) => {
            const payload = event.payload;
            if (!payload) return;
            const action = payload.bracket >= 180 ? "sleep" : "waiting";
            setAction(action);
            showBubble(pendingCopy(payload.bracket));
          },
        );
        if (cancelled) {
          off();
        } else {
          unlisteners.push(off);
        }
      } catch (err) {
        console.error("[emotion] pending-input listen failed", err);
      }

      try {
        const off = await listen<CompletionPayload>(
          TASK_COMPLETED_EVENT,
          (event) => {
            const payload = event.payload;
            if (!payload) return;
            setAction("done");
            showBubble(completionCopy(payload.duration_secs));
            // v1.1 — feed the pet on every completion. Privacy: only
            // model name + source tag are sent; no path / content.
            void invoke("record_feed", {
              source: "claude-code",
              model: payload.model,
            }).catch((err) => {
              console.error("[emotion] record_feed failed", err);
            });
            // Native notification: independent of mute window per S9.
            void (async () => {
              const granted = await ensureNotifyPermission();
              if (!granted) return;
              const modelLabel = payload.model ?? "Claude Code";
              const body = `${modelLabel} 完成了任务 (${formatDuration(payload.duration_secs)})`;
              try {
                sendNotification({ title: "Notchi", body });
              } catch (err) {
                console.error("[emotion] sendNotification failed", err);
              }
            })();
          },
        );
        if (cancelled) {
          off();
        } else {
          unlisteners.push(off);
        }
      } catch (err) {
        console.error("[emotion] task-completed listen failed", err);
      }

      // Re-pull mute settings whenever the settings window saves them.
      try {
        const off = await listen<{
          mute_window_start: string | null;
          mute_window_end: string | null;
        }>("settings:mute-changed", (event) => {
          const p = event.payload;
          if (!p) return;
          setMuteWindow(p.mute_window_start, p.mute_window_end);
        });
        if (cancelled) {
          off();
        } else {
          unlisteners.push(off);
        }
      } catch (err) {
        console.error("[emotion] mute-changed listen failed", err);
      }

      // Pre-warm the permission check so the macOS prompt fires before
      // the first completion lands. This is a no-op once granted.
      void ensureNotifyPermission();
    })();

    return () => {
      cancelled = true;
      for (const off of unlisteners) off();
    };
  }, []);
}
