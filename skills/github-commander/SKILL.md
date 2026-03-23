---
name: github-commander
description: |
  Structured workflows for triaging GitHub issues, reviewing PRs, sprinting
  through milestones, and running security/quality/performance audits — with
  configurable validation gates, auto-detected security scanning, journal audit
  trails, and human-in-the-loop checkpoints. Use this skill whenever you are
  working on a GitHub issue, reviewing or submitting a PR, running any kind of
  code audit, updating dependencies, or working through a milestone. Also use
  when the user mentions issue numbers, PR numbers, milestone names, or
  asks you to "fix", "triage", "audit", "review", or "update deps".
---

# GitHub Commander

Structured, configurable workflows that teach AI agents to triage GitHub issues,
review PRs, and sprint through milestones. Every action is journaled for full
audit trails, and human-in-the-loop checkpoints keep you in control.

The reason every step journals its results is that it creates a searchable audit
trail — future sessions can find exactly what was tried, what passed, and what
failed, without the human needing to remember or repeat context.

## When to Load

Load this skill when any of these apply:

- You are assigned or asked to fix a GitHub issue
- You need to review or submit a pull request
- You need to work through issues in a milestone
- You want to run dependency updates, security audits, or code quality audits
- The user mentions an issue number (e.g., "fix #42") or PR number
- The user says "triage", "audit", "review", "update deps", or similar
- You are about to push code and want a structured validation pipeline

## Quick Reference

| Workflow | File | Purpose |
|---|---|---|
| **Issue Triage** | `workflows/issue-triage.md` | Fix a single GitHub issue end-to-end |
| **PR Review** | `workflows/pr-review.md` | Review a PR with validation pipeline |
| **Milestone Sprint** | `workflows/milestone-sprint.md` | Work through milestone issues sequentially |
| **Update Dependencies** | `workflows/update-deps.md` | Dependency update with audit trail |
| **Security Audit** | `workflows/security-audit.md` | Auto-detected security scanning |
| **Code Quality Audit** | `workflows/code-quality-audit.md` | Static code quality analysis |
| **Performance Audit** | `workflows/perf-audit.md` | Build, bundle, runtime, test speed analysis |
| **Full Audit** | `workflows/full-audit.md` | Unified quality + perf + security audit |

## Prerequisites

- `gh` CLI authenticated (`gh auth status`)
- `GITHUB_TOKEN` set for API access
- `GITHUB_REPO_PATH` set for repo auto-detection
- Project repo cloned locally

## Configuration

All commands are configurable via environment variables. Defaults assume a
Node.js project. Override for other ecosystems (Python, Rust, Go, etc.).

| Variable | Default | Description |
|---|---|---|
| `PROJECT_LINT_CMD` | `npm run lint` | Lint command |
| `PROJECT_TYPECHECK_CMD` | `npm run typecheck` | Type-check command (empty = skip) |
| `PROJECT_BUILD_CMD` | `npm run build` | Build command (empty = skip) |
| `PROJECT_TEST_CMD` | `npm run test` | Unit/integration test command |
| `PROJECT_E2E_CMD` | _(empty = skip)_ | E2E test command |
| `PROJECT_PACKAGE_MANAGER` | _(auto-detect)_ | `npm`, `yarn`, `pnpm`, or `bun` |
| `PROJECT_HAS_DOCKERFILE` | _(auto-detect)_ | `true` to enable Docker audit steps |
| `COMMANDER_HITL_FILE_THRESHOLD` | `10` | HITL if changes touch > N files |
| `COMMANDER_SECURITY_TOOLS` | _(auto-detect)_ | Comma-separated override list |
| `COMMANDER_BRANCH_PREFIX` | `fix` | Branch naming prefix |

### Package Manager Auto-Detection

If `PROJECT_PACKAGE_MANAGER` is not set, detect by lockfile:

1. `bun.lockb` or `bun.lock` → `bun`
2. `pnpm-lock.yaml` → `pnpm`
3. `yarn.lock` → `yarn`
4. `package-lock.json` → `npm`
5. Fallback → `npm`

### Security Tool Auto-Detection

When `COMMANDER_SECURITY_TOOLS` is not set, each tool is detected independently:

| Tool | Detection | What It Scans |
|---|---|---|
| `npm-audit` | Always (Node.js project) | Dependency vulnerabilities |
| `codeql` | `codeql` CLI or `gh codeql` | Static analysis (SAST) |
| `trivy` | `trivy --version` succeeds | Container images, filesystems |
| `docker-scout` | `docker scout version` succeeds | Docker image CVEs |
| `gitleaks` | `gitleaks version` succeeds | Secrets in git history |
| `trufflehog` | `trufflehog --version` succeeds | Secrets (verified only) |

Missing tools are skipped with a journal note — never a failure.

## Core Concepts

### Validation Gates

Every workflow uses sequential validation gates. Each gate must pass before the
next runs. On failure, the agent attempts to auto-fix (lint/type errors). If
auto-fix fails after 2 attempts, the agent requests human input.

```
Gate 1: Lint + Typecheck  →  Gate 2: Build  →  Gate 3: Tests  →  Gate 4: E2E  →  Gate 5: Security
```

Gates configured with empty commands are skipped automatically.

### Journal Audit Trail

Every significant action creates a journal entry with structured tags:

- **`commander`** — all entries from this skill
- **`triage`** / **`review`** / **`milestone`** — workflow type
- **`gate-pass`** / **`gate-fail`** — validation results
- **`security`** — security scan findings

Entries link to issues/PRs via `issue_number` and `pr_number` fields, connecting
to the knowledge graph automatically.

### Human-in-the-Loop Checkpoints

The agent pauses and requests human approval when:

1. **Before `git push`** — present diff summary, files changed
2. **Critical security findings** — any critical/high severity scan result
3. **Unfixable test failures** — after 2 auto-fix attempts
4. **Large changesets** — changes touch more files than `COMMANDER_HITL_FILE_THRESHOLD`
5. **Between milestone issues** — in milestone-sprint workflow

## Shipped Entry Types

These entry types are used by Commander workflows for structured audit trails:

| Type | Used By | Purpose |
|---|---|---|
| `triage` | issue-triage | Issue context gathered, analysis complete |
| `implementation` | issue-triage | Fix implemented |
| `gate_pass` | all | Validation gate passed |
| `gate_fail` | all | Validation gate failed (with error details) |
| `security_finding` | security-audit | Security scan finding |
| `pr_submitted` | issue-triage | PR created and pushed |
| `review_start` | pr-review | PR review initiated |
| `review_complete` | pr-review | PR review completed |
| `milestone_sprint_start` | milestone-sprint | Sprint started |
| `deps_update` | update-deps | Dependency update completed |
| `audit_finding` | all audits | Code quality or perf finding |
