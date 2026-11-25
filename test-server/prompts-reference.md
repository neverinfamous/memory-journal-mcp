# MCP Prompts Reference

This document provides a comprehensive reference for all native MCP prompts exposed by the Memory Journal server.

## Overview

Prompts are predefined templates that the agent can use to inject formatted messages into the context window. They act as "guided workflow kickoffs," ensuring the agent has the exact instructions, context, or constraints needed for specific tasks.

---

## 1. Session & Workflow Prompts

These prompts are used to initialize sessions, manage entries, and handle core journal operations.

### `load-briefing`
**Description**: Load one or more project briefings to initialize your session context. Pass project names or leave blank to see the full list and choose interactively.
- **Arguments**:
  - `projects` (optional) - Comma-separated project names or numbers (e.g., `memory-journal-mcp`, `db-mcp,1`, `5`)
- **Behavior**:
  - **No args**: Returns a formatted markdown table of all registered projects and instructs the agent to ask the user which to load.
  - **With args**: Resolves the requested projects (exact match > case-insensitive exact > project number > partial match) and instructs the agent to call `read_resource` on the corresponding URIs.

### `session-summary`
**Description**: Create a formatted session summary entry.
- **Arguments**:
  - `workspace_id` (optional) - Target workspace ID (rejects `*`).
  - `project_number` (optional) - Target GitHub project number.

### `team-session-summary`
**Description**: Create a formatted team session summary entry.
- **Arguments**:
  - `workspace_id` (optional) - Target workspace ID.
  - `project_number` (optional) - Target GitHub project number.

### `create-entry`
**Description**: Create a structured mid-thread journal entry.
- **Arguments**:
  - `workspace_id` (optional) - Target workspace ID.
  - `project_number` (optional) - Target GitHub project number.

### `create-team-entry`
**Description**: Create a structured mid-thread team journal entry.
- **Arguments**:
  - `workspace_id` (optional) - Target workspace ID.
  - `project_number` (optional) - Target GitHub project number.

### `update-entry`
**Description**: Safely update an existing mid-thread entry or session summary.
- **Arguments**:
  - `entry_id` (optional) - Entry ID to inspect and update.
  - `workspace_id` (optional) - Target workspace ID.
  - `project_number` (optional) - Target GitHub project number.

### `update-team-entry`
**Description**: Safely update an existing team entry or team session summary.
- **Arguments**:
  - `entry_id` (optional) - Team entry ID to inspect and update.
  - `workspace_id` (optional) - Target workspace ID.
  - `project_number` (optional) - Target GitHub project number.

### `project-setup`
**Description**: Set up a new project tracking environment.
- **Arguments**: None

---

## 2. Analytics Prompts

These prompts aggregate metrics and synthesize insights for agile ceremonies or reporting.

### `prepare-standup`
**Description**: Prepare a daily standup summary (Yesterday, Today, Blockers).
- **Arguments**: None

### `prepare-retro`
**Description**: Prepare data and talking points for a sprint retrospective.
- **Arguments**: None

### `weekly-digest`
**Description**: Create a weekly digest formatted day-by-day.
- **Arguments**: None

### `goal-tracker`
**Description**: Milestone and achievement tracking based on significant entries.
- **Arguments**: None

---

## 3. GitHub Prompts

These prompts orchestrate multi-step GitHub interactions.

### `issue-commander`
**Description**: Issue triage, milestone sprinting, and roadmap kickoff with HITL checkpoints.
- **Arguments**:
  - `project_number` (optional) - GitHub project number (falls back to unambiguously configured `defaultProjectNumber`).
  - `workflow_type` (optional) - Commander workflow: `triage` or `milestone`.

### `project-status-summary`
**Description**: Generate a comprehensive status summary for a GitHub project.
- **Arguments**:
  - `project_number` (optional) - GitHub project number (falls back to unambiguously configured `defaultProjectNumber`).

### `project-milestone-tracker`
**Description**: Track progress against a specific project milestone.
- **Arguments**:
  - `project_number` (optional) - GitHub project number (falls back to unambiguously configured `defaultProjectNumber`).

### `pr-commander`
**Description**: Pull request summary, review prep, and dependency updates with validation gates.
- **Arguments**:
  - `pr_number` (optional) - Pull request number for the commander workflow.
  - `workflow_type` (optional) - Commander workflow: `summary`, `review`, or `dependencies`.

### `pr-summary`
**Description**: Generate a summary of a Pull Request.
- **Arguments**:
  - `pr_number` (required) - The ID of the PR.

### `code-review-prep`
**Description**: Prepare for a code review session.
- **Arguments**:
  - `pr_number` (required) - The ID of the PR.

### `pr-retrospective`
**Description**: Generate a retrospective for a closed/merged PR.
- **Arguments**:
  - `pr_number` (required) - The ID of the PR.

