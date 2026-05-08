// Manifest schema for pet assets. See docs/plans/2026-05-08-pet-system-redesign.md.
//
// Validation is manual (no zod) because the schema is small and we want to
// keep the bundle lean. Loading happens once at build time via
// import.meta.glob — invalid manifests are dropped with a console warning.

export type PetAction = "idle" | "coding" | "waiting" | "done" | "sleep";

export type PetEngine = "live2d" | "lottie" | "sprite";

export interface ActionSpec {
  /** Path relative to the manifest's directory. */
  src: string;
  /** Whether the engine should loop this action (default true). */
  loop?: boolean;
  /** Engine-specific options (group/index for live2d, fps/duration for others). */
  options?: Record<string, unknown>;
}

export interface PetManifest {
  /** Unique id; must equal the directory name. */
  id: string;
  /** Display name shown in the picker. */
  name: string;
  /** One-liner shown on hover / in the picker subtitle. */
  description?: string;
  /** Which engine renders this pet. */
  engine: PetEngine;
  /** Optional thumbnail (24x24+ PNG) — falls back to a default chip. */
  thumbnail?: string;
  /** Action → asset mapping. All five actions are required. */
  actions: Record<PetAction, ActionSpec>;
  /** Author / license attribution. */
  credits?: { author?: string; license?: string; sourceUrl?: string };
}

export const PET_ACTIONS: readonly PetAction[] = [
  "idle",
  "coding",
  "waiting",
  "done",
  "sleep",
] as const;

const ENGINES: readonly PetEngine[] = ["live2d", "lottie", "sprite"] as const;

/** Returns null if invalid; logs a warning describing why. */
export function validateManifest(
  raw: unknown,
  sourcePath: string,
): PetManifest | null {
  if (!raw || typeof raw !== "object") {
    console.warn(`[petManifest] ${sourcePath}: not an object`);
    return null;
  }
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== "string" || !m.id) {
    console.warn(`[petManifest] ${sourcePath}: missing id`);
    return null;
  }
  if (typeof m.name !== "string" || !m.name) {
    console.warn(`[petManifest] ${sourcePath}: missing name`);
    return null;
  }
  if (typeof m.engine !== "string" || !ENGINES.includes(m.engine as PetEngine)) {
    console.warn(
      `[petManifest] ${sourcePath}: bad engine "${String(m.engine)}"`,
    );
    return null;
  }
  const actions = m.actions;
  if (!actions || typeof actions !== "object") {
    console.warn(`[petManifest] ${sourcePath}: missing actions`);
    return null;
  }
  for (const action of PET_ACTIONS) {
    const spec = (actions as Record<string, unknown>)[action];
    if (!spec || typeof spec !== "object") {
      console.warn(`[petManifest] ${sourcePath}: missing action.${action}`);
      return null;
    }
    if (typeof (spec as { src?: unknown }).src !== "string") {
      console.warn(
        `[petManifest] ${sourcePath}: action.${action}.src not a string`,
      );
      return null;
    }
  }
  return raw as PetManifest;
}
