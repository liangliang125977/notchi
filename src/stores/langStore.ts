import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Locale } from "../lib/locales";

interface LangState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLangStore = create<LangState>()(
  persist(
    (set) => ({
      locale: "zh",
      setLocale: (locale) => set({ locale }),
    }),
    { name: "notchi-lang" },
  ),
);
