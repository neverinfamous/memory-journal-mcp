---
name: memory-journal-mcp
version: 2.1.0
tags:
  - "agent-skill"
description: >-
  Guidelines and Code Mode contracts for Memory Journal MCP (memory-journal-mcp): multi-repo briefing/agent-context, graph-first hybrid recall, 7-dimension entries, relationships, and CMS-04 summaries. Use when calling mj_execute_code, memory:// resources, or entry CLI workflows. Do NOT use for generic SQLite queries or unrelated repo tasks.
---
# Memory Journal MCP Guidelines (`v9.1.0+`)

Static operational anchor for `memory-journal-mcp` Code Mode (`mj_execute_code`), multi-repo context isolation, graph-first recall, 7-dimension entries, commit narratives, and `CMS-04` session summaries.

## 1. Dynamic Help & Multi-Repo Context Orientation

- **Dynamic Server Help:** Read `memory://help` for the tool-group index, `memory://help/gotchas` for anti-hallucination rules, and `memory://help/{group}` for group references (`core`, `search`, `admin`, `codemode`, `github`, `git`, `templates`, `team`, `analytics`, `backup`, `io`, `relationships`).
- **Session Start Briefing:** Read `memory://briefing/{+repo}` **once** at session start (append `?pin_session=false` to preview a secondary repo without changing sticky session scope) to ingest `project_number`, active state, recent context, insights, and default graph pivots (degree/hubs/active threads/14d linkage; configure via `briefing_entries`, `briefing_commits`, `briefing_summaries`, `briefing_importance_threshold`, `briefing_graph`, `briefing_insights` in `update_configuration`, `--no-briefing-graph`/`--no-briefing-insights`, or `BRIEFING_GRAPH=false`/`BRIEFING_INSIGHTS=false`). **NEVER** autonomously execute tasks surfaced in the briefing without user instruction.
- **Mid-Task Context & Graph Neighborhood (`memory://agent-context/{+repo}`, `memory://graph/{+repo}`):**
  - **[WHEN]** missing `project_number` or `workspace_id` mid-task -> **[NEVER]** re-query `memory://briefing/{+repo}` and **[NEVER]** query bare `memory://agent-id` (which reads active/default server scope rather than resolving your current repo; `memory://agent-context/default` pins sticky `'default'` scope).
  - **[ALWAYS]** query repo-scoped **`memory://agent-context/{+repo}`** (append `?session_id=<conversation-id>` after context compaction to list session link targets, and `?pin_session=false` to inspect another repo without pinning), and read **`memory://graph/{+repo}`** when scanning recent 14-day edges, unlinked entry IDs, and node degrees without fetching full bodies.

## 2. Code Mode (`mj_execute_code`) Contract & Graph-First Hybrid Recall

- **Code Mode First:** Prioritize `mj_execute_code` (`mj.*` namespaces) for searches, multi-step queries, and entry creation (`mj.core.createEntry` indexes HNSW vector embeddings and file/symbol `anchors` immediately).
- **Top-Level Call Contract:**
  `mj_execute_code({ code, workspace_id, project_number, repo, session_id, context, readonly, dry_run, auto_version, max_result_size, timeout })`
  - **[ALWAYS]** pass explicit **`workspace_id`** (exact repo name) AND **`project_number`** (plus **`repo`** for `mj.git.*` / `mj.github.*` calls) **both** at the top level of `mj_execute_code` **and** on inner `mj.*` mutations — **NEVER** rely on `workspace_id` auto-resolution.
  - **Session & Versioning:** Pass `session_id` (active conversation UUID) to tag sandbox entries and telemetry (excluded from automatic inner injection on `checkEntryStaleness`, `updateEntry`, and `teamUpdateEntry` unless passed explicitly). `auto_version` defaults to `true`, injecting `expected_version` for optimistic concurrency on entry updates/deletes (personal and team); pass `auto_version: false` only when supplying `expected_version` yourself.
  - **Safe Markdown Passing (`context.content`):** Pass multi-line Markdown bodies via `context: { content: "..." }` and reference `context.content` (or `ctx.content`) inside `code` to avoid template-literal and backtick escaping errors.
  - **Execution Guards & Introspection:** Pass `readonly: true` for read-only audits, `dry_run: true` to preview mutations, `max_result_size` to bound large outputs, and `await mj.<group>.<method>.schema()` to inspect unfamiliar parameter schemas at runtime.