### `actions-failure-digest`
**Description**: Analyze recent GitHub Actions failures and suggest fixes.
- **Arguments**: None

---

## 4. Git Prompts

These prompts manage local git repository interactions.

### `commit`
**Description**: Procedure for committing code changes with intelligent validation gates.
- **Arguments**:
  - `validation` (optional) - Validation level to run before committing (`lint`, `none`, `full`). Default: `lint`.

### `quickcommit`
**Description**: Quick commit for configuration, documentation, Markdown, and text files — skips lint/typecheck, commits directly.
- **Arguments**: None

---

## 5. Adversarial Prompts

These prompts execute deep, parallelized audits using subagents.

### `adversarial-plan-review`
**Description**: Comprehensive architectural review.
- **Arguments**:
  - `topic` (optional) - The topic or feature to review.
  - `depth` (optional) - Review depth profile (`light` | `standard` | `deep`, default: `standard`).
  - `copilot` (optional) - Opt-in to external GitHub Copilot CLI validation (`true` | `false`, default: `false`).

### `adversarial-audit-code-quality`
**Description**: Deep code quality audit.
- **Arguments**:
  - `target` (optional) - The directory or file to audit.
  - `copilot` (optional) - Opt-in to external GitHub Copilot CLI validation (`true` | `false`, default: `false`).

### `adversarial-audit-security`
**Description**: Deep security audit.
- **Arguments**:
  - `target` (optional) - The directory or file to audit.
  - `copilot` (optional) - Opt-in to external GitHub Copilot CLI validation (`true` | `false`, default: `false`).

### `adversarial-audit-performance`
**Description**: Deep performance audit.
- **Arguments**:
  - `target` (optional) - The directory or file to audit.
  - `copilot` (optional) - Opt-in to external GitHub Copilot CLI validation (`true` | `false`, default: `false`).

### `adversarial-audit-seo`
**Description**: Deep SEO audit.
- **Arguments**:
  - `target` (optional) - The directory or file to audit.
  - `copilot` (optional) - Opt-in to external GitHub Copilot CLI validation (`true` | `false`, default: `false`).

### `adversarial-audit-skill`
**Description**: Audit an agent skill configuration.
- **Arguments**:
  - `target` (optional) - The skill to audit.
  - `copilot` (optional) - Opt-in to external GitHub Copilot CLI validation (`true` | `false`, default: `false`).

### `adversarial-build-skill`
**Description**: Author, refine, and trigger-tune an agent skill (frontmatter, progressive disclosure, negative triggers, trigger evals, validation). Companion to `adversarial-audit-skill`.
- **Arguments**:
  - `target` (optional) - The skill path to refine, or the name and purpose of a new skill.
  - `copilot` (optional) - Opt-in to external GitHub Copilot CLI validation (`true` | `false`, default: `false`).

### `adversarial-audit-workflow`
**Description**: Audit an agent workflow configuration.
- **Arguments**:
  - `target` (optional) - The workflow to audit.
  - `copilot` (optional) - Opt-in to external GitHub Copilot CLI validation (`true` | `false`, default: `false`).

---

## 6. Optimizer & Cognitive Management System (CMS) Prompts

These prompts focus on maintaining system health, consolidating memory (`CMS-02`), and supervising autonomous passes (`CMS-04`).

### `optimize-journal`
**Description**: Guided database pruning, graph verification, episodic-to-semantic compaction, and multi-agent audit workflow (`CMS-02` NREM Consolidation).
- **Arguments**:
  - `lookback` (optional): Number of recent entries to inspect for unverified status (default: `10`)
  - `limit` (optional): Entry processing cap (`0` = unlimited across all history; default: `500`, or `0` when `mode: 'full'` / `autoRun: 'true'`)
  - `project` (optional): Target project name or number (omit to optimize all projects globally)
  - `autoRun` (optional): Boolean (`true` | `false`), bypasses interactive handover and executes all phases including Multi-Agent Domain Audit automatically (default: `false`)
  - `mode` (optional): `'quick'` | `'targeted'` | `'full'` (default: `'quick'`; `'full'` activates unattended full-depth mode)
  - `targetDimension` (optional): `'unassigned'` | `'relationships'` | `'scores'` | `'tags'` | `'all'` (default: `'all'`)

### `cms-rem-supervisor`
**Description**: REM Meta-Cognitive Supervisor & Self-Adaptation workflow (`CMS-04`). Audits recent NREM consolidation (`CMS-02`) mutations and soft-deletions, mines cross-run telemetry and unresolved blockers, and enforces the Dirty-Tree Conditional Single-Pass Validation Gate.
- **Arguments**:
  - `lookbackHours` (optional): Hours to look back for `CMS-02` maintenance entries and soft-deleted entries (default: `24`)
  - `autoRestore` (optional): Boolean (`true` | `false`), automatically restores any high-significance entry erroneously soft-deleted (default: `true`)
