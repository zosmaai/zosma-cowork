//! Zosma Cowork — Tauri backend
//!
//! A thin relay between the React frontend and the Node.js agent sidecar.

mod analytics;

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

// Skill management imports
use std::fs;
use std::io;
use walkdir::WalkDir;

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

struct TelemetryState {
    enabled: Arc<AtomicBool>,
}

#[derive(Default)]
struct AppState {
    sidecar: SidecarState,
    pending_prompts: Arc<Mutex<HashMap<String, PendingPrompt>>>,
    pending_requests: Arc<Mutex<HashMap<String, PendingRequest>>>,
}

fn find_sidecar_path(app: &tauri::AppHandle) -> PathBuf {
    // In debug/dev mode, prefer the TypeScript source via tsx.
    // This avoids resource copying issues and lets typebox resolve
    // naturally from agent-sidecar/node_modules/.
    if cfg!(debug_assertions) {
        let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("agent-sidecar")
            .join("src")
            .join("index.ts");
        if dev_path.exists() {
            return dev_path;
        }
    }

    // Try production resource dir — works on macOS .app bundles
    // and Linux AppImage/dpkg builds.
    let resource = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("agent-sidecar")
        .join("index.cjs");
    if resource.exists() {
        return resource;
    }

    // Check common system paths for distro-packaged installations.
    // Linux: /usr/lib/zosma-cowork/agent-sidecar/index.cjs
    // Windows: %PROGRAMFILES%\ZosmaAI\ZosmaCowork\agent-sidecar\index.cjs
    #[cfg(target_os = "windows")]
    {
        let program_files =
            std::env::var("PROGRAMFILES").unwrap_or_else(|_| "C:\\Program Files".into());
        let win_path = PathBuf::from(format!(
            "{}\\ZosmaAI\\ZosmaCowork\\agent-sidecar\\index.cjs",
            program_files
        ));
        if win_path.exists() {
            return win_path;
        }
        // Also check %LOCALAPPDATA% (per-user installs)
        let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
        if !local_app_data.is_empty() {
            let local_path = PathBuf::from(format!(
                "{}\\ZosmaAI\\ZosmaCowork\\agent-sidecar\\index.cjs",
                local_app_data
            ));
            if local_path.exists() {
                return local_path;
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let lib_path = PathBuf::from("/usr/lib/zosma-cowork/agent-sidecar/index.cjs");
        if lib_path.exists() {
            return lib_path;
        }
    }

    // Last resort — dev fallback
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("agent-sidecar")
        .join("src")
        .join("index.ts")
}

/// Pick the first candidate that exists and is NOT a `#!`-shebang shim.
/// `fetch-node.mjs` writes shell-script placeholders for variants it
/// didn't download; spawning one of those gives EPIPE on the next write.
fn pick_real_node(candidates: &[PathBuf]) -> Option<PathBuf> {
    use std::io::Read;
    for p in candidates {
        if !p.exists() {
            continue;
        }
        let mut buf = [0u8; 2];
        match std::fs::File::open(p).and_then(|mut f| f.read(&mut buf).map(|n| (n, buf))) {
            Ok((2, [b'#', b'!'])) => {
                log::warn!("Skipping shim Node.js placeholder: {:?}", p);
                continue;
            }
            Ok(_) => return Some(p.clone()),
            Err(e) => {
                log::warn!("Failed to read Node.js candidate {:?}: {}", p, e);
                continue;
            }
        }
    }
    None
}

fn find_node(app: &tauri::AppHandle) -> PathBuf {
    // 1. Allow override via NODE env var (useful for testing and CI)
    if let Ok(path) = std::env::var("NODE") {
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }

    // 2. Try bundled Node.js in app resources (production builds)
    // In production, Tauri bundles Node.js as a resource.
    // macOS universal builds ship both node-arm64 and node-x64.
    //
    // fetch-node.mjs creates `#!/bin/bash; exit 1` shim placeholders for
    // any variants it didn't download (so Tauri's resource validation
    // passes). Spawning a shim succeeds at the OS level but the shim
    // immediately exits, leaving the next write_all() to its stdin with
    // EPIPE ("Broken pipe (os error 32)"). Use `pick_real_node` to skip
    // shims by sniffing the first two bytes for a shebang.
    if !cfg!(debug_assertions) {
        if let Ok(resource_dir) = app.path().resource_dir() {
            let binaries_dir = resource_dir.join("binaries");

            #[cfg(target_os = "windows")]
            let candidates = [binaries_dir.join("node"), binaries_dir.join("node.exe")];

            #[cfg(target_os = "macos")]
            let candidates = {
                let current_arch = std::process::Command::new("uname")
                    .arg("-m")
                    .output()
                    .ok()
                    .and_then(|o| String::from_utf8(o.stdout).ok())
                    .unwrap_or_default();
                let arch_specific = if current_arch.starts_with("arm") {
                    binaries_dir.join("node-arm64")
                } else {
                    binaries_dir.join("node-x64")
                };
                // Try the arch-specific name first (correct for universal
                // builds), then the generic `node` (correct for single-arch
                // builds where the arch-specific name was a shim).
                [arch_specific, binaries_dir.join("node")]
            };

            #[cfg(target_os = "linux")]
            let candidates = [binaries_dir.join("node")];

            if let Some(real) = pick_real_node(&candidates) {
                log::info!("Using bundled Node.js: {:?}", real);
                return real;
            }
        }
    }

    // 3. Check common Node.js installation paths (dev mode / fallback).
    // macOS GUI apps launched via Finder inherit a minimal PATH
    // (/usr/bin:/bin:/usr/sbin:/sbin) which excludes Homebrew paths,
    // so we need to check these explicitly.
    // On Windows, desktop apps may not inherit the user's full PATH
    // so we check common install locations.

    #[cfg(target_os = "windows")]
    let candidates: Vec<String> = {
        let userprofile = std::env::var("USERPROFILE").unwrap_or_default();
        vec![
            "C:\\Program Files\\nodejs\\node.exe".into(),
            "C:\\Program Files (x86)\\nodejs\\node.exe".into(),
            format!("{}\\scoop\\apps\\nodejs\\current\\node.exe", userprofile),
            format!("{}\\nvm4w\\nodejs\\node.exe", userprofile),
            "C:\\ProgramData\\chocolatey\\lib\\nodejs\\tools\\node.exe".into(),
            "node.exe".into(),
        ]
    };

    #[cfg(not(target_os = "windows"))]
    let candidates: Vec<&str> = vec![
        "/opt/homebrew/bin/node",          // Homebrew Apple Silicon
        "/opt/homebrew/opt/node/bin/node", // Homebrew Node formula (no @version)
        "/usr/local/bin/node",             // Homebrew Intel / general
        "/usr/bin/node",                   // macOS bundled or pkgsrc
    ];

    for path in &candidates {
        let p = PathBuf::from(path);
        if p.exists() {
            return p;
        }
    }

    // 4. Last resort
    #[cfg(target_os = "windows")]
    {
        log::warn!("No bundled or system Node.js found — trying PATH");
        PathBuf::from("node.exe")
    }

    #[cfg(not(target_os = "windows"))]
    {
        log::warn!("No bundled or system Node.js found — relying on PATH");
        PathBuf::from("node")
    }
}

async fn spawn_sidecar(
    app: tauri::AppHandle,
    zm: &str,
) -> Result<
    (
        Child,
        tokio::process::ChildStdout,
        tokio::process::ChildStdin,
    ),
    String,
> {
    let p = find_sidecar_path(&app);
    let p_str = p.to_string_lossy().to_string();

    // Determine runtime: tsx for .ts (dev), node for .cjs (production)
    let run_cmd: String;
    let run_args: Vec<String>;

    if p.extension().map(|e| e == "ts").unwrap_or(false) {
        // Dev mode: use tsx from agent-sidecar's node_modules
        let sidecar_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("agent-sidecar");
        let tsx_bin = sidecar_dir.join("node_modules").join(".bin").join("tsx");
        if tsx_bin.exists() {
            run_cmd = tsx_bin.to_string_lossy().to_string();
            run_args = vec![p_str];
            log::info!("Sidecar: {} {}", run_cmd, run_args[0]);
        } else {
            run_cmd = "npx".to_string();
            run_args = vec!["tsx".to_string(), p_str];
            log::info!("Sidecar: {} tsx {}", run_cmd, run_args[1]);
        }
    } else {
        let node_path = find_node(&app);
        run_cmd = node_path.to_string_lossy().to_string();
        run_args = vec![p_str];
        log::info!("Sidecar: {} {}", run_cmd, run_args[0]);
    }

    let mut c = Command::new(&run_cmd);
    for a in &run_args {
        c.arg(a);
    }
    c.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true);
    let mut c = c.spawn().map_err(|e| format!("spawn: {e}"))?;
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
                    // Surface OAuth-flow events as Tauri events so the React
                    // UI can listen for them globally (separate from prompt
                    // streaming channels which are scoped to active prompts).
                    if let Some(kind) = e.get("kind").and_then(|v| v.as_str()) {
                        if kind.starts_with("oauth_") || kind == "agent_reload_failed" {
                            let _ = app.emit(kind, e.clone());
                        }
                    }
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
async fn start_oauth(provider: String, s: State<'_, AppState>) -> Result<Value, String> {
    // OAuth involves the user completing a browser flow — generous timeout.
    // Use a unique id per call so that a re-entrant `start_oauth` (e.g. after
    // the user closed the browser without completing) cannot have its reply
    // swallowed by the previous flow's cancellation message.
    let id = format!("so-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"start_oauth","id":id,"provider":provider}),
        std::time::Duration::from_secs(300),
    )
    .await
}

#[tauri::command]
async fn cancel_oauth(s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"cancel_oauth","id":"co"}),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn logout_provider(provider: String, s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"logout","id":"lo","provider":provider}),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn get_auth_status(s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"get_auth_status","id":"gas"}),
        std::time::Duration::from_secs(10),
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
async fn list_sessions(s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"list_sessions","id":"ls"}),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn save_session(
    sid: String,
    title: String,
    messages: Value,
    model: Option<String>,
    provider: Option<String>,
    s: State<'_, AppState>,
) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({
            "type":"save_session",
            "id": sid,
            "title": title,
            "messages": messages,
            "model": model,
            "provider": provider,
        }),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn load_session(session_file: String, s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"load_session","id":"ld","sessionFile": session_file}),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn delete_session(session_file: String, s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"delete_session","id":"dl","sessionFile": session_file}),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn new_session(s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"new_session","id":"ns"}),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn get_settings(s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"get_settings","id":"gs"}),
        std::time::Duration::from_secs(10),
    )
    .await
    .map(|r| {
        r.get("settings")
            .cloned()
            .unwrap_or(Value::Object(Default::default()))
    })
}

