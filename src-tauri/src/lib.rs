//! Zosma Cowork — Tauri backend
//!
//! A thin relay between the React frontend and the Node.js agent sidecar.

use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{oneshot, Mutex};

#[derive(Default)]
struct SidecarState {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<tokio::process::ChildStdin>>,
    ready: Arc<AtomicBool>,
}

struct PendingPrompt {
    channel: Channel<Value>,
}
struct PendingRequest {
    sender: oneshot::Sender<Result<Value, String>>,
}

#[derive(Default)]
struct AppState {
    sidecar: SidecarState,
    pending_prompts: Arc<Mutex<HashMap<String, PendingPrompt>>>,
    pending_requests: Arc<Mutex<HashMap<String, PendingRequest>>>,
}

fn find_sidecar_path() -> PathBuf {
    let d = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("agent-sidecar");
    let dev = d.join("src").join("index.ts");
    if dev.exists() {
        dev
    } else {
        d.join("dist").join("index.js")
    }
}

fn find_node() -> String {
    std::env::var("NODE").unwrap_or_else(|_| "node".to_string())
}

async fn spawn_sidecar(
    zm: &str,
) -> Result<
    (
        Child,
        tokio::process::ChildStdout,
        tokio::process::ChildStdin,
    ),
    String,
> {
    let p = find_sidecar_path();
    let n = find_node();
    log::info!("Sidecar: {} {}", n, p.display());
    let mut c = Command::new(&n)
        .arg(&p)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("spawn: {e}"))?;
    let o = c.stdout.take().ok_or("no stdout")?;
    let mut i = c.stdin.take().ok_or("no stdin")?;
    let msg = serde_json::json!({"type":"init","zosmaDir":zm});
    let l = format!("{}\n", serde_json::to_string(&msg).unwrap());
    i.write_all(l.as_bytes())
        .await
        .map_err(|e| format!("init: {e}"))?;
    i.flush().await.map_err(|e| format!("flush: {e}"))?;
    Ok((c, o, i))
}

use std::process::Stdio;

async fn read_stdout(
    mut out: tokio::process::ChildStdout,
    pp: Arc<Mutex<HashMap<String, PendingPrompt>>>,
    pr: Arc<Mutex<HashMap<String, PendingRequest>>>,
    rd: Arc<AtomicBool>,
    app: AppHandle,
) {
    let mut lines = BufReader::new(&mut out).lines();
    while let Ok(Some(l)) = lines.next_line().await {
        if l.trim().is_empty() {
            continue;
        }
        let m: Value = match serde_json::from_str(&l) {
            Ok(v) => v,
            _ => continue,
        };
        match m.get("type").and_then(|v| v.as_str()).unwrap_or("") {
            "ready" => {
                rd.store(true, Ordering::Release);
                log::info!("Ready");
                let _ = app.emit("ready", m);
            }
            "event" => {
                if let Some(e) = m.get("event") {
                    for (_, p) in pp.lock().await.iter() {
                        let _ = p.channel.send(e.clone());
                    }
                }
            }
            "done" => {
                if let Some(id) = m.get("id").and_then(|v| v.as_str()) {
                    pp.lock().await.remove(id);
                }
            }
            "result" => {
                if let Some(id) = m.get("id").and_then(|v| v.as_str()) {
                    if let Some(p) = pr.lock().await.remove(id) {
                        let _ = p
                            .sender
                            .send(Ok(m.get("data").cloned().unwrap_or(Value::Null)));
                    }
                }
            }
            "error" => {
                let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let t = m.get("message").and_then(|v| v.as_str()).unwrap_or("err");
                if let Some(p) = pr.lock().await.remove(id) {
                    let _ = p.sender.send(Err(t.into()));
                } else if let Some(p) = pp.lock().await.get(id) {
                    let _ = p
                        .channel
                        .send(serde_json::json!({"type":"error","message":t}));
                }
            }
            _ => {}
        }
    }
    log::warn!("Sidecar stdout closed");
}

async fn scmd(state: &AppState, m: &Value) -> Result<(), String> {
    let mut s = state.sidecar.stdin.lock().await;
    let i = s.as_mut().ok_or("no sidecar")?;
    let l = format!("{}\n", serde_json::to_string(m).map_err(|e| e.to_string())?);
    i.write_all(l.as_bytes()).await.map_err(|e| e.to_string())?;
    i.flush().await.map_err(|e| e.to_string())
}

