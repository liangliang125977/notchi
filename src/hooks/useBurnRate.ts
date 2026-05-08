// v0.2 #2 — bind to Notchi's burn-rate signal. Backend recomputes
// every 30s and emits `pet:burn-rate-changed`; we also do an upfront
// `invoke('burn_rate_now')` so the overlay shows numbers immediately
// instead of waiting for the first periodic emit.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { BurnRate } from "../lib/dataTypes";

export function useBurnRate(): BurnRate | null {
  const [br, setBr] = useState<BurnRate | null>(null);
  useEffect(() => {
    void invoke<BurnRate>("burn_rate_now")
      .then(setBr)
      .catch(() => {
        /* settings store missing or DB cold start — overlay just stays
           hidden until the next periodic emit lands */
      });
    const unlisten = listen<BurnRate>("pet:burn-rate-changed", (e) => {
      setBr(e.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
  return br;
}
