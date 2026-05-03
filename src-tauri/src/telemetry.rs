//! Telemetry client for Zosma Cowork.
//!
//! Provides opt-in anonymous usage tracking. Events are batched in memory
//! and flushed periodically or on explicit flush requests. All state is
//! persisted to `~/.zosmaai/cowork/settings.json`.
//!
//! **Privacy guarantees:**
//! - No PII collected (no emails, names, file paths)
//! - No prompt content or responses tracked
//! - No API keys or auth tokens transmitted
//! - User must explicitly opt-in on first launch
//! - User can disable anytime in Settings

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tokio::sync::mpsc;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Telemetry backend URL (overridable via env var).
fn telemetry_url() -> String {
    std::env::var("ZOSMA_TELEMETRY_URL")
        .unwrap_or_else(|_| "https://telemetry.zosma.ai".to_string())
}

/// Flush interval in seconds.
const FLUSH_INTERVAL_SECS: u64 = 30;
/// Max events to batch before forcing a flush.
const MAX_BATCH_SIZE: usize = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Telemetry settings stored in `~/.zosmaai/cowork/settings.json`.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TelemetrySettings {
    pub enabled: bool,
    pub device_id: String,
}

impl Default for TelemetrySettings {
    fn default() -> Self {
        Self {
            enabled: false, // opt-in by default
            device_id: format!("anon_{}", uuid::Uuid::new_v4().as_hyphenated()),
        }
    }
}

/// A single telemetry event.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TelemetryEvent {
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<serde_json::Value>,
    pub timestamp: String,
}

/// Payload sent to the telemetry backend.
#[derive(Serialize, Deserialize)]
struct TelemetryBatch {
    device_id: String,
    events: Vec<TelemetryEvent>,
}

/// Response from the telemetry backend.
#[allow(dead_code)]
#[derive(Deserialize)]
struct BatchResponse {
    ok: bool,
}

/// Crash report payload.
#[derive(Serialize, Deserialize)]
struct CrashReport {
    device_id: String,
    stack_trace: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_type: Option<String>,
    app_version: String,
    os: String,
    timestamp: String,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// In-memory event queue shared between commands and the flush task.
pub struct TelemetryQueue {
    /// Pending events waiting to be flushed.
    events: Mutex<Vec<TelemetryEvent>>,
    /// Channel to trigger manual flushes. (accessed internally)
    #[allow(dead_code)]
    flush_tx: mpsc::Sender<()>,
}

impl TelemetryQueue {
    pub fn new() -> (Self, mpsc::Receiver<()>) {
        let (tx, rx) = mpsc::channel(16);
        (
            Self {
                events: Mutex::new(Vec::new()),
                flush_tx: tx,
            },
            rx,
        )
    }

    pub fn push(&self, event: TelemetryEvent) {
        let mut guard = self.events.lock().unwrap_or_else(|e| e.into_inner());
        guard.push(event);
    }

    pub fn take_all(&self) -> Vec<TelemetryEvent> {
        let mut guard = self.events.lock().unwrap_or_else(|e| e.into_inner());
        guard.drain(..).collect()
    }

    pub fn len(&self) -> usize {
        let guard = self.events.lock().unwrap_or_else(|e| e.into_inner());
        guard.len()
    }

    /// Request an async flush (non-blocking).
    #[allow(dead_code)]
    pub fn request_flush(&self) {
        let _ = self.flush_tx.try_send(());
    }
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

fn settings_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|e| format!("Home dir not found: {e}"))?;

    Ok(PathBuf::from(home)
        .join(".zosmaai")
        .join("cowork")
        .join("settings.json"))
}

fn load_settings() -> TelemetrySettings {
    let path = match settings_path() {
        Ok(p) => p,
        Err(_) => return TelemetrySettings::default(),
    };

    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(settings) = serde_json::from_str(&content) {
            return settings;
        }
    }

    // Generate new settings and persist them
    let settings = TelemetrySettings::default();
    let _ = save_settings(&settings);
    settings
}

