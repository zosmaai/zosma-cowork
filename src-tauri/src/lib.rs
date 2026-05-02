//! Tauri backend for Zosma Cowork — thin shell over the metaagents engine.
//!
//! This module wires the `metaagents` engine into Tauri commands. The engine
//! replaces the old subprocess approach (`pi --mode json`) with in-process
//! SDK sessions, giving us multi-turn conversations, steering, and <1ms
//! prompt latency.
//!
//! All Zosma Cowork config lives under `~/.zosmaai/agent/`. The pi SDK is
//! redirected to this directory via the `PI_CODING_AGENT_DIR` env var set
//! at startup.

use std::sync::Arc;

use metaagents::config::{self, ConfigSnapshot, ModelInfo, ProviderInfo};
use metaagents::engine::MetaAgentsEngine;
use metaagents::events::{categorize_engine_error, CoworkErrorPayload, CoworkEvent};
use metaagents::ext_installer::{self as ext_installer, InstallResult};
use metaagents::extensions::ExtensionInfo;
use serde::{Deserialize, Serialize};

mod telemetry;

// ---------------------------------------------------------------------------
// Types shared with the frontend
// ---------------------------------------------------------------------------

/// Pi CLI installation status (for the welcome screen).
#[derive(Serialize)]
struct PiStatus {
    installed: bool,
    version: Option<String>,
    path: Option<String>,
}

/// Result of creating a new session.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateSessionResult {
    session_id: String,
}

/// Payload for `set_active_model`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetModelPayload {
    session_id: String,
    provider: String,
    model_id: String,
}

/// Full config snapshot for the frontend settings panel.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigPayload {
    default_provider: Option<String>,
    default_model: Option<String>,
    providers: Vec<ProviderInfo>,
    models: Vec<ModelInfo>,
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

/// Global state shared across all Tauri commands.
///
/// Holds the engine (session manager) and a cached config snapshot.
struct AppState {
    engine: Arc<MetaAgentsEngine>,
    config: Arc<std::sync::RwLock<ConfigSnapshot>>,
    #[allow(dead_code)] // accessed via Tauri state mechanism
    telemetry_queue: telemetry::TelemetryQueue,
}

// ---------------------------------------------------------------------------
// Commands — session lifecycle
// ---------------------------------------------------------------------------

/// Create a new agent session. Returns the session ID.
#[tauri::command]
async fn create_session(
    session_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<CreateSessionResult, String> {
    state
        .engine
        .create_default_session(session_id.clone())
        .await
        .map_err(|e| e.to_string())?;

    Ok(CreateSessionResult { session_id })
}

/// Create a session with a specific provider/model.
#[tauri::command]
async fn create_session_with_model(
    session_id: String,
    provider: String,
    model: String,
    state: tauri::State<'_, AppState>,
) -> Result<CreateSessionResult, String> {
    state
        .engine
        .create_session_with_model(session_id.clone(), provider, model)
        .await
        .map_err(|e| e.to_string())?;

    Ok(CreateSessionResult { session_id })
}

/// Send a prompt to an existing session. Events stream through the Tauri channel.
///
/// Errors from the SDK/engine are sent through the channel as `CoworkEvent::Error`
/// with structured `CoworkErrorPayload` fields (provider, model, code, retryable).
/// The invoke always returns `Ok(())` — the frontend should listen for error
/// events on the channel rather than catching invoke exceptions.
#[tauri::command]
async fn send_prompt(
    session_id: String,
    prompt: String,
    channel: tauri::ipc::Channel<CoworkEvent>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let (mut event_rx, join_handle) = match state.engine.send_prompt(session_id, prompt).await {
        Ok((rx, jh)) => (rx, jh),
        Err(e) => {
            // Engine couldn't start the prompt (e.g., session not found).
            // Send a structured error through the channel.
            let payload = categorize_engine_error(&e.to_string());
            let _ = channel.send(CoworkEvent::Error(payload));
            return Ok(());
        }
    };

    // Forward engine events to the Tauri channel until the stream ends.
    while let Some(event) = event_rx.recv().await {
        if channel.send(event).is_err() {
            // Channel closed — frontend probably navigated away.
            break;
        }
    }

    // Check the final result for errors.
    // If the prompt failed, send a structured error through the channel
    // rather than returning an invoke error. This lets the frontend handle
    // errors consistently via the event stream.
    match join_handle.await {
        Ok(Ok(_)) => {}
        Ok(Err(engine_err)) => {
            let payload = categorize_engine_error(&engine_err.to_string());
            let _ = channel.send(CoworkEvent::Error(payload));
        }
        Err(join_err) => {
            let payload =
                CoworkErrorPayload::new("Internal error: the prompt task panicked".to_string())
                    .with_details(format!("{join_err}"))
                    .with_code("internal");
            let _ = channel.send(CoworkEvent::Error(payload));
        }
    }

    // Always return Ok — errors are communicated via the event channel.
    // Panics (task panics) will still propagate as a 500-style invoke error
    // but we've already sent a friendly error event to the frontend first.
    Ok(())
}

/// Abort the current prompt in a session.
#[tauri::command]
async fn abort_session(
    session_id: String,
    _state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    // TODO: Wire up abort via the engine once the SDK exposes it.
    // For now, return false to indicate no abort happened.
    let _ = session_id;
    Ok(false)
}

/// Delete a session from the engine.
#[tauri::command]
async fn delete_session(
    session_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    Ok(state.engine.drop_session(&session_id).await)
}

/// List active session IDs from the engine.
#[tauri::command]
async fn list_engine_sessions(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    Ok(state.engine.list_sessions().await)
}

// ---------------------------------------------------------------------------
// Commands — extensions & models
// ---------------------------------------------------------------------------

/// Discover installed extensions from pi's directories.
#[tauri::command]
async fn list_extensions() -> Result<Vec<ExtensionInfo>, String> {
    Ok(metaagents::extensions::discover_extensions())
}

/// List all installed extensions with their metadata (filesystem-based).
#[tauri::command]
async fn list_extensions_v2() -> Result<Vec<InstallResult>, String> {
    Ok(ext_installer::list_installed_extensions())
}

/// Payload for installing an extension.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallExtensionPayload {
    /// Source string: npm:<pkg>, git URL, or local path
    source: String,
    /// Optional git branch/tag/ref (only used for git sources)
    #[serde(default)]
    ref_name: Option<String>,
}

