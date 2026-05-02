//! Extension installer — manages installing, uninstalling, and updating extensions.
//!
//! Supports three source types:
//! - **npm**: Installs via `npm pack` + tar extract into `~/.zosmaai/agent/extensions/<name>/`
//! - **git**: Clones via `git clone` into `~/.zosmaai/agent/extensions/<name>/`
//! - **local**: Copies a local directory path
//!
//! All installed extensions are tracked in `settings.json` under the `packages` array.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::config::{zosmaai_agent_dir, zosmaai_dir};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Source specification for installing an extension.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ExtensionSource {
    /// npm package (e.g., "npm:@zosmaai/zosma-slides" or "npm:pi-web-access")
    Npm {
        /// Full npm package specifier (name, name@version, or file:path)
        package: String,
    },
    /// Git URL (e.g., "https://github.com/zosmaai/some-extension.git")
    Git {
        /// The git URL to clone from
        url: String,
        /// Optional branch/tag/ref to checkout
        #[serde(default)]
        ref_name: Option<String>,
    },
    /// Local filesystem path (copied or referenced)
    Local {
        /// Absolute path to the extension directory
        path: String,
    },
}

/// Result of an install operation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    /// Extension ID (package name or directory name)
    pub id: String,
    /// Display name extracted from package.json or derived from source
    #[serde(default)]
    pub name: String,
    /// Version string if available
    #[serde(default)]
    pub version: String,
    /// Source type that was used
    pub source_type: String,
    /// Path where the extension was installed
    pub path: String,
    /// Whether settings.json was updated successfully
    pub settings_updated: bool,
}

/// Error types for extension installation.
#[derive(Debug, thiserror::Error)]
pub enum InstallError {
    #[error("npm is not installed or not in PATH")]
    NpmNotFound,

    #[error("git is not installed or not in PATH")]
    GitNotFound,

    #[error("npm install failed: {0}")]
    NpmInstallFailed(String),

    #[error("git clone failed: {0}")]
    GitCloneFailed(String),

    #[error("Local path does not exist: {0}")]
    LocalPathMissing(String),

    #[error("Failed to copy extension files: {0}")]
    CopyFailed(String),

    #[error("Failed to update settings.json: {0}")]
    SettingsUpdateFailed(String),

    #[error("Extension '{0}' is already installed")]
    AlreadyInstalled(String),

