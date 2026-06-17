# Changelog Commit Workflow

This workflow standardizes the high-integrity procedure for committing code changes and updating `UNRELEASED.md` with the corresponding commit SHA.

## Significance Threshold
Do NOT pollute `UNRELEASED.md` with trivial changes. The changelog is for human readers to understand the evolution of the software, not a granular git log.
- **DO NOT log**: Typos, minor linter fixes, formatting, test pollution fixes, internal refactoring that does not change behavior or architecture, or rapid iteration fixes on a feature you just built.
- **DO log**: New features, bug fixes affecting user behavior or security, architecture changes, dependency bumps, workflow changes, and performance improvements.

If your commit does not meet the threshold, simply commit the code and stop. Do not update `UNRELEASED.md`.

## The Procedure

Due to the cryptographic nature of Git, a commit's SHA is derived from the contents of the files within that commit. Therefore, it is **impossible** to include a commit's own SHA inside `UNRELEASED.md` within the same commit—modifying the file changes the commit hash, instantly invalidating the logged SHA.

To properly associate a commit SHA with an `UNRELEASED.md` entry, follow this strict two-step commit process:

### Step 1: Commit the Code Changes
**Crucial Prerequisite**: Run your complete validation pipeline (e.g., `pnpm run check`) and ensure all linting and tests pass *before* committing.

Commit your functional changes, fixes, or feature work first. Do NOT include `UNRELEASED.md` in this commit.
```powershell
git add <files>
git commit -m "fix: resolve nested css build output"
```

### Step 2: Retrieve the Short SHA
Obtain the short SHA of the commit you just made.
```powershell
git log -1 --format=%h
```
*(Example output: `a1b2c3d`)*

### Step 3: Update `UNRELEASED.md`
Edit `UNRELEASED.md` to document the change. You **MUST** use an agent-optimized description (concise, specific, actionable) and include the short commit SHA in backtick-wrapped parentheses at the end of the entry.
```markdown
### Fixed
- Fixed missing stylesheets by updating `vite.config.js` to prevent nested directory output. (`a1b2c3d`)
```
*(Note: For multi-commit entries, comma-separate the SHAs: ``(`a1b2c3d`, `e5f6g7h`)``)*

### Step 4: Commit the Documentation Update
Stage and commit `UNRELEASED.md` as a separate documentation/chore commit.
```powershell
git add UNRELEASED.md
git commit -m "docs(changelog): log vite configuration fix"
```

## Critical Rules
- **NEVER** attempt to use `git commit --amend` to add the SHA into the changelog. Amending a commit creates a completely new commit object with a new SHA, permanently invalidating the ID you just added.
- **BEWARE OF POST-COMMIT FIXES**: If you commit code, retrieve the SHA, and *then* realize you need to fix a linter error or broken test using `git commit --amend`, the commit SHA will change. You MUST restart this workflow from Step 2 to fetch the new valid SHA.
- **NEVER** edit `CHANGELOG.md` directly for unreleased work. Always use `UNRELEASED.md`.
- **ALWAYS** retrieve the SHA programmatically via `git log -1 --format=%h` after Step 1. Do not attempt to guess or mock the SHA.
- **SESSION SUMMARIES**: When creating a session summary at the end of a conversation, include all commit SHAs from this session in the `## Commits` section and in the `auto_context` JSON parameter. See the `session-summary` prompt for the exact format.
