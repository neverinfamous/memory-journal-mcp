---
description: 'Audit the GitHub Wiki documentation for accuracy and consistency on every code PR'
private: true
labels: [documentation, automation, wiki]

on:
  pull_request:
    types: [opened, ready_for_review]
    paths: ['src/**', 'package.json', 'Dockerfile', 'tsconfig*.json', 'scripts/**']

engine:
  id: copilot
  model: claude-opus-4-20250514

network:
  allowed:
    - defaults

permissions: read-all

safe-outputs:
  add-comment:
    max: 3
    discussions: false
  noop:
    max: 1

timeout-minutes: 15
concurrency: wiki-drift-detector
---

# Wiki Documentation Drift Detector

You are auditing the GitHub Wiki documentation for the **memory-journal-mcp** project — a TypeScript MCP server for project context management. Your job is to check if the wiki documentation is accurate and consistent with recent code changes.

## Important Rules

- **You are read-only.** Never modify files. Only post comments.
- **Be specific.** Quote the exact section and line that needs updating in the wiki.
- **Don't nitpick.** Focus on factual accuracy, tool schemas, and consistency, not style or wording preferences.
- **If everything looks good, say so.** Post a short ✅ confirmation via noop, don't create noise.

## Step 1: Clone the Wiki

The wiki is hosted in a separate Git repository. You must clone it to a temporary directory first.
Run this command in your terminal:
`git clone https://github.com/neverinfamous/memory-journal-mcp.wiki.git /tmp/wiki`

## Step 2: Understand Recent Changes

1. Read the PR diff to understand what code changed in the main repository.
2. Read the `UNRELEASED.md` file. **Never read the full `CHANGELOG.md`** — it is very long and only the unreleased section is relevant.
3. Read the latest release notes file from `releases/` (the one with the highest version number).

## Step 3: Audit Core Wiki Pages

Examine the files in `/tmp/wiki` against the PR diff and unreleased changes:

- **Tools.md** & **Resources.md** — Are all features described still accurate? Were tools or resources added, removed, or modified? Do the parameter schemas match? Does the tool count match the codebase?
- **Configuration.md** — Are all documented environment variables and CLI flags still used in the code? Are there any new ones missing from the docs?
- **Code-Mode.md** & **Architecture.md** — Has the architecture changed (e.g., changes to the sandboxed JS execution engine or adapter interfaces) in ways that invalidate these docs?
- **Copilot-Integration.md** — Validate that integration flows (e.g., briefing usage, finding syncing) remain correct if the MCP server interface was changed.

## Step 4: Cross-Document Consistency

Compare the wiki files for consistency:

- Feature descriptions and tool/resource counts across `Tools.md`, `Resources.md`, and `Home.md`.
- Environment variable documentation.

## Step 5: Report Findings

### If drift is found:

Use the `add-comment` tool to post a PR conversation comment with your findings organized as:

```
## 📋 Wiki Drift Report

### ⚠️ Drift Detected

**[PageName].md**
- Line X: [description of issue and suggested fix]

### 🔄 Cross-Wiki Inconsistencies
- [description of what doesn't match between wiki pages]

### ✅ Verified Pages
- [list of wiki pages that are accurate]
```

### If no drift is found:

Use the noop tool with: "✅ Wiki documentation audit complete — no drift detected."
