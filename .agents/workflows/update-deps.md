---
description: Update pnpm + Docker dependencies, audit for vulnerabilities, lint, typecheck, history, and commit
---

# Update Dependencies

> **Prerequisite**: Ensure your Git working directory is completely clean before starting. Stash or commit any unrelated changes.
> **Note**: Do NOT update or create `UNRELEASED.md` or `CHANGELOG.md`. We use git history as the single source of truth.

## Phase 1: pnpm Dependency Updates

1. **Convert to pnpm (If Needed)**: Run `pnpm import`, delete `package-lock.json`/`node_modules`, run `pnpm install`. Replace `npm` commands with `pnpm` in scripts/workflows.
2. Run `pnpm update`.
3. Run `pnpm audit`. If vulnerabilities exist, update `resolutions` in `package.json` to the latest safe versions.
   > [!CAUTION]
   > **Security Gate**: If vulnerabilities cannot be cleanly resolved via resolutions, you MUST hard-fail and request a HITL checkpoint. Never proceed with known vulnerabilities.
4. Run `pnpm outdated`. Update `package.json` version ranges for `0.x` packages manually if needed. Skip intentionally pinned packages.

---

## Phase 2: Docker & CI Transitive Audits

### 2.1 Dockerfile Audits

> **This prevents Docker Scout blocks at deploy time.**

1. Parse the `Dockerfile` for `npm pack <package>@<version>`.
2. Check `pnpm view <package> version` and `pnpm audit --json`.
3. If a newer version exists, update the Dockerfile `npm pack` lines and the `resolutions` entry in `package.json` (use exact version pins).
4. Update the `# Security Notes:` block in the Dockerfile to reflect runtime vs bundled packages.
5. Check Alpine System Packages if applicable.

### 2.2 GitHub Actions Audits

1. Inspect `.github/workflows/` for used actions.
2. Verify all external GitHub Actions are SHA-pinned by digest rather than version tags (e.g., `uses: actions/checkout@<sha>`).
3. Update the SHAs to their latest secure versions if necessary.

---

## Phase 3: Validation Gates

1. Run `pnpm run check`. (This single command handles linting, typechecking, tests, and E2E validation).

> [!CAUTION]
> **Loop Prevention**: Fix any test, lint, or build errors before proceeding. If still failing after 2 attempts -> **HITL checkpoint**.

---

## Phase 4: Commit Code Changes & HITL Checkpoint

> [!IMPORTANT]
> **HITL Checkpoint**: STOP HERE. Present the full list of dependency updates and overrides to the user. Ask for confirmation before staging and committing.

Following the strict `commit.md` procedure, use the automated commit CLI to log the dependency updates.

```pwsh
git add package.json pnpm-lock.yaml Dockerfile .github/workflows/
bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --msg "chore(deps): update dependencies and security patches" --no-history --category Changed --impact 0.4 --confidence 1.0 --validation passed
```

Do **not** push. The user will run `/bump-deploy` next if a release is planned.
