//! Zosma Cowork — OS keychain commands for auth token storage.
//!
//! Exposes three Tauri commands used by the frontend's `token-store.ts`:
//!   • `save_token`  — write (or overwrite) the bearer token
//!   • `load_token`  — read the stored token (returns null when absent)
//!   • `clear_token` — delete the token entry from the keychain

const SERVICE: &str = "ai.zosma.cowork";
const ACCOUNT: &str = "bearer_token";

/// Persist `token` in the OS keychain.
/// On macOS this is the user's Keychain; on Windows the Credential Store;
/// on Linux libsecret / KWallet.
#[tauri::command]
pub fn save_token(token: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    entry.set_password(&token).map_err(|e| e.to_string())
}

/// Load the stored bearer token. Returns `None` when no token has been saved.
#[tauri::command]
pub fn load_token() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Remove the stored bearer token from the OS keychain.
#[tauri::command]
pub fn clear_token() -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        // Not finding an entry to delete is not an error — treat as a no-op.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
