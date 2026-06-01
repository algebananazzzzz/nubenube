# Distribution & CI/CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up four GitHub Actions workflows (feature CI, PR CI, beta release, prod release) and integrate the Tauri auto-updater plugin so users on Linux, macOS, and Windows receive silent in-app updates from GitHub Releases.

**Architecture:** Each merge to `main` auto-bumps the semver (read from `tauri.conf.json`, bumped in CI, synced back via `tauri set-version`), builds on three runners in parallel using `tauri-apps/tauri-action`, and publishes a GitHub pre-release tagged `vX.Y.Z-beta`. After manual testing the developer triggers workflow #4 to build and publish the stable release at tag `vX.Y.Z`. The Tauri updater plugin points to GitHub's `/releases/latest/download/latest.json`; pre-releases are skipped by GitHub automatically, so only prod releases reach stable users.

**Tech stack:** GitHub Actions, `tauri-apps/tauri-action@v0`, `Swatinem/rust-cache@v2`, `tauri-plugin-updater` (Rust), `tauri-plugin-process` (Rust), `@tauri-apps/plugin-updater` (npm), `@tauri-apps/plugin-process` (npm), `jq`.

---

## File map

| Action | Path |
|---|---|
| Create | `.github/workflows/1-feature-ci.yml` |
| Create | `.github/workflows/2-pr-ci.yml` |
| Create | `.github/workflows/3-preprod-release.yml` |
| Create | `.github/workflows/4-prd-release.yml` |
| Create | `src/lib/updater.ts` |
| Modify | `src-tauri/Cargo.toml` — add two plugins |
| Modify | `src-tauri/src/lib.rs` — register two plugins |
| Modify | `src-tauri/tauri.conf.json` — add `plugins.updater` block |
| Modify | `src-tauri/capabilities/default.json` — add updater + process permissions |
| Modify | `package.json` — add two npm packages |
| Modify | `src/App.tsx` (or wherever the root component is) — call `checkForUpdates()` on mount |
| Modify | `README.md` — macOS install note + secrets setup |

---

## Task 1: Generate ed25519 signing keypair (local, one-time)

**Files:** none — this is a one-time local operation.

- [ ] **Step 1: Generate the keypair**

  Run locally (not in CI). The `-w` flag writes the private key to a file.

  ```bash
  cargo tauri signer generate -w ~/.tauri/nubenube.key
  ```

  The command prints the public key to stdout. Copy it — it goes into `tauri.conf.json` in Task 3.

- [ ] **Step 2: Add GitHub secrets**

  In your GitHub repo: Settings → Secrets and variables → Actions → New repository secret.

  | Secret name | Value |
  |---|---|
  | `TAURI_SIGNING_PRIVATE_KEY` | full contents of `~/.tauri/nubenube.key` |
  | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the passphrase you chose during generation |

- [ ] **Step 3: Verify**

  ```bash
  cat ~/.tauri/nubenube.key
  ```

  Should print the private key file (starts with `untrusted comment:`).

---

## Task 2: Add updater + process plugins to Rust

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add crates to Cargo.toml**

  In `src-tauri/Cargo.toml`, find the `# Tauri plugins` comment block (line 28) and append two lines:

  ```toml
  tauri-plugin-updater = "2"
  tauri-plugin-process = "2"
  ```

  The block should now end with:
  ```toml
  tauri-plugin-autostart = "2"
  tauri-plugin-single-instance = "2"
  tauri-plugin-updater = "2"
  tauri-plugin-process = "2"
  ```

- [ ] **Step 2: Register plugins in lib.rs**

  In `src-tauri/src/lib.rs`, find the `.plugin(tauri_plugin_notification::init())` call (line 47) and add two plugins immediately after it:

  ```rust
  .plugin(tauri_plugin_notification::init())
  .plugin(tauri_plugin_updater::Builder::new().build())
  .plugin(tauri_plugin_process::init())
  ```

