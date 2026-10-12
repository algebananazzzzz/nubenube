#!/usr/bin/env bash
# Check (and on Debian/Ubuntu, install) what a Tauri build needs before cargo
# gets far enough to fail on a missing pkg-config library. Run by `make install`.
set -euo pipefail

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "!! $1 not found. $2" >&2; exit 1; }
}

need_cmd npm "Install Node.js 20+ (https://nodejs.org)."
need_cmd cargo "Install Rust via rustup (https://rustup.rs)."

case "$(uname -s)" in
  Darwin)
    xcode-select -p >/dev/null 2>&1 || {
      echo "!! Xcode Command Line Tools missing. Run: xcode-select --install" >&2
      exit 1
    }
    ;;
  Linux)
    command -v dpkg-query >/dev/null 2>&1 || {
      echo "!! Only Debian/Ubuntu (apt) is automated. Install the Tauri prerequisites for your distro:" >&2
      echo "   https://v2.tauri.app/start/prerequisites/#linux" >&2
      exit 1
    }
    # libxss: user-idle (idle time). libxcb-randr: active-win-pos-rs. The rest
    # is the stock Tauri/WebKitGTK set, matching .github/workflows.
    pkgs=(
      build-essential pkg-config
      libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
      libxss-dev libxcb-randr0-dev libxcb-ewmh-dev libdbus-1-dev
    )
    missing=()
    for p in "${pkgs[@]}"; do
      dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q "install ok installed" || missing+=("$p")
    done
    if ((${#missing[@]})); then
      echo "==> Installing system packages: ${missing[*]}"
      sudo apt-get update
      sudo apt-get install -y "${missing[@]}"
    fi
    ;;
  *)
    echo "!! Unsupported OS: $(uname -s)" >&2
    exit 1
    ;;
esac
