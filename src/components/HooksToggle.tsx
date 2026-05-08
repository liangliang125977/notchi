// v0.2 #3 — Settings switch for the Claude Code hooks integration.
// Reads current install state from the backend on mount; toggles via
// invoke('install_hooks_cmd') / invoke('uninstall_hooks_cmd'). The
// backend handles the read/merge/write of ~/.claude/settings.json
// itself; this component is a thin button + status indicator.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "../hooks/useT";

export function HooksToggle() {
  const t = useT();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void invoke<boolean>("hooks_status_cmd")
      .then(setInstalled)
      .catch(() => setInstalled(false));
  }, []);

  const onToggle = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (installed) {
        await invoke("uninstall_hooks_cmd");
        setInstalled(false);
      } else {
        await invoke("install_hooks_cmd");
        setInstalled(true);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (installed === null) return null;

  return (
    <div className="sp-row">
      <button
        type="button"
        onClick={() => void onToggle()}
        disabled={busy}
        className="sp-btn"
      >
        {busy
          ? t.settings.applying
          : installed
            ? t.settings.disable
            : t.settings.enable}
      </button>
      <span style={{ fontSize: 12, opacity: 0.7 }}>
        {installed ? "✓ " : ""}
        {t.settings.hooksHint}
      </span>
      {err ? (
        <span style={{ color: "var(--sp-danger, #b3271e)", fontSize: 11 }}>
          {err}
        </span>
      ) : null}
    </div>
  );
}
