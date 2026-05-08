//! Install / uninstall Notchi hook commands into ~/.claude/settings.json.
use std::path::PathBuf;
use serde_json::{json, Value};

const HOOK_MARKER: &str = "notchi";

fn settings_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".claude/settings.json"))
}

pub fn install_hooks(port: u16) -> Result<(), String> {
    install_hooks_at(&settings_path().ok_or("HOME unset")?, port)
}

pub fn uninstall_hooks() -> Result<(), String> {
    uninstall_hooks_at(&settings_path().ok_or("HOME unset")?)
}

pub fn is_installed() -> bool {
    settings_path()
        .as_deref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .map(|v| settings_has_marker(&v))
        .unwrap_or(false)
}

fn settings_has_marker(v: &Value) -> bool {
    let hooks = match v.get("hooks") { Some(h) => h, None => return false };
    for kind in ["PreToolUse", "PostToolUse", "Stop"] {
        let Some(arr) = hooks.get(kind).and_then(|h| h.as_array()) else { continue };
        if arr.iter().any(|item| {
            item.get("hooks")
                .and_then(|h| h.as_array())
                .map(|hooks| hooks.iter().any(|h| h.get("marker").and_then(|m| m.as_str()) == Some(HOOK_MARKER)))
                .unwrap_or(false)
        }) {
            return true;
        }
    }
    false
}

pub(crate) fn install_hooks_at(path: &std::path::Path, port: u16) -> Result<(), String> {
    let mut root: Value = if path.exists() {
        let raw = std::fs::read_to_string(path).map_err(|e| format!("read: {e}"))?;
        // backup before mutating
        let _ = std::fs::write(path.with_extension("json.notchi-backup"), raw.as_bytes());
        serde_json::from_str(&raw).map_err(|e| format!("parse: {e}"))?
    } else {
        if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
        json!({})
    };

    if !root.is_object() { root = json!({}); }
    let hooks = root.as_object_mut().unwrap()
        .entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() { *hooks = json!({}); }

    for (event, route) in [
        ("PreToolUse", "pre-tool-use"),
        ("PostToolUse", "post-tool-use"),
        ("Stop", "stop"),
    ] {
        let arr = hooks.as_object_mut().unwrap()
            .entry(event).or_insert_with(|| json!([]));
        if !arr.is_array() { *arr = json!([]); }
        let arr = arr.as_array_mut().unwrap();

        // Idempotency: skip if any matcher contains a hook with our marker
        let already = arr.iter().any(|item| {
            item.get("hooks").and_then(|h| h.as_array())
                .map(|hooks| hooks.iter().any(|h| h.get("marker").and_then(|m| m.as_str()) == Some(HOOK_MARKER)))
                .unwrap_or(false)
        });
        if already { continue; }

        arr.push(json!({
            "matcher": "*",
            "hooks": [{
                "type": "command",
                "command": format!(
                    "curl -s -X POST -H 'Content-Type: application/json' \
                     -d \"@${{CLAUDE_HOOK_PAYLOAD_FILE:-/dev/stdin}}\" \
                     http://127.0.0.1:{port}/hooks/{route} > /dev/null 2>&1 || true"
                ),
                "marker": HOOK_MARKER,
            }]
        }));
    }

    let pretty = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(path, pretty).map_err(|e| format!("write: {e}"))?;
    Ok(())
}

pub(crate) fn uninstall_hooks_at(path: &std::path::Path) -> Result<(), String> {
    if !path.exists() { return Ok(()); }
    let raw = std::fs::read_to_string(path).map_err(|e| format!("read: {e}"))?;
    let mut root: Value = serde_json::from_str(&raw).map_err(|e| format!("parse: {e}"))?;
    let Some(obj) = root.as_object_mut() else { return Ok(()); };
    let Some(hooks) = obj.get_mut("hooks").and_then(|h| h.as_object_mut()) else { return Ok(()); };
    for kind in ["PreToolUse", "PostToolUse", "Stop"] {
        if let Some(arr) = hooks.get_mut(kind).and_then(|a| a.as_array_mut()) {
            arr.retain(|item| {
                let has_our_marker = item.get("hooks").and_then(|h| h.as_array())
                    .map(|hs| hs.iter().any(|h| h.get("marker").and_then(|m| m.as_str()) == Some(HOOK_MARKER)))
                    .unwrap_or(false);
                !has_our_marker
            });
        }
    }
    let pretty = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(path, pretty).map_err(|e| format!("write: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tempfile() -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("notchi-hooks-test-{}.json",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)));
        p
    }

    #[test]
    fn install_idempotent() {
        let p = tempfile();
        install_hooks_at(&p, 9999).unwrap();
        let after_first = std::fs::read_to_string(&p).unwrap();
        install_hooks_at(&p, 9999).unwrap();
        let after_second = std::fs::read_to_string(&p).unwrap();
        // Same hooks present, no duplicates
        assert_eq!(after_first, after_second);
        let v: Value = serde_json::from_str(&after_first).unwrap();
        assert!(settings_has_marker(&v));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn uninstall_preserves_other_hooks() {
        let p = tempfile();
        // Pre-existing user hook
        std::fs::write(&p, r#"{
            "hooks": {
                "PreToolUse": [
                    { "matcher": "Bash", "hooks": [
                        { "type": "command", "command": "echo user-hook" }
                    ]}
                ]
            }
        }"#).unwrap();
        install_hooks_at(&p, 9999).unwrap();
        uninstall_hooks_at(&p).unwrap();
        let raw = std::fs::read_to_string(&p).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        // User hook preserved
        let user_present = v.pointer("/hooks/PreToolUse")
            .and_then(|a| a.as_array())
            .map(|arr| arr.iter().any(|i|
                i.get("hooks").and_then(|h| h.as_array())
                    .map(|hooks| hooks.iter().any(|h|
                        h.get("command").and_then(|c| c.as_str())
                            .map(|c| c.contains("user-hook")).unwrap_or(false)))
                    .unwrap_or(false)
            ))
            .unwrap_or(false);
        assert!(user_present, "user hook was dropped during uninstall");
        // Notchi marker gone
        assert!(!settings_has_marker(&v));
        let _ = std::fs::remove_file(&p);
    }
}
