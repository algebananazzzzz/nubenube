# Distribution & CI/CD Design

**Date:** 2026-06-02  
**Project:** NubeNube (Tauri 2 desktop app)  
**Goal:** Ship installable binaries for Linux, macOS, and Windows via GitHub Releases with auto-update support and a beta/stable release pipeline.

---

## 1. Release tracks

| Track | GitHub release type | Who uses it |
|---|---|---|
| Beta | Pre-release (`vX.Y.Z-beta`) | Manual testers; developer verifies before promoting |
| Stable | Release (`vX.Y.Z`) | All end users; auto-update target |

Beta and stable share the same internal app version `X.Y.Z`. Stable users auto-update when stable ships. Beta users are already on `X.Y.Z` so they don't receive a redundant auto-update — they simply confirmed that version is good.

---

## 2. Branch & version strategy

- Single `main` branch. Feature branches PR into `main`.
- On every merge to `main`, CI auto-bumps the semver version using an existing GitHub Action (e.g. `anothrNick/github-tag-action` or `mathieudutour/github-tag-action` — team's choice). Bump level is determined by conventional commit messages (`fix:` → patch, `feat:` → minor, `BREAKING CHANGE` → major).
- After determining the new version, CI runs `npx tauri set-version X.Y.Z` which syncs `tauri.conf.json`, `package.json`, and `Cargo.toml` in one shot, then commits + pushes the version bump back to `main`.

---

## 3. Four workflow files

### `1-feature-ci.yml` — push to any branch except `main`

Parallel jobs:
- **rust**: `cargo check` + `cargo test --manifest-path src-tauri/Cargo.toml`
- **frontend**: ESLint + `tsc --noEmit`

Fast, no Tauri builds. Catches broken code before PR.

### `2-pr-ci.yml` — PR targeting `main`

Same jobs as feature CI. Placeholder comment for integration tests when added. Required status check before merge is allowed.

### `3-preprod-release.yml` — push to `main`

Sequential steps:
1. Auto-bump version via semver action; run `npx tauri set-version X.Y.Z`; commit + push version files
2. Build matrix (parallel, one runner per platform):
   - `ubuntu-latest` → `.AppImage` + `.deb`
   - `macos-latest` → universal `.dmg` (arm64 + x86_64 fat binary via `--target universal-apple-darwin`)
   - `windows-latest` → `.msi` + `.nsis`
3. Each runner signs artifacts with the ed25519 keypair; Tauri CLI generates `latest.json` (updater manifest)
4. Upload all 6 artifacts + `latest.json` → create GitHub **pre-release** tagged `vX.Y.Z-beta`
5. On success: create lightweight git tag `vX.Y.Z` (no release attached — just marks the code for step 4)

### `4-prd-release.yml` — `workflow_dispatch`, input: version tag

Input: version string (e.g. `0.2.0`).

Steps:
1. Checkout repo at tag `vX.Y.Z`
2. Same build matrix as preprod (rebuild from source for reproducibility)
3. Sign artifacts; generate `latest.json`
4. Create GitHub **stable release** tagged `vX.Y.Z` with all artifacts + `latest.json`
5. Tauri updater on existing stable installs detects new version → auto-update dialog shown to users

---

## 4. Artifacts per platform

| Platform | Formats |
|---|---|
| Linux | `.AppImage`, `.deb` |
| macOS | universal `.dmg` (arm64 + x86_64) |
| Windows | `.msi`, `.nsis` |

---

## 5. Tauri updater configuration

Add to `tauri.conf.json` under `plugins`:

```json
"plugins": {
  "updater": {
    "endpoints": ["https://github.com/{owner}/nubenube/releases/latest/download/latest.json"],
    "dialog": true,
    "pubkey": "<ed25519 public key from signer generate>"
  }
}
```

GitHub's `/releases/latest` URL automatically skips pre-releases, so beta releases never trigger auto-updates on stable installs.

The ed25519 keypair is generated once locally:
```bash
cargo tauri signer generate -w ~/.tauri/nubenube.key
```

Public key goes into `tauri.conf.json`. Private key + password go into GitHub repository secrets.

---

## 6. GitHub secrets required

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | ed25519 private key (output of signer generate) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | passphrase chosen during key generation |
| `GITHUB_TOKEN` | auto-provided by GitHub Actions |

---

## 7. macOS install UX

The `.dmg` is **unsigned** (no Apple Developer account required). First-time install requires the user to right-click → Open to bypass Gatekeeper. This is a one-time step — subsequent auto-updates applied by the Tauri updater inherit the cleared quarantine status and run transparently.

This is acceptable for the target audience (Claude Code users are developers comfortable with this workflow). A note in the README covers it.

---

## 8. Out of scope

- Apple code signing / notarization
- Linux package manager repos (AUR, apt PPA, etc.)
- Windows code signing
- A separate beta updater endpoint / dual-track auto-updates