#[tauri::command]
async fn save_settings(settings: Value, s: State<'_, AppState>) -> Result<Value, String> {
    let mut payload = serde_json::json!({"type":"save_settings","id":"ss"});
    if let Some(obj) = settings.as_object() {
        for (k, v) in obj {
            payload[k] = v.clone();
        }
    }
    scmd_r(&s, &payload, std::time::Duration::from_secs(10)).await
}

// ── Extension commands ────────────────────────────────────────────

#[tauri::command]
async fn list_extensions(s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"list_extensions","id":"le"}),
        std::time::Duration::from_secs(10),
    )
    .await
    .map(|r| r.get("extensions").cloned().unwrap_or(Value::Array(vec![])))
}

#[tauri::command]
async fn install_extension(
    source: String,
    ref_name: Option<String>,
    s: State<'_, AppState>,
) -> Result<Value, String> {
    let mut payload = serde_json::json!({"type":"install_extension","id":"ie","source":source});
    if let Some(r) = ref_name {
        payload["ref"] = serde_json::json!(r);
    }
    scmd_r(&s, &payload, std::time::Duration::from_secs(180))
        .await
        .map(|r| r.get("extension").cloned().unwrap_or(Value::Null))
}

#[tauri::command]
async fn uninstall_extension(
    extension_id: String,
    s: State<'_, AppState>,
) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"uninstall_extension","id":"ue","extensionId": extension_id}),
        std::time::Duration::from_secs(30),
    )
    .await
}

