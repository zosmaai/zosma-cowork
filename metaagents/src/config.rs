//! Configuration reader — reads Zosma settings and model registry from disk.
//!
//! All Zosma Cowork configuration lives under `~/.zosmaai/agent/`:
//! - `settings.json` — default provider, model, packages, etc.
//! - `models.json` — custom provider definitions and models
//! - `auth.json` — API keys for built-in providers
//!
//! The pi SDK is also redirected to this directory via the
//! `PI_CODING_AGENT_DIR` env var set at Tauri startup.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Provider configuration from models.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    /// Base URL for the provider API.
    pub base_url: Option<String>,
    /// API type (e.g., "openai-completions", "anthropic").
    pub api: Option<String>,
    /// API key (may be empty if using OAuth or local).
    #[serde(default)]
    pub api_key: String,
    /// List of models available for this provider.
    #[serde(default)]
    pub models: Vec<ModelConfig>,
}

/// Model configuration from models.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    /// Unique model identifier (e.g., "claude-sonnet-4").
    pub id: String,
    /// Human-readable display name.
    #[serde(default)]
    pub name: String,
    /// Whether the model supports reasoning/thinking.
    #[serde(default)]
    pub reasoning: bool,
    /// Accepted input types.
    #[serde(default)]
    pub input: Vec<String>,
    /// Context window size in tokens.
    #[serde(default)]
    pub context_window: u32,
    /// Maximum output tokens.
    #[serde(default)]
    pub max_tokens: u32,
    /// Cost information.
    #[serde(default)]
    pub cost: Option<CostConfig>,
}

/// Cost configuration for a model.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CostConfig {
    #[serde(default)]
    pub input: f64,
    #[serde(default)]
    pub output: f64,
    #[serde(default)]
    pub cache_read: f64,
    #[serde(default)]
    pub cache_write: f64,
}

/// Parsed pi settings from settings.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSettings {
    /// Default provider ID.
    #[serde(default)]
    pub default_provider: Option<String>,
    /// Default model ID.
    #[serde(default)]
    pub default_model: Option<String>,
    /// Default thinking level.
    #[serde(default)]
    pub default_thinking_level: Option<String>,
    /// Installed packages (extensions, skills, etc.).
    #[serde(default)]
    pub packages: Vec<String>,
    /// Enabled model patterns for filtering.
    #[serde(default, rename = "enabledModels")]
    pub enabled_models: Vec<String>,
}

/// Complete configuration snapshot combining settings and models.
#[derive(Debug, Clone)]
pub struct ConfigSnapshot {
    /// Parsed settings from settings.json.
    pub settings: Option<PiSettings>,
    /// Provider definitions from models.json.
    pub providers: Vec<ProviderInfo>,
    /// All available models across all providers.
    pub models: Vec<ModelInfo>,
}

/// Provider info for the frontend (simplified from ProviderConfig).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    /// Provider ID (e.g., "anthropic", "openai").
    pub id: String,
    /// Display name.
    #[serde(default)]
    pub name: String,
    /// API type.
    #[serde(default)]
    pub api: String,
    /// Number of models available.
    #[serde(default)]
    pub model_count: usize,
}

/// Model info for the frontend (includes provider context).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    /// Unique model identifier.
    pub id: String,
    /// Human-readable display name.
    #[serde(default)]
    pub name: String,
    /// Provider this model belongs to.
    pub provider: String,
    /// Whether the model supports reasoning/thinking.
    #[serde(default)]
    pub reasoning: bool,
    /// Context window size in tokens.
    #[serde(default)]
    pub context_window: u32,
    /// Maximum output tokens.
    #[serde(default)]
    pub max_tokens: u32,
}

/// Load the complete configuration snapshot from disk.
pub fn load_config() -> ConfigSnapshot {
    let agent_dir = zosmaai_agent_dir();

    let settings = load_settings(&agent_dir);
    let (providers, models) = load_models(&agent_dir);

    ConfigSnapshot {
        settings,
        providers,
        models,
    }
}