fn save_settings(settings: &TelemetrySettings) -> Result<(), String> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create settings dir: {e}"))?;
    }
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;
    std::fs::write(&path, content).map_err(|e| format!("Failed to write settings: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Check if telemetry is enabled.
#[tauri::command]
pub fn telemetry_enabled() -> bool {
    load_settings().enabled
}

/// Get the anonymous device ID (generates one if not exists).
#[tauri::command]
pub fn telemetry_device_id() -> String {
    load_settings().device_id
}

/// Enable or disable telemetry.
#[tauri::command]
pub fn telemetry_set_enabled(enabled: bool) -> Result<(), String> {
    let mut settings = load_settings();
    settings.enabled = enabled;
    save_settings(&settings)
}

/// Reset the device ID (for privacy / data deletion requests).
#[tauri::command]
pub fn telemetry_reset_device_id() -> Result<String, String> {
    let mut settings = load_settings();
    settings.device_id = format!(
        "anon_{:?}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    save_settings(&settings)?;
    Ok(settings.device_id.clone())
}

/// Send a telemetry event (queues it for batch flush).
#[tauri::command]
pub async fn send_telemetry_event(
    app: tauri::AppHandle,
    event_type: String,
    properties: Option<serde_json::Value>,
) -> Result<(), String> {
    let settings = load_settings();
    if !settings.enabled {
        return Ok(()); // silently skip when disabled
    }

    let event = TelemetryEvent {
        event_type,
        properties,
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    app.state::<std::sync::Arc<TelemetryQueue>>().push(event);

    // If queue is getting large, flush immediately
    if app.state::<std::sync::Arc<TelemetryQueue>>().len() >= MAX_BATCH_SIZE {
        flush_telemetry_internal(&app).await;
    }

    Ok(())
}

/// Flush pending telemetry events to the backend.
#[tauri::command]
pub async fn flush_telemetry(app: tauri::AppHandle) -> Result<usize, String> {
    let settings = load_settings();
    if !settings.enabled {
        return Ok(0);
    }

    flush_telemetry_internal(&app).await;
    Ok(0)
}

/// Internal flush logic (called by both the command and periodic task).
async fn flush_telemetry_internal(app: &tauri::AppHandle) {
    let events = app.state::<std::sync::Arc<TelemetryQueue>>().take_all();
    if events.is_empty() {
        return;
    }

    let settings = load_settings();
    let batch = TelemetryBatch {
        device_id: settings.device_id,
        events,
    };

    send_batch(&batch).await;
}

/// Send a crash report.
#[tauri::command]
pub async fn report_crash(
    _app: tauri::AppHandle,
    stack_trace: String,
    error_type: Option<String>,
) -> Result<(), String> {
    let settings = load_settings();
    if !settings.enabled {
        return Ok(());
    }

    let report = CrashReport {
        device_id: settings.device_id,
        stack_trace,
        error_type,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    send_crash(&report).await;
    Ok(())
}

/// Get the last N lines of the app log file (for bug reports).
#[tauri::command]
pub fn get_app_logs(lines: Option<usize>) -> Result<Vec<String>, String> {
    let count = lines.unwrap_or(100);

    // Tauri log plugin writes to platform-specific locations.
    // For dev, we just return a placeholder. In production, read from the log dir.
    let log_dir = match std::env::var("HOME") {
        Ok(h) => PathBuf::from(h)
            .join(".zosmaai")
            .join("cowork")
            .join("logs"),
        Err(_) => return Ok(vec![]),
    };

    // Find the most recent log file
    let mut entries: Vec<PathBuf> = std::fs::read_dir(&log_dir)
        .ok()
        .into_iter()
        .flat_map(|d| d.filter_map(|e| e.ok()))
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "log")
                .unwrap_or(false)
        })
        .map(|e| e.path())
        .collect();

    entries.sort_by_key(|p| {
        p.metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    });

    let log_file = match entries.last() {
        Some(f) => f,
        None => return Ok(vec!["No log files found.".to_string()]),
    };

    let content =
        std::fs::read_to_string(log_file).map_err(|e| format!("Failed to read logs: {e}"))?;
    let anonymized = content
        .lines()
        .rev()
        .take(count)
        .collect::<Vec<&str>>()
        .into_iter()
        .rev()
        .map(anonymize_log_line)
        .collect();

    Ok(anonymized)
}

/// Anonymize a log line by removing potential PII (file paths, API keys).
fn anonymize_log_line(line: &str) -> String {
    let mut result = line.to_string();
    // Remove home directory paths
    if let Ok(home) = std::env::var("HOME") {
        result = result.replace(&home, "$HOME");
    }
    // Mask API keys (common prefixes)
    for prefix in ["sk-", "ozk_", "gsk_", "tgpv", "xai-", "AIza"] {
        if let Some(pos) = result.find(prefix) {
            // Replace the key portion after the prefix
            let start = pos;
            let end = (pos + 20).min(result.len());
            let key_part = &result[start..end];
            let masked = format!("{}****", &key_part[..2.min(key_part.len())]);
            result = format!("{}{}{}", &result[..start], masked, &result[end..]);
        }
    }
    result
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

async fn send_batch(batch: &TelemetryBatch) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::warn!("Failed to create HTTP client for telemetry: {e}");
            return;
        }
    };

    let url = format!("{}/api/v1/events", telemetry_url());

    match client.post(&url).json(batch).send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                log::debug!("Telemetry batch sent successfully");
            } else {
                log::warn!("Telemetry backend returned status: {}", resp.status());
            }
        }
        Err(e) => {
            // Non-fatal — don't crash the app over telemetry failures
            log::debug!("Telemetry send failed (non-fatal): {e}");
        }
    }
}

async fn send_crash(report: &CrashReport) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::warn!("Failed to create HTTP client for crash report: {e}");
            return;
        }
    };

    let url = format!("{}/api/v1/crash", telemetry_url());

    match client.post(&url).json(report).send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                log::debug!("Crash report sent successfully");
            } else {
                log::warn!("Crash report backend returned status: {}", resp.status());
            }
        }
        Err(e) => {
            log::debug!("Crash report send failed (non-fatal): {e}");
        }
    }
}

// ---------------------------------------------------------------------------
// Background flush task
// ---------------------------------------------------------------------------

/// Spawn the periodic flush task. Should be called once during app setup.
pub async fn spawn_flush_task(app: tauri::AppHandle, mut rx: mpsc::Receiver<()>) {
    let mut interval = tokio::time::interval(Duration::from_secs(FLUSH_INTERVAL_SECS));

    loop {
        tokio::select! {
            _ = interval.tick() => {
                flush_telemetry_internal(&app).await;
            }
            _ = rx.recv() => {
                // Manual flush requested
                flush_telemetry_internal(&app).await;
            }
        }
    }
}
