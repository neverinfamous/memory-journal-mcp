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
  - `projects` (optional) - Comma-separated project names or numbers (e.g., `memory-journal-mcp`, `adamic,1`, `5`)
- **Behavior**:
  - **No args**: Returns a formatted markdown table of all registered projects and instructs the agent to ask the user which to load.
  - **With args**: Resolves the requested projects (exact match > case-insensitive exact > project number > partial match) and instructs the agent to call `read_resource` on the corresponding URIs.

### `session-summary`
**Description**: Generate a comprehensive session summary of recent journal entries.
- **Arguments**: None

### `team-session-summary`
**Description**: Generate a comprehensive session summary of recent team journal entries.
- **Arguments**: None

### `create-entry`
**Description**: Create a new personal journal entry.
- **Arguments**: None

### `create-team-entry`
**Description**: Create a new team journal entry.
- **Arguments**: None

### `update-entry`
**Description**: Update an existing personal journal entry.
- **Arguments**: None

### `update-team-entry`
**Description**: Update an existing team journal entry.
- **Arguments**: None

### `mcp-heal`
**Description**: Autonomous healing workflow to resolve tool execution failures.
- **Arguments**: None

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
**Description**: Generate a high-level weekly digest of all journal activity.
- **Arguments**: None

### `get-context-bundle`
**Description**: Get a comprehensive bundle of recent journal context.
- **Arguments**: None

### `get-recent-entries`
**Description**: Get the most recent journal entries.
- **Arguments**: None

### `confirm-briefing`
**Description**: Confirm the current session briefing.
- **Arguments**: None

### `analyze-period`
**Description**: Analyze journal activity over a specific time period.
- **Arguments**: None

---

## 3. GitHub Prompts

These prompts orchestrate multi-step GitHub interactions.

### `issue-commander`
**Description**: Comprehensive dashboard for viewing and managing project issues.
- **Arguments**:
  - `project_number` (required) - The ID of the project to manage.

### `project-status-summary`
**Description**: Generate a high-level status summary for a project.
- **Arguments**:
  - `project_number` (required) - The ID of the project.

### `project-milestone-tracker`
**Description**: Track milestone progress and open issues for a project.
- **Arguments**:
  - `project_number` (required) - The ID of the project.

### `pr-commander`
**Description**: Comprehensive dashboard for reviewing and managing a Pull Request.
- **Arguments**:
  - `pr_number` (required) - The ID of the PR to manage.

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
**Description**: Execute a standard interactive commit workflow.
- **Arguments**: None

### `quick-commit`
**Description**: Execute a fast, automated commit.
- **Arguments**: None

---

## 5. Adversarial Prompts

These prompts execute deep, parallelized audits using subagents.

### `adversarial-plan-review`
**Description**: Comprehensive architectural review.
- **Arguments**:
  - `topic` (optional) - The topic or feature to review.

### `adversarial-audit-code-quality`
**Description**: Deep code quality audit.
- **Arguments**:
  - `target` (optional) - The directory or file to audit.

### `adversarial-audit-security`
**Description**: Deep security audit.
- **Arguments**:
  - `target` (optional) - The directory or file to audit.

### `adversarial-audit-performance`
**Description**: Deep performance audit.
- **Arguments**:
  - `target` (optional) - The directory or file to audit.

### `adversarial-audit-seo`
**Description**: Deep SEO audit.
- **Arguments**:
  - `target` (optional) - The directory or file to audit.

### `adversarial-audit-skill`
**Description**: Audit an agent skill configuration.
- **Arguments**:
  - `target` (optional) - The skill to audit.

### `adversarial-audit-workflow`
**Description**: Audit an agent workflow configuration.
- **Arguments**:
  - `target` (optional) - The workflow to audit.

---

## 6. Optimizer Prompts

These prompts focus on maintaining system health and validating state.

### `optimize-journal`
**Description**: Run health checks and optimizations on the journal database.
- **Arguments**: None

### `verify-work`
**Description**: Verify recently completed work against requirements.
- **Arguments**: None

### `flag-dashboard`
**Description**: View and manage system flags and alerts.
- **Arguments**:
  - `flag_type` (optional) - Filter by specific flag type.
