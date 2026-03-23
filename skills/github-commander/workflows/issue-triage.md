# Issue Triage

Fix a single assigned GitHub issue end-to-end — from context gathering through
validated PR submission.

## Phase 1 — Gather Context

1. Read `memory://briefing` for session context
2. Fetch the assigned issue:
   ```
   get_github_issue({ issue_number: <N> })
   ```
3. Search journal for related prior work:
   ```
   semantic_search({ query: "<issue title/description>" })
   search_entries({ tags: ["commander"] })
   ```
4. Check knowledge graph for linked specs/implementations:
   ```
   visualize_relationships({ format: "mermaid" })
   ```
5. Journal the triage start:
   ```
   create_entry({
     content: "Triaging issue #<N>: <title>. Related entries: <ids>. Prior context: <summary>.",
     entry_type: "triage",
     tags: ["commander", "triage"],
     issue_number: <N>
   })
   ```

## Phase 2 — Implement Fix

1. Analyze the issue and implement the fix
2. Follow existing project conventions (check journal for patterns, rules, etc.)
3. Journal the implementation:
   ```
   create_entry({
     content: "Implemented fix for #<N>: <description of changes>. Files modified: <list>.",
     entry_type: "implementation",
     tags: ["commander", "fix"],
     issue_number: <N>
   })
   ```

## Phase 3 — Validation Gates

Run gates sequentially. Each must pass before the next. Skip gates where the
command is empty or not configured.

### Gate 1: Lint + Typecheck

Run `PROJECT_LINT_CMD` (default: `npm run lint`).
Run `PROJECT_TYPECHECK_CMD` (default: `npm run typecheck`).

On failure:

- Attempt auto-fix (run lint with `--fix` if available)
- Re-run the gate
- If still failing after 2 attempts → **HITL checkpoint**

Journal result:

```
create_entry({
  content: "Gate 1 (Lint + Typecheck): PASSED/FAILED. Details: <output>.",
  entry_type: "gate_pass" or "gate_fail",
  tags: ["commander", "validation", "lint"],
  issue_number: <N>
})
```

### Gate 2: Build

Run `PROJECT_BUILD_CMD` (default: `npm run build`).
Skip if not configured (empty string).

On failure → attempt fix → **HITL checkpoint** after 2 attempts.

### Gate 3: Unit/Integration Tests

Run `PROJECT_TEST_CMD` (default: `npm run test`).

On failure:

- Analyze test output to determine if failure is related to the fix
- If related: attempt to fix the test or the code
- If unrelated (pre-existing failure): journal and flag for human
- After 2 fix attempts → **HITL checkpoint**

### Gate 4: E2E Tests

Run `PROJECT_E2E_CMD` (default: empty = skip).
Skip if not configured. Same failure handling as Gate 3.

### Gate 5: Security Scans

Run auto-detected security scanning tools (see SKILL.md § Security Tool
Auto-Detection). For each available tool:

1. Run the scan
2. Parse output for findings with severity levels
3. Journal each finding:
   ```
   create_entry({
     content: "Security finding (<tool>): <severity> - <description>",
     entry_type: "security_finding",
     tags: ["commander", "security", "<tool-name>"],
     issue_number: <N>
   })
   ```
4. **Critical/High findings → HITL checkpoint** (present findings, ask how to proceed)
5. Missing tools → skip with journal note:
   ```
   create_entry({
     content: "Security scan: <tool> not available — skipped.",
     entry_type: "gate_pass",
     tags: ["commander", "validation", "security-skip"],
     issue_number: <N>
   })
   ```

#### npm audit

```bash
npm audit --json
```

Parse JSON output. Report vulnerabilities by severity.

#### CodeQL (if available)

```bash
codeql database create /tmp/codeql-db --language=javascript --overwrite
codeql database analyze /tmp/codeql-db --format=sarif-latest --output=/tmp/codeql-results.sarif
```

Or via GitHub Actions (if running in CI context).

#### Trivy (if available)

```bash
trivy fs --severity HIGH,CRITICAL --format json .
```

For Docker projects (`PROJECT_HAS_DOCKERFILE=true`):

```bash
trivy image --severity HIGH,CRITICAL --format json <image-name>
```

#### Docker Scout (if available)

```bash
docker scout cves <image-name> --format json --only-severity critical,high
```

#### Gitleaks (if available)

```bash
gitleaks detect --source . --report-format json --report-path /tmp/gitleaks.json
```

#### TruffleHog (if available)

```bash
trufflehog filesystem . --json --only-verified
```

## Phase 4 — Human Checkpoint

**Always pause before submitting a PR.** Present to the human:

1. Summary of changes (files modified, lines added/removed)
2. All gate results (pass/fail with details)
3. Any security findings
4. All journal entries created during this workflow

**Additional HITL triggers** (pause earlier if any apply):

- Changes touch more files than `COMMANDER_HITL_FILE_THRESHOLD` (default: 10)
- Any critical or high security findings
- Test failures that couldn't be auto-fixed

Wait for human approval before proceeding to Phase 5.

## Phase 5 — Submit PR

1. Create a feature branch:

   ```bash
   git checkout -b <COMMANDER_BRANCH_PREFIX>/issue-<N>
   ```

2. Stage changed files selectively (**never `git add -A`**):

   ```bash
   git add <file1> <file2> ...
   ```

3. Verify staged files:

   ```bash
   git diff --cached --stat
   ```

4. Commit with descriptive message:

   ```bash
   git commit -m "fix: <description> (closes #<N>)"
   ```

5. Push and create PR:

   ```bash
   git push origin <COMMANDER_BRANCH_PREFIX>/issue-<N>
   gh pr create --base main --title "fix: <description>" --body "Closes #<N>\n\n<summary of changes>"
   ```

6. Journal the PR:
   ```
   create_entry({
     content: "Submitted PR #<pr_number> for issue #<N>: <description>. Gates: all passed.",
     entry_type: "pr_submitted",
     tags: ["commander", "pr"],
     issue_number: <N>,
     pr_number: <pr_number>
   })
   ```

## Phase 6 — Session Summary

Run `/session-summary` to capture:

- Issue triaged and fixed
- All gate results
- Security findings (if any)
- PR link and status
- Any pending items for next session
