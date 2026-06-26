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
    // The Child handle is owned by the exit-watcher task spawned in setup()
    // (not stored here) so we can wait() on it and log unexpected deaths.
    // tokio's kill_on_drop ensures it's reaped on app shutdown when the
    // watcher task is aborted.
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

/// Strip the Windows `\\?\` extended-length path prefix.
///
/// Tauri's `app.path().resource_dir()` on Windows returns paths in the
/// extended-length form (e.g. `\\?\C:\Program Files\...`) because the
/// underlying call to `GetFinalPathNameByHandleW` produces that form.
/// This is fine for most Rust file I/O, but Node.js v24's main-module
/// resolver calls `realpathSync` on its argv[1] and then walks the
/// path component-by-component starting from the prefix — it ends up
/// calling `lstat('C:')`, which on Windows returns EISDIR, and Node
/// crashes with `Error: EISDIR: illegal operation on a directory` before
/// the sidecar's first line runs. The crash is invisible because the
/// Tauri parent has no console and stderr is normally inherited.
///
/// Strip the prefix unconditionally — `dunce::simplified` does the same
/// check; we avoid the dependency here. The non-extended path is
/// equivalent for paths <260 chars (which all our resource paths are).
fn strip_unc_prefix(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped.to_string())
    } else {
        p
    }
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
        return strip_unc_prefix(resource);
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

    // Try relative to the current executable (works for portable installs,
    // manual unpack, or any non-standard layout).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let rel_path = exe_dir.join("../lib/zosma-cowork/agent-sidecar/index.cjs");
            if rel_path.exists() {
                return rel_path;
            }
            // Also try plain relative (e.g. portable extraction)
            let plain_path = exe_dir.join("agent-sidecar/index.cjs");
            if plain_path.exists() {
                return plain_path;
            }
        }
    }

    // Last resort — dev fallback (only useful during development)
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("agent-sidecar")
        .join("src")
        .join("index.ts")
}