/// Load settings from the agent directory.
fn load_settings(agent_dir: &Path) -> Option<PiSettings> {
    let settings_path = agent_dir.join("settings.json");
    let content = std::fs::read_to_string(&settings_path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Load provider and model definitions from models.json.
fn load_models(agent_dir: &Path) -> (Vec<ProviderInfo>, Vec<ModelInfo>) {
    let models_path = agent_dir.join("models.json");
    let content = match std::fs::read_to_string(&models_path) {
        Ok(c) => c,
        Err(_) => return (Vec::new(), Vec::new()),
    };

    #[derive(Deserialize)]
    struct ModelsFile {
        #[serde(default)]
        providers: std::collections::HashMap<String, ProviderConfig>,
    }

    let models_file: ModelsFile = match serde_json::from_str(&content) {
        Ok(f) => f,
        Err(_) => return (Vec::new(), Vec::new()),
    };

    let mut providers = Vec::new();
    let mut models = Vec::new();

    for (provider_id, config) in models_file.providers {
        let provider_info = ProviderInfo {
            id: provider_id.clone(),
            name: provider_id
                .chars()
                .next()
                .map(|c| c.to_uppercase().to_string())
                .unwrap_or_default()
                + &provider_id[1..],
            api: config.api.clone().unwrap_or_default(),
            model_count: config.models.len(),
        };

        for model in config.models {
            models.push(ModelInfo {
                id: model.id,
                name: model.name,
                provider: provider_id.clone(),
                reasoning: model.reasoning,
                context_window: model.context_window,
                max_tokens: model.max_tokens,
            });
        }

        providers.push(provider_info);
    }

    (providers, models)
}

/// Get the home directory path.
fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("/"))
}

/// Return the base `~/.zosmaai/` directory.
pub fn zosmaai_dir() -> PathBuf {
    home_dir().join(".zosmaai")
}

/// Return the `~/.zosmaai/agent/` directory where all config lives.
pub fn zosmaai_agent_dir() -> PathBuf {
    zosmaai_dir().join("agent")
}

/// Ensure `~/.zosmaai/agent/` exists on disk (creates parent dirs too).
///
/// Call this once at app startup so that config writes never fail due to
/// missing directories.
pub fn ensure_agent_dir() -> Result<PathBuf, String> {
    let dir = zosmaai_agent_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create agent dir {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Get the default provider/model from settings.
pub fn default_model(config: &ConfigSnapshot) -> Option<(String, String)> {
    let settings = config.settings.as_ref()?;
    let provider = settings.default_provider.clone()?;
    let model = settings.default_model.clone()?;
    Some((provider, model))
}

/// List installed package names from settings.
pub fn list_packages(config: &ConfigSnapshot) -> Vec<String> {
    config
        .settings
        .as_ref()
        .map(|s| s.packages.clone())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Provider configuration write support (models.json editing)
// ---------------------------------------------------------------------------

/// Path to `~/.zosmaai/agent/models.json`.
pub fn models_json_path() -> PathBuf {
    zosmaai_agent_dir().join("models.json")
}

/// Read the raw models.json content as a JSON value.
///
/// Returns an empty object `{}` if the file doesn't exist or can't be parsed.
pub fn read_models_json_raw() -> serde_json::Value {
    let path = models_json_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => {
            serde_json::from_str(&content).unwrap_or(serde_json::json!({"providers": {}}))
        }
        Err(_) => serde_json::json!({"providers": {}}),
    }
}

/// Write a complete models.json file with the given content.
///
/// Expects a JSON object with a `"providers"` key. Returns an error if the
/// content can't be serialized or the file can't be written.
pub fn write_models_json_raw(content: &serde_json::Value) -> Result<(), String> {
    let path = models_json_path();
    let pretty = serde_json::to_string_pretty(content)
        .map_err(|e| format!("Failed to serialize models config: {e}"))?;
    std::fs::write(&path, pretty).map_err(|e| format!("Failed to write models.json: {e}"))?;
    Ok(())
}

/// Add or update a provider configuration in models.json.
///
/// Takes the provider ID and a JSON object with provider settings.
/// Merges with existing models list if the provider already exists.
pub fn upsert_provider(
    provider_id: &str,
    provider_config: &serde_json::Value,
) -> Result<(), String> {
    let mut root = read_models_json_raw();

    // Ensure root is an object with a "providers" map
    let providers = root
        .as_object_mut()
        .and_then(|o| o.get_mut("providers"))
        .and_then(|p| p.as_object_mut())
        .ok_or_else(|| "models.json root must be an object with a 'providers' map".to_string())?;

    providers.insert(provider_id.to_string(), provider_config.clone());

    write_models_json_raw(&root)
}

/// Remove a provider from models.json.
pub fn delete_provider(provider_id: &str) -> Result<(), String> {
    let mut root = read_models_json_raw();

    let providers = root
        .as_object_mut()
        .and_then(|o| o.get_mut("providers"))
        .and_then(|p| p.as_object_mut())
        .ok_or_else(|| "models.json root must be an object with a 'providers' map".to_string())?;

    providers.remove(provider_id);

    write_models_json_raw(&root)
}

/// Return the `~/.zosmaai/agent/` directory (alias for zosmaai_agent_dir).
#[deprecated(since = "0.3.0", note = "Use zosmaai_agent_dir() instead")]
pub fn agent_dir() -> PathBuf {
    zosmaai_agent_dir()
}

// ---------------------------------------------------------------------------
// Auth configuration (auth.json — API keys for built-in providers)
// ---------------------------------------------------------------------------

/// Path to `~/.zosmaai/agent/auth.json`.
pub fn auth_json_path() -> PathBuf {
    zosmaai_agent_dir().join("auth.json")
}

/// Read the raw auth.json content as a JSON value.
///
/// Returns an empty object `{}` if the file doesn't exist or can't be parsed.
pub fn read_auth_json() -> serde_json::Value {
    let path = auth_json_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or(serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    }
}

/// Return default model definitions for known built-in providers.
///
/// When a user saves an API key for one of these providers, we automatically
/// populate `models.json` with these models so the dropdown is not empty.
pub fn builtin_provider_models(provider_id: &str) -> Option<Vec<serde_json::Value>> {
    let models = match provider_id {
        // Crof AI — OpenAI-compatible gateway
        "crofai" => vec![
            model_entry("gpt-4o", "GPT-4o"),
            model_entry("gpt-4o-mini", "GPT-4o Mini"),
            model_entry("o3-mini", "O3 Mini"),
            model_entry("claude-sonnet-4-20250514", "Claude Sonnet 4"),
        ],
        // OpenCode Go — budget-friendly aggregator
        "opencode-go" => vec![
            model_entry("gpt-4o", "GPT-4o"),
            model_entry("gpt-4o-mini", "GPT-4o Mini"),
            model_entry("claude-sonnet-4-20250514", "Claude Sonnet 4"),
        ],
        // OpenAI
        "openai" => vec![
            model_entry("gpt-4o", "GPT-4o"),
            model_entry("gpt-4o-mini", "GPT-4o Mini"),
            model_entry("o3-mini", "O3 Mini"),
        ],
        // Anthropic
        "anthropic" => vec![
            model_entry("claude-sonnet-4-20250514", "Claude Sonnet 4"),
            model_entry("claude-opus-4-20250514", "Claude Opus 4"),
        ],
        // Google (Gemini)
        "google" => vec![
            model_entry("gemini-2.5-flash", "Gemini 2.5 Flash"),
            model_entry("gemini-2.5-pro", "Gemini 2.5 Pro"),
        ],
        // Groq
        "groq" => vec![
            model_entry("llama-3.3-70b-versatile", "Llama 3.3 70B"),
            model_entry("llama-3.1-8b-instant", "Llama 3.1 8B"),
        ],
        // Together AI
        "together" => vec![model_entry(
            "meta-llama/Llama-3.3-70B-Instruct-Turbo",
            "Llama 3.3 70B",
        )],
        // xAI
        "xai" => vec![
            model_entry("grok-2-1212", "Grok 2"),
            model_entry("grok-3", "Grok 3"),
        ],
        _ => return None,
    };
    Some(models)
}

/// Create a minimal model entry JSON object.
fn model_entry(id: &str, name: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "name": name
    })
}

