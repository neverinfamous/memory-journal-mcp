---
description: "Weekly audit of CI workflows for deprecations, outdated actions, and health issues"
private: true
labels: [maintenance, ci-cd]

on:
  schedule:
    - cron: "0 14 * * 3" # Every Wednesday at 14:00 UTC
  workflow_dispatch:

engine:
  id: copilot
  model: claude-opus-4-20250514

network:
  allowed:
    - defaults
    - node

permissions: read-all

safe-outputs:
  create-issue:
    title-prefix: "[ci-health] "
    labels: [maintenance, ci-cd]
    max: 1
  noop:
    max: 1

timeout-minutes: 15
concurrency: ci-health-monitor
---

# CI Health Monitor

You are auditing the CI/CD infrastructure for the **memory-journal-mcp** project. Your job is to check all GitHub Actions workflows for deprecations, outdated action versions, and health issues.

## Important Rules

- **Only report actionable findings.** Don't flag things that are working correctly.
- **If everything is healthy, report "all clear" via noop.** Do not create empty issues.
- **Be specific with fix suggestions.** Include the exact file, line, and replacement value.

## Step 1: Audit Workflow Files

List all `.yml` files in `.github/workflows/`. For each workflow file:

1. **Check action versions** — for each `uses:` line, note the action name and version/tag. Check if a newer major or minor version exists by reading the action's releases.
2. **Check Node.js runtime** — look for `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` workarounds or actions known to use deprecated Node.js versions (16, 18, 20). Flag any that will break after the June 2026 deadline.
3. **Check for deprecated features** — `set-output`, `save-state`, `::set-output::` commands, or other deprecated GitHub Actions features.
4. **Check Dependabot config** — read `dependabot.yml` and verify it covers all ecosystems in use (npm, GitHub Actions, Docker).

## Step 2: Review Recent Workflow Runs

Check recent workflow runs (last 7 days):

1. Any workflows with consistent failures?
2. Any runs with annotations or warnings?
3. Any runs that are abnormally slow?

## Step 3: Report

Before creating a new issue, check if an existing open issue with the `[ci-health]` prefix already exists. If so, add a comment to that issue instead of creating a duplicate. Only create a new issue if none exists.

### If issues are found:

Create an issue via safe-output with this structure:

```
## 🏥 CI Health Report — [DATE]

### 🔴 Critical (blocks before June 2026)
- [action@version] in [workflow.yml] — needs update to [version] for Node.js 24

### 🟡 Warnings
- [description of warning/deprecation]

### 🟢 Healthy
- [list of workflows that passed all checks]

### Suggested Fixes
1. [exact code change with file + line]
```

### If everything is healthy:

Use the noop tool with: "✅ CI Health Check — all workflows healthy, no deprecations or issues found."
