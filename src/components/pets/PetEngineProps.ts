import type { PetAction, PetManifest } from "../../lib/petManifest";

export interface PetEngineProps {
  /** Side length in CSS pixels. Engines render to a square. */
  size: number;
  /** Current animation state. */
  action: PetAction;
  /** The pet to render. */
  manifest: PetManifest;
  /** Optional callback when a non-loop action completes naturally. */
  onActionEnd?: (action: PetAction) => void;
}
