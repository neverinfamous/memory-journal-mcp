---
name: github-repo-setup
description: |
  Reusable scaffold for public TypeScript/Node.js repositories under
  a target organization. Use when creating a new GitHub repository to generate all
  community standards, CI/CD, config files, labels, and topics in one pass.
---

# GitHub Repository Setup

Scaffold a new public TypeScript/Node.js repo with community standards, CI, and strict tooling.

## Prerequisites

- Git CLI with SSH (`~/.ssh/id_ed25519`)
- GitHub CLI (`gh`) authenticated as `{{ORG_NAME}}`
- Node.js 24+
- Default branch: `main`
- Credentials: Load from a secure environment file (e.g., `{{SECRETS_ENV_PATH}}`) or OS credential stores. **CRITICAL: NEVER hardcode this path in shared templates or commit `.env` files.**

## Parameters

Replace these placeholders throughout:

| Placeholder          | Example                  |
| -------------------- | ------------------------ |
| `{{ORG_NAME}}`       | `neverinfamous`          |
| `{{REPO_NAME}}`      | `my-mcp-server`          |
| `{{DESCRIPTION}}`    | `MCP server for X`       |
| `{{YEAR}}`           | `2026`                   |
| `{{SECRETS_ENV_PATH}}`| `C:\path\to\secrets.env` |

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

See **[inline-templates.md](references/inline-templates.md)** for the boilerplate contents of `LICENSE`, `CHANGELOG.md`, `UNRELEASED.md`, `.gitattributes`, `.gitignore`, and `package.json`.

> **Note**: AI-suggested versions may be outdated. Always run `npm outdated` and `npx npm-check-updates -u` after install.

---

## 2. Init Repo & Push

> **CRITICAL HITL GATE**: You MUST stop and ask the user for explicit confirmation before running the `gh repo create` and `git push` commands. Creating a public repository is a destructive and public action.

```powershell
cd {{TARGET_DIRECTORY}}
git init
git add .
git commit -m "Initial commit: Repository setup"
gh repo create {{ORG_NAME}}/{{REPO_NAME}} --public --source=. --remote=origin --description "{{DESCRIPTION}}"
git push -u origin main
```

> **Note**: `git add .` is appropriate here because this is a brand-new repo with a clean `.gitignore`. For established repos, always use selective staging per user rules.

## 3. Labels, Topics & GitHub Settings

```powershell
# Labels
gh label create dependencies --description "Dependency PRs" --color 0052CC --repo {{ORG_NAME}}/{{REPO_NAME}} --force
gh label create github-actions --description "GitHub Actions" --color FF6B6B --repo {{ORG_NAME}}/{{REPO_NAME}} --force
gh label create npm --description "NPM updates" --color CB3837 --repo {{ORG_NAME}}/{{REPO_NAME}} --force
gh label create bug --description "Bug reports" --color d73a49 --repo {{ORG_NAME}}/{{REPO_NAME}} --force
gh label create enhancement --description "Feature requests" --color a2eeef --repo {{ORG_NAME}}/{{REPO_NAME}} --force

# Topics
gh repo edit {{ORG_NAME}}/{{REPO_NAME}} --add-topic typescript --add-topic nodejs

# Security settings (automate instead of manual UI)
gh api repos/{{ORG_NAME}}/{{REPO_NAME}} -X PATCH -f security_and_analysis.secret_scanning.status=enabled
gh api repos/{{ORG_NAME}}/{{REPO_NAME}} -X PATCH -f security_and_analysis.secret_scanning_push_protection.status=enabled
```

## 4. Verify

```powershell
npm install          # 0 vulnerabilities
npm run build        # Compiles
npm run typecheck    # No errors
npm run lint         # No errors
git status           # .gitignore working
npm outdated         # Update if needed
git remote -v        # origin → github.com/{{ORG_NAME}}/{{REPO_NAME}}
gh repo view         # Displays repo info
```

## Reference Repos

- `{{ORG_NAME}}/db-mcp` (SQLite)
- `{{ORG_NAME}}/mysql-mcp` (MySQL)
- `{{ORG_NAME}}/postgres-mcp` (PostgreSQL)
- `{{ORG_NAME}}/memory-journal-mcp` (Memory Journal)