- **Unbiased Pre-Planning Hybrid & Graph Recall:** Omit `sort_by: 'importance'` (or use `sort_by: 'blended'`) and exclude commit noise (both `commit-narrative` and legacy `session-commits` rows) so architectural decisions rank by relevance before expanding the graph. Pass `source: top.source` (or rely on Code Mode silent team fallback auto-routing with `_healed.routedTo`):
  ```javascript
  // FTS: tokens containing . / : @ auto-quote as phrases; bare hyphenated tokens split into separate AND terms,
  // so wrap them in double quotes for an exact phrase match (e.g., '"memory-journal-mcp"')
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
  // Direct MCP tools: pass source: top.source ('personal' | 'team') or call teamGetEntryById / teamVisualizeRelationships;
  // Code Mode mj.core.getEntryById / mj.relationships.visualizeRelationships auto-route missing personal IDs to Team DB.
  const full = !top
    ? null
    : await mj.core.getEntryById({ entry_id: top.id, workspace_id: 'my-repo', ...(top.source ? { source: top.source } : {}) });
  const graph = !top
    ? null
    : await mj.relationships.visualizeRelationships({ entry_id: top.id, depth: 2, workspace_id: 'my-repo', ...(top.source ? { source: top.source } : {}) });
  return { hits, decisions, full, graph };
  ```
  - Search tag `"copilot-finding"` before opening PRs to prevent recurring review regressions.
- **Ecosystem Namespaces & Runtime Config:**
  - **`mj.git.*`:** `getCommitHistory({ techDebtAudit: true, ... })` (or `getCommitHistory({ uncommitted: true, path? })` for working-tree status/diffstat instead of raw `git status`), `searchCommits`, `getUnreleasedCommits`, `checkEntryStaleness`.
  - **`mj.github.*`:** `getGithubIssues`, `getGithubPrs`, `getCopilotReviews`, `createGithubIssueWithEntry`, Kanban and Milestone tools.
  - **`mj.team.*` / `share_with_team: true`:** Omit `share_with_team` to keep routine entries in the Personal DB (default); pass `share_with_team: true` only when publishing reusable cross-repository patterns to the shared team database. Discover valid team IDs via `mj.team.teamGetRecent` or `mj.team.teamSearch` instead of probing sequential entry IDs.
  - **`update_configuration`:** Hot-reload `tool_filter`, briefing preferences (`briefing_entries`, `briefing_commits`, `briefing_summaries`, `briefing_importance_threshold`, `briefing_graph`, `briefing_insights`, etc.), and default workspace/project scope at runtime (automatically emits `notifications/tools/list_changed` without restarting the server).

## 3. 7-Dimension Entry Quality & Auto-Prune Guardrails

Every manual journal entry (`mj.core.createEntry`) **MUST** populate:
1. **`workspace_id`**: Exact repository name (e.g., `"my-repo"`).
2. **`project_number`**: Numeric project ID from `memory://briefing/{+repo}` or `memory://agent-context/{+repo}`.
3. **`session_id`**: Active conversation UUID (when running inside an agent harness).
4. **`entry_type`**: Canonical enum value — `'technical_note'`, `'project_decision'`, `'bug_fix'`, `'feature_implementation'`, `'planning'`, `'retrospective'`, or `'maintenance'` (pair architectural decisions with `significance_type: 'architecture' | 'decision'`).
5. **`impact_score`** (`0.0–1.0`) & **`trust_score`** (`0.0–1.0`).
6. **`validation_status`**: `'passed'`, `'none'`, or `'failed'`.
7. **Canonical `anchors` & Graph `relationships`**: Pass file/symbol anchors as `anchors: [{ anchor_path: "src/foo.ts", anchor_type: "file" }]` (never invent arbitrary `{ type, value }` keys), and pass **`relationships: [{ targetId: <number>, relationType: <canonical_type> }]`** (if omitted, `create_entry` returns up to 3 `suggested_links` from same-session, shared-anchor, and semantic neighbors, or pass `auto_link: true` to auto-link up to 2 same-session/shared-anchor targets) using **only** canonical types:
   - Causal (carry 20% of importance score): `'resolved'`, `'caused'`, `'blocked_by'`
   - Structural / informational: `'evolves_from'`, `'implements'`, `'clarifies'`, `'response_to'`, `'references'`
   - **NEVER** use `'caused_by'` (invert source/target or use `'resolved'` / `'evolves_from'`).

- **Two-Stage Auto-Prune & Hard-Delete Lifecycle:**
  Auto-prune defaults to off (`pruneOlderThanDays: 0`, `hardDeleteOlderThanDays: 0`, `pruneImportanceThreshold: 0.15`, `pruneExcludeTags: []`). Under the recommended 5-day retention policy (`pruneOlderThanDays: 5`, `hardDeleteOlderThanDays: 5`, threshold `0.6`, and `--prune-exclude-tags architecture,important,keep,never-prune,reference`), unlinked entries (`rel_count === 0`) with `significance_type === null` and `impact_score < 0.5` below threshold soft-delete at 5 days and permanently hard-delete 5 days later. Always link superseded notes (`evolves_from` / `resolved`) and run `mj.git.checkEntryStaleness` after major refactors.

## 4. Commit Narratives, CLI & Session Summary Guardrails

- **CLI Attribution (`entry create`):** `memory-journal-mcp entry create` resolves project context from explicit `-p`/`--project`/`--workspace-id` or `--metadata` first, then a registered `process.cwd()` path match in `projectRegistry` (supports `--significance <type>`, `--related-to`, `anchors` frontmatter/metadata or `--auto-context` extraction, `--auto-link` / `auto_link: true` heuristic linking, `--no-auto-link`, and `--dry-run-links`). Content and tag keywords do not select the project.
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