- [ ] **Step 3: Verify it compiles**

  ```bash
  cargo build --manifest-path src-tauri/Cargo.toml
  ```

  Expected: `Compiling nubenube ...` → `Finished`. No errors.

- [ ] **Step 4: Commit**

  ```bash
  git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
  git commit -m "feat(updater): add tauri-plugin-updater and tauri-plugin-process"
  ```

---

## Task 3: Wire updater into tauri.conf.json and capabilities

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add plugins block to tauri.conf.json**

  Replace your GitHub username for `OWNER`. Add after the `"bundle"` block:

  ```json
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/OWNER/nubenube/releases/latest/download/latest.json"
      ],
      "pubkey": "PASTE_YOUR_PUBLIC_KEY_HERE"
    }
  }
  ```

  The full file should end:
  ```json
    "bundle": { ... },
    "plugins": {
      "updater": {
        "endpoints": [
          "https://github.com/OWNER/nubenube/releases/latest/download/latest.json"
        ],
        "pubkey": "PASTE_YOUR_PUBLIC_KEY_HERE"
      }
    }
  }
  ```

  Replace `PASTE_YOUR_PUBLIC_KEY_HERE` with the public key printed during Task 1, Step 1. It looks like `dW50cnVzdGVk...` (base64).

- [ ] **Step 2: Add permissions to capabilities/default.json**

  In `src-tauri/capabilities/default.json`, add two entries to the `"permissions"` array:

  ```json
  "updater:default",
  "process:allow-relaunch"
  ```

  Final array:
  ```json
  "permissions": [
    "core:default",
    "core:window:default",
    "core:window:allow-show",
    "core:window:allow-hide",
    "core:window:allow-set-focus",
    "core:window:allow-set-always-on-top",
    "core:window:allow-set-position",
    "core:window:allow-set-size",
    "core:window:allow-start-dragging",
    "core:event:default",
    "store:default",
    "notification:default",
    "autostart:allow-enable",
    "autostart:allow-disable",
    "autostart:allow-is-enabled",
    "updater:default",
    "process:allow-relaunch"
  ]
  ```

- [ ] **Step 3: Verify config is valid JSON**

  ```bash
  jq . src-tauri/tauri.conf.json && jq . src-tauri/capabilities/default.json
  ```

  Expected: both print their contents without error.

- [ ] **Step 4: Commit**

  ```bash
  git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json
  git commit -m "feat(updater): configure updater endpoint and capabilities"
  ```

---

## Task 4: Add updater to frontend

**Files:**
- Add to `package.json` dependencies
- Create: `src/lib/updater.ts`
- Modify: `src/App.tsx` (or root component)

- [ ] **Step 1: Install npm packages**

  ```bash
  npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process
  ```

  Verify they appear in `package.json` under `"dependencies"`.

- [ ] **Step 2: Create src/lib/updater.ts**

  ```typescript
  import { check } from '@tauri-apps/plugin-updater';
  import { relaunch } from '@tauri-apps/plugin-process';

  export async function checkForUpdates(): Promise<void> {
    if (import.meta.env.DEV) return;
    try {
      const update = await check();
      if (!update) return;
      const ok = confirm(
        `NubeNube ${update.version} is available.\n\n${update.body ?? ''}\n\nInstall now?`
      );
      if (ok) {
        await update.downloadAndInstall();
        await relaunch();
      }
    } catch {
      // don't surface updater failures to the user
    }
  }
  ```

- [ ] **Step 3: Call checkForUpdates on mount in your root App component**

  Open `src/App.tsx`. Import and call `checkForUpdates` once in a `useEffect`:

  ```typescript
  import { useEffect } from 'react';
  import { checkForUpdates } from './lib/updater';

  // Inside the App (or root) component, add:
  useEffect(() => { checkForUpdates(); }, []);
  ```