/// Pick the first candidate that exists and is NOT a stub placeholder.
/// `fetch-node.mjs` writes shell-script (`#!/bin/bash ... exit 1`) or
/// batch (`@echo off ... exit /b 1`) placeholders for variants it didn't
/// download. Spawning a `#!` script on Unix gives EPIPE on the next write;
/// spawning a `@echo off` text file on Windows fails CreateProcessW with
/// ERROR_BAD_EXE_FORMAT. Sniff the first two bytes for either signature.
fn pick_real_node(candidates: &[PathBuf]) -> Option<PathBuf> {
    use std::io::Read;
    for p in candidates {
        if !p.exists() {
            continue;
        }
        let mut buf = [0u8; 2];
        match std::fs::File::open(p).and_then(|mut f| f.read(&mut buf).map(|n| (n, buf))) {
            Ok((2, [b'#', b'!'])) => {
                log::warn!("Skipping shebang Node.js shim: {:?}", p);
                continue;
            }
            // `@e` is the first two bytes of "@echo off" — fetch-node.mjs's
            // Windows stub. Real node.exe starts with `MZ` (PE header).
            Ok((2, [b'@', _])) => {
                log::warn!("Skipping batch-file Node.js shim: {:?}", p);
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

            // Windows: prefer node.exe (the real downloaded binary). Older
            // copies of fetch-node.mjs leave `binaries/node` as an 84-byte
            // `.cmd` stub (`@echo off ... exit /b 1`) because the stub-creation
            // loop ran before the `node.exe → node` copy and the copy was
            // guarded by `!existsSync(nodeCopy)`. CreateProcessW on that stub
            // fails with ERROR_BAD_EXE_FORMAT, killing the sidecar before init.
            // pick_real_node only sniffs for `#!` shebangs, so the `.cmd`
            // stub slips past — listing node.exe first sidesteps it entirely.
            #[cfg(target_os = "windows")]
            let candidates = [binaries_dir.join("node.exe"), binaries_dir.join("node")];

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
                let real = strip_unc_prefix(real);
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
        // Dev mode: use tsx from agent-sidecar's node_modules.
        // On Windows, npm creates THREE files per bin: a POSIX shell wrapper
        // (`tsx`, no extension) for Git Bash, plus `tsx.cmd` for cmd.exe and
        // `tsx.ps1` for PowerShell. Rust's Command/CreateProcessW cannot
        // execute the POSIX wrapper (it's not a PE binary), so picking it
        // makes spawn fail with ERROR_BAD_EXE_FORMAT and the sidecar never
        // starts. Prefer `tsx.cmd` on Windows.
        let sidecar_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("agent-sidecar");
        let bin_dir = sidecar_dir.join("node_modules").join(".bin");
        #[cfg(target_os = "windows")]
        let tsx_bin = {
            let cmd = bin_dir.join("tsx.cmd");
            if cmd.exists() {
                cmd
            } else {
                bin_dir.join("tsx")
            }
        };
        #[cfg(not(target_os = "windows"))]
        let tsx_bin = bin_dir.join("tsx");
        if tsx_bin.exists() {
            run_cmd = tsx_bin.to_string_lossy().to_string();
            run_args = vec![p_str];
            log::info!("Sidecar: {} {}", run_cmd, run_args[0]);
        } else {
            // npx is also a .cmd on Windows — let cmd.exe resolve it via PATH.
            #[cfg(target_os = "windows")]
            {
                run_cmd = "npx.cmd".to_string();
            }
            #[cfg(not(target_os = "windows"))]
            {
                run_cmd = "npx".to_string();
            }
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
    // macOS GUI apps launched via Finder don't inherit a terminal's env
    // vars, and our bundled Node 24's stock CA bundle doesn't include
    // corporate MITM root certs (ZScaler / Cloudflare WARP / Fortinet /
    // etc.). `--use-system-ca` (Node 22.4+) makes Node consult the OS
    // trust store — macOS keychain, Windows cert store, Linux
    // ca-certificates — in addition to its built-in CAs, so any root the
    // browser already trusts becomes valid for OAuth token exchange too.
    // Falls back gracefully when the OS store has no extras. Preserve any
    // pre-existing NODE_OPTIONS the user has set.
    let existing_node_opts = std::env::var("NODE_OPTIONS").unwrap_or_default();
    let node_options = if existing_node_opts.contains("--use-system-ca") {
        existing_node_opts
    } else if existing_node_opts.is_empty() {
        "--use-system-ca".to_string()
    } else {
        format!("{existing_node_opts} --use-system-ca")
    };
    c.env("NODE_OPTIONS", node_options);
    c.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // Without CREATE_NO_WINDOW (0x08000000), spawning a console-subsystem
    // child (node.exe / npx.cmd / tsx.cmd are all console-subsystem) from a
    // windows-subsystem GUI parent makes Windows allocate a brand new
    // console window for the child — a black cmd.exe popup that sits open
    // for the entire lifetime of the sidecar. CREATE_NO_WINDOW suppresses
    // it and is the universal Windows-GUI-spawning-CLI-child fix.
    #[cfg(target_os = "windows")]
    {
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    log::info!("Sidecar: spawning cmd={run_cmd:?} args={run_args:?} zosmaDir={zm}");
    let mut c = c.spawn().map_err(|e| format!("spawn: {e}"))?;
    let o = c.stdout.take().ok_or("no stdout")?;
    let mut i = c.stdin.take().ok_or("no stdin")?;
    // Pipe sidecar stderr into our logger so crashes are visible.
    // Without this, on Windows GUI apps stderr inherit() silently
    // discards everything because windows-subsystem parents have no
    // console attached. See issue #140.
    if let Some(err) = c.stderr.take() {
        tauri::async_runtime::spawn(async move {
            use tokio::io::AsyncBufReadExt as _;
            let mut lines = tokio::io::BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                log::warn!("sidecar[err]: {line}");
            }
            log::warn!("sidecar[err]: stderr EOF");
        });
    }
    let msg = serde_json::json!({"type":"init","zosmaDir":zm});
    let l = format!("{}\n", serde_json::to_string(&msg).unwrap());
    i.write_all(l.as_bytes())
        .await
        .map_err(|e| format!("init: {e}"))?;
    i.flush().await.map_err(|e| format!("flush: {e}"))?;
    log::info!("Sidecar: init sent, pid={:?}", c.id());
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
                        // Surface OAuth, reload, and extension-UI requests as
                        // global Tauri events. `ui_request` carries ctx.ui
                        // dialog calls (e.g. pi-ask-user) so the React UI can
                        // render them regardless of which prompt is active.
                        // `ui_cancel` tells the UI to dismiss a dialog the
                        // sidecar already resolved itself (timeout/abort).
                        if kind.starts_with("oauth_")
                            || kind == "agent_reload_failed"
                            || kind == "ui_request"
                            || kind == "ui_cancel"
                        {
                            let _ = app.emit(kind, e.clone());
                        }
                    }
                    // Pi SDK session-level events (queue_update,
                    // session_info_changed, etc.) use `type` instead of
                    // `kind`. The composer (#201 PR 3) needs to know about
                    // queue mutations EVEN WHEN NO PROMPT IS ACTIVE — e.g.
                    // after the agent finishes and a follow-up dequeues.
                    // Emit those globally so a `listen("queue_update", ...)`
                    // in React works regardless of streaming state.
                    if let Some(t) = e.get("type").and_then(|v| v.as_str()) {
                        if t == "queue_update" {
                            let _ = app.emit("queue_update", e.clone());
                        }
                        // Tasks-bridge push: the sidecar emits this when the
                        // active cwd's .pi/scheduled_tasks.json changes so the
                        // Tasks list can refetch live (no prompt active).
                        if t == "tasks_changed" {
                            let _ = app.emit("tasks_changed", e.clone());
                        }
                        // Task-run-completed push (#300): the sidecar emits this
                        // when a scheduled task finishes executing so the
                        // TaskDetailPage can live-update the runs section.
                        if t == "task_run_completed" {
                            let _ = app.emit("task_run_completed", e.clone());
                        }
                        // Task-run-progress push (#300): the sidecar emits this
                        // periodically while a scheduled task is still running so
                        // the run detail view can stream live steps.
                        if t == "task_run_progress" {
                            let _ = app.emit("task_run_progress", e.clone());
                        }
                    }
                    for (_, p) in pp.lock().await.iter() {
                        let _ = p.channel.send(e.clone());
                    }
                }
            }
            "done" => {
                if let Some(id) = m.get("id").and_then(|v| v.as_str()) {
                    // Forward a terminal `done` to the prompt channel BEFORE
                    // dropping it. The UI ends a turn on `agent_end` OR `done`;
                    // without this forward the only completion signal is
                    // `agent_end`, so any turn that doesn't emit one (incl. the
                    // sidecar's prompt-timeout abort, which only sends `done`)
                    // leaves the UI stuck in "thinking" forever.
                    if let Some(p) = pp.lock().await.remove(id) {
                        let _ = p.channel.send(serde_json::json!({"type":"done"}));
                    }
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
    let i = s.as_mut().ok_or_else(|| {
        log::error!("scmd: no sidecar (stdin is None) for msg={m}");
        "no sidecar".to_string()
    })?;
    let l = format!("{}\n", serde_json::to_string(m).map_err(|e| e.to_string())?);
    let kind = m.get("type").and_then(|v| v.as_str()).unwrap_or("?");
    let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("-");
    if let Err(e) = i.write_all(l.as_bytes()).await {
        log::error!(
            "scmd[{kind}/{id}]: write_all FAILED: {e} (raw os err: {:?})",
            e.raw_os_error()
        );
        return Err(e.to_string());
    }
    if let Err(e) = i.flush().await {
        log::error!(
            "scmd[{kind}/{id}]: flush FAILED: {e} (raw os err: {:?})",
            e.raw_os_error()
        );
        return Err(e.to_string());
    }
    log::debug!("scmd[{kind}/{id}]: sent ({} bytes)", l.len());
    Ok(())
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

/// Returns the model the engine will actually run (`session.model`) as
/// `{provider, id, name}` or null. The frontend mirrors this on startup so the
/// model shown near the input matches the model that actually answers.
#[tauri::command]
async fn get_active_model(s: State<'_, AppState>) -> Result<Value, String> {
    let id = format!("gam-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"get_active_model","id":id}),
        std::time::Duration::from_secs(10),
    )
    .await
}

/// #268 — Token/cache usage, cost, and live context-window usage for the
/// active session. Mirrors the sidecar's `get_session_stats` (which wraps the
/// SDK's `AgentSession.getSessionStats()`). The UI polls this when a turn
/// completes and on session load to drive the always-on status line.
#[tauri::command]
async fn get_session_stats(s: State<'_, AppState>) -> Result<Value, String> {
    let id = format!("gss-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"get_session_stats","id":id}),
        std::time::Duration::from_secs(10),
    )
    .await
}

/// #268 — Current reasoning ("thinking") level plus the levels the active model
/// supports. Returned shape: `{ thinkingLevel, availableThinkingLevels,
/// supportsThinking }`.
#[tauri::command]
async fn get_thinking_level(s: State<'_, AppState>) -> Result<Value, String> {
    let id = format!("gtl-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"get_thinking_level","id":id}),
        std::time::Duration::from_secs(10),
    )
    .await
}

/// #268 — Set the reasoning level (`off | minimal | low | medium | high |
/// xhigh`). The SDK clamps to what the model supports, so the result echoes the
/// EFFECTIVE level the engine adopted.
#[tauri::command]
async fn set_thinking_level(level: String, s: State<'_, AppState>) -> Result<Value, String> {
    let id = format!("stl-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"set_thinking_level","id":id,"level":level}),
        std::time::Duration::from_secs(10),
    )
    .await
}

/// #268 — Advance the reasoning level to the next supported step (wraps around).
/// Powers the clickable thinking-level pill in the status line.
#[tauri::command]
async fn cycle_thinking_level(s: State<'_, AppState>) -> Result<Value, String> {
    let id = format!("ctl-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"cycle_thinking_level","id":id}),
        std::time::Duration::from_secs(10),
    )
    .await
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

/// Build the JSONL payload sent to the sidecar for a `steer` command.
///
/// Factored out as a pure function so the wire shape is unit-testable
/// without spinning up a real sidecar process. The Tauri command
/// [`steer_prompt`] is a thin wrapper that generates an id and forwards
/// the payload via [`scmd_r`].
///
/// See `agent-sidecar/src/steering.ts` for the matching handler and
/// pi-coding-agent's `docs/rpc.md` for the protocol reference (cowork
/// uses `text` rather than pi's `message` to stay internally consistent
/// with the existing `prompt` command).
fn build_steer_payload(id: &str, text: &str) -> Value {
    serde_json::json!({
        "type": "steer",
        "id": id,
        "text": text,
    })
}

/// Build the install context the frontend uses to decide whether the in-app
/// updater may self-update or should defer to a package manager (issue #271).
///
/// Pure so it can be unit-tested without touching real env/OS state.
fn build_install_context(target_os: &str, is_appimage: bool, channel: &str) -> Value {
    // `std::env::consts::OS` already yields "macos"/"windows"/"linux"/…, which
    // matches the platform strings the frontend's resolveUpdatePolicy expects,
    // so we forward it as-is.
    let channel = if channel.is_empty() {
        "direct"
    } else {
        channel
    };
    serde_json::json!({
        "platform": target_os,
        "isAppImage": is_appimage,
        "channel": channel,
    })
}

/// Tauri command: report the running install context to the frontend.
///
/// - `isAppImage` is true when launched from an AppImage (`APPIMAGE` env set);
///   only then can the Tauri updater self-replace on Linux.
/// - `channel` is a compile-time marker baked by CI: package-manager builds
///   (Homebrew/AUR/Winget) are built with `ZOSMA_UPDATE_CHANNEL=managed` so the
///   app never tries to self-update binaries the package manager owns.
#[tauri::command]
fn get_install_context() -> Value {
    let is_appimage = std::env::var_os("APPIMAGE").is_some();
    let channel = option_env!("ZOSMA_UPDATE_CHANNEL").unwrap_or("direct");
    build_install_context(std::env::consts::OS, is_appimage, channel)
}

/// Build the JSONL payload sent to the sidecar for a `clear_queue` command.
/// Issue #201 PR 3 — atomically drains the SDK queue. No `text` field: this
/// command takes no input. The sidecar replies with the drained
/// `{steering, followUp}` arrays in a `result` envelope.
fn build_clear_queue_payload(id: &str) -> Value {
    serde_json::json!({
        "type": "clear_queue",
        "id": id,
    })
}

/// Build the JSONL payload sent to the sidecar for a `follow_up` command.
/// See [`build_steer_payload`] for rationale.
fn build_follow_up_payload(id: &str, text: &str) -> Value {
    serde_json::json!({
        "type": "follow_up",
        "id": id,
        "text": text,
    })
}

/// Queue a steering message on the active session. Delivered after the
/// current assistant turn finishes its tool calls, before the next LLM
/// call. Round-trips through `scmd_r` with a short timeout because the
/// sidecar replies with a one-shot `result` / `error` envelope (no
/// streaming channel — streaming events keep flowing on the existing
/// prompt channel).
#[tauri::command]
async fn steer_prompt(text: String, s: State<'_, AppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    let id = format!("st-{}", uuid_v4());
    scmd_r(
        &s,
        &build_steer_payload(&id, &text),
        std::time::Duration::from_secs(5),
    )
    .await
}

/// Queue a follow-up message on the active session. Delivered after the
/// agent has no more tool calls or steering messages pending.
#[tauri::command]
async fn follow_up_prompt(text: String, s: State<'_, AppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    let id = format!("fu-{}", uuid_v4());
    scmd_r(
        &s,
        &build_follow_up_payload(&id, &text),
        std::time::Duration::from_secs(5),
    )
    .await
}

/// Drain the active session's steer + follow-up queue and return the
/// drained `{steering, followUp}` arrays. Issue #201 PR 3 — the desktop
/// composer calls this when the user presses Ctrl+↑ to recall pending
/// queued messages for editing. Idempotent on an empty queue.
#[tauri::command]
async fn clear_queue(s: State<'_, AppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    let id = format!("cq-{}", uuid_v4());
    scmd_r(
        &s,
        &build_clear_queue_payload(&id),
        std::time::Duration::from_secs(5),
    )
    .await
}

/// Answer an extension UI dialog (ctx.ui.select/confirm/input/editor). `id` is
/// the UI-request id from the `ui_request` event. Exactly one of `value`/
/// `confirmed` is set, or `cancelled` is true. Fire-and-forget: the sidecar
/// resolves the pending dialog promise and sends no response.
#[tauri::command]
async fn send_ui_response(
    id: String,
    value: Option<String>,
    confirmed: Option<bool>,
    cancelled: Option<bool>,
    s: State<'_, AppState>,
) -> Result<(), String> {
    let mut msg = serde_json::json!({ "type": "ui_response", "id": id });
    if let Some(v) = value {
        msg["value"] = serde_json::Value::String(v);
    }
    if let Some(c) = confirmed {
        msg["confirmed"] = serde_json::Value::Bool(c);
    }
    if let Some(c) = cancelled {
        msg["cancelled"] = serde_json::Value::Bool(c);
    }
    scmd(&s, &msg).await
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

// ─── Custom OpenAI-compatible providers (issue #207) ───────────────────────
// Thin forwarders for the three sidecar commands that read/write the
// `providers.<id>` section of models.json. The UI never touches models.json
// directly; pi-coding-agent's ModelRegistry owns that file and we re-init it
// inside the sidecar on every save/delete so the model selector refreshes.

#[tauri::command]
async fn list_custom_providers(s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"list_custom_providers","id":"lcp"}),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn save_custom_provider(provider: Value, s: State<'_, AppState>) -> Result<Value, String> {
    // initAgent() reloads the agent from disk; allow the same 30s budget as
    // save_auth_key. Validation errors come back via the sidecar `error`
    // channel and surface as Err here.
    scmd_r(
        &s,
        &serde_json::json!({"type":"save_custom_provider","id":"scp","provider":provider}),
        std::time::Duration::from_secs(30),
    )
    .await
}

#[tauri::command]
async fn delete_custom_provider(
    provider_id: String,
    s: State<'_, AppState>,
) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"delete_custom_provider","id":"dcp","providerId":provider_id}),
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
    // Unique id per call: a hardcoded id collides in `pending_requests` when
    // several callers invoke the same command concurrently (the map insert
    // overwrites, so all-but-one request resolves as "closed" and errors).
    let id = format!("gas-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"get_auth_status","id":id}),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn has_credentials(s: State<'_, AppState>) -> Result<bool, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Ok(false);
    }
    // "Has credentials" must mean the user has actually AUTHENTICATED at least
    // one provider — not that the model catalog is non-empty. Shared pi
    // extensions (e.g. `pi-crofai`) register provider model catalogs WITHOUT
    // any stored credential, so counting `get_models` made a freshly-wiped
    // install look authenticated and skipped onboarding, dropping the user into
    // chat with non-working models. Count authenticated providers from auth
    // storage instead (the same list the onboarding/Connect screen reflects).
    let id = format!("hc-{}", uuid_v4());
    let r = scmd_r(
        &s,
        &serde_json::json!({"type":"get_auth_status","id":id}),
        std::time::Duration::from_secs(30),
    )
    .await?;
    let has_auth = r
        .get("providers")
        .and_then(|v| v.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false);
    if has_auth {
        return Ok(true);
    }
    // A configured Custom Local LLM (issue #207) is a complete, working setup
    // even though it leaves no entry in auth storage — Ollama / LM Studio need
    // no API key, so `get_auth_status` reports zero providers for them. Without
    // this, saving a local model on the Welcome screen flips nothing in
    // `has_credentials`, `needsOnboarding` stays true, and the UI bounces the
    // user straight back to the "Get started" onboarding screen they just left.
    let cid = format!("hclcp-{}", uuid_v4());
    let cr = scmd_r(
        &s,
        &serde_json::json!({"type":"list_custom_providers","id":cid}),
        std::time::Duration::from_secs(30),
    )
    .await?;
    Ok(cr
        .get("providers")
        .and_then(|v| v.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false))
}

/// Google broker: run the consent flow (loopback+PKCE) for the selected scopes
/// and fan out credentials to the real package config files. `prefs` is the
/// per-product capability selection; `byo` an optional bring-your-own client.
#[tauri::command]
async fn google_connect(
    s: State<'_, AppState>,
    prefs: Option<Value>,
    byo: Option<Value>,
) -> Result<Value, String> {
    let id = format!("cg-{}", uuid_v4());
    let mut payload = serde_json::json!({"type":"connect_google","id":id});
    if let Some(p) = prefs {
        payload["prefs"] = p;
    }
    // `byo` may be JSON null to explicitly clear; preserve that distinction.
    if let Some(b) = byo {
        payload["byo"] = b;
    }
    scmd_r(
        &s,
        &payload,
        // Consent involves browser + user interaction — generous timeout.
        std::time::Duration::from_secs(300),
    )
    .await
}

/// Google broker: read the capability matrix + saved scope prefs / BYO state.
#[tauri::command]
async fn google_get_prefs(s: State<'_, AppState>) -> Result<Value, String> {
    let id = format!("ggp-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"get_google_prefs","id":id}),
        std::time::Duration::from_secs(10),
    )
    .await
}

/// Google broker: persist scope prefs / BYO client without (re)running consent.
#[tauri::command]
async fn google_save_prefs(
    s: State<'_, AppState>,
    prefs: Option<Value>,
    byo: Option<Value>,
) -> Result<Value, String> {
    let id = format!("gsp-{}", uuid_v4());
    let mut payload = serde_json::json!({"type":"save_google_prefs","id":id});
    if let Some(p) = prefs {
        payload["prefs"] = p;
    }
    if let Some(b) = byo {
        payload["byo"] = b;
    }
    scmd_r(&s, &payload, std::time::Duration::from_secs(10)).await
}

/// Google app: which extensions the selection needs + whether they're installed.
#[tauri::command]
async fn google_get_app_status(
    s: State<'_, AppState>,
    prefs: Option<Value>,
) -> Result<Value, String> {
    let id = format!("ggas-{}", uuid_v4());
    let mut payload = serde_json::json!({"type":"get_google_app_status","id":id});
    if let Some(p) = prefs {
        payload["prefs"] = p;
    }
    scmd_r(&s, &payload, std::time::Duration::from_secs(15)).await
}

/// Google app: install (via pi's package manager) any missing app extensions.
#[tauri::command]
async fn google_install_app(s: State<'_, AppState>, prefs: Option<Value>) -> Result<Value, String> {
    let id = format!("gia-{}", uuid_v4());
    let mut payload = serde_json::json!({"type":"install_google_app","id":id});
    if let Some(p) = prefs {
        payload["prefs"] = p;
    }
    // npm install over the network — generous timeout.
    scmd_r(&s, &payload, std::time::Duration::from_secs(300)).await
}

/// Google broker: probe both token destinations and report connected state.
#[tauri::command]
async fn google_get_status(s: State<'_, AppState>) -> Result<Value, String> {
    let id = format!("ggs-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"get_google_status","id":id}),
        std::time::Duration::from_secs(10),
    )
    .await
}

/// GitHub: probe gh auth status.
#[tauri::command]
async fn gh_auth_status(s: State<'_, AppState>) -> Result<Value, String> {
    let id = format!("gas-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"gh_auth_status","id":id}),
        std::time::Duration::from_secs(10),
    )
    .await
}

/// GitHub: list organizations for the authenticated user.
#[tauri::command]
async fn gh_organizations(s: State<'_, AppState>) -> Result<Value, String> {
    let id = format!("go-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"gh_organizations","id":id}),
        std::time::Duration::from_secs(10),
    )
    .await
}

/// GitHub: drive `gh auth login --web` device flow; returns {code, url}.
#[tauri::command]
async fn gh_auth_login(s: State<'_, AppState>, scopes: Option<String>) -> Result<Value, String> {
    let id = format!("gal-{}", uuid_v4());
    let mut payload = serde_json::json!({"type":"gh_auth_login","id":id});
    if let Some(sc) = scopes {
        payload["scopes"] = serde_json::json!(sc);
    }
    scmd_r(&s, &payload, std::time::Duration::from_secs(20)).await
}

/// GitHub: cancel an in-flight device-flow login.
#[tauri::command]
async fn gh_auth_cancel(s: State<'_, AppState>) -> Result<Value, String> {
    let id = format!("gac-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"gh_auth_cancel","id":id}),
        std::time::Duration::from_secs(5),
    )
    .await
}

/// GitHub: sign out (gh auth logout for github.com).
#[tauri::command]
async fn gh_auth_logout(s: State<'_, AppState>) -> Result<Value, String> {
    let id = format!("glo-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"gh_auth_logout","id":id}),
        std::time::Duration::from_secs(10),
    )
    .await
}

/// Google broker: revoke the refresh token and delete all local token files.
#[tauri::command]
async fn google_disconnect(s: State<'_, AppState>) -> Result<Value, String> {
    let id = format!("dg-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"disconnect_google","id":id}),
        std::time::Duration::from_secs(10),
    )
    .await
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

/// Lightweight env-read for the system username — used in the empty-state
/// greeting. Microseconds, non-blocking, always returns something.
#[tauri::command]
fn get_username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default()
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

/// Give a chat session a user-chosen title. The sidecar marks the header
/// `titleLocked` so auto-derived titles never overwrite it again.
#[tauri::command]
async fn rename_session(
    session_file: String,
    title: String,
    s: State<'_, AppState>,
) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({
            "type":"rename_session",
            "id":"rn",
            "sessionFile": session_file,
            "title": title,
        }),
        std::time::Duration::from_secs(10),
    )
    .await
}

/// Pin or unpin a chat session (floats it to the top of the sidebar).
#[tauri::command]
async fn set_session_pinned(
    session_file: String,
    pinned: bool,
    s: State<'_, AppState>,
) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({
            "type":"set_session_pinned",
            "id":"pn",
            "sessionFile": session_file,
            "pinned": pinned,
        }),
        std::time::Duration::from_secs(10),
    )
    .await
}

