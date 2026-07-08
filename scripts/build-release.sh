#!/usr/bin/env bash
# Full release build: deb + rpm + AppImage
#
# Builds the agent-sidecar bundle, compiles the Tauri app, and
# packages all distribution formats. Includes fixes for known
# bundling issues (icon symlinks, missing package.json sidecar).

set -euo pipefail

cd "$(dirname "$0")/.."

BUNDLE_DIR="target/release/bundle"

echo "================================================"
echo "  Zosma Cowork Release Build"
echo "================================================"

# ── Step 1: Build sidecar bundle + frontend ──────────
echo ""
echo "=== Step 1: Build sidecar bundle + frontend ==="
node scripts/prebuild.mjs
pnpm run build:frontend

# ── Step 2: Build Tauri app (creates binary, deb, rpm, AppDir) ──
echo ""
echo "=== Step 2: Build Tauri app ==="
npx tauri build --bundles deb,rpm,appimage 2>&1 || echo "[WARN] tauri build completed with bundler warnings (may need manual AppImage fix)"

# ── Step 3: Fix AppImage icon symlink ────────────────
echo ""
echo "=== Step 3: Fix AppImage icon symlink ==="

APPIMAGE_APPDIR=$(find "$BUNDLE_DIR/appimage" -maxdepth 1 -type d -name "*.AppDir" 2>/dev/null | head -1)

if [ -z "$APPIMAGE_APPDIR" ]; then
	echo "[ERROR] No AppDir found in $BUNDLE_DIR/appimage/"
	echo "  AppImage may need to be created manually."
	exit 0
fi

DESKTOP_FILE=$(find "$APPIMAGE_APPDIR" -maxdepth 1 -name "*.desktop" 2>/dev/null | head -1)
if [ -z "$DESKTOP_FILE" ]; then
	echo "[ERROR] No .desktop file found in AppDir root."
	exit 0
fi

# Read the Icon= field from the desktop file
ICON_NAME=$(grep -E "^Icon=" "$DESKTOP_FILE" | cut -d= -f2)

if [ -z "$ICON_NAME" ]; then
	echo "[WARN] No Icon= field found in desktop file."
	exit 0
fi

# Check if the icon file exists, if not create a symlink
if [ ! -f "$APPIMAGE_APPDIR/$ICON_NAME.png" ] && [ ! -f "$APPIMAGE_APPDIR/$ICON_NAME.svg" ]; then
	# Look for any png in the AppDir root
	ROOT_PNG=$(find "$APPIMAGE_APPDIR" -maxdepth 1 -name "*.png" 2>/dev/null | head -1)
	if [ -n "$ROOT_PNG" ]; then
		echo "  Creating symlink: $ICON_NAME.png -> $(basename "$ROOT_PNG")"
		ln -sf "$(basename "$ROOT_PNG")" "$APPIMAGE_APPDIR/$ICON_NAME.png"
	else
		echo "[WARN] No png found in AppDir root to symlink."
	fi
else
	echo "  Icon file '$ICON_NAME' already exists, no fix needed."
fi

# ── Step 4: Generate AppImage if not already done ────
echo ""
echo "=== Step 4: Generating AppImage ==="

if ls "$BUNDLE_DIR/appimage/"*.AppImage 2>/dev/null | grep -q .; then
	echo "  AppImage already exists:"
	ls -lh "$BUNDLE_DIR/appimage/"*.AppImage
else
	echo "  Creating AppImage from AppDir..."

	if [ -f /home/arjun/.cache/tauri/linuxdeploy-plugin-appimage.AppImage ]; then
		APPIMAGE_EXTRACT_AND_RUN=1 /home/arjun/.cache/tauri/linuxdeploy-plugin-appimage.AppImage \
			--appdir "$APPIMAGE_APPDIR" 2>&1

		# Move generated AppImage to bundle dir
		find . -maxdepth 1 -name "*.AppImage" -exec mv {} "$BUNDLE_DIR/appimage/" \;
		echo "  AppImage created:"
		ls -lh "$BUNDLE_DIR/appimage/"*.AppImage
	else
		echo "[WARN] linuxdeploy-plugin-appimage not found at /home/arjun/.cache/tauri/"
		echo "  Run 'npx tauri build --bundles appimage' first to cache the tool."
	fi
fi

# ── Summary ──────────────────────────────────────────
echo ""
echo "================================================"
echo "  Build Summary"
echo "================================================"
echo ""
echo "  Binary: $(ls -lh target/release/zosma-cowork 2>/dev/null | awk '{print $5, $NF}')"
echo "  .deb:   $(ls -lh $BUNDLE_DIR/deb/*.deb 2>/dev/null | awk '{print $5, $NF}')"
echo "  .rpm:   $(ls -lh $BUNDLE_DIR/rpm/*.rpm 2>/dev/null | awk '{print $5, $NF}')"
echo "  AppImage: $(ls -lh $BUNDLE_DIR/appimage/*.AppImage 2>/dev/null | awk '{print $5, $NF}')"
echo ""
echo "  Done! 🎉"