- [ ] **Step 4: Verify it builds**

  ```bash
  npm run build
  ```

  Expected: `vite build` completes without TypeScript errors.

- [ ] **Step 5: Commit**

  ```bash
  git add package.json package-lock.json src/lib/updater.ts src/App.tsx
  git commit -m "feat(updater): check for updates on startup"
  ```

---

## Task 5: Feature branch CI workflow

**Files:**
- Create: `.github/workflows/1-feature-ci.yml`

- [ ] **Step 1: Create the workflow file**

  ```bash
  mkdir -p .github/workflows
  ```

  Create `.github/workflows/1-feature-ci.yml`:

  ```yaml
  name: 1 - Feature CI

  on:
    push:
      branches-ignore:
        - main

  jobs:
    lint-frontend:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4

        - uses: actions/setup-node@v4
          with:
            node-version: '20'
            cache: npm

        - run: npm ci
        - run: npm run lint
        - run: npx tsc --noEmit

    test-rust:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4

        - name: Install Linux system deps
          run: |
            sudo apt-get update
            sudo apt-get install -y \
              libgtk-3-dev libwebkit2gtk-4.1-dev \
              libappindicator3-dev librsvg2-dev patchelf

        - uses: dtolnay/rust-toolchain@stable

        - uses: Swatinem/rust-cache@v2
          with:
            workspaces: src-tauri

        - run: cargo test --manifest-path src-tauri/Cargo.toml
        - run: cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
  ```

- [ ] **Step 2: Push to a feature branch and verify**

  ```bash
  git add .github/workflows/1-feature-ci.yml
  git commit -m "ci: add feature branch CI workflow"
  git push origin HEAD
  ```

  Go to GitHub → Actions. The `1 - Feature CI` workflow should appear and go green.

---

## Task 6: PR CI workflow

**Files:**
- Create: `.github/workflows/2-pr-ci.yml`

- [ ] **Step 1: Create the workflow file**

  Create `.github/workflows/2-pr-ci.yml`:

  ```yaml
  name: 2 - PR CI

  on:
    pull_request:
      branches:
        - main

  jobs:
    lint-frontend:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4

        - uses: actions/setup-node@v4
          with:
            node-version: '20'
            cache: npm

        - run: npm ci
        - run: npm run lint
        - run: npx tsc --noEmit

    test-rust:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4

        - name: Install Linux system deps
          run: |
            sudo apt-get update
            sudo apt-get install -y \
              libgtk-3-dev libwebkit2gtk-4.1-dev \
              libappindicator3-dev librsvg2-dev patchelf

        - uses: dtolnay/rust-toolchain@stable

        - uses: Swatinem/rust-cache@v2
          with:
            workspaces: src-tauri

        - run: cargo test --manifest-path src-tauri/Cargo.toml
        - run: cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
        # Add integration test commands here when ready
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add .github/workflows/2-pr-ci.yml
  git commit -m "ci: add PR CI workflow"
  ```

---

## Task 7: Pre-prod release workflow (beta)

**Files:**
- Create: `.github/workflows/3-preprod-release.yml`

