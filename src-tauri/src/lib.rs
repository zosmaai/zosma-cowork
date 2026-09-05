//! Zosma Cowork shell.
//!
//! The app is a browser, not an app: one window pinned to
//! `http://127.0.0.1:{SHARED_PORT}` serving the Zosma Harness web UI (`web/`).
//! All UI, API, and agent logic lives in that Next.js server (the pi SDK runs
//! in-process there). This process does exactly three things:
//!
//! 1. Probe `127.0.0.1:30141`. If a server is already there, attach to it
//!    ("borrowed") and never kill it on quit.
//! 2. If nothing listens (production build), spawn the bundled Node running
//!    the web server launcher (`bin/pi-web.js`) and wait for the port
//!    (≤ 30 s), showing the captured log tail on failure.
//! 3. On quit, kill the server it spawned ("owned"), wait ≤ 5 s, then exit.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

/// The single port contract, shared with `web/package.json` (CI guards it).
pub const SHARED_PORT: u16 = 30141;

const PROBE_TIMEOUT: Duration = Duration::from_millis(250);
const SPAWN_WAIT: Duration = Duration::from_secs(30);
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);
const LOG_RING: usize = 200;

/// Shared server-lifecycle state: the child we may own, plus a bounded log
/// tail of its output (for the startup-failure dialog).
#[derive(Default)]
struct Shared {
    child: Mutex<Option<Child>>,
    owned: AtomicBool,
    log_tail: Mutex<VecDeque<String>>,
}

impl Shared {
    fn push_log(&self, line: &str) {
        log::info!("[web-server] {line}");
        let mut tail = self.log_tail.lock().unwrap();
        if tail.len() >= LOG_RING {
            tail.pop_front();
        }
        tail.push_back(line.to_string());
    }

    fn tail(&self, n: usize) -> String {
        let guard = self.log_tail.lock().unwrap();
        guard
            .iter()
            .skip(guard.len().saturating_sub(n))
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    }
}

// ---------------------------------------------------------------------------
// Reused verbatim from the sidecar-era lib.rs: bundled-Node resolution.
// ---------------------------------------------------------------------------

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
/// the server's first line runs. The crash is invisible because the
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

// ---------------------------------------------------------------------------
// Web-server launcher resolution.
// ---------------------------------------------------------------------------

const WEB_ENTRY_REL: &str = "web/dist-server/bin/pi-web.js";

/// Resolve the web server launcher (`pi-web.js`): dev repo source in debug
/// builds, bundled resource layout (`web/dist-server/**`) in production,
/// then system install paths, then the path relative to the executable.
fn find_web_entry(app: &tauri::AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("web")
            .join("bin")
            .join("pi-web.js");
        if dev.exists() {
            return dev;
        }
    }

    // Production resource dir — works on macOS .app bundles
    // and Linux AppImage/dpkg builds, and Windows installers.
    let resource = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(WEB_ENTRY_REL);
    if resource.exists() {
        return strip_unc_prefix(resource);
    }

    // Check common system paths for distro-packaged installations.
    // Linux: /usr/lib/zosma-cowork/web/dist-server/bin/pi-web.js
    // Windows: %PROGRAMFILES%\ZosmaAI\ZosmaCoWork\web\dist-server\bin\pi-web.js
    #[cfg(target_os = "windows")]
    for root in [
        std::env::var("PROGRAMFILES").unwrap_or_else(|_| "C:\\Program Files".into()),
        std::env::var("LOCALAPPDATA").unwrap_or_default(),
    ] {
        if root.is_empty() {
            continue;
        }
        let p = PathBuf::from(format!(
            "{}\\ZosmaAI\\ZosmaCoWork\\web\\dist-server\\bin\\pi-web.js",
            root
        ));
        if p.exists() {
            return p;
        }
    }

    #[cfg(target_os = "linux")]
    {
        let p = PathBuf::from("/usr/lib/zosma-cowork/web/dist-server/bin/pi-web.js");
        if p.exists() {
            return p;
        }
    }

    // Try relative to the current executable (portable installs, manual
    // unpack, or any non-standard layout).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let rel = exe_dir.join("../lib/zosma-cowork").join(WEB_ENTRY_REL);
            if rel.exists() {
                return rel;
            }
        }
    }

    // Last resort — dev fallback (only useful during development)
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("web")
        .join("bin")
        .join("pi-web.js")
}

