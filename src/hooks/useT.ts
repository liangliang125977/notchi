import { useLangStore } from "../stores/langStore";
import { locales, type Strings } from "../lib/locales";

export function useT(): Strings {
  const locale = useLangStore((s) => s.locale);
  return locales[locale];
}
