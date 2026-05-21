---
name: github-repo-setup
description: |
  Reusable scaffold for public TypeScript/Node.js repositories under
  neverinfamous. Use when creating a new GitHub repository to generate all
  community standards, CI/CD, config files, labels, and topics in one pass.
---

# GitHub Repository Setup

Scaffold a new public TypeScript/Node.js repo with community standards, CI, and strict tooling.

## Prerequisites

- Git CLI with SSH (`~/.ssh/id_ed25519`)
- GitHub CLI (`gh`) authenticated as `neverinfamous`
- Node.js 24+
- Default branch: `main`
- Credentials: `C:\Users\chris\Desktop\adamic\secrets.env`

## Parameters

Replace these placeholders throughout:

| Placeholder       | Example            |
| ----------------- | ------------------ |
| `{{REPO_NAME}}`   | `my-mcp-server`    |
| `{{DESCRIPTION}}` | `MCP server for X` |
| `{{YEAR}}`        | `2026`             |

---

## 1. Create Files (~28 total)

Read the reference file listed in the **Template Source** column for exact file contents. Files marked *inline* are defined directly below the table.

### File Manifest

| File | Purpose | Template Source |
|------|---------|----------------|
| **Community Standards** | | |
| `LICENSE` | MIT license | *inline* |
| `README.md` | Badges, quick start, TOC, examples | Adapt from reference repos |
| `CONTRIBUTING.md` | Fork → Clone → Branch → PR workflow | [community-standards.md](references/community-standards.md) |
| `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1 | [community-standards.md](references/community-standards.md) |
| `SECURITY.md` | Vulnerability reporting process | [community-standards.md](references/community-standards.md) |
| `CHANGELOG.md` | Keep a Changelog format (empty) | *inline* |
| `UNRELEASED.md` | SSoT for unreleased changes | *inline* |
| **GitHub Automation** | | |
| `.github/workflows/codeql.yml` | CodeQL static analysis | [github-automation.md](references/github-automation.md) |
| `.github/workflows/lint-and-test.yml` | CI: lint, typecheck, build, test | [github-automation.md](references/github-automation.md) |
| `.github/workflows/secrets-scanning.yml` | TruffleHog + Gitleaks | [github-automation.md](references/github-automation.md) |
| `.github/workflows/dependabot-auto-merge.yml` | Auto-squash patch/minor PRs | [github-automation.md](references/github-automation.md) |
| `.github/workflows/e2e.yml` | Playwright E2E tests | [github-automation.md](references/github-automation.md) |
| `.github/dependabot.yml` | Grouped dependency updates | [github-automation.md](references/github-automation.md) |
| `.github/ISSUE_TEMPLATE/bug_report.md` | Rich bug report template | [github-automation.md](references/github-automation.md) |
| `.github/ISSUE_TEMPLATE/feature_request.md` | Feature request template | [github-automation.md](references/github-automation.md) |
| `.github/ISSUE_TEMPLATE/config.yml` | Blank issue redirect | [github-automation.md](references/github-automation.md) |
| `.github/pull_request_template.md` | Comprehensive PR checklist | [github-automation.md](references/github-automation.md) |
| **Project Config** | | |
| `.gitignore` | Comprehensive ignores | *inline* |
| `.gitattributes` | Line ending normalization | *inline* |
| `.prettierrc` | Code formatting config | [project-config.md](references/project-config.md) |
| `.prettierignore` | Prettier exclusions | [project-config.md](references/project-config.md) |
| `.gitleaks.toml` | Secret scanning config | [project-config.md](references/project-config.md) |
| `package.json` | Project manifest | *inline* |
| `tsconfig.json` | TypeScript strict config | [project-config.md](references/project-config.md) |
| `eslint.config.js` | ESLint 10 strict + test config | [project-config.md](references/project-config.md) |
| `tsup.config.ts` | Build configuration | [project-config.md](references/project-config.md) |
| `vitest.config.ts` | Test configuration | [project-config.md](references/project-config.md) |
| `src/index.ts` | Entry point placeholder | Empty file |

---

### Inline Templates

#### LICENSE

```
MIT License

Copyright (c) {{YEAR}} Adamic.tech

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### CHANGELOG.md

```markdown
# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/).
```

#### UNRELEASED.md

```markdown
## [Unreleased]
```

#### .gitattributes

```gitattributes
# Normalize line endings to LF on all platforms
* text=auto eol=lf

# Windows-specific scripts that require CRLF
*.bat text eol=crlf
*.cmd text eol=crlf

# Docker
Dockerfile text eol=lf
.dockerignore text eol=lf

# Explicitly binary
*.db binary
*.wasm binary
*.png binary
*.jpg binary
*.ico binary
```