async fn scmd_r(state: &AppState, m: &Value, t: std::time::Duration) -> Result<Value, String> {
    let id = m
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("no id")?
        .to_string();
    let (tx, rx) = oneshot::channel();
    state
        .pending_requests
        .lock()
        .await
        .insert(id, PendingRequest { sender: tx });
    scmd(state, m).await?;
    tokio::time::timeout(t, rx)
        .await
        .map_err(|_| "timeout".to_string())?
        .map_err(|_| "closed".to_string())?
}

#[tauri::command]
async fn get_models(s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"get_models","id":"gm"}),
        std::time::Duration::from_secs(30),
    )
    .await
    .map(|r| r.get("models").cloned().unwrap_or(Value::Array(vec![])))
}

#[tauri::command]
async fn send_prompt(
    text: String,
    ch: Channel<Value>,
    s: State<'_, AppState>,
) -> Result<(), String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    let id = format!("p-{}", uuid_v4());
    s.pending_prompts
        .lock()
        .await
        .insert(id.clone(), PendingPrompt { channel: ch });
    scmd(
        &s,
        &serde_json::json!({"type":"prompt","id":id,"text":text}),
    )
    .await
}

#[tauri::command]
async fn abort_prompt(s: State<'_, AppState>) -> Result<(), String> {
    scmd(&s, &serde_json::json!({"type":"abort","id":"ab"})).await
}

#[tauri::command]
async fn set_active_model(
    provider: String,
    model: String,
    s: State<'_, AppState>,
) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"set_model","id":"sm","provider":provider,"model":model}),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn save_auth_key(
    provider: String,
    key: String,
    s: State<'_, AppState>,
) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"save_auth","id":"sa","provider":provider,"key":key}),
        std::time::Duration::from_secs(30),
    )
    .await
}

#[tauri::command]
async fn has_credentials(s: State<'_, AppState>) -> Result<bool, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Ok(false);
    }
    let r = scmd_r(
        &s,
        &serde_json::json!({"type":"get_models","id":"hc"}),
        std::time::Duration::from_secs(30),
    )
    .await?;
    Ok(r.get("models")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0)
        > 0)
}

#[tauri::command]
async fn reload_sidecar(s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"reload","id":"rl"}),
        std::time::Duration::from_secs(30),
    )
    .await
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    let st = std::process::Command::new("sh")
        .arg("-c")
        .arg(format!(
            "xdg-open '{}' || open '{}' || start '' '{}'",
            &url, &url, &url
        ))
        .status()
        .map_err(|e| format!("open: {e}"))?;
    if !st.success() {
        return Err(format!("exit: {}", st));
    }
    Ok(())
}

fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        (n & 0xFFFF_FFFF) as u32,
        ((n >> 32) & 0xFFFF) as u16,
        (((n >> 48) as u16) & 0x0FFF) | 0x4000,
        (((n >> 24) as u16) & 0x3FFF) | 0x8000,
        (n as u64) & 0xFFFF_FFFF_FFFF
    )
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let h = app.handle().clone();
            let st: AppState = AppState::default();
            let zd = std::env::var("ZOSMA_DIR").unwrap_or_else(|_| {
                format!(
                    "{}/.zosmaai",
                    std::env::var("HOME").unwrap_or_else(|_| "/tmp".into())
                )
            });
            let pp = st.pending_prompts.clone();
            let pr = st.pending_requests.clone();
            let rd = Arc::clone(&st.sidecar.ready);
            app.manage(st);
            tauri::async_runtime::spawn(async move {
                match spawn_sidecar(&zd).await {
                    Ok((c, o, i)) => {
                        let s: State<AppState> = h.state();
                        *s.sidecar.child.lock().await = Some(c);
                        *s.sidecar.stdin.lock().await = Some(i);
                        read_stdout(o, pp, pr, rd, h.clone()).await;
                    }
                    Err(e) => log::error!("Sidecar: {e}"),
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_models,
            send_prompt,
            abort_prompt,
            set_active_model,
            save_auth_key,
            has_credentials,
            reload_sidecar,
            open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri");
}
