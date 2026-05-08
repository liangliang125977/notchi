//! v0.2 #3 — embedded HTTP server for Claude Code hook callbacks.
use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;

#[derive(Clone)]
pub struct ServerHandle {
    pub port: u16,
}

#[derive(Debug, Deserialize)]
pub struct HookPayload {
    // `session_id` / `timestamp` arrive on every payload but the
    // current visualisation layer does not surface them. Declared so
    // serde does not silently drop the fields and so v0.3 does not
    // need to revisit this struct.
    #[serde(default)]
    #[allow(dead_code)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub stop_reason: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    #[allow(dead_code)]
    pub timestamp: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct HookEvent {
    pub kind: &'static str,
    pub tool_name: Option<String>,
    pub stop_reason: Option<String>,
    pub duration_ms: Option<u64>,
}

pub async fn start_server(app: AppHandle) -> Result<ServerHandle, String> {
    let app_arc = Arc::new(app);
    let router = Router::new()
        .route("/hooks/pre-tool-use",
            post({
                let a = app_arc.clone();
                move |Json(p): Json<HookPayload>| {
                    let a = a.clone();
                    async move {
                        let _ = a.emit("pet:hook-event", &HookEvent {
                            kind: "pre_tool_use",
                            tool_name: p.tool_name,
                            stop_reason: None,
                            duration_ms: None,
                        });
                        "ok"
                    }
                }
            }))
        .route("/hooks/post-tool-use",
            post({
                let a = app_arc.clone();
                move |Json(p): Json<HookPayload>| {
                    let a = a.clone();
                    async move {
                        let _ = a.emit("pet:hook-event", &HookEvent {
                            kind: "post_tool_use",
                            tool_name: p.tool_name,
                            stop_reason: None,
                            duration_ms: p.duration_ms,
                        });
                        "ok"
                    }
                }
            }))
        .route("/hooks/stop",
            post({
                let a = app_arc.clone();
                move |Json(p): Json<HookPayload>| {
                    let a = a.clone();
                    async move {
                        let _ = a.emit("pet:hook-event", &HookEvent {
                            kind: "stop",
                            tool_name: None,
                            stop_reason: p.stop_reason,
                            duration_ms: p.duration_ms,
                        });
                        "ok"
                    }
                }
            }));

    let listener = TcpListener::bind("127.0.0.1:0").await
        .map_err(|e| format!("bind: {e}"))?;
    let addr: SocketAddr = listener.local_addr()
        .map_err(|e| format!("local_addr: {e}"))?;
    let port = addr.port();

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            eprintln!("[hooks-server] {e}");
        }
    });

    // Persist port for diagnostics
    let _ = std::fs::create_dir_all(
        std::env::var_os("HOME")
            .map(|h| std::path::PathBuf::from(h).join(".notchi"))
            .unwrap_or_default(),
    );
    let _ = std::env::var_os("HOME").map(|h| {
        std::fs::write(
            std::path::PathBuf::from(h).join(".notchi/port.txt"),
            format!("{port}"),
        )
    });

    Ok(ServerHandle { port })
}