/// Install an extension from npm, git, or local path.
#[tauri::command]
async fn install_extension(payload: InstallExtensionPayload) -> Result<InstallResult, String> {
    let parsed = ext_installer::parse_source(&payload.source).map_err(|e| e.to_string())?;

    match parsed.source {
        ext_installer::ExtensionSource::Npm { package } => {
            ext_installer::install_from_npm(&package).map_err(|e| e.to_string())
        }
        ext_installer::ExtensionSource::Git { url, .. } => {
            ext_installer::install_from_git(&url, payload.ref_name.as_deref())
                .map_err(|e| e.to_string())
        }
        ext_installer::ExtensionSource::Local { path } => {
            ext_installer::install_from_local(&path).map_err(|e| e.to_string())
        }
    }
}

/// Uninstall an extension by ID.
#[tauri::command]
async fn uninstall_extension(id: String) -> Result<(), String> {
    ext_installer::uninstall_extension(&id).map_err(|e| e.to_string())
}

/// List configured providers and models from pi's settings.
#[tauri::command]
async fn list_providers(state: tauri::State<'_, AppState>) -> Result<ConfigPayload, String> {
    let config = state.config.read().unwrap_or_else(|e| e.into_inner());
    let defaults = config::default_model(&config);
    Ok(ConfigPayload {
        default_provider: defaults.as_ref().map(|(p, _)| p.clone()),
        default_model: defaults.as_ref().map(|(_, m)| m.clone()),
        providers: config.providers.clone(),
        models: config.models.clone(),
    })
}

/// Change the active model for a session.
#[tauri::command]
async fn set_active_model(
    payload: SetModelPayload,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .engine
        .set_session_model(payload.session_id, payload.provider, payload.model_id)
        .await
        .map_err(|e| e.to_string())
}

