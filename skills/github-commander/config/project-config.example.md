# GitHub Commander — Project Configuration

This file documents all environment variables used by the GitHub Commander skill.
Copy the relevant variables to your MCP server configuration.

## Quick Start (Node.js — defaults work out of the box)

```json
{
  "mcpServers": {
    "memory-journal-mcp": {
      "command": "memory-journal-mcp",
      "env": {
        "GITHUB_TOKEN": "ghp_your_token",
        "GITHUB_REPO_PATH": "/path/to/your/repo"
      }
    }
  }
}
```

No additional configuration needed — all defaults are Node.js with npm.

## Full Configuration Reference

### Project Commands

These define what commands the agent runs during validation gates.
Set any of them to an empty string to skip that gate.

```bash
# Lint command (default: "npm run lint")
PROJECT_LINT_CMD="npm run lint"

# Type-check command (default: "npm run typecheck")
# Set empty to skip: PROJECT_TYPECHECK_CMD=""
PROJECT_TYPECHECK_CMD="npm run typecheck"

# Build command (default: "npm run build")
# Set empty to skip: PROJECT_BUILD_CMD=""
PROJECT_BUILD_CMD="npm run build"

# Unit/integration test command (default: "npm run test")
PROJECT_TEST_CMD="npm run test"

# E2E test command (default: empty = skip)
PROJECT_E2E_CMD="npm run test:e2e"
```

### Package Manager

```bash
# Auto-detected from lockfile if not set
# Options: npm, yarn, pnpm, bun
PROJECT_PACKAGE_MANAGER="npm"
```

### Docker Support

```bash
# Auto-detected from Dockerfile presence if not set
# Set explicitly to enable Docker-specific audit steps
PROJECT_HAS_DOCKERFILE="true"
```

### Commander Behavior

```bash
# HITL checkpoint if changes touch more than this many files (default: 10)
COMMANDER_HITL_FILE_THRESHOLD="10"

# Override auto-detected security tools (comma-separated)
# Options: npm-audit, codeql, trivy, docker-scout, gitleaks, trufflehog
# Default: auto-detect all available tools
COMMANDER_SECURITY_TOOLS="npm-audit,trivy,gitleaks"

# Branch naming prefix (default: "fix")
# Produces branches like: fix/issue-123
COMMANDER_BRANCH_PREFIX="fix"
```

## Example: Python Project

```json
{
  "env": {
    "PROJECT_LINT_CMD": "ruff check .",
    "PROJECT_TYPECHECK_CMD": "mypy .",
    "PROJECT_BUILD_CMD": "",
    "PROJECT_TEST_CMD": "pytest",
    "PROJECT_E2E_CMD": "",
    "PROJECT_PACKAGE_MANAGER": "pip"
  }
}
```

## Example: Rust Project

```json
{
  "env": {
    "PROJECT_LINT_CMD": "cargo clippy -- -D warnings",
    "PROJECT_TYPECHECK_CMD": "",
    "PROJECT_BUILD_CMD": "cargo build",
    "PROJECT_TEST_CMD": "cargo test",
    "PROJECT_E2E_CMD": "",
    "PROJECT_PACKAGE_MANAGER": "cargo"
  }
}
```

## Example: Go Project

```json
{
  "env": {
    "PROJECT_LINT_CMD": "golangci-lint run",
    "PROJECT_TYPECHECK_CMD": "",
    "PROJECT_BUILD_CMD": "go build ./...",
    "PROJECT_TEST_CMD": "go test ./...",
    "PROJECT_E2E_CMD": "",
    "PROJECT_PACKAGE_MANAGER": "go"
  }
}
```