/// Deep content search across all session bodies (not just titles).
#[tauri::command]
async fn search_sessions(query: String, s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"search_sessions","id":"ss","query": query}),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn new_session(cwd: Option<String>, s: State<'_, AppState>) -> Result<Value, String> {
    // `cwd` is the workspace folder the user picked (via the native folder
    // picker). Forwarded to the sidecar, which rebinds the agent's file/bash
    // tools and project-local resource discovery to it. Omitted => the sidecar
    // keeps its current workspace (defaults to the user's home dir).
    let mut payload = serde_json::json!({"type":"new_session","id":"ns"});
    if let Some(c) = cwd {
        if !c.trim().is_empty() {
            payload["cwd"] = serde_json::Value::String(c);
        }
    }
    scmd_r(&s, &payload, std::time::Duration::from_secs(10)).await
}

/// Report the sidecar's active workspace folder (and the default), so the UI
/// can display "where am I working" and pre-fill the folder picker.
#[tauri::command]
async fn get_workspace(s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"get_workspace","id":"gw"}),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn get_settings(s: State<'_, AppState>) -> Result<Value, String> {
    let id = format!("gs-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"get_settings","id":id}),
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
    let mut payload = serde_json::json!({"type":"save_settings","id":format!("ss-{}", uuid_v4())});
    if let Some(obj) = settings.as_object() {
        for (k, v) in obj {
            payload[k] = v.clone();
        }
    }
    scmd_r(&s, &payload, std::time::Duration::from_secs(10)).await
}

#[tauri::command]
async fn get_instructions(s: State<'_, AppState>) -> Result<String, String> {
    let id = format!("gi-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"get_instructions","id":id}),
        std::time::Duration::from_secs(10),
    )
    .await
    .map(|r| {
        r.get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    })
}

#[tauri::command]
async fn save_instructions(content: String, s: State<'_, AppState>) -> Result<Value, String> {
    let id = format!("si-{}", uuid_v4());
    // session.reload() in the sidecar can take a moment; allow more headroom.
    scmd_r(
        &s,
        &serde_json::json!({"type":"save_instructions","id":id,"content":content}),
        std::time::Duration::from_secs(30),
    )
    .await
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

// ── Tasks bridge (pi-routines scheduled tasks) ────────────────────
// Thin shims over the sidecar's tasks_* commands, which read/write the
// active cwd's .pi/scheduled_tasks.json directly (no LLM round-trip).
// `cwd` is optional: when omitted the sidecar uses its active workspaceCwd.

#[tauri::command]
async fn tasks_list(s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"tasks_list","id":"tl"}),
        std::time::Duration::from_secs(10),
    )
    .await
    .map(|r| r.get("tasks").cloned().unwrap_or(Value::Array(vec![])))
}