/// Save an API key for a built-in provider in auth.json.
///
/// Creates the file if it doesn't exist. Merges with existing entries.
/// Uses the standard pi auth format: `{ "provider-id": { "type": "api_key", "key": "..." } }`.
///
/// Additionally, if the provider is a known built-in provider, this function
/// automatically populates `models.json` with default model definitions so that
/// the model dropdown in the UI is not empty after saving an API key.
pub fn save_auth_api_key(provider_id: &str, api_key: &str) -> Result<(), String> {
    let mut root = read_auth_json();

    let providers = root
        .as_object_mut()
        .ok_or_else(|| "auth.json root must be an object".to_string())?;

    providers.insert(
        provider_id.to_string(),
        serde_json::json!({
            "type": "api_key",
            "key": api_key
        }),
    );

    let path = auth_json_path();
    let pretty = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Failed to serialize auth config: {e}"))?;
    std::fs::write(&path, pretty).map_err(|e| format!("Failed to write auth.json: {e}"))?;

    // Also populate models.json for known built-in providers
    if let Some(models) = builtin_provider_models(provider_id) {
        let provider_config = serde_json::json!({
            "models": models
        });
        upsert_provider(provider_id, &provider_config)
            .map_err(|e| format!("Failed to populate models for {provider_id}: {e}"))?;
    }

    Ok(())
}

/// Remove an auth entry for a provider from auth.json.
pub fn remove_auth_entry(provider_id: &str) -> Result<(), String> {
    let mut root = read_auth_json();

    let providers = root
        .as_object_mut()
        .ok_or_else(|| "auth.json root must be an object".to_string())?;

    providers.remove(provider_id);

    let path = auth_json_path();
    let pretty = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Failed to serialize auth config: {e}"))?;
    std::fs::write(&path, pretty).map_err(|e| format!("Failed to write auth.json: {e}"))?;
    Ok(())
}