- [ ] **Step 1: Create the workflow file**

  Create `.github/workflows/3-preprod-release.yml`:

  ```yaml
  name: 3 - Pre-prod Release (Beta)

  on:
    push:
      branches:
        - main

  permissions:
    contents: write

  jobs:
    bump-version:
      # GITHUB_TOKEN pushes don't re-trigger workflows, so the version-bump commit
      # won't cause a loop. This guard is a safety net if you ever switch to a PAT.
      if: "!startsWith(github.event.head_commit.message, 'chore: bump version')"
      runs-on: ubuntu-latest
      outputs:
        new_version: ${{ steps.compute.outputs.new_version }}
      steps:
        - uses: actions/checkout@v4
          with:
            fetch-depth: 0

        - uses: actions/setup-node@v4
          with:
            node-version: '20'

        - run: npm ci

        - name: Compute next version
          id: compute
          run: |
            CURRENT=$(jq -r '.version' src-tauri/tauri.conf.json)
            IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
            MSG="${{ github.event.head_commit.message }}"
            if echo "$MSG" | grep -qiE "BREAKING[[:space:]]CHANGE|^feat!:"; then
              MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0
            elif echo "$MSG" | grep -qiE "^feat(\(.+\))?:"; then
              MINOR=$((MINOR + 1)); PATCH=0
            else
              PATCH=$((PATCH + 1))
            fi
            NEW="${MAJOR}.${MINOR}.${PATCH}"
            echo "new_version=$NEW" >> $GITHUB_OUTPUT
            echo "Bumping $CURRENT → $NEW"

        - name: Sync version into project files
          run: npm run tauri -- set-version ${{ steps.compute.outputs.new_version }}

        - name: Commit version bump
          run: |
            git config user.name "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git add src-tauri/tauri.conf.json package.json \
                    src-tauri/Cargo.toml src-tauri/Cargo.lock
            git commit -m "chore: bump version to ${{ steps.compute.outputs.new_version }}"
            git push

    build-beta:
      needs: bump-version
      strategy:
        fail-fast: false
        matrix:
          include:
            - platform: ubuntu-latest
              args: ''
            - platform: macos-latest
              args: '--target universal-apple-darwin'
            - platform: windows-latest
              args: ''
      runs-on: ${{ matrix.platform }}
      steps:
        - uses: actions/checkout@v4
          with:
            ref: main  # pick up the version-bump commit

        - uses: actions/setup-node@v4
          with:
            node-version: '20'
            cache: npm

        - uses: dtolnay/rust-toolchain@stable
          with:
            # Both targets needed for universal macOS build; ignored on other platforms
            targets: aarch64-apple-darwin,x86_64-apple-darwin

        - uses: Swatinem/rust-cache@v2
          with:
            workspaces: src-tauri

        - name: Install Linux system deps
          if: matrix.platform == 'ubuntu-latest'
          run: |
            sudo apt-get update
            sudo apt-get install -y \
              libgtk-3-dev libwebkit2gtk-4.1-dev \
              libappindicator3-dev librsvg2-dev patchelf

        - run: npm ci

        - name: Build and publish beta release
          uses: tauri-apps/tauri-action@v0
          env:
            GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
            TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
            TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
          with:
            tagName: v${{ needs.bump-version.outputs.new_version }}-beta
            releaseName: "NubeNube v${{ needs.bump-version.outputs.new_version }} (Beta)"
            releaseBody: "Beta release for testing. Promote to stable when satisfied."
            prerelease: true
            args: ${{ matrix.args }}

    create-stable-tag:
      needs: [bump-version, build-beta]
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4

        - name: Create stable git tag
          run: |
            git tag v${{ needs.bump-version.outputs.new_version }}
            git push origin v${{ needs.bump-version.outputs.new_version }}
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add .github/workflows/3-preprod-release.yml
  git commit -m "ci: add pre-prod (beta) release workflow"
  ```

---

## Task 8: Production release workflow

**Files:**
- Create: `.github/workflows/4-prd-release.yml`

