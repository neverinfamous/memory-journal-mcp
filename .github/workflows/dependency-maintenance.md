---
description: 'Automated dependency maintenance — npm, Docker transitive deps, Alpine packages, and validation (no version bump)'
private: true
labels: [dependencies, automation, maintenance]

on:
  schedule:
    - cron: '0 14 * * 1' # Every Monday at 14:00 UTC
  workflow_dispatch:

engine:
  id: copilot
  model: claude-opus-4-20250514

runtimes:
  node:
    version: '24'

network:
  allowed:
    - defaults
    - node

permissions: read-all

safe-outputs:
  create-pull-request:
    title-prefix: '[deps] '
    labels: [dependencies, automated]
    reviewers: [neverinfamous]
    draft: false
    max: 1
    expires: 14
    fallback-as-issue: true
    if-no-changes: 'ignore'

timeout-minutes: 30
concurrency: dependency-maintenance
---

# Dependency Maintenance Agent

You are maintaining the **memory-journal-mcp** project — a TypeScript MCP server for project context management with SQLite, semantic search, and GitHub integration. Built with Node.js 24. Your job is to batch-update all dependencies across npm, Docker, and system layers, run validation, and create a single PR with all changes.

**This workflow does NOT bump versions or create releases.** It only updates dependencies and validates the build. Version bumps and releases are handled separately by the maintainer.

## Important Rules

- **Only act on actual command output.** Never guess package versions.
- **If nothing is outdated and no Dockerfile patches are needed, exit cleanly.** Do not create a PR with no changes.
- **Dockerfile `npm pack` patches must stay within the same major version line** as npm's bundled dependencies (e.g., diff@8.x, tar@7.x, minimatch@10.x).
- **Keep `package.json` overrides in sync with Dockerfile `npm pack` versions** — use **exact version pins** (e.g., `"10.2.4"` not `"^10.2.4"`) to prevent lockfile drift.

## Step 1: Check for Outdated Packages

Run `npm outdated --json` to see what's available. If nothing is outdated, note this and proceed to check Dockerfile patches (Step 3). Do not stop here — Dockerfile transitive deps may still need attention.

## Step 2: Update npm Packages

1. Run `npm update` to update packages within their semver ranges.
2. For packages where `wanted` equals `current` but `latest` is newer (beyond the caret range), install them explicitly: `npm install <package>@latest` for each.
3. **`0.x` caret-range edge case**: `npm update` respects semver but **will not cross minor boundaries for `0.x` packages** (e.g., `^0.12.3` won't resolve `0.13.0`). Update the version range in `package.json` and run `npm install`.
4. **Skip intentionally pinned packages** where "Latest" on npm is actually a downgrade or incompatible:
   - Pre-release/canary pins
   - Exact-version pins where `Current` equals `Wanted` but differs from `Latest`
5. Run `npm audit`. If vulnerabilities are found, run `npm audit fix`. If unfixable via audit, check if `overrides` in `package.json` can pin transitive deps to patched versions.

After excluding intentional pins, `npm outdated` should show only expected pins (or nothing).

## Step 3: Audit Dockerfile Transitive Dependencies

> **This is the critical step that prevents Docker Scout blocks at deploy time.**

Parse the project's `Dockerfile` for all `npm pack <package>@<version>` lines. These are manually patched npm-bundled packages (the P111 lifecycle pattern). For each package found:

1. Determine the major version line being used (e.g., `tar@7.5.11` → major line 7).
2. Check the latest version in that major line: `npm view <package>@<major> version`.
3. If a newer patch/minor version exists in the same major line, update **all of**:
   - The `npm pack <package>@<new_version>` lines in **both** Dockerfile stages (builder + runtime)
   - The corresponding `overrides` entry in `package.json` (use exact version pins)
   - The CVE/GHSA comment above each `RUN` block
4. After updating overrides, run `npm install --package-lock-only` to sync the lockfile.

Common packages to check: `diff`, `tar`, `minimatch`, `brace-expansion`.

## Step 4: Check Alpine System Packages

If the Dockerfile uses `--repository=https://dl-cdn.alpinelinux.org/alpine/edge/main` for specific packages (e.g., `curl`, `libexpat`, `zlib`), verify these are still the latest by checking Alpine edge package versions.

## Step 5: Validate

Run all validation gates. **All must pass before proceeding:**

```bash
npm run lint
npm run typecheck
npm test
npx prettier --write .
```

If lint or typecheck fails, attempt to fix the issues. If unfixable, report the errors in the PR description and create the PR anyway (as draft).

## Step 6: npm Audit Report

Run `npm audit` one final time and capture the output. Include the result (clean or vulnerability count) in the PR description.

## Step 7: Patch Version Bump

Read the current version from `package.json`. Bump the **patch** version only (e.g., `5.1.1` → `5.1.2`). Dependency-only updates are always patch bumps. **Never bump minor or major versions** — those are reserved for the maintainer.

Update version references in:

- `package.json` (`"version"` field)
- Run `npm install --package-lock-only` to sync `package-lock.json`
- `README.md` (version badge if present)
- `DOCKER_README.md` (version badge if present, Available Tags table)
- `Dockerfile` (`LABEL version=` line)
- `server.json` (top-level `version`, package `version`, and OCI `identifier` tag if present)

**Verify no version references were missed.** Search for the OLD version number across the project (excluding `node_modules`, `CHANGELOG.md`, `releases/`, and `package-lock.json`). If any matches appear, update them.

## Step 8: Update Unreleased Log and Create Release Notes

1. Add dependency updates to `UNRELEASED.md`:
   - Under `### Security` for CVE/advisory fixes
   - Under `### Changed` → `**Dependency Updates**` for routine version bumps
   - **Do NOT create duplicate section headers** — check if sections already exist first
2. Run `node scripts/compile-changelog.js` to automatically compile `UNRELEASED.md` into `CHANGELOG.md`.
3. Create `releases/vX.Y.Z.md` with condensed highlights:
   - Highlights (top 3-5 bullet points)
   - Categorized sections (Security, Changed)
   - Footer with compare link and install commands (`npm install memory-journal-mcp@X.Y.Z`)

## Step 9: Commit and Create PR

1. Stage all changes: `git add -A`
2. Commit with message: `vX.Y.Z - Dependency updates and security patches`
3. Create the PR via safe-output with a description that includes:
   - The new version number
   - A **summary table** of all version changes (package | from | to)
   - Which Dockerfile patches were updated (if any)
   - Alpine package status
   - `npm audit` results
   - Validation results (lint, typecheck, test, prettier)
   - CHANGELOG entries added

The PR will be reviewed by Copilot and CI checks. After merge, a separate `auto-release.yml` workflow creates the git tag and GitHub release, which triggers npm publish and Docker image build.