#### .gitignore

```gitignore
# Dependencies
node_modules/

# Build outputs
dist/
build/
out/

# Environment files
.env
.env.local
.env.*.local
.dev.vars

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*

# OS files
.DS_Store
Thumbs.db

# Editor directories and files
.gemini/
.vscode/*
!.vscode/settings.json
.idea/
*.swp
*.swo
*~

# Test coverage
coverage/
.nyc_output/
test-results.json

# Playwright
test-results/
playwright-report/

# TypeScript
*.tsbuildinfo

# Optional npm/eslint cache
.npm
.eslintcache
eslint-results.json

# Database files
data/
*.db
*.db-shm
*.db-wal
*.db-journal
*.sqlite
*.sqlite-shm
*.sqlite-wal

# Credentials
*.pem
*.key

# MCP Registry tokens
.mcpregistry_github_token
.mcpregistry_registry_token

# Alternative lock files
yarn.lock
pnpm-lock.yaml

# Temporary files
tmp/
temp/
*.tmp
```

#### package.json

```json
{
  "name": "{{REPO_NAME}}",
  "version": "0.1.0",
  "description": "{{DESCRIPTION}}",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "{{REPO_NAME}}": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "typecheck": "tsc --noEmit",
    "check": "npm run lint && npm run typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "bench": "vitest bench --run",
    "clean": "rimraf dist"
  },
  "keywords": [],
  "author": "neverinfamous",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/neverinfamous/{{REPO_NAME}}.git"
  },
  "bugs": {
    "url": "https://github.com/neverinfamous/{{REPO_NAME}}/issues"
  },
  "homepage": "https://github.com/neverinfamous/{{REPO_NAME}}#readme",
  "engines": {
    "node": ">=24.0.0"
  },
  "dependencies": {},
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@playwright/test": "^1.58.2",
    "@types/node": "^25.4.0",
    "@vitest/coverage-v8": "^4.0.18",
    "eslint": "^10.0.2",
    "globals": "^17.4.0",
    "rimraf": "^6.1.3",
    "tsup": "^8.5.1",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.57.1",
    "vitest": "^4.0.17"
  }
}
```

> **Note**: AI-suggested versions may be outdated. Always run `npm outdated` and `npx npm-check-updates -u` after install.

---

## 2. Init Repo & Push

```powershell
cd C:\Users\chris\Desktop\{{REPO_NAME}}
git init
git add .
git commit -m "Initial commit: Repository setup"
gh repo create neverinfamous/{{REPO_NAME}} --public --source=. --remote=origin --description "{{DESCRIPTION}}"
git push -u origin main
```

> **Note**: `git add .` is appropriate here because this is a brand-new repo with a clean `.gitignore`. For established repos, always use selective staging per user rules.

## 3. Labels, Topics & GitHub Settings

```powershell
# Labels
gh label create dependencies --description "Dependency PRs" --color 0052CC --repo neverinfamous/{{REPO_NAME}} --force
gh label create github-actions --description "GitHub Actions" --color FF6B6B --repo neverinfamous/{{REPO_NAME}} --force
gh label create npm --description "NPM updates" --color CB3837 --repo neverinfamous/{{REPO_NAME}} --force
gh label create bug --description "Bug reports" --color d73a49 --repo neverinfamous/{{REPO_NAME}} --force
gh label create enhancement --description "Feature requests" --color a2eeef --repo neverinfamous/{{REPO_NAME}} --force

# Topics
gh repo edit neverinfamous/{{REPO_NAME}} --add-topic typescript --add-topic nodejs

# Security settings (automate instead of manual UI)
gh api repos/neverinfamous/{{REPO_NAME}} -X PATCH -f security_and_analysis.secret_scanning.status=enabled
gh api repos/neverinfamous/{{REPO_NAME}} -X PATCH -f security_and_analysis.secret_scanning_push_protection.status=enabled
```

## 4. Verify

```powershell
npm install          # 0 vulnerabilities
npm run build        # Compiles
npm run typecheck    # No errors
npm run lint         # No errors
git status           # .gitignore working
npm outdated         # Update if needed
git remote -v        # origin → github.com/neverinfamous/{{REPO_NAME}}
gh repo view         # Displays repo info
```

## Reference Repos

- `C:\Users\chris\Desktop\db-mcp` (SQLite)
- `C:\Users\chris\Desktop\mysql-mcp` (MySQL)
- `C:\Users\chris\Desktop\postgres-mcp` (PostgreSQL)
- `C:\Users\chris\Desktop\memory-journal-mcp` (Memory Journal)