#[tauri::command]
async fn set_extension_enabled(
    extension_id: String,
    enabled: bool,
    s: State<'_, AppState>,
) -> Result<Value, String> {
    scmd_r(
		&s,
		&serde_json::json!({"type":"set_extension_enabled","id":"se","extensionId": extension_id, "enabled": enabled}),
		std::time::Duration::from_secs(10),
	)
	.await
}

#[tauri::command]
async fn set_extension_config(
    extension_id: String,
    config: Value,
    s: State<'_, AppState>,
) -> Result<Value, String> {
    scmd_r(
		&s,
		&serde_json::json!({"type":"set_extension_config","id":"sc","extensionId": extension_id, "config": config}),
		std::time::Duration::from_secs(10),
	)
	.await
}

#[tauri::command]
async fn search_discover(query: String, s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"search_discover","id":"sd","query": query}),
        std::time::Duration::from_secs(15),
    )
    .await
    .map(|r| r.get("packages").cloned().unwrap_or(Value::Array(vec![])))
}

// ── Skills commands ──────────────────────────────────────────────

#[tauri::command]
async fn search_skills(query: String, s: State<'_, AppState>) -> Result<Value, String> {
    let id = format!("ssk-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"search_skills","id": id, "query": query}),
        std::time::Duration::from_secs(35),
    )
    .await
    .map(|r| r.get("results").cloned().unwrap_or(Value::Array(vec![])))
}

