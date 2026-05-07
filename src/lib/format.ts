// Formatting helpers shared by L2 capsule and L3 overview. Apple-flavoured
// minimalism: short tokens (1.2K / 1.2M), $X.XX cost, model name without
// vendor / date noise.

export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1000) return `${Math.round(n)}`;
  if (abs < 1_000_000) return `${(n / 1000).toFixed(abs < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(abs < 10_000_000 ? 2 : 1)}M`;
}

export function formatModel(model: string | null | undefined): string {
  if (!model) return "—";
  let m = model;
  // Strip vendor prefix.
  m = m.replace(/^claude-/, "").replace(/^anthropic\./, "");
  // Strip dated tag suffix (e.g. -20251001).
  m = m.replace(/-\d{8}$/, "");
  // Pretty-case a few well-known families.
  return m
    .split("-")
    .map((part) => {
      if (/^\d/.test(part)) return part.replace(".", "."); // versions
      if (part.length <= 3) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) {
    if (current === 0) return 0;
    return null; // ambiguous
  }
  return ((current - previous) / previous) * 100;
}

export function formatPercentDelta(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "↑" : pct < 0 ? "↓" : "·";
  return `${sign}${Math.abs(pct).toFixed(0)}%`;
}

export function formatTimeHM(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

export function formatRelativeMinutes(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function shortProjectPath(p: string | null | undefined): string {
  if (!p) return "—";
  // Last two segments, e.g. ai-coding/games.
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  return parts.slice(-2).join("/");
}

// Compact, single-token session label for the L2 capsule. We avoid
// surfacing internal layout like "worktrees/agent-a18be4...". Rules:
//  - take the last path segment
//  - if it's a hash-like worktree dir ("agent-<hex>" / 8+ hex tail),
//    fall back to the parent segment when meaningful, else trim hash
//  - never exceed ~14 chars, ellipsis the middle on overflow
export function shortSessionLabel(p: string | null | undefined): string {
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  if (parts.length === 0) return "";
  let leaf = parts[parts.length - 1];
  const parent = parts.length >= 2 ? parts[parts.length - 2] : null;
  const hashTail = /-[0-9a-f]{6,}$/i;
  if (hashTail.test(leaf)) {
    // e.g. "agent-a18be44e81cc6ec5" → strip hex → "agent"
    const stripped = leaf.replace(hashTail, "");
    leaf = stripped.length >= 2 ? stripped : (parent ?? leaf);
  } else if (parent === "worktrees" || parent === ".worktrees") {
    leaf = leaf.replace(hashTail, "");
  }
  if (leaf.length > 16) leaf = leaf.slice(0, 14) + "…";
  return leaf;
}

// Map a (possibly raw) model id to a coarse family bucket so the L2
// capsule can colour the leading dot the way macOS uses accent dots.
export type ModelFamily = "opus" | "sonnet" | "haiku" | "other";

export function modelFamily(model: string | null | undefined): ModelFamily {
  if (!model) return "other";
  const m = model.toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return "other";
}

export function todayDateLabel(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

const SOURCE_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
};

export function formatSource(s: string | null | undefined): string {
  if (!s) return "—";
  return SOURCE_LABELS[s.toLowerCase()] ?? s;
}
