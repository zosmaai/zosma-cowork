//! # MetaAgents Engine
//!
//! UI-agnostic agent harness built on the [`pi_agent_rust`] SDK.
//!
//! This crate is the core of the MetaAgents architecture. It exposes a stable
//! Rust API that desktop GUIs (Zosma Cowork), terminal UIs, and future
//! products (Zosma Code) can build on without coupling to the underlying pi
//! SDK shape.
//!
//! ## Modules
//!
//! | Module | Purpose |
//! |--------|---------|
//! | **[[events]]** | `CoworkEvent` enum matching frontend PiEvent taxonomy |
//! | **[[session]]** | `Session` wrapper around `AgentSessionHandle` with event bridging |
//! | **[[engine]]** | `MetaAgentsEngine` managing session lifecycle (create/get/drop) |
//! | **[[config]]** | Read pi settings and model registry from disk |
//! | **[[extensions]]** | Discover extensions from local dirs and settings packages |
//!
//! ## Re-exports
//!
//! The pi SDK is re-exported as [`pi`] so downstream crates can write
//! `use metaagents::pi::sdk::*;` without taking a direct dependency on
//! `pi_agent_rust` (and without caring about its name remap from
//! `pi_agent_rust` to library name `pi`).

#![forbid(unsafe_code)]
#![warn(rust_2018_idioms)]
// All public API items have docs. If adding new exports, add docs too.

/// Re-export of the `pi_agent_rust` crate (library name `pi`).
///
/// The crates.io package is `pi_agent_rust`, but its `[lib] name = "pi"`,
/// so the import path inside Rust is `pi::*`. We re-export under the same
/// name so downstream crates write `use metaagents::pi::sdk::*;` — keeping
/// the convention used by every example in the upstream docs.
pub use ::pi;

/// Stable event types matching the frontend PiEvent taxonomy.
pub mod events;

/// Session management wrapping the SDK AgentSessionHandle.
pub mod session;

/// MetaAgents engine — manages multiple sessions with lifecycle control.
pub mod engine;

/// Configuration reader for pi settings and model registry.
pub mod config;

/// Extension discovery from pi's extension directories.
pub mod extensions;

/// Extension installer — install/uninstall extensions from npm, git, or local paths.
pub mod ext_installer;

/// Crate version, exposed for diagnostic surfaces (e.g. About dialog).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Version of the embedded pi SDK, exposed for About dialogs and diagnostics.
///
/// This is the package version reported by `pi_agent_rust`'s `CARGO_PKG_VERSION`
/// at build time. Useful for verifying which SDK build a deployed app is
/// running against.
pub const PI_SDK_VERSION: &str = "0.1.13";

/// Returns a short banner describing this build of the engine.
///
/// Used by smoke tests and the Tauri shell's About dialog.
pub fn banner() -> String {
    format!("metaagents v{VERSION} (pi sdk v{PI_SDK_VERSION})")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn banner_includes_versions() {
        let b = banner();
        assert!(b.contains(VERSION), "banner missing engine version: {b}");
        assert!(
            b.contains(PI_SDK_VERSION),
            "banner missing SDK version: {b}"
        );
        assert!(b.contains("metaagents"), "banner missing crate name: {b}");
    }

    #[test]
    fn pi_sdk_is_reachable() {
        // Compile-time linkage check: prove `pi::sdk` resolves through our
        // re-export. If the pi crate version, feature set, or rename ever
        // breaks, this test fails to compile (caught by `cargo check`,
        // not a runtime assertion).
        use crate::pi::sdk::SessionOptions;
        let opts = SessionOptions::default();
        // Defaults documented in pi_agent_rust::sdk::SessionOptions::default().
        assert!(
            opts.no_session,
            "default SessionOptions should disable session persistence"
        );
        assert!(
            opts.include_cwd_in_prompt,
            "default SessionOptions should include cwd"
        );
        assert_eq!(opts.max_tool_iterations, 50);
    }

    #[test]
    fn pi_builtin_tool_names_are_exposed() {
        // Verify the SDK's built-in tool roster is reachable through our
        // re-export. This is the canonical list our engine will surface
        // in the GUI's tool panel later.
        use crate::pi::sdk::BUILTIN_TOOL_NAMES;
        assert!(
            !BUILTIN_TOOL_NAMES.is_empty(),
            "pi exposes at least one built-in tool"
        );
        assert!(BUILTIN_TOOL_NAMES.contains(&"bash"), "bash tool present");
        assert!(BUILTIN_TOOL_NAMES.contains(&"read"), "read tool present");
        assert!(BUILTIN_TOOL_NAMES.contains(&"edit"), "edit tool present");
    }
}