#[tauri::command]
async fn tasks_delete(task_id: String, s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"tasks_delete","id":"td","taskId": task_id}),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn tasks_set_enabled(
    task_id: String,
    enabled: bool,
    s: State<'_, AppState>,
) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"tasks_set_enabled","id":"tse","taskId": task_id, "enabled": enabled}),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn tasks_run_now(task_id: String, s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"tasks_run_now","id":"trn","taskId": task_id}),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn tasks_list_runs(
    task_id: String,
    limit: Option<u32>,
    s: State<'_, AppState>,
) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({
            "type": "tasks_list_runs",
            "id": "tlr",
            "taskId": task_id,
            "limit": limit.unwrap_or(50)
        }),
        std::time::Duration::from_secs(10),
    )
    .await
    .map(|r| r.get("runs").cloned().unwrap_or(Value::Array(vec![])))
}

#[tauri::command]
async fn tasks_get_completed(s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type":"tasks_get_completed","id":"tgc"}),
        std::time::Duration::from_secs(10),
    )
    .await
    .map(|r| r.get("completed").cloned().unwrap_or(Value::Array(vec![])))
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

/// Read a whitelisted extension's own config file (e.g. pi-messenger-bridge's
/// ~/.pi/msg-bridge.json) so the UI can offer a bespoke setup screen.
#[tauri::command]
async fn get_extension_config_file(
    extension_id: String,
    s: State<'_, AppState>,
) -> Result<Value, String> {
    let id = format!("gecf-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"get_extension_config_file","id":id,"extensionId": extension_id}),
        std::time::Duration::from_secs(10),
    )
    .await
}

