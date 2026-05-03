//! Node.js Sidecar — manages a persistent Node child process for Pi extension compatibility.
//!
//! The sidecar spawns a single Node.js process that uses `jiti` to dynamically
//! load TypeScript extensions (Pi packages). Communication with the sidecar
//! happens via JSON messages over stdin/stdout IPC.
//!
//! # Architecture
//!
//! ```text
//! ┌──────────────┐     JSON IPC      ┌─────────────────┐
//! │  Rust (Tauri)│ ←───────────────→ │  Node.js Sidecar │
//! │              │   stdin/stdout    │  (jiti + exts)   │
//! └──────────────┘                   └─────────────────┘
//! ```
//!
//! # Protocol
//!
//! Each message is a single JSON line (one JSON object per line):
//!
//! Request (Rust -> Node):
//! ```json
//! { "id": 1, "type": "invoke", "payload": { "extensionId": "@zosmaai/slides", "toolName": "generate_slides", "args": { ... } } }
//! { "id": 2, "type": "list_tools", "payload": { "extensionId": "@zosmaai/slides" } }
//! { "id": 3, "type": "load_extension", "payload": { "extensionPath": "/path/to/ext" } }
//! ```
//!
//! Response (Node -> Rust):
//! ```json
//! { "id": 1, "success": true, "result": { ... } }
//! { "id": 2, "success": false, "error": "extension not found" }
//! ```

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};

/// A response received from the sidecar via stdout.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarResponse {
    pub id: u64,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Shared state for the sidecar process.
struct SidecarInner {
    node_path: Option<PathBuf>,
    sidecar_entry: PathBuf,
    child: tokio::sync::Mutex<Option<Child>>,
    stdin: tokio::sync::Mutex<Option<ChildStdin>>,
    pending:
        tokio::sync::Mutex<HashMap<u64, tokio::sync::oneshot::Sender<Result<serde_json::Value>>>>,
    next_id: tokio::sync::Mutex<u64>,
}

/// Manage a Node.js sidecar process for Pi extension compatibility.
#[derive(Clone)]
pub struct Sidecar {
    inner: Arc<SidecarInner>,
}

impl Sidecar {
    /// Create a new sidecar manager.
    pub fn new(node_path: Option<PathBuf>, sidecar_entry: PathBuf) -> Self {
        Self {
            inner: Arc::new(SidecarInner {
                node_path,
                sidecar_entry,
                child: tokio::sync::Mutex::new(None),
                stdin: tokio::sync::Mutex::new(None),
                pending: tokio::sync::Mutex::new(HashMap::new()),
                next_id: tokio::sync::Mutex::new(1),
            }),
        }
    }

    /// Start the sidecar process.
    pub async fn start(&self) -> Result<()> {
        let node_bin = self
            .inner
            .node_path
            .clone()
            .unwrap_or_else(|| PathBuf::from("node"));

        log::info!(
            "Starting sidecar: {} {}",
            node_bin.display(),
            self.inner.sidecar_entry.display()
        );

        let mut child = tokio::process::Command::new(node_bin)
            .arg(&self.inner.sidecar_entry)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .context("Failed to spawn sidecar process")?;

        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("Failed to open stdin for sidecar"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("Failed to open stdout for sidecar"))?;

        // Write initial startup command
        let startup = serde_json::json!({
            "id": 0,
            "type": "init",
            "payload": {
                "extensionsDir": self.extensions_dir().to_string_lossy()
            }
        });
        let startup_msg = format!("{}\n", startup);
        stdin
            .write_all(startup_msg.as_bytes())
            .await
            .context("Failed to write startup message")?;
        stdin
            .flush()
            .await
            .context("Failed to flush startup message")?;

        *self.inner.child.lock().await = Some(child);
        *self.inner.stdin.lock().await = Some(stdin);

        // Spawn reader task for stdout
        let sidecar_clone = self.clone();
        tokio::spawn(async move {
            if let Err(e) = read_stdout_loop(sidecar_clone, stdout).await {
                log::error!("Sidecar stdout reader error: {}", e);
            }
        });

        // Wait for ready signal from sidecar
        let ready = self.send_request("ready", serde_json::json!({})).await;
        match ready {
            Ok(result) => {
                log::info!("Sidecar ready: {}", result);
                Ok(())
            }
            Err(e) => {
                log::warn!("Sidecar did not respond to ready: {}", e);
                // Non-fatal: sidecar may still be functional
                Ok(())
            }
        }
    }

