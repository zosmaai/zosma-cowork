//! Minimal anonymous analytics module for Zosma Cowork.
//!
//! Sends events to Aptabase's ingest API directly via reqwest.
//! Follows the client-side SDK spec: https://github.com/aptabase/aptabase/wiki/How-to-build-your-own-SDK

use std::{
    collections::VecDeque,
    sync::{Arc, RwLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use log::info;
use rand::Rng;
use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::{json, Value};
use tauri::Manager;

static DEFAULT_FLUSH_INTERVAL: Duration = Duration::from_secs(60);
static HTTP_TIMEOUT: Duration = Duration::from_secs(10);

/// Aptabase ingest host. EU keys (`A-EU-...`) must hit the EU collector.
fn ingest_host(app_key: &str) -> &'static str {
    if app_key.contains("EU") {
        "https://eu.aptabase.com"
    } else {
        "https://us.aptabase.com"
    }
}

/// Generate a session id matching Aptabase's expected format:
/// epoch seconds + 8 random digits.
fn new_session_id() -> String {
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let suffix: u32 = rand::thread_rng().gen_range(0..100_000_000);
    format!("{}{:08}", epoch, suffix)
}

/// Build system properties for every event.
fn system_props(app: &tauri::App) -> Value {
    let package_info = app.package_info();
    json!({
        "osName": std::env::consts::OS,
        "osVersion": std::env::consts::OS,
        "deviceModel": std::env::consts::ARCH,
        "locale": sys_locale::get_locale().map(|l| l.to_string()).unwrap_or_default(),
        "isDebug": cfg!(debug_assertions),
        "appVersion": package_info.version.to_string(),
        "sdkVersion": "zosma-analytics@0.1.0",
    })
}

/// Thread-safe internal queue of pending events.
pub(crate) struct EventQueue {
    inner: RwLock<VecDeque<Value>>,
    http_client: reqwest::Client,
    ingest_url: String,
    session_id: String,
    system_props: Value,
}

impl EventQueue {
    fn new(app_key: &str, session_id: String, system_props: Value) -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(
            "App-Key",
            HeaderValue::from_str(app_key).expect("invalid App-Key"),
        );
        headers.insert("Content-Type", HeaderValue::from_static("application/json"));

        let http_client = reqwest::Client::builder()
            .timeout(HTTP_TIMEOUT)
            .default_headers(headers)
            .build()
            .expect("failed to build reqwest client");

        let host = ingest_host(app_key);
        let ingest_url = format!("{}/api/v0/events", host);
        info!("Analytics ingest URL: {}", ingest_url);

        Self {
            inner: RwLock::new(VecDeque::new()),
            http_client,
            ingest_url,
            session_id,
            system_props,
        }
    }

    fn enqueue(&self, event: Value) {
        if let Ok(mut queue) = self.inner.write() {
            queue.push_back(event);
        }
    }

    /// Try to send all queued events. Errors are logged but not propagated.
    async fn flush(&self) {
        let batch: Vec<Value> = {
            let mut queue = self.inner.write().expect("lock queue");
            queue.drain(..).collect()
        };

        if batch.is_empty() {
            return;
        }

        info!("flushing {} analytics events", batch.len());

        let body = json!(batch);
        match self
            .http_client
            .post(&self.ingest_url)
            .json(&body)
            .send()
            .await
        {
            Ok(resp) => {
                if resp.status().is_success() {
                    info!("analytics flush OK");
                } else {
                    let status = resp.status();
                    let text = resp.text().await.unwrap_or_default();
                    info!("analytics flush returned {}: {}", status, text);
                }
            }
            Err(e) => info!("analytics flush failed: {}", e),
        }
    }
}

/// Public handle stored in Tauri state for the JS frontend to call.
pub(crate) struct Analytics {
    queue: Arc<EventQueue>,
    enabled: std::sync::atomic::AtomicBool,
}

impl Analytics {
    fn new(app_key: &str, session_id: String, system_props: Value) -> Self {
        let queue = Arc::new(EventQueue::new(app_key, session_id, system_props));
        Self {
            queue,
            enabled: std::sync::atomic::AtomicBool::new(true),
        }
    }

    /// Track an event if analytics is enabled.
    pub fn track_event(&self, name: &str, props: Option<Value>) {
        if !self.enabled.load(std::sync::atomic::Ordering::Relaxed) {
            return;
        }

        let timestamp = humantime::format_rfc3339_seconds(SystemTime::now()).to_string();
        let event = json!({
            "timestamp": timestamp,
            "sessionId": self.queue.session_id,
            "eventName": name,
            "systemProps": self.queue.system_props,
            "props": props.unwrap_or(json!({})),
        });
        info!("analytics event tracked: {}", name);
        self.queue.enqueue(event);
    }

    /// Enable or disable analytics.
    pub fn set_enabled(&self, enabled: bool) {
        self.enabled
            .store(enabled, std::sync::atomic::Ordering::Release);
    }

    /// Flush queued events immediately.
    pub(crate) async fn flush(&self) {
        self.queue.flush().await;
    }

    /// Spawn the background flush loop on the Tauri async runtime.
    fn start_flush_loop(&self) {
        let queue = self.queue.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(DEFAULT_FLUSH_INTERVAL).await;
                queue.flush().await;
            }
        });
    }
}

/// Tauri IPC command — track an anonymous event.
#[tauri::command]
pub(crate) fn track_analytics_event(
    app: tauri::AppHandle,
    name: String,
    props: Option<Value>,
) -> Result<(), String> {
    if let Some(analytics) = app.try_state::<Analytics>() {
        analytics.track_event(&name, props);
    }
    Ok(())
}

/// Tauri IPC command — enable or disable analytics.
#[tauri::command]
pub(crate) fn set_analytics_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if let Some(analytics) = app.try_state::<Analytics>() {
        analytics.set_enabled(enabled);
    }
    Ok(())
}

/// Tauri IPC command — flush the analytics queue immediately.
#[tauri::command]
pub(crate) async fn flush_analytics(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(analytics) = app.try_state::<Analytics>() {
        analytics.flush().await;
    }
    Ok(())
}

/// Set up the analytics system.
///
/// Call this from the app's `setup` closure (not from a plugin build),
/// so we are safely within Tauri's tokio runtime.
pub(crate) fn setup(app: &mut tauri::App, app_key: &str) -> Result<(), Box<dyn std::error::Error>> {
    let session_id = new_session_id();
    let system_props = system_props(app);
    let analytics = Analytics::new(app_key, session_id, system_props);
    analytics.start_flush_loop();
    app.manage(analytics);
    info!("Analytics initialized");

    // In dev builds, send a startup ping and flush immediately so we can
    // verify the pipeline end-to-end without waiting 60 seconds.
    #[cfg(debug_assertions)]
    {
        let app = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(3)).await;
            if let Some(analytics) = app.try_state::<Analytics>() {
                analytics.track_event("zosma_app_started", None);
                analytics.flush().await;
            }
        });
    }

    Ok(())
}
