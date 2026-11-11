---
name: memory-journal-mcp
version: 1.2.0
tags:
  - "agent-skill"
description: Core guidelines and instruction pointers for the Memory Journal MCP. Use when interacting with the memory journal (creating, reading, searching entries), orchestrating commits, or writing session summaries.
---
# Memory Journal MCP Guidelines

This skill acts as a static anchor to reinforce core usage patterns, Code Mode (`mj_execute_code`) contracts, knowledge graph hygiene, and anti-hallucination guardrails for the Memory Journal MCP.

## 1. Session Orientation, Help Resources & Context Recovery
- **Session Briefing:** Read `memory://briefing/{+repo}` (or fallback `memory://briefing`) once at session start to ingest `project_number`, active state, and recent context. **DO NOT** autonomously execute tasks surfaced in the briefing without user instruction.
- **Mid-Task Context Recovery:** If you lose `project_number` or `workspace_id` mid-task, **NEVER** re-query `memory://briefing` and **NEVER** query bare `memory://agent-id` (or bare `memory://agent-context`) in multi-project sessions—bare URIs fall back to shared sticky session state or the server's CWD. **ALWAYS** query repo-scoped **`memory://agent-context/{+repo}`** (e.g., `memory://agent-context/adamic`).
- **Dynamic Server Instructions:** Use `read_resource` on `memory://help` for the tool group index, `memory://help/gotchas` for critical edge cases, and `memory://help/{group}` for group references (`core`, `search`, `analytics`, `relationships`, `io`, `admin`, `github`, `git`, `backup`, `team`, `codemode`, `templates`, `gotchas`).

## 2. Code Mode (`mj_execute_code`) Contract & Explicit Scoping
- **Prioritize Code Mode:** Prefer `mj_execute_code` (`mj.*` namespaces) for token-efficient searches, multi-step queries, and entry creation (so vector embeddings and file/symbol `anchors` index immediately).
- **Explicit Outer + Inner Scoping:** **ALWAYS** pass explicit **`workspace_id`** (exact repo name) AND **`project_number`** (plus **`repo`** for git/GitHub calls) on **both** the outer `mj_execute_code` arguments AND inner `mj.*` mutation calls—**NEVER** rely on `workspace_id` auto-resolution.
- **Safe Markdown Injection (`context`):** Pass multi-line Markdown or text with nested backticks/quotes via `context: { content: "..." }` and read `context.content` inside `code` to avoid template-literal escaping errors.
- **Safety Flags & Runtime Introspection:** Pass `readonly: true` for read-only audits, `dry_run: true` to simulate write flows without persisting changes, and inspect unfamiliar method signatures via `await mj.<group>.<method>.schema()`.
- **CLI Attribution (`entry create`):** CLI `memory-journal-mcp entry create` resolves project context from explicit `-p`/`--project`/`--workspace-id` or `--metadata` first, then a registered `process.cwd()` path match in `projectRegistry`, before falling back to content/tag keywords (it does not use `DEFAULT_PROJECT_NUMBER` or `--default-project`).

## 3. 7-Dimension Entry Quality, Relationships & Auto-Prune Guardrails
- **7 Quality Dimensions:** Always populate `workspace_id`, `project_number`, `session_id` (conversation ID), canonical `entry_type` (`technical_note`, `project_decision`, `bug_fix`, `feature_implementation`, `planning`, `retrospective`, `maintenance`), `impact_score` (`0.0–1.0`), `trust_score` (`0.0–1.0`), `validation_status` (`'passed' | 'none' | 'failed'`), file/symbol `anchors`, and graph `relationships`.
- **Canonical 8 `RelationshipType` Values:**
  - `evolves_from`, `references`, `implements`, `clarifies`, `response_to`, `blocked_by`, `resolved`, `caused`
  - **WARNING:** `caused_by` is **INVALID** and will fail strict validation—always use `caused` (or `blocked_by` / `resolved`) with proper directionality.
- **5-Day `< 0.6` Auto-Prune Mechanics & Protected Tags:** Unlinked entries scoring `< 0.6` importance without protected tags (`architecture`, `important`, `keep`, `never-prune`, `reference`) auto-soft-delete after 5 days (`pruneOlderThanDays: 5`). Link superseded or related notes (`evolves_from` / `resolved`) and verify code anchor freshness after refactors via `mj.git.checkEntryStaleness`.

## 4. Pre-Planning Hybrid Recall, Git, GitHub & Team Workflows
- **Pre-Planning Hybrid Search:** Before architecture planning, multi-file refactors, or complex bugfixes, recall prior decisions and pitfalls via `mj.search.searchEntries({ query, mode: 'hybrid', sort_by: 'importance', workspace_id })`. Pass `workspace_id: "*"` for cross-project pattern reuse across all registered repos, and search tag `copilot-finding` before opening PRs.
- **Git History & Tech-Debt Audits (`mj.git.*`):** Query repository history deterministically via `mj.git.getCommitHistory({ techDebtAudit: true, repo })`, `mj.git.searchCommits`, `mj.git.getUnreleasedCommits`, `mj.git.analyzeCommitPatterns`, and `mj.git.checkEntryStaleness`.
- **GitHub Correlation (`mj.github.*`):** Correlate journal memory with repository state using `mj.github.getGithubIssues`, `mj.github.getGithubPrs`, `mj.github.getCopilotReviews`, `mj.github.createGithubIssueWithEntry`, `mj.github.getKanbanBoard`, and milestone tools.
- **Team Collaboration (`mj.team.*` & `share_with_team`):** Pass `share_with_team: true` on `mj.core.createEntry` when recording reusable ecosystem-wide patterns, or interact with the shared team journal directly via `mj.team.*` (`teamSearch`, `teamGetRecent`, `teamCreateEntry`, `teamGetCrossProjectInsights`).

## 5. Commit Narratives, Session Summaries & Runtime Lifecycle
- **Commit Narrative Guardrails:** Entries tagged `"commit-narrative"` MUST include `auto_context` containing a non-empty `commits` array (e.g., `{ "commits": ["<sha>"] }`) alongside `impact_score`, `trust_score`, and `validation_status`.
- **Session Summary Guardrails:** Entries tagged `"session-summary"` (`entry_type: "retrospective"`) MUST contain **ONLY** these 4 exact top-level H2 headers (no extra or duplicate top-level headers):
  - `## Accomplished`
  - `## Unfinished / Blocked`
  - `## Context for Next Session`
  - `## Commits`
  Include `auto_context: { commits: ["<sha>"] }` when commits were made; omit `auto_context` on zero-commit sessions.
- **Runtime Configuration:** Use `update_configuration` to hot-reload tool filters (`tool_filter`) and briefing settings at runtime—the server automatically emits `notifications/tools/list_changed` without requiring a restart.