/// Merge a patch into a whitelisted extension's own config file (written with
/// 0600 perms by the sidecar).
#[tauri::command]
async fn save_extension_config_file(
    extension_id: String,
    patch: Value,
    s: State<'_, AppState>,
) -> Result<Value, String> {
    let id = format!("secf-{}", uuid_v4());
    scmd_r(
        &s,
        &serde_json::json!({"type":"save_extension_config_file","id":id,"extensionId": extension_id, "patch": patch}),
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

/// Read the raw SKILL.md content for an installed skill directory.
///
/// `path` is the skill directory path (as returned by `list_skills`). The file
/// `<path>/SKILL.md` is read and returned verbatim so the UI can render it.
#[tauri::command]
async fn read_skill_md(path: String, _s: State<'_, AppState>) -> Result<Value, String> {
    let dir = PathBuf::from(&path);
    // Accept either a directory (append SKILL.md) or a direct SKILL.md path.
    let skill_md = if dir.is_dir() {
        dir.join("SKILL.md")
    } else if dir.file_name().map(|f| f == "SKILL.md").unwrap_or(false) {
        dir
    } else {
        dir.join("SKILL.md")
    };

    if !skill_md.exists() {
        return Err(format!("SKILL.md not found at {}", skill_md.display()));
    }

    let content =
        fs::read_to_string(&skill_md).map_err(|e| format!("Failed to read SKILL.md: {e}"))?;

    Ok(serde_json::json!({
        "content": content,
        "path": skill_md.to_string_lossy().to_string(),
    }))
}

// ── Background wallpaper (#191) ──────────────────────────────────────
//
// The webview can't read arbitrary files the user picks (fs scope is limited
// to ~/.zosmaai/cowork/**, and there's no asset protocol), so the picked image
// is copied into the wallpapers dir by Rust and read back as bytes at apply
// time. Keeping both file ops in Rust avoids any Tauri config/capability change.

const WALLPAPER_EXTS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];

fn wallpapers_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|e| format!("Cannot find home directory: {e}"))?;
    let dir = PathBuf::from(home)
        .join(".zosmaai")
        .join("cowork")
        .join("wallpapers");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create wallpapers dir: {e}"))?;
    Ok(dir)
}