/// Check if any provider has a valid API key configured in auth.json.
///
/// Returns true if at least one provider entry has type "api_key" with a non-empty key.
pub fn has_any_api_keys() -> bool {
    let root = read_auth_json();
    let Some(obj) = root.as_object() else {
        return false;
    };

    obj.values().any(|entry| {
        entry.get("type").and_then(|t| t.as_str()) == Some("api_key")
            && entry
                .get("key")
                .and_then(|k| k.as_str())
                .map(|k| !k.is_empty())
                .unwrap_or(false)
    })
}

/// List all providers that have API keys configured in auth.json.
///
/// Returns a list of provider IDs that have non-empty API keys.
pub fn list_auth_providers() -> Vec<String> {
    let root = read_auth_json();
    let Some(obj) = root.as_object() else {
        return Vec::new();
    };

    obj.iter()
        .filter(|(_, entry)| {
            entry.get("type").and_then(|t| t.as_str()) == Some("api_key")
                && entry
                    .get("key")
                    .and_then(|k| k.as_str())
                    .map(|k| !k.is_empty())
                    .unwrap_or(false)
        })
        .map(|(id, _)| id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_info_serializes() {
        let info = ProviderInfo {
            id: "anthropic".to_string(),
            name: "Anthropic".to_string(),
            api: "anthropic".to_string(),
            model_count: 5,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains(r#""id":"anthropic""#));
        assert!(json.contains(r#""modelCount":5"#));
    }

    #[test]
    fn model_info_serializes() {
        let info = ModelInfo {
            id: "claude-sonnet-4".to_string(),
            name: "Claude Sonnet 4".to_string(),
            provider: "anthropic".to_string(),
            reasoning: true,
            context_window: 200000,
            max_tokens: 8192,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains(r#""reasoning":true"#));
        assert!(json.contains(r#""contextWindow":200000"#));
    }

    #[test]
    fn cost_config_defaults_to_zero() {
        let cost = CostConfig::default();
        assert_eq!(cost.input, 0.0);
        assert_eq!(cost.output, 0.0);
    }

    #[test]
    fn load_config_handles_missing_files() {
        // When running tests, the config files may or may not exist.
        // The function should handle both cases gracefully.
        let _config = load_config();
        // If we got here without panicking, ConfigSnapshot was constructed OK.
    }

    #[test]
    fn default_model_returns_none_for_empty_config() {
        let config = ConfigSnapshot {
            settings: None,
            providers: Vec::new(),
            models: Vec::new(),
        };
        assert!(default_model(&config).is_none());
    }

    #[test]
    fn list_packages_returns_empty_for_no_settings() {
        let config = ConfigSnapshot {
            settings: None,
            providers: Vec::new(),
            models: Vec::new(),
        };
        assert!(list_packages(&config).is_empty());
    }

    #[test]
    fn list_packages_returns_packages_from_settings() {
        let settings = PiSettings {
            default_provider: None,
            default_model: None,
            default_thinking_level: None,
            packages: vec!["npm:test-pkg".to_string()],
            enabled_models: Vec::new(),
        };
        let config = ConfigSnapshot {
            settings: Some(settings),
            providers: Vec::new(),
            models: Vec::new(),
        };
        assert_eq!(list_packages(&config), vec!["npm:test-pkg"]);
    }

    #[test]
    fn pi_settings_deserializes_minimal() {
        let json = r#"{"defaultProvider":"openai","packages":["npm:test"]}"#;
        let settings: PiSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.default_provider, Some("openai".to_string()));
        assert_eq!(settings.packages, vec!["npm:test"]);
    }

    #[test]
    fn pi_settings_deserializes_empty() {
        let json = r#"{}"#;
        let settings: PiSettings = serde_json::from_str(json).unwrap();
        assert!(settings.default_provider.is_none());
        assert!(settings.packages.is_empty());
    }

    #[test]
    fn builtin_models_returns_models_for_known_providers() {
        for provider_id in [
            "crofai",
            "opencode-go",
            "openai",
            "anthropic",
            "google",
            "groq",
            "together",
            "xai",
        ] {
            let models = builtin_provider_models(provider_id);
            assert!(
                models.is_some(),
                "Expected models for provider: {provider_id}",
            );
            let model_list = models.unwrap();
            assert!(
                !model_list.is_empty(),
                "Models should not be empty for {provider_id}"
            );
            // Each model entry should have an id and name
            for model in &model_list {
                assert!(model.get("id").is_some(), "Model should have an id");
                assert!(model.get("name").is_some(), "Model should have a name");
            }
        }
    }

    #[test]
    fn builtin_models_returns_none_for_unknown_provider() {
        assert!(builtin_provider_models("unknown-provider").is_none());
        assert!(builtin_provider_models("").is_none());
    }
}