// ── Native skill listing (reads from same dir as install/remove) ────────

#[tauri::command]
async fn list_skills(_s: State<'_, AppState>) -> Result<Value, String> {
    let skill_dirs = get_all_skill_dirs()?;
    let cowork_skills_dir = get_skills_dir()?;
    let mut seen_names = std::collections::HashSet::<String>::new();
    let mut result = Vec::<serde_json::Value>::new();

    for skills_dir in &skill_dirs {
        if !skills_dir.exists() {
            continue;
        }

        for entry in fs::read_dir(skills_dir)
            .map_err(|e| format!("Failed to read skills directory {skills_dir:?}: {e}"))?
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
            let name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden dirs and node_modules
            if name.starts_with('.') || name == "node_modules" {
                continue;
            }

            // Deduplicate: skip if we already saw this skill name
            if seen_names.contains(&name) {
                continue;
            }

            let skill_path = entry.path();
            if !skill_path.is_dir() {
                continue;
            }

            // Check for SKILL.md
            let skill_md = skill_path.join("SKILL.md");
            if !skill_md.exists() {
                continue;
            }

            seen_names.insert(name.clone());

            // Determine if this skill is removable (only skills in the cowork dir)
            let removable = *skills_dir == cowork_skills_dir;

            // Try to extract description from frontmatter
            let content = fs::read_to_string(&skill_md).unwrap_or_default();
            let description = extract_field_from_frontmatter(&content, "description");

            result.push(serde_json::json!({
                "name": name,
                "path": skill_path.to_string_lossy().to_string(),
                "description": description,
                "removable": removable,
            }));
        }
    }

    Ok(serde_json::json!(result))
}

/// Extract a YAML frontmatter field from SKILL.md content
fn extract_field_from_frontmatter(content: &str, field: &str) -> String {
    let content = content.trim_start();
    if !content.starts_with("---") {
        return String::new();
    }
    let end_match = content[3..].find("---");
    let frontmatter = match end_match {
        Some(end) => &content[3..end + 3],
        None => return String::new(),
    };

    for line in frontmatter.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix(&format!("{}:", field)) {
            return val.trim().trim_matches('"').trim_matches('\'').to_string();
        }
    }
    String::new()
}

// ── Skill management (direct in Rust — no npx needed) ────────────────

/// Parse a skill source string into a git URL and optional sub-path.
///
/// Supports these formats:
///   - `owner/repo` or `owner/repo/skill-name` (GitHub shorthand, no prefix)
///   - `github/owner/repo` or `github/owner/repo/skill-name` (explicit GitHub prefix)
///   - `https://github.com/owner/repo.git` (full URL)
///   - `https://...` (any other full URL)
fn parse_skill_source(source: &str) -> (String, Option<String>) {
    // ── Full URLs ──────────────────────────────────────────────────
    if source.starts_with("http://") || source.starts_with("https://") {
        let url = source.to_string();
        let parts: Vec<&str> = source.split('/').collect();
        // Last non-empty segment might be a sub-directory path (no dots)
        // or the repo name itself (may contain .git)
        for p in parts.iter().rev() {
            if !p.is_empty() {
                if !p.contains('.') && !p.ends_with(".git") {
                    return (url, Some(p.to_string()));
                }
                break;
            }
        }
        return (url, None);
    }

    let parts: Vec<&str> = source.split('/').collect();

    // ── github/owner/repo[/skill-name] ─────────────────────────────
    if parts.len() >= 3 && parts[0] == "github" {
        let url = format!("https://github.com/{}/{}.git", parts[1], parts[2]);
        let sub_path = if parts.len() > 3 {
            Some(parts[3..].join("/"))
        } else {
            None
        };
        return (url, sub_path);
    }

    // ── owner/repo[/skill-name]  (GitHub shorthand, no prefix) ────
    if parts.len() >= 2 && !parts[0].is_empty() && !parts[0].contains('.') {
        let url = format!("https://github.com/{}/{}.git", parts[0], parts[1]);
        let sub_path = if parts.len() > 2 {
            Some(parts[2..].join("/"))
        } else {
            None
        };
        return (url, sub_path);
    }

    // ── Single segment, treat as GitHub repo name ──────────────────
    (
        format!("https://github.com/{}/{}.git", source, source),
        None,
    )
}