/// Copy a user-picked image into the wallpapers dir. Returns the stored filename.
/// A single active slot is kept (`wallpaper.<ext>`), overwriting any previous one
/// of the same extension; stale slots with other extensions are removed.
#[tauri::command]
fn import_wallpaper(src_path: String) -> Result<String, String> {
    let src = PathBuf::from(&src_path);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .filter(|e| WALLPAPER_EXTS.contains(&e.as_str()))
        .ok_or_else(|| "Unsupported image type (use PNG, JPG, WEBP or GIF).".to_string())?;

    let dir = wallpapers_dir()?;
    // Drop any previous wallpaper slot so we don't accumulate files.
    for other in WALLPAPER_EXTS {
        let p = dir.join(format!("wallpaper.{other}"));
        if p.exists() {
            let _ = fs::remove_file(&p);
        }
    }

    let filename = format!("wallpaper.{ext}");
    let dest = dir.join(&filename);
    fs::copy(&src, &dest).map_err(|e| format!("Failed to copy image: {e}"))?;
    Ok(filename)
}

/// Read a stored wallpaper image's bytes by filename (no path traversal allowed).
#[tauri::command]
fn read_wallpaper(filename: String) -> Result<Vec<u8>, String> {
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("Invalid wallpaper filename.".to_string());
    }
    let path = wallpapers_dir()?.join(&filename);
    fs::read(&path).map_err(|e| format!("Failed to read wallpaper: {e}"))
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

