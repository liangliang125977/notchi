import { validateManifest, type PetManifest } from "./petManifest";

// Vite glob runs at build time. The path must be a literal so Vite can
// statically analyze it. Each match is the parsed manifest.json content.
const RAW: Record<string, unknown> = import.meta.glob(
  "/public/assets/pets/*/manifest.json",
  { eager: true, import: "default" },
);

const REGISTRY: Map<string, PetManifest> = (() => {
  const out = new Map<string, PetManifest>();
  for (const [path, raw] of Object.entries(RAW)) {
    const manifest = validateManifest(raw, path);
    if (!manifest) continue;
    // Sanity: directory name must equal manifest.id
    const dir = path.split("/").slice(-2, -1)[0];
    if (manifest.id !== dir) {
      console.warn(
        `[petRegistry] ${path}: id "${manifest.id}" does not match dir "${dir}", skipping`,
      );
      continue;
    }
    if (out.has(manifest.id)) {
      console.warn(`[petRegistry] duplicate id "${manifest.id}" — later wins`);
    }
    out.set(manifest.id, manifest);
  }
  return out;
})();

export function listPets(): PetManifest[] {
  return Array.from(REGISTRY.values());
}

export function getPet(id: string): PetManifest | null {
  return REGISTRY.get(id) ?? null;
}

/** Default pet — first registered alphabetically by id. */
export function defaultPet(): PetManifest | null {
  const all = listPets();
  if (all.length === 0) return null;
  return [...all].sort((a, b) => a.id.localeCompare(b.id))[0];
}

/** Resolve an asset path relative to a manifest. */
export function petAssetUrl(manifest: PetManifest, relSrc: string): string {
  // Allow ../ prefixes so manifests under public/assets/pets/<id>/ can
  // reference shared assets at public/assets/<other>/. Resolved against
  // the manifest's own directory.
  const base = `/assets/pets/${manifest.id}/`;
  // Naive resolver: collapse ../ prefixes
  let url = base + relSrc;
  while (url.includes("/../")) {
    url = url.replace(/[^/]+\/\.\.\//, "");
  }
  return url;
}
