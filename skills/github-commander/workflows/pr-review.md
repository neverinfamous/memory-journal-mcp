# PR Review

Review an open pull request with optional validation pipeline and structured
findings.

## Phase 1 — Gather Context

1. Read `memory://briefing` for session context
2. Fetch the PR details:
   ```
   get_github_pr({ pr_number: <N> })
   ```
3. If available, fetch Copilot review findings:
   ```
   get_copilot_reviews({ pr_number: <N> })
   ```
4. Search journal for related entries:
   ```
   semantic_search({ query: "<PR title/description>" })
   ```
5. Check linked issues and milestone context
6. Journal review start:
   ```
   create_entry({
     content: "Starting review of PR #<N>: <title>. Author: <author>. Files changed: <count>.",
     entry_type: "review_start",
     tags: ["commander", "review"],
     pr_number: <N>
   })
   ```

## Phase 2 — Code Review

1. Check out the PR branch locally:

   ```bash
   gh pr checkout <N>
   ```

2. Review changes for:
   - **Correctness** — does the code do what the PR claims?
   - **Style** — does it follow project conventions?
   - **Security** — any injection, validation, or auth issues?
   - **Performance** — any hot-path allocations, missing early returns?
   - **Test coverage** — are new/changed paths tested?

3. Run validation gates (same as issue-triage Phase 3):
   - Gate 1: Lint + Typecheck
   - Gate 2: Build
   - Gate 3: Unit/Integration Tests
   - Gate 4: E2E Tests
   - Gate 5: Security Scans (auto-detected)

   Journal each gate result as in issue-triage.

## Phase 3 — Findings Report

Compile all findings into a structured report:

1. **Code review findings** — issues found during manual review
2. **Gate results** — pass/fail for each validation gate
3. **Security findings** — from auto-detected security scans
4. **Copilot findings** — any issues flagged by Copilot reviews

Journal each significant finding:

```
create_entry({
  content: "PR #<N> finding: <severity> - <description>. File: <path>:<lines>.",
  entry_type: "audit_finding",
  tags: ["commander", "review", "<category>"],
  pr_number: <N>
})
```

**HITL checkpoint**: Present the full findings report to the human. Ask for
review decision:

- **Approve** — no blocking issues found
- **Request changes** — blocking issues identified
- **Comment** — non-blocking suggestions

## Phase 4 — Submit Review

Based on human's decision:

### Approve

```bash
gh pr review <N> --approve --body "LGTM. All validation gates passed. <summary>"
```

### Request Changes

```bash
gh pr review <N> --request-changes --body "<findings summary with specific file/line references>"
```

### Comment

```bash
gh pr review <N> --comment --body "<non-blocking suggestions>"
```

Journal review completion:

```
create_entry({
  content: "Completed review of PR #<N>: <decision>. Findings: <count>. Gates: <summary>.",
  entry_type: "review_complete",
  tags: ["commander", "review"],
  pr_number: <N>
})
```

## Phase 5 — Session Summary

Run `/session-summary` to capture:

- PR reviewed with decision
- All findings by category
- Gate results
- Any follow-up items
