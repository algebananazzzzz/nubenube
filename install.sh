#!/usr/bin/env bash
# Install the latest stable NubeNube release: the .deb through apt on
# Debian/Ubuntu, the .app into /Applications on macOS. Downloads the prebuilt
# image, so it needs no Rust, Node or -dev packages. For a source checkout,
# `make install` sets up the build dependencies instead.
set -euo pipefail

APP_NAME="Nube Nube"
# The updater manifest of the latest non-prerelease, keyed by platform.
MANIFEST_URL="https://github.com/algebananazzzzz/nubenube/releases/latest/download/latest.json"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# latest.json is pretty-printed by tauri-action: each platform key opens an
# object whose "url" line follows a "signature" line.
asset_url() {
  local url
  url=$(awk -v key="\"$1\": {" 'index($0, key) { f = 1 } f && /"url"/ { gsub(/.*"url": *"|".*/, ""); print; exit }' "$tmp/latest.json")
  [ -n "$url" ] || { echo "!! The latest release has no $1 build." >&2; exit 1; }
  echo "$url"
}

install_linux() {
  [ "$(uname -m)" = x86_64 ] || { echo "!! Releases ship x86_64 Linux builds only." >&2; exit 1; }
  command -v apt-get >/dev/null 2>&1 || {
    echo "!! Only Debian/Ubuntu is automated. Grab the .rpm from the releases page instead." >&2
    exit 1
  }
  local url deb
  url=$(asset_url linux-x86_64-deb)
  deb="$tmp/$(basename "$url")"

  echo "==> Downloading $url"
  curl -fL --progress-bar -o "$deb" "$url"

  echo "==> Quitting any running instance"
  pkill -x nubenube 2>/dev/null || true

  echo "==> Installing (apt pulls in the runtime libraries)"
  # apt reads the file as the _apt user, which can't enter a mktemp dir.
  chmod 755 "$tmp"
  # --reinstall so rerunning on the same version still replaces the binary.
  sudo apt-get install -y --reinstall "$deb"

  echo "==> Launching"
  setsid nubenube >/dev/null 2>&1 < /dev/null &
  echo "Done. Installed $(dpkg-query -W -f='${Package} ${Version}' "$(dpkg-deb -f "$deb" Package)")"
}

install_macos() {
  local arch url dest="/Applications/${APP_NAME}.app"
  arch=$(uname -m)
  [ "$arch" = arm64 ] && arch=aarch64
  url=$(asset_url "darwin-${arch}-app")

  echo "==> Downloading $url"
  curl -fL --progress-bar -o "$tmp/app.tar.gz" "$url"
  tar -xzf "$tmp/app.tar.gz" -C "$tmp"
  [ -d "$tmp/${APP_NAME}.app" ] || { echo "!! Archive did not contain ${APP_NAME}.app" >&2; exit 1; }

  echo "==> Quitting any running instance"
  osascript -e "quit app \"${APP_NAME}\"" 2>/dev/null || true
  pkill -f "${dest}" 2>/dev/null || true
  sleep 1

  echo "==> Installing to ${dest}"
  rm -rf "$dest"
  cp -R "$tmp/${APP_NAME}.app" "$dest"
  # The release is unsigned; without this Gatekeeper refuses to open it.
  xattr -dr com.apple.quarantine "$dest" 2>/dev/null || true

  echo "==> Launching"
  open "$dest"
  echo "Done. Installed $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$dest/Contents/Info.plist") to $dest"
}

curl -fsSL -o "$tmp/latest.json" "$MANIFEST_URL"

case "$(uname -s)" in
  Linux) install_linux ;;
  Darwin) install_macos ;;
  *) echo "!! Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
