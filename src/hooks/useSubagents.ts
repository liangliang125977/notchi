// v0.2 #1 — subscribe to Notchi's `pet:subagents-changed` event and
// surface the current list of active subagents to React. The Rust
// backend polls every 5 s and emits only when the set changes, so
// most ticks are no-ops; this hook just mirrors whatever the latest
// payload was.

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ActiveSubagent } from "../lib/dataTypes";

export function useSubagents(): ActiveSubagent[] {
  const [list, setList] = useState<ActiveSubagent[]>([]);
  useEffect(() => {
    const unlisten = listen<ActiveSubagent[]>(
      "pet:subagents-changed",
      (e) => {
        setList(e.payload);
      },
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
  return list;
}
