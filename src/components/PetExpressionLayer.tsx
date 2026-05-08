// v0.2 #3 — transient emoji overlay reacting to Claude Code hook
// events. Each event flashes an emoji for ~600 ms then disappears,
// returning the pet to its mood-driven baseline (handled elsewhere).
// Hook events do NOT feed into the long-term mood pipeline — they
// are deliberately ephemeral so the pet feels lively without
// overriding cache / burn / feed signals.

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import "./PetExpressionLayer.css";

type HookEvent = {
  kind: "pre_tool_use" | "post_tool_use" | "stop";
  tool_name?: string | null;
  stop_reason?: string | null;
  duration_ms?: number | null;
};

const TOOL_EXPR: Record<string, string> = {
  Bash: "💪",
  Edit: "🤓",
  Write: "🤓",
  Read: "📖",
  Grep: "🔍",
  Glob: "🔍",
  Task: "💭",
  Agent: "💭",
};

export function PetExpressionLayer() {
  const [emoji, setEmoji] = useState<string | null>(null);
  const [showId, setShowId] = useState(0);

  useEffect(() => {
    const unlisten = listen<HookEvent>("pet:hook-event", (e) => {
      const ev = e.payload;
      let next: string | null = null;
      if (ev.kind === "pre_tool_use" || ev.kind === "post_tool_use") {
        next = TOOL_EXPR[ev.tool_name ?? ""] ?? null;
      } else if (ev.kind === "stop") {
        next = ev.stop_reason === "error" ? "⚠️" : "✨";
      }
      if (next) {
        setEmoji(next);
        setShowId((id) => id + 1);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // Auto-clear after 600ms — re-arms whenever a new emoji shows up.
  useEffect(() => {
    if (emoji === null) return;
    const t = setTimeout(() => setEmoji(null), 600);
    return () => clearTimeout(t);
  }, [emoji, showId]);

  if (!emoji) return null;
  return (
    <div className="pet-expression-layer" aria-hidden="true">
      <span key={showId} className="pet-expression-emoji">
        {emoji}
      </span>
    </div>
  );
}
