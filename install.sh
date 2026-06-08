#!/usr/bin/env bash
# Build NubeNube from source and install it to /Applications (macOS).
# Local install only — skips the updater-artifact signing (no signing key
# needed). For a shareable installer build a dmg instead (see end of file).
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APP_NAME="Nube Nube"
SRC="src-tauri/target/release/bundle/macos/${APP_NAME}.app"
DEST="/Applications/${APP_NAME}.app"

echo "==> Installing JS dependencies"
npm install

echo "==> Building ${APP_NAME} (release) — this compiles Rust, give it a few minutes"
# --bundles app: only the .app (skip dmg). The inline config turns off updater
# artifacts so the build doesn't demand TAURI_SIGNING_PRIVATE_KEY.
npm run tauri build -- --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'

[ -d "$SRC" ] || { echo "!! Build artifact missing: $SRC" >&2; exit 1; }

echo "==> Quitting any running instance"
osascript -e "quit app \"${APP_NAME}\"" 2>/dev/null || true
pkill -f "${DEST}" 2>/dev/null || true
sleep 1

echo "==> Installing to ${DEST}"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
# Strip the quarantine flag so Gatekeeper doesn't block an unsigned local build.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo "==> Launching"
open "$DEST"
echo "Done. Installed $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$DEST/Contents/Info.plist" 2>/dev/null || echo '?') to $DEST"

# For a shareable installer instead of installing locally, run:
#   npm run tauri build -- --bundles dmg --config '{"bundle":{"createUpdaterArtifacts":false}}'
# → src-tauri/target/release/bundle/dmg/Nube Nube_<version>_<arch>.dmg
