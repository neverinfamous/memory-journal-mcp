---
description: Version bump, release notes, full validation, and deploy via feature branch PR workflow
---

# Bump and Deploy

> **Prerequisite**: Run `/security-audit` and `/update-deps` first to ensure dependencies are current, secrets are not exposed, and vulnerabilities are resolved.
> **Note**: Do NOT update or create `UNRELEASED.md` or `CHANGELOG.md`. We use git history as the single source of truth.
> **Credentials**: If GitHub authentication is required for PR creation or merging, temporarily source the `GITHUB_PAT` token from `C:\Users\chris\Desktop\adamic\secrets.env`. Never expose this token in output.

## Phase 1: Determine Version Bump & Update References

1. Run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts` to view all unreleased changes from the git history.
2. Auto-select the version bump (Major/Minor/Patch) based on semver rules.
3. Update non-historical version references in `package.json`, `README.md`, `DOCKER_README.md`, `Dockerfile`, `mcp_config.json`, `.github/workflows/`, etc.
   > [!NOTE]
   > `DOCKER_README.md`, `Dockerfile`, and `server.json` are project-specific — skip updating them if they don't exist in the current repo.
4. Run `pnpm install` to update lock files.
5. Run `grep_search` to verify NO old version strings exist (exclude logs/history).

---

## Phase 2: Dockerfile & Release Notes Checks

1. Verify Dockerfile `COPY` instructions include all needed build config files.
2. Verify `DOCKER_README.md` stays under 25,000 bytes.
   > [!NOTE]
   > Steps 1–2 only apply if the project has a `Dockerfile`. Skip gracefully if not.
3. Run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts` to fetch the raw unreleased JSON blocks from the git history.
4. Create `releases/vX.Y.Z.md` using the template at `C:\Users\chris\Desktop\adamic\.agents\templates\release-notes-template.md`. Include YAML frontmatter with all required fields: `product`, `version`, `date`, `slug`, `npm_package`, `github_repo`, `description`. The `docker_image` field is required only if the project publishes Docker images. 
5. Fill in all applicable release note sections (Highlights, Added, Changed, Fixed, Security, Removed) using the JSON output from step 3. Omit empty sections. **CRITICAL**: The git history input is highly technical and agent-optimized. You MUST strictly adhere to the Adversarial Marketing Guidelines embedded in the template comments. You must heavily translate the technical file-path-oriented entries into punchy, benefit-driven copy (active voice, short sentences) to produce the highest quality release notes for humans.
6. Validate that the release notes file has valid YAML frontmatter with all required fields. Error if any required field is missing.

---

## Phase 3: Tiered Verification

Run validation based on the scope of change:
- **Comprehensive Validation**: Run `pnpm run check`. (This single command handles linting, typechecking, Vitest, and Playwright E2E testing).
- **Smoke Tests**: Run targeted tests via `mj_execute_code` (if MCP).

> [!CAUTION]
> **Loop Prevention**: If tests or builds fail, attempt to fix them. If still failing after 2 attempts -> **HITL checkpoint**.

---

## Phase 4: External Validation (GitHub Copilot)

Use the GitHub CLI Copilot extension to validate the git history and release notes against the actual Git diff.

```pwsh
gh copilot explain "Analyze this git history and release notes update against the recent git diff. Are any major changes missing?"
```
*(Gracefully skip if Copilot is unavailable).*

---

## Phase 5: Commit & PR Creation

1. Stage ONLY modified files. Never `git add -A`.
2. Commit: `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --msg "vX.Y.Z - Release description" --history-file "releases/vX.Y.Z.md" --impact 1.0 --confidence 1.0 --validation passed --significance release`
3. Branch & Push: `git checkout -b release/vX.Y.Z` → `git push origin release/vX.Y.Z`
4. Create PR: `gh pr create --title "vX.Y.Z - Release description" --body-file releases/vX.Y.Z.md --base main --head release/vX.Y.Z`

---

## Phase 6: Copilot Review & HITL

> [!IMPORTANT]
> **HITL Checkpoint**: STOP HERE. Notify the user that the PR has been created. The user will monitor CI checks and Copilot review. 

**Agent vs. Copilot Judgment**: Agent's informed judgment supersedes Copilot's automated heuristics. Fix actionable feedback, dismiss irrelevant feedback with rationale. Amend + force-push fixes to the same branch.

---

## Phase 7: Merge & Release (User-Initiated)

When the user confirms all checks pass and asks to merge:
1. `gh pr merge <PR_NUMBER> --squash --delete-branch`
2. `git checkout main` → `git reset --hard origin/main`
3. Force-delete local branch: `git branch -D release/vX.Y.Z`
4. Tag & Push: `git tag -a vX.Y.Z -m "Release vX.Y.Z"` → `git push origin main --follow-tags`
5. Create Release: `gh release create vX.Y.Z --notes-file releases/vX.Y.Z.md`
6. Trigger blog article update (gracefully skip if workflow doesn't exist):
   ```pwsh
   gh api repos/neverinfamous/adamic-blog/dispatches --method POST -f event_type=update-article -f "client_payload[repo]=$REPO_NAME" -f "client_payload[version]=vX.Y.Z"
   ```
