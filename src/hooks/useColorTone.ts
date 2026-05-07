// Color tone is no longer driven by budget/cost. Always returns null
// so the pet's appearance is purely determined by evolution stage.

export type ColorToneFilter = string | null;

export function useColorTone(): { filter: ColorToneFilter } {
  return { filter: null };
}