- [ ] **Step 1: Create the workflow file**

  Create `.github/workflows/4-prd-release.yml`:

  ```yaml
  name: 4 - Production Release

  on:
    workflow_dispatch:
      inputs:
        version:
          description: 'Version to promote to stable (e.g. 0.2.0 — without the v)'
          required: true
          type: string

  permissions:
    contents: write

  jobs:
    build-stable:
      strategy:
        fail-fast: false
        matrix:
          include:
            - platform: ubuntu-latest
              args: ''
            - platform: macos-latest
              args: '--target universal-apple-darwin'
            - platform: windows-latest
              args: ''
      runs-on: ${{ matrix.platform }}
      steps:
        - uses: actions/checkout@v4
          with:
            ref: v${{ inputs.version }}

        - uses: actions/setup-node@v4
          with:
            node-version: '20'
            cache: npm

        - uses: dtolnay/rust-toolchain@stable
          with:
            targets: aarch64-apple-darwin,x86_64-apple-darwin

        - uses: Swatinem/rust-cache@v2
          with:
            workspaces: src-tauri

        - name: Install Linux system deps
          if: matrix.platform == 'ubuntu-latest'
          run: |
            sudo apt-get update
            sudo apt-get install -y \
              libgtk-3-dev libwebkit2gtk-4.1-dev \
              libappindicator3-dev librsvg2-dev patchelf

        - run: npm ci

        - name: Build and publish stable release
          uses: tauri-apps/tauri-action@v0
          env:
            GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
            TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
            TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
          with:
            tagName: v${{ inputs.version }}
            releaseName: "NubeNube v${{ inputs.version }}"
            releaseBody: "Stable release."
            prerelease: false
            args: ${{ matrix.args }}
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add .github/workflows/4-prd-release.yml
  git commit -m "ci: add production release workflow"
  ```

---

## Task 9: Push all CI files and verify first beta run

- [ ] **Step 1: Push the branch and open a PR to main**

  ```bash
  git push origin HEAD
  ```

  Open a PR targeting `main`. Verify `2 - PR CI` triggers and goes green.

- [ ] **Step 2: Merge the PR**

  Merge the PR. `3 - Pre-prod Release (Beta)` should trigger automatically.

  Watch it in GitHub → Actions:
  1. `bump-version` job runs, pushes a version bump commit
  2. Three `build-beta` runners start in parallel (Linux, macOS, Windows)
  3. A GitHub pre-release `v0.2.0-beta` appears under Releases
  4. `create-stable-tag` creates the `v0.2.0` lightweight tag

- [ ] **Step 3: Verify the release artifacts**

  On GitHub → Releases → `v0.2.0-beta`, you should see:
  - `Nube.Nube_0.2.0_amd64.AppImage`
  - `Nube.Nube_0.2.0_amd64.deb`
  - `Nube.Nube_0.2.0_universal.dmg`
  - `NubeNube_0.2.0_x64-setup.exe` (NSIS)
  - `NubeNube_0.2.0_x64_en-US.msi`
  - `latest.json` (updater manifest)

- [ ] **Step 4: Trigger a stable release**

  GitHub → Actions → `4 - Production Release` → Run workflow → enter `0.2.0`.

  Verify a non-pre-release `v0.2.0` appears under Releases with the same artifact set.

---

## Task 10: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add installation section**

  Add after the existing "Run it" section:

  ```markdown
  ## Install

  Download the latest release from [GitHub Releases](https://github.com/OWNER/nubenube/releases).

  | Platform | File |
  |---|---|
  | Linux (Ubuntu/Debian) | `.deb` |
  | Linux (universal) | `.AppImage` — run `chmod +x` then execute |
  | macOS | `.dmg` |
  | Windows | `.msi` or `.exe` (NSIS) |

  **macOS note:** The `.dmg` is unsigned. On first open, right-click the app → **Open** to bypass Gatekeeper. You only need to do this once; subsequent auto-updates are silent.

  ## Releases

  - **Beta** (`vX.Y.Z-beta`): published automatically on every merge to `main`. Install to test before stable.
  - **Stable** (`vX.Y.Z`): promoted manually via GitHub Actions → `4 - Production Release`. Existing installs auto-update.
  ```

- [ ] **Step 2: Add secrets setup section (for contributors)**

  ```markdown
  ## Contributing — first-time release setup

  1. Generate the ed25519 signing keypair: `cargo tauri signer generate -w ~/.tauri/nubenube.key`
  2. Copy the printed public key into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
  3. Add `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to GitHub repo secrets
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add README.md
  git commit -m "docs: add install instructions and release process"
  ```