    #[error("Invalid source URL: {0}")]
    InvalidSource(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Result of parsing a source string into an ExtensionSource.
pub struct ParsedSource {
    pub source: ExtensionSource,
    pub id: String,
}

// ---------------------------------------------------------------------------
// Source parsing
// ---------------------------------------------------------------------------

/// Parse a user-provided source string into an ExtensionSource and ID.
///
/// Supported formats:
/// - `npm:<package>` — explicit npm package
/// - `<package>` (no prefix) — treated as npm package
/// - `https://` or `git@` — git URL
/// - `/absolute/path` or `./relative` — local path
pub fn parse_source(input: &str) -> Result<ParsedSource, InstallError> {
    let input = input.trim();

    if let Some(stripped) = input.strip_prefix("npm:") {
        let package = stripped.trim().to_string();
        let id = extract_npm_name(&package);
        Ok(ParsedSource {
            source: ExtensionSource::Npm { package },
            id,
        })
    } else if input.starts_with("https://")
        || input.starts_with("git@")
        || input.starts_with("git ")
    {
        let url = input.to_string();
        let name = extract_git_name(&url);
        Ok(ParsedSource {
            source: ExtensionSource::Git {
                url,
                ref_name: None,
            },
            id: name,
        })
    } else if input.starts_with('/') || input.starts_with("./") || input.starts_with("../") {
        let path = input.to_string();
        let name = extract_local_name(&path);
        Ok(ParsedSource {
            source: ExtensionSource::Local { path },
            id: name,
        })
    } else {
        // Default: treat as npm package
        let id = input.to_string();
        Ok(ParsedSource {
            source: ExtensionSource::Npm {
                package: input.to_string(),
            },
            id,
        })
    }
}

/// Extract the package name from an npm specifier (strips version suffix).
fn extract_npm_name(package: &str) -> String {
    // Handle scoped packages: @scope/name@version -> @scope/name
    if package.starts_with('@') {
        if let Some(slash_pos) = package.find('/') {
            let rest = &package[slash_pos + 1..];
            if let Some(at_pos) = rest.find('@') {
                // Has version suffix: @scope/name@version
                return format!("@{}/{}", &package[1..slash_pos], &rest[..at_pos]);
            } else {
                // No version suffix: @scope/name (already clean)
                return package.to_string();
            }
        }
        // Just @scope without slash - treat as-is
        return package.to_string();
    }
    // Regular package: name@version -> name
    package.split('@').next().unwrap_or(package).to_string()
}

/// Extract a directory name from a git URL.
fn extract_git_name(url: &str) -> String {
    let name = url
        .split('/')
        .next_back()
        .unwrap_or("extension")
        .trim_end_matches(".git")
        .to_string();
    if name.is_empty() {
        "extension".to_string()
    } else {
        name
    }
}

/// Extract a directory name from a local path.
fn extract_local_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "extension".to_string())
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

/// Get the directory where extensions are stored.
pub fn extensions_dir() -> PathBuf {
    zosmaai_agent_dir().join("extensions")
}

/// Install an extension from an npm package.
pub fn install_from_npm(package: &str) -> Result<InstallResult, InstallError> {
    let id = extract_npm_name(package);

    // Check if already installed
    if is_installed(&id) {
        return Err(InstallError::AlreadyInstalled(id.clone()));
    }

    let ext_dir = extensions_dir();
    std::fs::create_dir_all(&ext_dir).map_err(InstallError::Io)?;

    // Use npm pack + tar extract approach for cleaner installs
    let temp_dir = zosmaai_dir().join(".extensions-temp");
    std::fs::create_dir_all(&temp_dir).map_err(InstallError::Io)?;

    let output = Command::new("npm")
        .args(["pack", package, "--json"])
        .current_dir(&temp_dir)
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                InstallError::NpmNotFound
            } else {
                InstallError::NpmInstallFailed(e.to_string())
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(InstallError::NpmInstallFailed(stderr.trim().to_string()));
    }

    // Parse the tarball filename from npm pack output
    let stdout = String::from_utf8_lossy(&output.stdout);
    let tarball_name = parse_npm_pack_filename(&stdout).ok_or_else(|| {
        InstallError::NpmInstallFailed("Could not parse npm pack output".to_string())
    })?;

    let tarball_path = temp_dir.join(&tarball_name);
    if !tarball_path.exists() {
        // Fallback: find any .tgz file in temp dir
        let tgz_files: Vec<PathBuf> = std::fs::read_dir(&temp_dir)
            .ok()
            .map(|d| {
                d.filter_map(|e| {
                    e.ok().and_then(|entry| {
                        entry
                            .path()
                            .extension()
                            .is_some_and(|ext| ext == "tgz")
                            .then_some(entry.path())
                    })
                })
                .collect()
            })
            .unwrap_or_default();

        if tgz_files.is_empty() {
            return Err(InstallError::NpmInstallFailed(
                "No tarball found after npm pack".to_string(),
            ));
        }
    }

    let target_dir = ext_dir.join(&id);
    if target_dir.exists() {
        std::fs::remove_dir_all(&target_dir).ok();
    }
    std::fs::create_dir_all(&target_dir).map_err(InstallError::Io)?;

