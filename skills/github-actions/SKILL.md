---
name: github-actions
description: |
  Master GitHub Actions CI/CD workflows with production-grade security and
  performance patterns. Use when writing workflow YAML, configuring CI/CD
  pipelines, setting up matrix strategies, caching dependencies, managing
  artifacts, or implementing reusable workflows. Triggers on "GitHub Actions",
  "CI/CD", "workflow", "actions/checkout", "matrix strategy", "reusable
  workflow", "SHA pinning", ".github/workflows".
---

# GitHub Actions CI/CD Engineering Standards

This skill codifies 2026 GitHub Actions best practices — secure supply chains, efficient caching, reusable workflows, and hardened permission models.

## 1. Security: SHA Pinning (Mandatory)

### Pin Every Third-Party Action to a Commit SHA

```yaml
# ✅ Good: SHA-pinned (immutable, auditable)
- uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.2.2
- uses: actions/setup-node@1d0ff469b7ec7b3cb9d8673fde8c81c89c3166c0 # v4.2.0

# ❌ Bad: Tag-pinned (mutable, vulnerable to supply chain attacks)
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
```

- **ALWAYS** pin to full-length commit SHAs — tags are mutable and can be hijacked
- **ALWAYS** add a trailing comment with the version for human readability
- **Use tools** like `step-security/harden-runner` or `pin-github-action` CLI to automate SHA resolution
- **Audit quarterly** — review all pinned SHAs when updating workflow dependencies

### Permission Hardening

```yaml
# Set restrictive defaults at the workflow level
permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    # Grant specific permissions per-job
    permissions:
      contents: read
      packages: write
```

- **ALWAYS** set `permissions:` at the workflow level — use `read-all` or specify individually
- **NEVER** use `permissions: write-all` — it grants maximum privileges
- **Grant write only where needed** — per-job, not per-workflow

## 2. Workflow Structure

### Standard CI Template

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha> # v4
      - uses: actions/setup-node@<sha> # v4
        with:
          node-version-file: .node-version
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run lint
      - run: pnpm run typecheck

  test:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@<sha> # v4
      - uses: actions/setup-node@<sha> # v4
        with:
          node-version-file: .node-version
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  build:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@<sha> # v4
      - uses: actions/setup-node@<sha> # v4
        with:
          node-version-file: .node-version
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run build
```

### Key Structural Rules

- **ALWAYS** set `concurrency` with `cancel-in-progress: true` to prevent stale runs
- **Use `needs:`** to create a dependency chain: lint → test → build → deploy
- **Use `.node-version`** or `.python-version` files — never hardcode versions in workflows
- **Use `--frozen-lockfile`** — never let CI modify the lock file

## 3. Caching

### Package Manager Caching

```yaml
# Node.js (pnpm)
- uses: actions/setup-node@<sha>
  with:
    node-version-file: .node-version
    cache: pnpm

# Python (uv)
- uses: actions/setup-python@<sha>
  with:
    python-version-file: .python-version
- run: pip install uv
- uses: actions/cache@<sha>
  with:
    path: ~/.cache/uv
    key: uv-${{ runner.os }}-${{ hashFiles('uv.lock') }}
    restore-keys: uv-${{ runner.os }}-

# Go
- uses: actions/setup-go@<sha>
  with:
    go-version-file: go.mod
    cache: true
```

### Custom Caching Rules

- **Key on lock file hash** — `${{ hashFiles('pnpm-lock.yaml') }}`
- **Use `restore-keys`** for fallback to partial cache hits
- **Cache the package manager's global cache**, not `node_modules` directly
- **Don't cache everything** — simplicity trumps marginal speedup

## 4. Matrix Strategy

### Basic Matrix

```yaml
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [20, 22]
        exclude:
          - os: windows-latest
            node: 20
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/setup-node@<sha>
        with:
          node-version: ${{ matrix.node }}
```

### Dynamic Matrix

```yaml
jobs:
  prepare:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.set.outputs.matrix }}
    steps:
      - id: set
        run: |
          echo 'matrix={"include":[{"project":"api"},{"project":"web"}]}' >> "$GITHUB_OUTPUT"

  build:
    needs: prepare
    strategy:
      matrix: ${{ fromJSON(needs.prepare.outputs.matrix) }}
    runs-on: ubuntu-latest
    steps:
      - run: echo "Building ${{ matrix.project }}"
```

### Rules

- **Use `fail-fast: false`** for test matrices — you want to see all failures, not just the first
- **Use `include`/`exclude`** to fine-tune — don't generate invalid combinations
- **Use `max-parallel`** if jobs contend for shared resources (APIs, databases)

## 5. Reusable Workflows

### Defining a Reusable Workflow

```yaml
# .github/workflows/reusable-build.yml
name: Reusable Build

on:
  workflow_call:
    inputs:
      node-version:
        type: string
        default: "22"
    secrets:
      NPM_TOKEN:
        required: true

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with:
          node-version: ${{ inputs.node-version }}
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Calling a Reusable Workflow

```yaml
jobs:
  build:
    uses: ./.github/workflows/reusable-build.yml
    with:
      node-version: "22"
    secrets:
      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Rules

- **Pass secrets explicitly** — avoid `secrets: inherit` (grants broader access than needed)
- **Pin reusable workflows** to SHA or tag in production
- **Use `workflow_call` inputs** for all configuration — don't rely on `env` or file conventions
- **Separate concerns**: reusable workflows = entire jobs; composite actions = reusable steps

## 6. Artifacts (v4)

```yaml
# Upload
- uses: actions/upload-artifact@<sha> # v4
  with:
    name: build-output
    path: dist/
    retention-days: 7
    compression-level: 6

# Download (in a different job)
- uses: actions/download-artifact@<sha> # v4
  with:
    name: build-output
    path: dist/
```

### Rules

- **v4 artifacts are immutable** — you cannot overwrite the same artifact name
- **Use unique names per job** — don't upload from parallel matrix jobs to the same name
- **Set `retention-days`** — don't rely on org defaults (storage costs add up)
- **Use `compression-level: 0`** for already-compressed files (`.zip`, `.tar.gz`)
- **v3 and v4 are incompatible** — do not mix upload-artifact@v3 with download-artifact@v4

## 7. Environment Protection

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://myapp.example.com
    steps:
      - run: echo "Deploying to production"
```

- **Use `environment:`** for production deployments — enables approval gates
- **Configure required reviewers** in repo Settings → Environments
- **Use environment-scoped secrets** — production secrets should not be accessible in CI

## 8. Anti-Patterns (Never Do These)

| Anti-Pattern | Why It's Wrong | Do This Instead |
|-------------|---------------|-----------------|
| `uses: action@v4` | Mutable tag, supply chain risk | Pin to full commit SHA |
| `permissions: write-all` | Maximum privilege, dangerous | Explicit per-job permissions |
| `continue-on-error: true` on security steps | Suppresses critical failures | Hard-fail on security gates |
| `secrets: inherit` | Over-broad secret access | Pass secrets explicitly |
| Hardcoded `node-version: 22` | Version drift across workflows | Use `.node-version` file |
| No `concurrency:` | Stale runs waste minutes | Always set with `cancel-in-progress` |
| `if: always()` on non-cleanup steps | Runs even after critical failures | Use `if: success()` (default) |
| Caching `node_modules` directly | Fragile, platform-specific | Cache package manager global cache |