// ---------------------------------------------------------------------------
// Port probe + server lifecycle.
// ---------------------------------------------------------------------------

fn probe_addr() -> SocketAddr {
    format!("127.0.0.1:{SHARED_PORT}")
        .parse()
        .expect("static loopback address")
}

fn port_open() -> bool {
    TcpStream::connect_timeout(&probe_addr(), PROBE_TIMEOUT).is_ok()
}

fn wait_until_open() -> bool {
    let deadline = Instant::now() + SPAWN_WAIT;
    loop {
        if port_open() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn show_dialog(app: &tauri::AppHandle, kind: MessageDialogKind, message: &str) {
    // blocking_show must not run on the main thread — every call site runs
    // on a dedicated std thread or a tokio worker.
    let _ = app
        .dialog()
        .message(message)
        .title("Zosma Cowork")
        .kind(kind)
        .blocking_show();
}

/// Kill the owned server and wait for a clean exit (≤ 5 s).
fn stop_owned_server(shared: &Shared) {
    let mut child = match shared.child.lock().unwrap().take() {
        Some(c) => c,
        None => {
            shared.owned.store(false, Ordering::SeqCst);
            return;
        }
    };
    let pid = child.id();
    if cfg!(target_os = "windows") {
        // No portable SIGTERM on Windows — taskkill /T takes down pi-web and
        // its `next start` child together, so neither is orphaned.
        let id = pid.to_string();
        let _ = Command::new("taskkill")
            .args(["/PID", &id, "/T", "/F"])
            .status();
    } else {
        // SIGTERM: pi-web's process-lifecycle handler forwards it to `next`
        // itself and force-kills after 5 s, so the tree cleans up on its own.
        let _ = child.kill();
    }
    let deadline = Instant::now() + SHUTDOWN_GRACE;
    while Instant::now() < deadline {
        if child.try_wait().ok().flatten().is_some() {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    log::info!("web server stopped (pid {pid})");
    shared.owned.store(false, Ordering::SeqCst);
}

fn drain_pipe(stream: impl std::io::Read + Send + 'static, shared: Arc<Shared>) {
    thread::spawn(move || {
        for line in BufReader::new(stream).lines() {
            match line {
                Ok(l) => shared.push_log(&l),
                Err(_) => break,
            }
        }
    });
}

/// Spawn the bundled web server and wait for the port to come up.
fn start_owned_server(app: &tauri::AppHandle, shared: &Arc<Shared>) {
    let node = find_node(app);
    let entry = find_web_entry(app);
    log::info!("spawning web server: {node:?} {entry:?} --port {SHARED_PORT}");
    let spawned = Command::new(&node)
        .arg(&entry)
        .args(["--port", &SHARED_PORT.to_string(), "--no-open"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => {
            log::error!("failed to spawn web server: {e}");
            show_dialog(
                app,
                MessageDialogKind::Error,
                &format!(
                    "Failed to start the Zosma web server on 127.0.0.1:{SHARED_PORT}.\n\n\
                     Bundled Node: {node:?}\nLauncher: {entry:?}\n\nDetails: {e}"
                ),
            );
            return;
        }
    };

    // Drain both pipes into the log ring: keeps the server from blocking on
    // full pipe buffers, and the tail is surfaced in the failure dialog below.
    if let Some(out) = child.stdout.take() {
        drain_pipe(out, shared.clone());
    }
    if let Some(err) = child.stderr.take() {
        drain_pipe(err, shared.clone());
    }

    shared.child.lock().unwrap().replace(child);
    shared.owned.store(true, Ordering::SeqCst);

    if wait_until_open() {
        log::info!("web server up on 127.0.0.1:{SHARED_PORT}");
    } else {
        log::error!(
            "web server did not open 127.0.0.1:{SHARED_PORT} within {:?}",
            SPAWN_WAIT
        );
        let tail = shared.tail(50);
        stop_owned_server(shared);
        show_dialog(
            app,
            MessageDialogKind::Error,
            &format!(
                "The Zosma web server failed to start on 127.0.0.1:{SHARED_PORT}.\n\n\
                 --- last log lines ---\n{tail}"
            ),
        );
    }
}

// ---------------------------------------------------------------------------
// Updater (endpoint + pubkey unchanged — in-place updates keep working).
// ---------------------------------------------------------------------------

fn check_for_updates(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Some(updater) = app.updater().ok() else {
            return;
        };
        let update = match updater.check().await {
            Ok(Some(u)) => u,
            Ok(None) => return,
            Err(e) => {
                log::warn!("update check failed: {e}");
                return;
            }
        };
        let version = update.version.to_string();
        let current = app.package_info().version.to_string();
        if version == current {
            return;
        }
        let confirmed = app
            .dialog()
            .message(format!(
                "Zosma Cowork {version} is available (running {current}). Install now?"
            ))
            .title("Zosma Cowork")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Install".into(),
                "Later".into(),
            ))
            .blocking_show();
        if !confirmed {
            return;
        }
        match update
            .download_and_install(
                |done, total| {
                    log::debug!("update downloaded {done}/{total:?}");
                },
                || {},
            )
            .await
        {
            Ok(()) => {
                // Install replaced the binary — spawn the fresh one and exit.
                if let Ok(exe) = std::env::current_exe() {
                    let _ = Command::new(&exe).spawn();
                }
                app.exit(0);
            }
            Err(e) => {
                show_dialog(
                    &app,
                    MessageDialogKind::Error,
                    &format!("Update failed: {e}"),
                );
            }
        }
    });
}

// ---------------------------------------------------------------------------
// App entry.
// ---------------------------------------------------------------------------

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    // Per-platform browser opener. The Windows path is load-bearing (ported
    // from the old sidecar-era shell): the URL MUST be wrapped in double
    // quotes and appended via `raw_arg` so Rust doesn't re-escape it —
    // cmd.exe treats `&` as a command separator and would truncate a PKCE
    // authorization URL at the first `&`.
    if url != url.trim() || !url.starts_with("http") {
        return Err("Invalid URL".into());
    }
    #[cfg(target_os = "windows")]
    let result = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/c", "start", ""])
            .raw_arg(format!("\"{url}\""))
            .creation_flags(0x0800_0000)
            .status()
    };
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).status();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(&url).status();

    let st = result.map_err(|e| format!("open: {e}"))?;
    if !st.success() {
        return Err(format!("exit: {st}"));
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(Arc::new(Shared::default()))
        .setup(|app| {
            let shared = app.state::<Arc<Shared>>().inner().clone();
            let handle = app.handle().clone();
            thread::spawn(move || {
                if port_open() {
                    log::info!(
                        "127.0.0.1:{SHARED_PORT} already serving — borrowing (server is NOT killed on quit)"
                    );
                    return;
                }
                if cfg!(debug_assertions) {
                    // In dev the web server belongs to the developer
                    // (beforeDevCommand: `pnpm -C web dev`).
                    show_dialog(
                        &handle,
                        MessageDialogKind::Warning,
                        "No web server on 127.0.0.1:30141.\n\nStart the dev server:\n  pnpm -C web dev",
                    );
                    return;
                }
                start_owned_server(&handle, &shared);
            });
            if !cfg!(debug_assertions) {
                check_for_updates(app.handle().clone());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let shared: Arc<Shared> = window.state::<Arc<Shared>>().inner().clone();
                if shared.owned.load(Ordering::SeqCst) && shared.child.lock().unwrap().is_some()
                {
                    let handle = window.app_handle().clone();
                    api.prevent_close();
                    thread::spawn(move || {
                        stop_owned_server(&shared);
                        handle.exit(0);
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![open_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