    // Extract tarball to target directory
    let output = Command::new("tar")
        .args([
            "-xzf",
            tarball_path.to_str().unwrap(),
            "-C",
            &target_dir.to_string_lossy(),
        ])
        .output()
        .map_err(|e| InstallError::NpmInstallFailed(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(InstallError::NpmInstallFailed(stderr.trim().to_string()));
    }

    // npm pack creates a package/ subdirectory, move contents up
    let pkg_subdir = target_dir.join("package");
    if pkg_subdir.is_dir() {
        let entries: Vec<_> = std::fs::read_dir(&pkg_subdir)
            .ok()
            .into_iter()
            .flat_map(|r| r.filter_map(|e| e.ok()))
            .collect();
        for entry in entries {
            let src = entry.path();
            let dst = target_dir.join(entry.file_name());
            std::fs::rename(&src, &dst).ok();
        }
        std::fs::remove_dir_all(&pkg_subdir).ok();
    }

    // Clean up temp dir
    std::fs::remove_dir_all(&temp_dir).ok();

    // Read metadata from package.json
    let (name, version) = read_package_metadata(&target_dir);

    // Update settings.json
    let settings_updated = add_to_settings(&format!("npm:{}", package)).is_ok();

    Ok(InstallResult {
        id,
        name,
        version,
        source_type: "npm".to_string(),
        path: target_dir.to_string_lossy().to_string(),
        settings_updated,
    })
}

/// Parse the tarball filename from npm pack JSON output.
fn parse_npm_pack_filename(stdout: &str) -> Option<String> {
    for line in stdout.lines() {
        let line = line.trim();
        if let Some(filename) = line.split(r#""filename":"#).nth(1) {
            return filename.split('"').next().map(|s| s.to_string());
        }
    }
    // Fallback: look for .tgz pattern
    Some(
        stdout
            .split(".tgz")
            .next()?
            .split('/')
            .next_back()?
            .to_string()
            + ".tgz",
    )
}

/// Install an extension from a git URL.
pub fn install_from_git(url: &str, ref_name: Option<&str>) -> Result<InstallResult, InstallError> {
    let name = extract_git_name(url);

    // Check if already installed
    if is_installed(&name) {
        return Err(InstallError::AlreadyInstalled(name.clone()));
    }

    let ext_dir = extensions_dir();
    std::fs::create_dir_all(&ext_dir).map_err(InstallError::Io)?;

    let target_dir = ext_dir.join(&name);

    // Don't clone if directory already exists (might be from previous failed install)
    if target_dir.exists() {
        std::fs::remove_dir_all(&target_dir)
            .map_err(|e| InstallError::GitCloneFailed(e.to_string()))?;
    }

    let mut cmd = Command::new("git");
    cmd.args(["clone", url, &target_dir.to_string_lossy()]);

    if let Some(ref_n) = ref_name {
        cmd.args(["--branch", ref_n]);
    }

    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            InstallError::GitNotFound
        } else {
            InstallError::GitCloneFailed(e.to_string())
        }
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(InstallError::GitCloneFailed(stderr.trim().to_string()));
    }

    // Read metadata from package.json if it exists
    let (name_display, version) = read_package_metadata(&target_dir);

    // Update settings.json
    let settings_updated = add_to_settings(url).is_ok();

    Ok(InstallResult {
        id: name,
        name: name_display,
        version,
        source_type: "git".to_string(),
        path: target_dir.to_string_lossy().to_string(),
        settings_updated,
    })
}

/// Install an extension from a local directory path.
pub fn install_from_local(path: &str) -> Result<InstallResult, InstallError> {
    let src_path = Path::new(path);
    if !src_path.is_dir() {
        return Err(InstallError::LocalPathMissing(path.to_string()));
    }

    let name = extract_local_name(path);

    // Check if already installed
    if is_installed(&name) {
        return Err(InstallError::AlreadyInstalled(name.clone()));
    }

    let ext_dir = extensions_dir();
    std::fs::create_dir_all(&ext_dir).map_err(InstallError::Io)?;

    let target_dir = ext_dir.join(&name);

    // Copy the directory
    if target_dir.exists() {
        std::fs::remove_dir_all(&target_dir)
            .map_err(|e| InstallError::CopyFailed(e.to_string()))?;
    }

    copy_directory(src_path, &target_dir).map_err(|e| InstallError::CopyFailed(e.to_string()))?;

    // Read metadata
    let (name_display, version) = read_package_metadata(&target_dir);

    // Update settings.json with local path reference
    let settings_updated = add_to_settings(path).is_ok();

    Ok(InstallResult {
        id: name,
        name: name_display,
        version,
        source_type: "local".to_string(),
        path: target_dir.to_string_lossy().to_string(),
        settings_updated,
    })
}