/// Reload config from disk (call after settings change).
#[tauri::command]
async fn reload_config(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let fresh = config::load_config();
    let mut guard = state.config.write().unwrap_or_else(|e| e.into_inner());
    *guard = fresh;
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands — provider configuration (models.json editing)
// ---------------------------------------------------------------------------

/// Get the raw models.json provider configuration for the frontend editor.
///
/// Returns the full content of models.json as a JSON value, or an empty
/// `{"providers":{}}` if the file doesn't exist.
#[tauri::command]
async fn get_models_config() -> Result<serde_json::Value, String> {
    Ok(config::read_models_json_raw())
}

/// Save a complete provider configuration to models.json.
///
/// This is called after the frontend finishes editing providers. It
/// replaces the entire file content, so the frontend must send the
/// complete state.
#[tauri::command]
async fn save_models_config(
    content: serde_json::Value,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    config::write_models_json_raw(&content)?;
    // Reload config so the engine picks up changes
    let fresh = config::load_config();
    let mut guard = state.config.write().unwrap_or_else(|e| e.into_inner());
    *guard = fresh;
    Ok(())
}

/// Add or update a single provider in models.json.
///
/// `provider_id` is the key (e.g., "openai", "anthropic").
/// `config` is a JSON object with the provider settings.
#[tauri::command]
async fn upsert_provider(
    provider_id: String,
    config_json: serde_json::Value,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    config::upsert_provider(&provider_id, &config_json)?;
    // Reload config
    let fresh = config::load_config();
    let mut guard = state.config.write().unwrap_or_else(|e| e.into_inner());
    *guard = fresh;
    Ok(())
}

/// Delete a provider from models.json.
#[tauri::command]
async fn delete_provider_cmd(
    provider_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    config::delete_provider(&provider_id)?;
    // Reload config
    let fresh = config::load_config();
    let mut guard = state.config.write().unwrap_or_else(|e| e.into_inner());
    *guard = fresh;
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands — auth configuration (auth.json)
// ---------------------------------------------------------------------------

/// Save an API key for a built-in provider in auth.json.
///
/// Creates the file if it doesn't exist. Merges with existing entries.
/// Uses the standard pi auth format.
#[tauri::command]
async fn save_auth_key(provider_id: String, api_key: String) -> Result<(), String> {
    config::save_auth_api_key(&provider_id, &api_key)
}

/// Check if any provider has a valid API key in auth.json.
///
/// Returns true if at least one provider entry has type "api_key" with a non-empty key.
#[tauri::command]
async fn has_any_credentials() -> bool {
    config::has_any_api_keys()
}

/// List all providers that have API keys configured in auth.json.
#[tauri::command]
async fn list_auth_providers() -> Vec<String> {
    config::list_auth_providers()
}

// ---------------------------------------------------------------------------
// Commands — pi CLI (welcome flow)
// ---------------------------------------------------------------------------

/// Check if the pi CLI is installed.
#[tauri::command]
async fn check_pi_status() -> Result<PiStatus, String> {
    let which_output = std::process::Command::new("which")
        .arg("pi")
        .output()
        .map_err(|e| format!("Failed to run which: {e}"))?;

    let path = if which_output.status.success() {
        Some(
            String::from_utf8_lossy(&which_output.stdout)
                .trim()
                .to_string(),
        )
    } else {
        None
    };

    let version = if path.is_some() {
        match std::process::Command::new("pi").arg("--version").output() {
            Ok(output) if output.status.success() => {
                Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
            }
            _ => None,
        }
    } else {
        None
    };

    Ok(PiStatus {
        installed: path.is_some(),
        version,
        path,
    })
}

/// Install the pi CLI globally via npm.
#[tauri::command]
async fn install_pi() -> Result<String, String> {
    let output = std::process::Command::new("npm")
        .args(["install", "-g", "@mariozechner/pi-coding-agent"])
        .output()
        .map_err(|e| format!("Failed to run npm install: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(format!(
            "npm install failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/// Get engine banner for diagnostics / about dialog.
#[tauri::command]
fn engine_banner() -> String {
    metaagents::banner()
}

// ---------------------------------------------------------------------------
// App entry
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Redirect the pi SDK to use ~/.zosmaai/agent/ instead of ~/.pi/agent/
    let agent_dir = config::ensure_agent_dir().expect("Failed to create agent directory");
    std::env::set_var("PI_CODING_AGENT_DIR", agent_dir.to_string_lossy().as_ref());

    let engine = Arc::new(MetaAgentsEngine::new());
    let config = Arc::new(std::sync::RwLock::new(config::load_config()));

    // Telemetry: event queue + background flush task
    let (telemetry_queue, flush_rx) = telemetry::TelemetryQueue::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            engine,
            config,
            telemetry_queue,
        })
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Spawn background telemetry flush task
            let app_handle = app.handle().clone();
            tokio::spawn(telemetry::spawn_flush_task(app_handle, flush_rx));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Session lifecycle
            create_session,
            create_session_with_model,
            send_prompt,
            abort_session,
            delete_session,
            list_engine_sessions,
            // Extensions & models
            list_extensions,
            list_extensions_v2,
            install_extension,
            uninstall_extension,
            list_providers,
            set_active_model,
            reload_config,
            // Provider configuration
            get_models_config,
            save_models_config,
            upsert_provider,
            delete_provider_cmd,
            // Auth configuration (auth.json)
            save_auth_key,
            has_any_credentials,
            list_auth_providers,
            // Pi CLI (welcome flow)
            check_pi_status,
            install_pi,
            // Diagnostics
            engine_banner,
            // Telemetry
            telemetry::telemetry_enabled,
            telemetry::telemetry_device_id,
            telemetry::telemetry_set_enabled,
            telemetry::telemetry_reset_device_id,
            telemetry::send_telemetry_event,
            telemetry::flush_telemetry,
            telemetry::report_crash,
            telemetry::get_app_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