// ── Remote Access (Phase 6.0) ──────────────────────────────────

#[tauri::command]
async fn start_remote_server(
    port: Option<u16>,
    host: Option<String>,
    s: State<'_, AppState>,
) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({
            "type": "start_remote",
            "id": "sr",
            "port": port.unwrap_or(8765),
            "host": host.unwrap_or_else(|| "127.0.0.1".to_string()),
        }),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn stop_remote_server(s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type": "stop_remote", "id": "sr"}),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn get_remote_status(s: State<'_, AppState>) -> Result<Value, String> {
    scmd_r(
        &s,
        &serde_json::json!({"type": "get_remote_status", "id": "grs"}),
        std::time::Duration::from_secs(10),
    )
    .await
}

#[tauri::command]
async fn write_user_file(path: String, content: String) -> Result<(), String> {
    tokio::fs::write(&path, &content)
        .await
        .map_err(|e| format!("write_file: {e}"))
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    // Per-platform browser opener. Previous implementation shelled out to
    // `sh -c "xdg-open ... || open ... || start '' ..."` which silently
    // fails on Windows: GUI Tauri processes don't have `sh` on PATH, and
    // even when Git Bash is installed `start` is a cmd.exe builtin, not
    // a real executable. That broke every OAuth flow (Claude Pro, GitHub
    // Copilot, OpenAI Codex) on Windows — the UI stuck at "Opening
    // browser…" with no error because the React side `.catch(() => {})`s
    // the rejection.
    #[cfg(target_os = "windows")]
    let result = {
        // `cmd /c start "" <url>` — the empty quoted string is required
        // because `start` interprets the first quoted arg as the window
        // title. CREATE_NO_WINDOW (0x08000000) prevents a brief flash of
        // a console window when the GUI app shells out.
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &url])
            .creation_flags(0x0800_0000)
            .status()
    };
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).status();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(&url).status();

    let st = result.map_err(|e| format!("open: {e}"))?;
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
        .plugin(
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("zosma".into()),
                    },
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .level(log::LevelFilter::Info)
                .max_file_size(5_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            // Resolve zosma dir. On Windows, GUI apps don't inherit HOME
            // (that's a POSIX convention) — the equivalent is USERPROFILE.
            // Falling through to /tmp/.zosmaai on Windows causes auth.json
            // and models.json to land in C:\tmp\.zosmaai instead of the user's
            // profile, so credentials silently "disappear" between runs and
            // every release-installer user trips over it.
            let zd = std::env::var("ZOSMA_DIR").unwrap_or_else(|_| {
                #[cfg(target_os = "windows")]
                let home = std::env::var("USERPROFILE")
                    .or_else(|_| std::env::var("HOME"))
                    .unwrap_or_else(|_| "C:\\Users\\Default".into());
                #[cfg(not(target_os = "windows"))]
                let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
                format!("{}/.zosmaai", home)
            });
            let pp = st.pending_prompts.clone();
            let pr = st.pending_requests.clone();
            let rd = Arc::clone(&st.sidecar.ready);
            app.manage(st);
            tauri::async_runtime::spawn(async move {
                // Retry loop: if the sidecar crashes (OOM, unhandled error,
                // model-load failure) we restart it up to 3 times so the
                // app keeps working without user intervention (#307).
                let max_retries = 3;
                for attempt in 0..max_retries {
                    match spawn_sidecar(h.clone(), &zd).await {
                        Ok((mut c, o, i)) => {
                            let s: State<AppState> = h.state();
                            let pid = c.id();
                            *s.sidecar.stdin.lock().await = Some(i);
                            rd.store(true, Ordering::Release);
                            let _ = h.emit(
                                "ready",
                                serde_json::json!({
                                    "sidecarRestarted": attempt > 0
                                }),
                            );
                            // Watch the sidecar's exit so unexpected deaths are
                            // diagnosable. Owns the Child for its lifetime;
                            // tokio kill_on_drop ensures cleanup if this task
                            // is aborted (app shutdown).
                            let pid_watch = pid;
                            tauri::async_runtime::spawn(async move {
                                match c.wait().await {
                                    Ok(status) => log::error!(
                                        "Sidecar pid={pid_watch:?} EXITED: status={status:?} code={:?}",
                                        status.code()
                                    ),
                                    Err(e) => log::error!("Sidecar pid={pid_watch:?} wait error: {e}"),
                                }
                            });
                            read_stdout(o, pp.clone(), pr.clone(), rd.clone(), h.clone()).await;
                            // Sidecar died — mark not ready so commands fail
                            // fast with "not ready" instead of hanging.
                            rd.store(false, Ordering::Release);
                            let _ = h.emit("sidecar_lost", ());
                            if attempt < max_retries - 1 {
                                let delay = std::time::Duration::from_millis(
                                    500 * (attempt as u64 + 1),
                                );
                                log::warn!(
                                    "Sidecar: restarting (attempt {}) in {}ms",
                                    attempt + 2,
                                    delay.as_millis(),
                                );
                                tokio::time::sleep(delay).await;
                            }
                        }
                        Err(e) => {
                            log::error!("Sidecar: spawn failed (attempt {}): {}", attempt + 1, e);
                            if attempt < max_retries - 1 {
                                tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
                            }
                        }
                    }
                }
                log::error!("Sidecar: all {} restart attempts exhausted — app restart needed", max_retries);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_models,
            get_active_model,
            get_session_stats,
            get_thinking_level,
            set_thinking_level,
            cycle_thinking_level,
            send_prompt,
            abort_prompt,
            steer_prompt,
            follow_up_prompt,
            clear_queue,
            send_ui_response,
            set_active_model,
            save_auth_key,
            list_custom_providers,
            save_custom_provider,
            delete_custom_provider,
            start_oauth,
            cancel_oauth,
            logout_provider,
            get_auth_status,
            has_credentials,
            google_connect,
            gh_auth_status,
            gh_organizations,
            gh_auth_login,
            gh_auth_cancel,
            gh_auth_logout,
            google_get_status,
            google_disconnect,
            google_get_prefs,
            google_save_prefs,
            google_get_app_status,
            google_install_app,
            reload_sidecar,
            get_username,
            list_sessions,
            save_session,
            load_session,
            delete_session,
            rename_session,
            set_session_pinned,
            search_sessions,
            new_session,
            get_workspace,
            get_settings,
            save_settings,
            get_instructions,
            save_instructions,
            list_extensions,
            tasks_list,
            tasks_delete,
            tasks_set_enabled,
            tasks_run_now,
            tasks_list_runs,
            tasks_get_completed,
            install_extension,
            uninstall_extension,
            set_extension_enabled,
            set_extension_config,
            get_extension_config_file,
            save_extension_config_file,
            search_discover,
            search_skills,
            list_skills,
            read_skill_md,
            install_skill,
            remove_skill,
            import_wallpaper,
            read_wallpaper,
            start_remote_server,
            stop_remote_server,
            get_remote_status,
            write_user_file,
            open_url,
            crate::analytics::track_analytics_event,
            crate::analytics::set_analytics_enabled,
            set_telemetry_enabled,
            get_install_context,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri");
}

#[cfg(test)]
mod tests {
    use super::{
        build_clear_queue_payload, build_follow_up_payload, build_install_context,
        build_steer_payload,
    };

    // ── In-app updater install context (#271) ───────────────────────────

    #[test]
    fn install_context_maps_known_platforms_and_flags() {
        let ctx = build_install_context("macos", false, "direct");
        assert_eq!(ctx["platform"], "macos");
        assert_eq!(ctx["isAppImage"], false);
        assert_eq!(ctx["channel"], "direct");
    }

    #[test]
    fn install_context_reports_appimage_on_linux() {
        let ctx = build_install_context("linux", true, "direct");
        assert_eq!(ctx["platform"], "linux");
        assert_eq!(ctx["isAppImage"], true);
    }

    #[test]
    fn install_context_defaults_empty_channel_to_direct() {
        let ctx = build_install_context("windows", false, "");
        assert_eq!(ctx["channel"], "direct");
    }

    #[test]
    fn install_context_preserves_managed_channel_marker() {
        let ctx = build_install_context("macos", false, "managed");
        assert_eq!(ctx["channel"], "managed");
    }

    // Wire-format guards: the sidecar's `case "steer"` / `case "follow_up"` /
    // `case "clear_queue"` handlers (agent-sidecar/src/index.ts) read these
    // exact fields. Drift here = silent breakage on the React → Rust → sidecar
    // path.

    #[test]
    fn steer_payload_uses_steer_type_with_text_and_id() {
        let p = build_steer_payload("st-abc", "hi there");
        assert_eq!(p["type"], "steer");
        assert_eq!(p["id"], "st-abc");
        assert_eq!(p["text"], "hi there");
    }

    #[test]
    fn follow_up_payload_uses_follow_up_type_with_text_and_id() {
        let p = build_follow_up_payload("fu-xyz", "after you finish");
        assert_eq!(p["type"], "follow_up");
        assert_eq!(p["id"], "fu-xyz");
        assert_eq!(p["text"], "after you finish");
    }

    #[test]
    fn steer_payload_preserves_text_with_newlines_and_unicode() {
        // Steering messages are user-authored composer input — must not
        // be mangled by serialization. The Tauri → sidecar transport is
        // LF-delimited JSONL so embedded `\n` and Unicode line separators
        // must round-trip via JSON escaping.
        let p = build_steer_payload("id", "line one\nline two — café");
        let serialized = serde_json::to_string(&p).unwrap();
        // The newline inside the user's text is escaped, never raw.
        assert!(
            !serialized.contains("line one\nline two"),
            "raw newline leaked into JSONL frame: {serialized}"
        );
        assert!(serialized.contains("line one\\nline two"));
        assert!(serialized.contains("caf\u{00e9}"));
    }

    #[test]
    fn clear_queue_payload_uses_clear_queue_type_with_id_only() {
        // No text field — clear_queue takes no input from the user. The
        // sidecar reads `type` to dispatch and `id` to route the response
        // envelope back through `pending_requests`.
        let p = build_clear_queue_payload("cq-abc");
        assert_eq!(p["type"], "clear_queue");
        assert_eq!(p["id"], "cq-abc");
        // Defensive: ensure no extra fields snuck in that the sidecar
        // doesn't expect (sidecar's strict TS Command union would refuse).
        let obj = p.as_object().expect("clear_queue payload is an object");
        assert_eq!(
            obj.len(),
            2,
            "unexpected fields in clear_queue payload: {p}"
        );
    }

    #[test]
    fn payloads_are_pure_no_shared_state_between_calls() {
        // Two calls with the same id must produce byte-identical JSON.
        let a = build_steer_payload("same", "hello");
        let b = build_steer_payload("same", "hello");
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
    }
}
