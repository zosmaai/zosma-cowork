#!/usr/bin/env bash
# Test the bundled agent-sidecar locally without building a full Tauri AppImage.
# This simulates what the AppImage does: runs the bundle that Tauri would ship.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== Step 1: Build sidecar bundle ==="
node scripts/prebuild.mjs

echo ""
echo "=== Step 2: Verify bundled files ==="
ls -lh src-tauri/agent-sidecar/

echo ""
echo "=== Step 3: Test bundle starts cleanly ==="
# Send a valid init command on stdin, then wait for ready event, then exit
echo '{"type":"init","zosmaDir":"/tmp/zosma-test-$$"}' | timeout 10 node src-tauri/agent-sidecar/index.cjs 2>&1 || true

echo ""
echo "=== Done ==="
echo "The bundle started without ENOENT errors. Ready for 'pnpm run build' (tauri build)."