/// Find SKILL.md files in a directory tree and return their parent directories
fn find_skill_dirs(base: &PathBuf) -> Vec<PathBuf> {
    let mut skills = Vec::new();
    for entry in WalkDir::new(base)
        .max_depth(4)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_name() == "SKILL.md" {
            if let Some(parent) = entry.path().parent() {
                skills.push(parent.to_path_buf());
            }
        }
    }
    skills
}

/// Extract skill name from SKILL.md frontmatter
fn extract_skill_name(skill_dir: &std::path::Path) -> Option<String> {
    let skill_md = skill_dir.join("SKILL.md");
    let content = fs::read_to_string(&skill_md).ok()?;

    // Parse YAML frontmatter (simple --- ... --- extraction)
    let content = content.trim_start();
    if !content.starts_with("---") {
        return Some(skill_dir.file_name()?.to_str()?.to_string());
    }

    let end = content[3..].find("---")? + 3;
    let frontmatter = &content[3..end];

    for line in frontmatter.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("name:") {
            return Some(val.trim().to_string());
        }
    }
    None
}

/// Get the skills directory path (~/.pi/agent/skills)
fn get_skills_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|e| format!("Cannot find home directory: {e}"))?;
    Ok(PathBuf::from(home)
        .join(".zosmaai")
        .join("cowork")
        .join("skills"))
}

/// Returns all skill directories the sidecar AI agent discovers skills from.
/// This ensures the Skills Panel shows the same skills the AI has access to.
fn get_all_skill_dirs() -> Result<Vec<PathBuf>, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|e| format!("Cannot find home directory: {e}"))?;
    let mut dirs = Vec::new();

    // 1. Primary cowork skills dir
    let cowork_skills = PathBuf::from(&home)
        .join(".zosmaai")
        .join("cowork")
        .join("skills");
    dirs.push(cowork_skills);

    // 2. Legacy ~/.agents/skills/
    let agents_skills = PathBuf::from(&home).join(".agents").join("skills");
    if agents_skills.exists() {
        dirs.push(agents_skills);
    }

    // 3. Extension-installed skills from ~/.zosmaai/cowork/extensions/*/skills/
    let extensions_dir = PathBuf::from(&home)
        .join(".zosmaai")
        .join("cowork")
        .join("extensions");
    if extensions_dir.exists() {
        if let Ok(entries) = fs::read_dir(&extensions_dir) {
            for entry in entries.flatten() {
                let ext_skills = entry.path().join("skills");
                if ext_skills.is_dir() {
                    dirs.push(ext_skills);
                }
            }
        }
    }

    // 4. System pi skills dir
    let pi_skills = PathBuf::from(&home)
        .join(".pi")
        .join("agent")
        .join("skills");
    if pi_skills.exists() {
        dirs.push(pi_skills);
    }

    // 5. Project-level .pi/skills/ (relative to cwd)
    if let Ok(cwd) = std::env::current_dir() {
        let project_skills = cwd.join(".pi").join("skills");
        if project_skills.exists() {
            dirs.push(project_skills);
        }
    }

    // 6. Project-level .agents/skills/ (relative to cwd)
    if let Ok(cwd) = std::env::current_dir() {
        let project_agents = cwd.join(".agents").join("skills");
        if project_agents.exists() {
            dirs.push(project_agents);
        }
    }

    Ok(dirs)
}

/// Recursively copy a directory
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_type = entry.file_type()?;
        let dst_path = dst.join(entry.file_name());
        if src_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dst_path)?;
        } else {
            fs::copy(entry.path(), &dst_path)?;
        }
    }
    Ok(())
}

