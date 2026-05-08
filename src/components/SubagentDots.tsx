// v0.2 #1 — orbital dots representing live Claude Code subagents.
// Each subagent is rendered as a 12px coloured circle on a 100px-radius
// orbit around the pet centre. Orbit completes one rotation every 30s.
// Colour is bucketed by per-agent session token total. Dead agents
// (jsonl untouched > 60s) are filtered out by the parent — the alive
// flag check here is defence-in-depth.

import { useEffect, useRef, useState } from "react";
import type { ActiveSubagent } from "../lib/dataTypes";
import "./SubagentDots.css";

const ORBIT_RADIUS_PX = 100;
const ROTATION_PERIOD_MS = 30_000;

function colorFor(tokens: number): string {
  if (tokens < 10_000) return "#34C759";
  if (tokens < 100_000) return "#FF9500";
  return "#FF3B30";
}

export function SubagentDots({ subagents }: { subagents: ActiveSubagent[] }) {
  const [angleDeg, setAngleDeg] = useState(0);
  const startRef = useRef(performance.now());

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      setAngleDeg(((elapsed / ROTATION_PERIOD_MS) * 360) % 360);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const alive = subagents.filter((s) => s.is_alive);
  if (alive.length === 0) return null;

  return (
    <div className="subagent-dots" aria-hidden="true">
      {alive.map((s, i) => {
        const baseDeg = (i * 360) / alive.length;
        const totalDeg = (angleDeg + baseDeg) * (Math.PI / 180);
        const x = Math.cos(totalDeg) * ORBIT_RADIUS_PX;
        const y = Math.sin(totalDeg) * ORBIT_RADIUS_PX;
        return (
          <span
            key={s.agent_id}
            className="subagent-dot"
            style={{
              transform: `translate(${x}px, ${y}px)`,
              backgroundColor: colorFor(s.total_tokens),
            }}
            title={`${s.model ?? "?"} · ${(s.total_tokens / 1000).toFixed(1)}K tokens`}
          />
        );
      })}
    </div>
  );
}
