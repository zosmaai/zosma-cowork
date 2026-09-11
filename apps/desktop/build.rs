fn main() {
    tauri_build::build();

    // Re-run build script if ../.env changes
    println!("cargo:rerun-if-changed=../.env");

    // Track whether we found and set the key
    let mut key_set = false;

    // If APTABASE_KEY is not already in the build environment,
    // try reading it from ../.env (project root).
    if std::env::var("APTABASE_KEY").is_err() {
        if let Ok(contents) = std::fs::read_to_string("../.env") {
            for line in contents.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((key, value)) = line.split_once('=') {
                    let key = key.trim();
                    let value = value.trim();
                    if key == "APTABASE_KEY" && !value.is_empty() {
                        println!("cargo:rustc-env=APTABASE_KEY={}", value);
                        key_set = true;
                        break;
                    }
                }
            }
        }
    } else {
        // APTABASE_KEY is set in the shell environment (e.g., CI)
        key_set = true;
    }

    // Warn if APTABASE_KEY could not be determined
    if !key_set {
        println!("cargo:warning=APTABASE_KEY is not set. Usage analytics will be disabled.");
        println!("cargo:warning=  Set APTABASE_KEY in a .env file at the project root, or");
        println!("cargo:warning=  export APTABASE_KEY=your_key before building.");
    }

    // Also make VITE_SENTRY_DSN available at compile time for CI verification.
    // In normal dev, Vite loads this from .env automatically.
}