/// Select which skills in a cloned repo to install.
/// When a sub-path is specified (from search API 3-part IDs like owner/repo/skill-name),
/// match by skill name first (the skill may live at repo root), then fall back to
/// subdirectory lookup. When no sub-path, install all skills found.
fn select_skills_to_install(
    skill_dirs: &[PathBuf],
    sub_path: Option<&str>,
    repo_path: &std::path::Path,
) -> Result<Vec<PathBuf>, String> {
    let Some(sp) = sub_path else {
        // No sub-path — install all skills in the repo
        return Ok(skill_dirs.to_vec());
    };

    // Try matching by skill name first
    let matched: Vec<PathBuf> = skill_dirs
        .iter()
        .filter(|sd| {
            let name = extract_skill_name(sd)
                .or_else(|| sd.file_name().and_then(|n| n.to_str()).map(String::from))
                .unwrap_or_default();
            name == sp
        })
        .cloned()
        .collect();

    if !matched.is_empty() {
        return Ok(matched);
    }

    // Sub-path wasn't a skill name match; try as a subdirectory
    let sub_dir = repo_path.join(sp);
    if sub_dir.exists() && sub_dir.is_dir() {
        let sub_skills = find_skill_dirs(&sub_dir);
        if !sub_skills.is_empty() {
            return Ok(sub_skills);
        }
    }

    Err(format!("Skill '{}' not found in repo", sp))
}

#[tauri::command]
async fn install_skill(source: String, _s: State<'_, AppState>) -> Result<Value, String> {
    // Parse source into git URL + optional sub-path
    let (git_url, sub_path) = parse_skill_source(&source);
    log::info!(
        "Installing skill from: {} (sub-path: {:?})",
        git_url,
        sub_path
    );

    // Create temp directory for clone
    let temp_dir = std::env::temp_dir().join(format!("cowork-skill-install-{}", uuid_v4()));
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {e}"))?;

    // Clone repository using git2 (blocking — run on threadpool)
    let temp_dir_clone = temp_dir.clone();
    let result = tokio::task::spawn_blocking(move || {
        let repo_path = temp_dir_clone.join("repo");

        // Use git2::clone with default options
        let repo = git2::Repository::clone(&git_url, &repo_path)
            .map_err(|e| format!("Failed to clone {}: {e}", git_url))?;

        // Always search the entire repo root for skills
        let skill_dirs = find_skill_dirs(&repo_path);
        if skill_dirs.is_empty() {
            return Err(
                "No valid skills found — repository contains no SKILL.md files".to_string(),
            );
        }

        // Get destination skills directory
        let dest_base = get_skills_dir()?;
        fs::create_dir_all(&dest_base)
            .map_err(|e| format!("Failed to create skills directory: {e}"))?;

        // Determine which skills to install
        let skills_to_install =
            select_skills_to_install(&skill_dirs, sub_path.as_deref(), &repo_path)?;

        let mut installed = Vec::new();
        for skill_dir in skills_to_install {
            // Extract skill name from SKILL.md or use directory name
            let skill_name = extract_skill_name(&skill_dir)
                .or_else(|| {
                    skill_dir
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(String::from)
                })
                .ok_or("Cannot determine skill name")?;

            let dest = dest_base.join(&skill_name);
            log::info!("Installing skill '{}' to {:?}", skill_name, dest);

            // Remove existing installation if present
            if dest.exists() {
                fs::remove_dir_all(&dest)
                    .map_err(|e| format!("Failed to remove existing skill: {e}"))?;
            }

            // Copy skill directory
            copy_dir_recursive(&skill_dir, &dest)
                .map_err(|e| format!("Failed to copy skill files: {e}"))?;

            installed.push(skill_name);
        }

        // Drop repo handle before cleanup
        drop(repo);

        Ok(installed)
    })
    .await;

    // Cleanup temp dir
    let _ = fs::remove_dir_all(temp_dir.clone());

    match result {
        Ok(Ok(installed)) => {
            log::info!("Successfully installed skills: {:?}", installed);
            Ok(serde_json::json!({
                "success": true,
                "installed": installed
            }))
        }
        Ok(Err(e)) => Err(e),
        Err(je) => Err(format!("Task join error: {je}")),
    }
}

