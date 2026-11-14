---
name: memory-journal-mcp
version: 2.1.0
tags:
  - "agent-skill"
description: >-
  Guidelines and Code Mode contracts for Memory Journal MCP (memory-journal-mcp): multi-repo briefing/agent-context, graph-first hybrid recall, 7-dimension entries, relationships, and CMS-04 summaries.
---
# Memory Journal MCP Guidelines (`v9.1.0+`)

Static operational anchor for `memory-journal-mcp` Code Mode (`mj_execute_code`), multi-repo context isolation, graph-first recall, 7-dimension entries, commit narratives, and `CMS-04` session summaries.

## 1. Dynamic Help & Multi-Repo Context Orientation

- **Dynamic Server Help:** Read `memory://help` for the tool-group index, `memory://help/gotchas` for anti-hallucination rules, and `memory://help/{group}` for group references (`core`, `search`, `admin`, `codemode`, `github`, `git`, `templates`, `team`, `analytics`, `backup`, `io`, `relationships`).
- **Session Start Briefing:** Read `memory://briefing/{+repo}` **once** at session start to ingest `project_number`, active state, and recent context. **NEVER** autonomously execute tasks surfaced in the briefing without user instruction.
- **Mid-Task Context Recovery (`memory://agent-context/{+repo}`):**
  - **[WHEN]** missing `project_number` or `workspace_id` mid-task -> **[NEVER]** re-query `memory://briefing/{+repo}` and **[NEVER]** query bare `memory://agent-id` (which reads `'default'` or previously pinned server scope rather than resolving your current repo; `memory://agent-context/default` pins sticky `'default'` scope).
  - **[ALWAYS]** query repo-scoped **`memory://agent-context/{repo_name}`** (e.g., `memory://agent-context/my-repo`).

## 2. Code Mode (`mj_execute_code`) Contract & Graph-First Hybrid Recall

- **Code Mode First:** Prioritize `mj_execute_code` (`mj.*` namespaces) for searches, multi-step queries, and entry creation (`mj.core.createEntry` indexes HNSW vector embeddings and file/symbol `anchors` immediately).
- **Top-Level Call Contract:**
  `mj_execute_code({ code, workspace_id, project_number, repo, context, readonly, dry_run, max_result_size, timeout })`
  - **[ALWAYS]** pass explicit **`workspace_id`** (exact repo name) AND **`project_number`** (plus **`repo`** for `mj.git.*` / `mj.github.*` calls) **both** at the top level of `mj_execute_code` **and** on inner `mj.*` mutations — **NEVER** rely on `workspace_id` auto-resolution.
  - **Safe Markdown Passing (`context.content`):** Pass multi-line Markdown bodies via `context: { content: "..." }` and reference `context.content` inside `code` to avoid template-literal and backtick escaping errors.
  - **Execution Guards & Introspection:** Pass `readonly: true` for read-only audits, `dry_run: true` to preview mutations, `max_result_size` to bound large outputs, and `await mj.<group>.<method>.schema()` to inspect unfamiliar parameter schemas at runtime.
- **Unbiased Pre-Planning Hybrid & Graph Recall:** Omit `sort_by: 'importance'` (or use `sort_by: 'blended'`) and exclude commit noise so architectural decisions rank by relevance before expanding the graph:
  ```javascript
  // Quote hyphenated tokens in FTS queries (e.g., '"memory-journal-mcp"') so '-' is not split as separate words
  const hits = await mj.search.searchEntries({
    query: 'search sanitizer regression',
    mode: 'hybrid',
    exclude_tags: ['commit-narrative'],
    workspace_id: 'my-repo', // Pass "*" for cross-repo pattern recall
  });
  const decisions = await mj.search.searchEntries({
    query: 'search sanitizer',
    entry_type: 'project_decision',
    workspace_id: 'my-repo',
  });
  const top = hits.entries[0] ?? decisions.entries[0];
  const full = top ? await mj.core.getEntryById({ entry_id: top.id }) : null;
  const graph = top ? await mj.relationships.visualizeRelationships({ entry_id: top.id, depth: 2 }) : null;
  return { hits, decisions, full, graph };
  ```
  - Search tag `"copilot-finding"` before opening PRs to prevent recurring review regressions.