    /// Send a request to the sidecar and await the response.
    pub async fn send_request(
        &self,
        request_type: &str,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let mut next_id = self.inner.next_id.lock().await;
        let id = *next_id;
        *next_id += 1;

        // Create oneshot channel for response
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.inner.pending.lock().await.insert(id, tx);

        // Build request message
        let request = serde_json::json!({
            "id": id,
            "type": request_type,
            "payload": payload
        });

        // Send via stdin
        let mut stdin = self.inner.stdin.lock().await;
        if let Some(ref mut s) = *stdin {
            let request_msg = format!("{}\n", request);
            s.write_all(request_msg.as_bytes())
                .await
                .context("Failed to write to sidecar stdin")?;
            s.flush().await.context("Failed to flush sidecar stdin")?;
        } else {
            return Err(anyhow!("Sidecar stdin not available"));
        }

        // Wait for response with timeout
        match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(anyhow!("Sidecar request channel closed")),
            Err(_) => Err(anyhow!("Sidecar request timed out (id={})", id)),
        }
    }

    /// Invoke a tool in a loaded extension.
    pub async fn invoke_tool(
        &self,
        extension_id: &str,
        tool_name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let payload = serde_json::json!({
            "extensionId": extension_id,
            "toolName": tool_name,
            "args": args
        });
        self.send_request("invoke", payload).await
    }

    /// List all available tools in an extension.
    pub async fn list_tools(&self, extension_id: &str) -> Result<serde_json::Value> {
        let payload = serde_json::json!({
            "extensionId": extension_id
        });
        self.send_request("list_tools", payload).await
    }

    /// Load an extension from a filesystem path.
    pub async fn load_extension(&self, extension_path: &str) -> Result<serde_json::Value> {
        let payload = serde_json::json!({
            "extensionPath": extension_path
        });
        self.send_request("load_extension", payload).await
    }

    /// List all loaded extensions and their tools from the sidecar.
    pub async fn list_all_extensions(&self) -> Result<serde_json::Value> {
        self.send_request("list_extensions", serde_json::json!({}))
            .await
    }

    /// Get the extensions directory path.
    pub fn extensions_dir(&self) -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".zosmaai")
            .join("agent")
            .join("extensions")
    }

    /// Check if the sidecar process is running.
    pub async fn is_running(&self) -> bool {
        let child = self.inner.child.lock().await;
        match child.as_ref() {
            Some(c) => c.id().is_some(),
            None => false,
        }
    }
}

/// Background task: read stdout lines and dispatch responses to pending requests.
async fn read_stdout_loop(sidecar: Sidecar, stdout: ChildStdout) -> Result<()> {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break, // EOF
            Ok(_) => {
                let line = line.trim().to_string();
                if line.is_empty() {
                    continue;
                }

                // Try to parse as sidecar response
                if let Ok(response) = serde_json::from_str::<SidecarResponse>(&line) {
                    log::debug!(
                        "Sidecar response: id={} success={}",
                        response.id,
                        response.success
                    );

                    let mut pending = sidecar.inner.pending.lock().await;
                    if let Some(tx) = pending.remove(&response.id) {
                        let _ = tx.send(if response.success {
                            Ok(response.result.unwrap_or(serde_json::json!(null)))
                        } else {
                            Err(anyhow!(
                                "{}",
                                response
                                    .error
                                    .unwrap_or_else(|| "Unknown error".to_string())
                            ))
                        });
                    }
                } else {
                    // Non-JSON line (e.g., logs from sidecar)
                    log::debug!("Sidecar output: {}", line);
                }
            }
            Err(e) => {
                log::warn!("Sidecar stdout read error: {}", e);
                break;
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sidecar_creation() {
        let entry = PathBuf::from("/fake/sidecar.mjs");
        let sidecar = Sidecar::new(None, entry);
        assert_eq!(*sidecar.inner.next_id.blocking_lock(), 1);
    }

    #[test]
    fn test_extensions_dir() {
        let entry = PathBuf::from("/fake/sidecar.mjs");
        let sidecar = Sidecar::new(None, entry);
        let dir = sidecar.extensions_dir();
        assert!(dir.to_string_lossy().contains(".zosmaai"));
        assert!(dir.to_string_lossy().contains("extensions"));
    }

    #[test]
    fn test_sidecar_response_serialization() {
        let resp = SidecarResponse {
            id: 1,
            success: true,
            result: Some(serde_json::json!({"output": "hello"})),
            error: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"success\":true"));
    }

    #[test]
    fn test_sidecar_response_error() {
        let resp = SidecarResponse {
            id: 2,
            success: false,
            result: None,
            error: Some("not found".to_string()),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"success\":false"));
        assert!(json.contains("not found"));
    }

    #[test]
    fn test_sidecar_clone() {
        let entry = PathBuf::from("/fake/sidecar.mjs");
        let sidecar = Sidecar::new(None, entry);
        let clone = sidecar.clone();
        assert_eq!(sidecar.extensions_dir(), clone.extensions_dir());
    }
}