#[tauri::command]
async fn remove_skill(name: String, _s: State<'_, AppState>) -> Result<Value, String> {
    let skills_dir = get_skills_dir()?;
    let skill_path = skills_dir.join(&name);

    // Fast path: direct directory match (e.g., name = "pptx")
    if skill_path.exists() && skill_path.is_dir() {
        fs::remove_dir_all(&skill_path).map_err(|e| format!("Failed to remove skill: {e}"))?;
        log::info!("Removed skill: {}", name);
        return Ok(serde_json::json!({ "success": true, "removed": name }));
    }

    // Fallback: name might be a source URL like "github/owner/repo/skill-name"
    // Try matching against installed skill names (from SKILL.md or dir name)
    let candidate = name.split('/').next_back().unwrap_or(&name).to_string();
    let candidate_path = skills_dir.join(&candidate);

    if candidate_path.exists() && candidate_path.is_dir() {
        fs::remove_dir_all(&candidate_path).map_err(|e| format!("Failed to remove skill: {e}"))?;
        log::info!(
            "Removed skill '{}' (matched from source '{}')",
            candidate,
            name
        );
        return Ok(serde_json::json!({ "success": true, "removed": candidate }));
    }

    // Final fallback: scan all installed skills for a name match
    if skills_dir.exists() {
        for entry in fs::read_dir(&skills_dir)
            .map_err(|e| format!("Failed to read skills directory: {e}"))?
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
            let skill_name = entry.file_name().to_string_lossy().to_string();

            // Check if the source URL contains this skill name
            if name.contains(&skill_name) {
                let target = skills_dir.join(&skill_name);
                if target.exists() && target.is_dir() {
                    fs::remove_dir_all(&target)
                        .map_err(|e| format!("Failed to remove skill: {e}"))?;
                    log::info!(
                        "Removed skill '{}' (substring match from '{}')",
                        skill_name,
                        name
                    );
                    return Ok(serde_json::json!({ "success": true, "removed": skill_name }));
                }
            }
        }
    }

    Err(format!("Skill '{}' not found in {:?}", name, skills_dir))
}

#[tauri::command]
async fn write_user_file(path: String, content: String) -> Result<(), String> {
    tokio::fs::write(&path, &content)
        .await
        .map_err(|e| format!("write_file: {e}"))
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

// ── Telemetry ────────────────────────────────────────────────

#[tauri::command]
async fn set_telemetry_enabled(enabled: bool, app: AppHandle) -> Result<(), String> {
    let state = app.state::<TelemetryState>();
    state.enabled.store(enabled, Ordering::Release);
    log::info!(
        "Telemetry: {}",
        if enabled { "enabled" } else { "disabled" }
    );
    Ok(())
}

static INSTALL_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Generate a unique temp directory suffix.
/// Combines a timestamp with an atomic counter to guarantee uniqueness
/// even under concurrent `install_skill` calls.
fn uuid_v4() -> String {
    use std::sync::atomic::Ordering;
    use std::time::{SystemTime, UNIX_EPOCH};
    let counter = INSTALL_COUNTER.fetch_add(1, Ordering::AcqRel);
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "{:016x}",
        (n << 16 | u128::from(counter)) & 0xFFFF_FFFF_FFFF_FFFF
    )
}

pub fn run() {
    let aptabase_key = option_env!("APTABASE_KEY").unwrap_or("");
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(TelemetryState {
            enabled: Arc::new(AtomicBool::new(false)),
        });

    #[allow(unused_mut)]
    let mut builder = builder;

    // Only set up our in-house analytics if a key is available at compile time.
    // The analytics module uses tauri::async_runtime::spawn (safe in setup context)
    // into a single .setup() since Tauri only calls the last one.
    let ak = (!aptabase_key.is_empty()).then(|| aptabase_key.to_string());

    builder
        .setup(move |app| {
            // Initialize in-house analytics (runs within Tauri's tokio runtime)
            if let Some(ref key) = ak {
                if let Err(e) = analytics::setup(app, key) {
                    log::warn!("Analytics setup failed: {}", e);
                }
            } else {
                log::info!("Analytics: no key, disabled");
            }

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
                match spawn_sidecar(h.clone(), &zd).await {
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
            start_oauth,
            cancel_oauth,
            logout_provider,
            get_auth_status,
            has_credentials,
            reload_sidecar,
            list_sessions,
            save_session,
            load_session,
            delete_session,
            new_session,
            get_settings,
            save_settings,
            list_extensions,
            install_extension,
            uninstall_extension,
            set_extension_enabled,
            set_extension_config,
            search_discover,
            search_skills,
            list_skills,
            install_skill,
            remove_skill,
            write_user_file,
            open_url,
            crate::analytics::track_analytics_event,
            crate::analytics::set_analytics_enabled,
            set_telemetry_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri");
}