- **Ecosystem Namespaces & Runtime Config:**
  - **`mj.git.*`:** `getCommitHistory({ techDebtAudit: true, ... })`, `searchCommits`, `getUnreleasedCommits`, `checkEntryStaleness`.
  - **`mj.github.*`:** `getGithubIssues`, `getGithubPrs`, `getCopilotReviews`, `createGithubIssueWithEntry`, Kanban and Milestone tools.
  - **`mj.team.*` / `share_with_team: true`:** Publish reusable cross-repository patterns to the shared team database (`mj.core.createEntry({ ..., share_with_team: true })`).
  - **`update_configuration`:** Hot-reload `tool_filter`, briefing preferences, and default workspace/project scope at runtime (automatically emits `notifications/tools/list_changed` without restarting the server).

## 3. 7-Dimension Entry Quality & Auto-Prune Guardrails

Every manual journal entry (`mj.core.createEntry`) **MUST** populate:
1. **`workspace_id`**: Exact repository name (e.g., `"my-repo"`).
2. **`project_number`**: Numeric project ID from `memory://briefing/{+repo}` or `memory://agent-context/{+repo}`.
3. **`session_id`**: Active conversation UUID (when running inside an agent harness).
4. **`entry_type`**: Canonical enum value — `'technical_note'`, `'project_decision'`, `'bug_fix'`, `'feature_implementation'`, `'planning'`, `'retrospective'`, or `'maintenance'` (pair architectural decisions with `significance_type: 'architecture'`).
5. **`impact_score`** (`0.0–1.0`) & **`trust_score`** (`0.0–1.0`).
6. **`validation_status`**: `'passed'`, `'none'`, or `'failed'`.
7. **Graph `relationships`**: Pass **`relationships: [{ targetId: <number>, relationType: <canonical_type> }]`** using **only** canonical types:
   - Causal (carry 20% of importance score): `'resolved'`, `'caused'`, `'blocked_by'`
   - Structural / informational: `'evolves_from'`, `'implements'`, `'clarifies'`, `'response_to'`, `'references'`
   - **NEVER** use `'caused_by'` (invert source/target or use `'resolved'` / `'evolves_from'`).

- **Two-Stage Auto-Prune & Hard-Delete Lifecycle (~10 Days Total):**
  Unlinked entries (`rel_count === 0`) with `significance_type === null`, `impact_score < 0.5`, and importance `< 0.6` lacking protected tags (`architecture`, `important`, `keep`, `never-prune`, `reference`) **auto-soft-delete at 5 days** (`pruneOlderThanDays: 5`) and **permanently hard-delete 5 days later** (`hardDeleteOlderThanDays: 5`). Always link superseded notes (`evolves_from` / `resolved`) and run `mj.git.checkEntryStaleness` after major refactors.

## 4. Commit Narratives, CLI & Session Summary Guardrails

- **CLI Attribution (`entry create`):** `memory-journal-mcp entry create` resolves project context from explicit `-p`/`--project`/`--workspace-id` or `--metadata` first, then a registered `process.cwd()` path match in `projectRegistry`, before falling back to content/tag keywords (supports `--significance <type>` and `--related-to`).
- **Commit Narratives:** Any entry tagged `"commit-narrative"` **MUST** include `auto_context` with a non-empty `commits` array (`{ commits: ["<sha>"] }`).
- **Session Summaries (Feeds Nightly `CMS-04` REM Supervisor):**
  - Entries tagged `"session-summary"` (`entry_type: "retrospective"`) **MUST** contain **only** these 4 exact H2 headers (no extra or duplicate H2 headers):
    - `## Accomplished`
    - `## Unfinished / Blocked`
    - `## Context for Next Session`
    - `## Commits`
  - **Conditional `auto_context`:** Include `auto_context: { commits: ["<sha>"] }` **when commits occurred during the session**; **omit `auto_context`** on zero-commit sessions.

## 5. Self-Healing Telemetry & Architecture References

- **Dual-Schema Validation & Code Mode Architecture:** See `AGENT_README.md` and `test-server/code-map.md`.
- **MCP Friction Telemetry (`CMS-04`):** MCP schema/validation errors are auto-logged server-side (and transport errors by `PostToolUse`) to `logs/agent-issues.jsonl`; log additional reproducible bugs in `session-summary` `## Unfinished / Blocked`.