/// Recursively copy a directory.
fn copy_directory(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;

    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if file_type.is_dir() {
            copy_directory(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

/// Read name and version from package.json in the given directory.
fn read_package_metadata(dir: &Path) -> (String, String) {
    let pkg_path = dir.join("package.json");
    if let Ok(content) = std::fs::read_to_string(&pkg_path) {
        #[derive(Deserialize)]
        struct PackageJson {
            #[serde(default)]
            name: String,
            #[serde(default)]
            version: String,
        }

        if let Ok(pkg) = serde_json::from_str::<PackageJson>(&content) {
            return (pkg.name, pkg.version);
        }
    }
    // Fallback: use directory name
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    (name, "0.0.0".to_string())
}

// ---------------------------------------------------------------------------
// Uninstallation
// ---------------------------------------------------------------------------

/// Uninstall an extension by ID.
pub fn uninstall_extension(id: &str) -> Result<(), InstallError> {
    let ext_dir = extensions_dir();
    let target_dir = ext_dir.join(id);

    // Remove from filesystem
    if target_dir.exists() {
        std::fs::remove_dir_all(&target_dir)
            .map_err(|e| InstallError::CopyFailed(e.to_string()))?;
    }

    // Remove from settings.json
    remove_from_settings(id).map_err(|e| InstallError::SettingsUpdateFailed(e.to_string()))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Settings management
// ---------------------------------------------------------------------------

/// Check if an extension is already installed (exists in extensions dir).
pub fn is_installed(id: &str) -> bool {
    let ext_dir = extensions_dir();
    ext_dir.join(id).is_dir()
}

/// List all installed extensions with their metadata.
pub fn list_installed_extensions() -> Vec<InstallResult> {
    let ext_dir = extensions_dir();
    if !ext_dir.exists() {
        return vec![];
    }

    let mut results = Vec::new();

    let entries: Vec<_> = std::fs::read_dir(&ext_dir)
        .ok()
        .into_iter()
        .flat_map(|r| r.filter_map(|e| e.ok()))
        .collect();

    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            let id = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let (name, version) = read_package_metadata(&path);

            results.push(InstallResult {
                id,
                name,
                version,
                source_type: "unknown".to_string(),
                path: path.to_string_lossy().to_string(),
                settings_updated: true,
            });
        }
    }

    results.sort_by(|a, b| a.id.cmp(&b.id));
    results
}

/// Add a package entry to settings.json.
pub fn add_to_settings(source: &str) -> Result<(), InstallError> {
    let settings_path = zosmaai_agent_dir().join("settings.json");

    // Read existing settings or create empty
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)
            .map_err(|e| InstallError::SettingsUpdateFailed(e.to_string()))?;
        serde_json::from_str(&content)
            .map_err(|e| InstallError::SettingsUpdateFailed(e.to_string()))?
    } else {
        serde_json::Value::Object(serde_json::Map::new())
    };

    // Ensure packages array exists
    let packages = settings
        .as_object_mut()
        .ok_or_else(|| InstallError::SettingsUpdateFailed("Invalid settings.json".to_string()))?
        .entry("packages")
        .or_insert_with(|| serde_json::Value::Array(Vec::new()));

    let packages_array = packages.as_array_mut().ok_or_else(|| {
        InstallError::SettingsUpdateFailed("packages is not an array".to_string())
    })?;

    // Check if already present
    for pkg in packages_array.iter() {
        if pkg.as_str() == Some(source) {
            return Ok(()); // Already exists, no-op
        }
    }

    packages_array.push(serde_json::Value::String(source.to_string()));

    // Write back
    std::fs::create_dir_all(zosmaai_agent_dir())
        .map_err(|e| InstallError::SettingsUpdateFailed(e.to_string()))?;

    let output = serde_json::to_string_pretty(&settings)
        .map_err(|e| InstallError::SettingsUpdateFailed(e.to_string()))?;

    std::fs::write(&settings_path, output)
        .map_err(|e| InstallError::SettingsUpdateFailed(e.to_string()))?;

    Ok(())
}

/// Remove a package entry from settings.json by extension ID.
pub fn remove_from_settings(id: &str) -> Result<(), InstallError> {
    let settings_path = zosmaai_agent_dir().join("settings.json");

    if !settings_path.exists() {
        return Ok(()); // Nothing to remove
    }

    let content = std::fs::read_to_string(&settings_path)
        .map_err(|e| InstallError::SettingsUpdateFailed(e.to_string()))?;

    let mut settings: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| InstallError::SettingsUpdateFailed(e.to_string()))?;

    if let Some(packages) = settings.get_mut("packages").and_then(|p| p.as_array_mut()) {
        packages.retain(|pkg| {
            let pkg_str = pkg.as_str().unwrap_or("");
            // Match by: exact name, npm:name, or git URL containing the name
            pkg_str != id && !pkg_str.starts_with(&format!("npm:{}", id)) && !pkg_str.contains(id)
        });
    }

    let output = serde_json::to_string_pretty(&settings)
        .map_err(|e| InstallError::SettingsUpdateFailed(e.to_string()))?;

    std::fs::write(&settings_path, output)
        .map_err(|e| InstallError::SettingsUpdateFailed(e.to_string()))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_npm_source() {
        let result = parse_source("npm:@zosmaai/zosma-slides").unwrap();
        assert_eq!(result.id, "@zosmaai/zosma-slides");
        match result.source {
            ExtensionSource::Npm { package } => assert_eq!(package, "@zosmaai/zosma-slides"),
            _ => panic!("Expected Npm source"),
        }
    }

    #[test]
    fn test_parse_npm_source_with_version() {
        let result = parse_source("npm:@zosmaai/zosma-slides@1.2.3").unwrap();
        assert_eq!(result.id, "@zosmaai/zosma-slides");
    }

    #[test]
    fn test_parse_npm_source_without_prefix() {
        let result = parse_source("pi-web-access").unwrap();
        assert_eq!(result.id, "pi-web-access");
        match result.source {
            ExtensionSource::Npm { package } => assert_eq!(package, "pi-web-access"),
            _ => panic!("Expected Npm source"),
        }
    }

    #[test]
    fn test_parse_git_source() {
        let result = parse_source("https://github.com/zosmaai/some-extension.git").unwrap();
        assert_eq!(result.id, "some-extension");
        match result.source {
            ExtensionSource::Git { url, .. } => {
                assert_eq!(url, "https://github.com/zosmaai/some-extension.git")
            }
            _ => panic!("Expected Git source"),
        }
    }

    #[test]
    fn test_parse_git_ssh_source() {
        let result = parse_source("git@github.com:zosmaai/some-extension.git").unwrap();
        assert_eq!(result.id, "some-extension");
    }

    #[test]
    fn test_parse_local_source() {
        let result = parse_source("/home/user/my-extension").unwrap();
        assert_eq!(result.id, "my-extension");
        match result.source {
            ExtensionSource::Local { path } => assert_eq!(path, "/home/user/my-extension"),
            _ => panic!("Expected Local source"),
        }
    }

    #[test]
    fn test_extract_npm_name_simple() {
        assert_eq!(extract_npm_name("my-package"), "my-package");
        assert_eq!(extract_npm_name("my-package@1.0.0"), "my-package");
    }

    #[test]
    fn test_extract_npm_name_scoped() {
        assert_eq!(extract_npm_name("@scope/pkg"), "@scope/pkg");
        assert_eq!(extract_npm_name("@scope/pkg@2.0.0"), "@scope/pkg");
    }

    #[test]
    fn test_extract_git_name_https() {
        assert_eq!(extract_git_name("https://github.com/org/repo.git"), "repo");
        assert_eq!(extract_git_name("https://github.com/org/repo"), "repo");
    }

    #[test]
    fn test_extract_local_name() {
        assert_eq!(extract_local_name("/path/to/my-ext"), "my-ext");
        assert_eq!(extract_local_name("./local-dir"), "local-dir");
    }

    #[test]
    fn test_extensions_dir_exists() {
        let dir = extensions_dir();
        assert!(dir.to_string_lossy().contains("extensions"));
    }

    #[test]
    fn test_is_installed_returns_false_for_missing() {
        // This should return false for a non-existent extension
        assert!(!is_installed("definitely-not-installed-ext-12345"));
    }

    #[test]
    fn test_list_installed_extensions_empty() {
        // Returns vec when no extensions exist (or dir doesn't exist)
        let _results = list_installed_extensions();
        // Should not panic even if dir doesn't exist
    }
}
