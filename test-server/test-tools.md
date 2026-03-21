# Test memory-journal-mcp — Pass 1: Core Functionality

Exhaustively test the memory-journal-mcp server's core functionality using the phased plan below. **Please make sure to use the correct resource names/urls as documented below.**

**Scope:** 61 tools, 22 resources (15 static + 7 templates), 16 prompts — this pass covers happy paths, core error paths, and feature verification (Phases 0-10).

**Constraints:**

- Confirm MCP server instructions were auto-received before starting.
- Use the MCP server directly for all tests — not the terminal or scripts.
- Use https://github.com/users/neverinfamous/projects/5 for project/Kanban testing.

**Workflow after testing:**

1. Create a plan to fix any issues found, including changes to `server-instructions.md`/`server-instructions.ts` or this file (`test-server/test-tools.md`).
2. If the plan requires no user decisions, proceed with implementation immediately.
3. After implementation: run `npm run lint && npm run typecheck`, fix any issues, run `npx vitest run`, fix broken tests, update `UNRELEASED.md`, and commit without pushing.
4. Re-test fixes with direct MCP calls.
5. Provide a final summary — after re-testing if fixes were needed, or immediately if no issues were found.

> [!IMPORTANT]
> **Test Session Prerequisites**

1. The server instructions are auto-injected by the MCP protocol. Confirm receipt (no need to read `memory://instructions` separately).
2. Confirm `memory://briefing` was auto-received and **present the `userMessage` to the user as a formatted bullet list of key facts as the server instructions required:**. Detailed briefing testing is below in Phase 1.2.

---

## Phase 0: Seed Test Data

> [!IMPORTANT]
> Create these entries **before Phase 2** to ensure FTS5, filter, semantic search, and relationship tests have matching data. Each entry is mapped to the test cases it enables.
>
> **Do NOT skip this phase** — without it, many Phase 3 search tests will return empty results and won't validate the underlying feature.

### 0.1 FTS5 Content Entries

These entries ensure every FTS5 query pattern in Phase 3.1 returns actual results.

| #   | Tool           | Params                                                                                                                                                                                              | Enables Tests                                                      |
| --- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| S1  | `create_entry` | `content: "Redesigned the authentication architecture for the OAuth 2.1 module"`, `entry_type: "technical_note"`, `tags: ["architecture", "auth"]`                                                  | `architecture`, `auth*`, `"authentication architecture"` phrase    |
| S2  | `create_entry` | `content: "Improved error handling in the database adapter layer with typed error classes"`, `entry_type: "bug_fix"`, `significance_type: "lesson_learned"`, `tags: ["error-handling", "database"]` | `"error handling"` phrase, `significance_type` filter              |
| S3  | `create_entry` | `content: "Deploy new release candidate to the CDN edge network"`, `entry_type: "feature_implementation"`, `tags: ["deploy", "release"]`, `is_personal: false`                                      | `deploy NOT staging`, `deploy OR release`                          |
| S4  | `create_entry` | `content: "Released v5.0 with breaking API changes and migration guide"`, `entry_type: "milestone"`, `significance_type: "breakthrough"`, `tags: ["release"]`                                       | `deploy OR release` (via "release"), semantic search for "release" |
| S5  | `create_entry` | `content: "Deploy to staging environment failed — rollback initiated"`, `entry_type: "bug_fix"`, `tags: ["deploy", "staging"]`                                                                      | `deploy NOT staging` (negative match — verifies NOT exclusion)     |
| S6  | `create_entry` | `content: "The test's scope was expanded to cover 100% of edge cases"`, `entry_type: "planning"`, `tags: ["testing"]`                                                                               | `test's` LIKE fallback, `100%` LIKE fallback                       |

### 0.2 Filter & GitHub-Linked Entries

These entries ensure filter tests (`issue_number`, `pr_status`, `workflow_run_id`, `project_number`) return results.

| #   | Tool           | Params                                                                                                                                                                                                                                     | Enables Tests                                                                            |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| S7  | `create_entry` | `content: "Investigated performance regression in issue #44 — root cause was N+1 queries"`, `entry_type: "research"`, `issue_number: 44`, `project_number: 5`, `tags: ["performance", "investigation"]`                                    | `issue_number: 44` filter, `project_number: 5` filter, semantic search for "performance" |
| S8  | `create_entry` | `content: "Code review feedback from PR #67 merged — refactored authentication middleware"`, `entry_type: "code_review"`, `pr_number: 67`, `pr_status: "merged"`, `tags: ["code-review", "auth"]`                                          | `pr_status: "merged"` filter, `pr_number` filter, `auth*` prefix                         |
| S9  | `create_entry` | `content: "CI workflow run completed — all 910 tests passing across 3 test suites"`, `entry_type: "technical_note"`, `workflow_run_id: 12345`, `workflow_name: "lint-and-test"`, `workflow_status: "completed"`, `tags: ["ci", "testing"]` | `workflow_run_id` filter, workflow field persistence                                     |
| S10 | `create_entry` | `content: "Personal reflection on improving development velocity and reducing technical debt"`, `entry_type: "personal_reflection"`, `is_personal: true`, `tags: ["personal", "velocity"]`                                                 | `is_personal: true` filter, semantic search for "improving performance"                  |

### 0.3 Team & Cross-DB Entries

These entries ensure cross-DB search merging (`source: 'personal' | 'team'`) returns results from both databases.

| #   | Tool                | Params                                                                                                                                                                                     | Enables Tests                                                                    |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| S11 | `create_entry`      | `content: "Architecture decision: adopted event-driven design for webhook processing"`, `entry_type: "project_decision"`, `share_with_team: true`, `tags: ["architecture", "team-shared"]` | Cross-DB `search_entries` with `source` marker, team search, `architecture` FTS5 |
| S12 | `team_create_entry` | `content: "Team standup: discussed authorization flow improvements and deploy pipeline"`, `entry_type: "standup"`, `tags: ["standup", "auth", "deploy"]`                                   | Team-only search, cross-DB date range, `auth*` and `deploy` in team DB           |

### 0.4 Post-Seed Verification

After creating all 12 entries, verify the seed data is searchable:

| Check                | Command                                           | Expected                                                          |
| -------------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| FTS5 indexed         | `search_entries(query: "architecture")`           | ≥ 2 results (S1, S11)                                             |
| Filters work         | `search_entries(issue_number: 44)`                | ≥ 1 result (S7)                                                   |
| Cross-DB merged      | `search_entries(query: "architecture")`           | Results include `source: 'personal'` and `source: 'team'` entries |
| Rebuild vector index | `rebuild_vector_index`                            | `entriesIndexed` > 0                                              |
| Semantic search      | `semantic_search(query: "improving performance")` | ≥ 1 result (S7, S10 should be semantically similar)               |

---

## Phase 1: Core Infrastructure

### 1.1 Server Health & Connectivity

| Test               | Command/Action         | Expected Result                                                                                 |
| ------------------ | ---------------------- | ----------------------------------------------------------------------------------------------- |
| Basic connectivity | `test_simple`          | Returns echo message                                                                            |
| Health resource    | Read `memory://health` | Shows DB stats, tool filter status, vector index health                                         |
| Health team block  | Read `memory://health` | Includes `teamDatabase` block with `configured`, `entryCount`, `path` (requires `TEAM_DB_PATH`) |
| Scheduler inactive | Read `memory://health` | `scheduler.active: false`, `scheduler.jobs: []` (scheduler is HTTP-only, inactive in stdio)     |
| Statistics         | `get_statistics`       | Returns `structuredContent` with entry counts, types, periods                                   |
| Enhanced analytics | `get_statistics`       | Returns `decisionDensity`, `relationshipComplexity`, `activityTrend`, `causalMetrics`           |

### 1.2 Briefing Resource

| Test                             | Command/Action                   | Expected Result                                                                                        |
| -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Read briefing                    | Read `memory://briefing`         | Returns JSON with `userMessage`, `templateResources`, `journal`, `github`                              |
| Verify `lastModified` annotation | Check resource metadata          | ISO 8601 timestamp (client-dependent — AntiGravity doesn't expose MCP annotations)                     |
| Confirm `userMessage`            | Inspect briefing.userMessage     | Formatted table with project/branch/CI/journal stats                                                   |
| Milestone progress row           | Inspect briefing.userMessage     | Table includes milestone progress row (e.g., "🚩 Milestones: X open")                                  |
| Team DB row                      | Inspect briefing.userMessage     | Table includes "Team DB" row with team entry count (requires `TEAM_DB_PATH`)                           |
| Template URIs                    | Check `templateResources` array  | 7 template URIs listed (includes `memory://milestones/{number}`)                                       |
| Workflow summary                 | Inspect `github.workflowSummary` | Present when `BRIEFING_WORKFLOW_STATUS=true` — has `passing`, `failing`, `pending`, `cancelled` counts |
| Workflow named runs              | Inspect `workflowSummary.runs`   | Array of `{name, conclusion}` when `BRIEFING_WORKFLOW_COUNT > 0`; CI row shows icons (✅/❌)           |
| Rules metadata                   | Inspect `rulesFile` field        | Present when `RULES_FILE_PATH` set — has `name`, `sizeKB`, `lastModified`                              |
| Skills metadata                  | Inspect `skillsDir` field        | Present when `SKILLS_DIR_PATH` set — has `count`, `names` array                                        |
| Enhanced CI row                  | Inspect briefing.userMessage     | CI row shows breakdown or named runs (not just single-word status) when workflow env vars are set      |

### 1.3 Protocol Validation — Run via Scripts - DO NOT SKIP!

> [!IMPORTANT]
> These tests require **separate server starts** — they cannot be run via MCP tool calls. Run the scripts below in a terminal. See `test-server/README.md` for full details and script locations.

```powershell
# Test A — Instruction levels (essential < standard < full)
node test-server/test-instruction-levels.mjs

# Test B — Tool annotations (61 tools, 33 openWorldHint=false, 16 openWorldHint=true, 0 missing)
node test-server/test-tool-annotations.mjs
```

| Check              | Expected                                                             |
| ------------------ | -------------------------------------------------------------------- |
| Instruction levels | essential (~1.2K) < standard (~1.4K) < full (~6.7K tokens)           |
| Tool annotations   | 61 tools, all with `annotations`, 33 `false` + 16 `true` = 0 missing |

### 1.4 GitHub Status Resource

| Test              | Command/Action                | Expected Result                                                  |
| ----------------- | ----------------------------- | ---------------------------------------------------------------- |
| Read status       | Read `memory://github/status` | Compact JSON with repo, branch, CI, issues, PRs, Kanban summary  |
| CI status mapping | Verify CI status value        | Shows `passing`, `failing`, `pending`, `cancelled`, or `unknown` |
| Milestone data    | Inspect status data           | Includes milestones summary (open count, completion percentages) |

---

## Phase 2: Entry CRUD Operations

### 2.1 Create Entry

| Test                 | Command/Action                                                                                              | Expected Result                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Minimal create       | `create_entry_minimal(content: "Test entry")`                                                               | Returns entry ID                                                                      |
| Full create          | `create_entry(content: "...", entry_type: "planning", tags: ["test"])`                                      | Entry created with metadata                                                           |
| With GitHub linking  | `create_entry(..., issue_number: <N>)`                                                                      | Entry links to issue                                                                  |
| issueUrl auto-pop    | `create_entry(content: "...", issue_number: <N>)` — omit issueUrl                                           | `issueUrl` auto-populated from cached repo info (requires prior `get_github_context`) |
| Invalid entry_type   | `create_entry(content: "test", entry_type: "invalid")`                                                      | Structured error: `{ success: false, error: "..." }` listing valid enum values        |
| Invalid significance | `create_entry(content: "test", significance_type: "invalid")`                                               | Structured error: `{ success: false, error: "..." }` listing valid enum values        |
| With PR fields       | `create_entry(content: "PR test", pr_number: 67, pr_status: "merged")`                                      | Entry created with `prNumber`, `prStatus` fields persisted                            |
| With workflow fields | `create_entry(content: "CI test", workflow_run_id: 123, workflow_name: "CI", workflow_status: "completed")` | Entry created with all workflow fields persisted                                      |
| With project_owner   | `create_entry(content: "...", project_number: 5, project_owner: "neverinfamous")`                           | Entry created with `projectOwner` field                                               |
| auto_context off     | `create_entry(content: "No context", auto_context: false)`                                                  | Entry created without auto-generated context                                          |
| share_with_team      | `create_entry(content: "Shared entry", share_with_team: true)`                                              | Entry in personal DB + team DB; response has `sharedWithTeam: true`, `author`         |

### 2.2 Read & Update

| Test                      | Command/Action                                                 | Expected Result                                                          |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Get by ID                 | `get_entry_by_id(entry_id: <N>)`                               | Returns `structuredContent` with relationships                           |
| Importance score          | `get_entry_by_id(entry_id: <N>)`                               | Response includes `importance` field (0.0-1.0) and `importanceBreakdown` |
| No relationships          | `get_entry_by_id(entry_id: <N>, include_relationships: false)` | Response omits `relationships` array (or returns empty)                  |
| Update tags               | `update_entry(entry_id: <N>, tags: ["updated"])`               | Tags changed                                                             |
| Update content            | `update_entry(entry_id: <N>, content: "Updated content")`      | Content changed; verify via `get_entry_by_id`                            |
| Update entry_type         | `update_entry(entry_id: <N>, entry_type: "technical_note")`    | Entry type changed                                                       |
| Update is_personal        | `update_entry(entry_id: <N>, is_personal: false)`              | `isPersonal` toggled                                                     |
| Update nonexistent        | `update_entry(entry_id: 999999, tags: ["x"])`                  | Returns `{ success: false, error: "Entry 999999 not found" }`            |
| Update invalid type       | `update_entry(entry_id: <N>, entry_type: "invalid")`           | Structured error listing valid enum values                               |
| Get recent                | `get_recent_entries(limit: 5)`                                 | Returns `structuredContent` array                                        |
| Get recent (personal)     | `get_recent_entries(limit: 5, is_personal: true)`              | Only personal entries returned                                           |
| Get recent (not personal) | `get_recent_entries(limit: 5, is_personal: false)`             | Only non-personal entries returned                                       |

### 2.3 Delete (Test Last!)

| Test                     | Command/Action                                        | Expected Result                                           |
| ------------------------ | ----------------------------------------------------- | --------------------------------------------------------- |
| Soft delete              | `delete_entry(entry_id: <test_id>, permanent: false)` | Entry hidden from search                                  |
| Permanent delete         | `delete_entry(entry_id: <test_id>, permanent: true)`  | Entry removed                                             |
| Delete nonexistent entry | `delete_entry(entry_id: 999999, permanent: false)`    | Returns `success: false, error: "Entry 999999 not found"` |

---

## Phase 3: Search Tools

### 3.1 Text Search

| Test                  | Command/Action                                                                                   | Expected Result                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| FTS5 search           | `search_entries(query: "architecture")`                                                          | ≥ 2 results (S1, S11) ranked by BM25 relevance                            |
| FTS5 phrase           | `search_entries(query: "\"error handling\"")`                                                    | ≥ 1 result (S2) — exact phrase match only                                 |
| FTS5 prefix           | `search_entries(query: "auth*")`                                                                 | ≥ 2 results (S1, S8) — matches "authentication", "authorization", etc.    |
| FTS5 boolean NOT      | `search_entries(query: "deploy NOT staging")`                                                    | Returns S3, S11 but NOT S5 (S5 contains "staging")                        |
| FTS5 boolean OR       | `search_entries(query: "deploy OR release")`                                                     | ≥ 2 results (S3, S4, S5 expected)                                         |
| FTS5 fallback         | `search_entries(query: "test's")`                                                                | ≥ 1 result (S6) — LIKE fallback, single quotes are FTS5-unsafe            |
| FTS5 special chars    | `search_entries(query: "100%")`                                                                  | ≥ 1 result (S6) — LIKE fallback, `%` is FTS5-unsafe                       |
| Date range            | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-01-31")`                         | Returns `structuredContent` array                                         |
| Cross-DB search       | `search_entries(query: "test")`                                                                  | Results include `source: 'personal' \| 'team'` marker on each entry       |
| Cross-DB date         | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31")`                         | Results include `source` marker merging personal + team entries           |
| Invalid date fmt      | `search_by_date_range(start_date: "Jan 1", end_date: "Jan 31")`                                  | Structured error: `{ success: false, error: "..." }` with YYYY-MM-DD hint |
| Filter by issue       | `search_entries(issue_number: 44)`                                                               | Returns entries linked to issue #44                                       |
| Filter by PR status   | `search_entries(pr_status: "merged")`                                                            | Returns entries with `prStatus: "merged"`                                 |
| Filter by workflow    | `search_entries(workflow_run_id: <N>)`                                                           | Returns entries linked to workflow run                                    |
| Filter by project     | `search_entries(project_number: 5)`                                                              | Returns entries linked to project #5                                      |
| Filter by is_personal | `search_entries(query: "test", is_personal: true)`                                               | Only personal entries returned                                            |
| Date range + type     | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", entry_type: "planning")` | Only "planning" entries in date range                                     |
| Date range + tags     | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", tags: ["test"])`         | Only entries with "test" tag in date range                                |
| Date range + personal | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", is_personal: true)`      | Only personal entries in date range                                       |
| Date range + project  | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", project_number: 5)`      | Only project #5 entries in date range                                     |
| Inverted date range   | `search_by_date_range(start_date: "2026-12-31", end_date: "2026-01-01")`                         | Returns empty results (no validation for `start > end` — confirmed)       |

> [!NOTE]
> **Cross-DB Search Behavior:** When a team DB is present, per-DB queries fetch `limit × 2` (capped at 500) to prevent BM25 ranking in one DB from silently dropping entries before the cross-DB merge. The user's requested `limit` is applied after merging.
>
> **Code Mode API Group Structure:** When testing `mj_execute_code`, methods are bound to specific groups. Key mapping: `listTags` → `mj.core`, `mergeTags` → `mj.admin`, `getStatistics` → `mj.analytics`. Use `mj.help()` or `mj.<group>.help()` to discover available methods per group.

### 3.2 Semantic Search

| Test                   | Command/Action                                                     | Expected Result                                                                     |
| ---------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Vector index stats     | `get_vector_index_stats`                                           | Shows `itemCount`, `modelName`, `dimensions`                                        |
| Rebuild index          | `rebuild_vector_index`                                             | `entriesIndexed` > 0 (indexes seed entries)                                         |
| Semantic query         | `semantic_search(query: "improving performance")`                  | ≥ 1 result — S7, S10 semantically similar                                           |
| Custom threshold       | `semantic_search(query: "performance", similarity_threshold: 0.5)` | Fewer results than default threshold (0.25)                                         |
| Personal filter        | `semantic_search(query: "test", is_personal: true)`                | Only personal entries in results                                                    |
| Hint disabled          | `semantic_search(query: "xyznonexistent", hint_on_empty: false)`   | Noise results with quality gate `hint` still shown (only advisory hints suppressed) |
| Hint enabled (default) | `semantic_search(query: "xyznonexistent")`                         | Noise results with quality gate `hint` (all hints shown)                            |

### 3.3 Analytics & Index Management

| Test                     | Command/Action                                                                 | Expected Result                                                 |
| ------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Stats group by month     | `get_statistics(group_by: "month")`                                            | Periods grouped by month                                        |
| Stats group by day       | `get_statistics(group_by: "day")`                                              | Periods grouped by day                                          |
| Stats with dates         | `get_statistics(start_date: "2026-01-01", end_date: "2026-03-01")`             | Returns `dateRange` in response; results filtered to date range |
| Stats project breakdown  | `get_statistics(project_breakdown: true)`                                      | Returns `projectBreakdown` array with per-project stats         |
| Cross-project insights   | `get_cross_project_insights`                                                   | Returns `project_count`, `total_entries`, `projects` array      |
| Insights with dates      | `get_cross_project_insights(start_date: "2026-01-01", end_date: "2026-03-01")` | Date-filtered project insights                                  |
| Insights min_entries     | `get_cross_project_insights(min_entries: 1)`                                   | Lower threshold includes more projects                          |
| Add to vector index      | `add_to_vector_index(entry_id: <existing_id>)`                                 | `success: true`, `entryId` in response                          |
| Add nonexistent to index | `add_to_vector_index(entry_id: 999999)`                                        | Returns `{ success: false, error: "..." }`                      |

---

## Phase 4: Relationships & Visualization

### 4.1 Basic Relationships

| Test                    | Command/Action                                                                                                            | Expected Result                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Link entries            | `link_entries(from_entry_id: <A>, to_entry_id: <B>, relationship_type: "references")`                                     | Relationship created                                                                         |
| Duplicate link          | Call `link_entries` again with same params                                                                                | Returns `duplicate: true`, `message`, existing relationship                                  |
| Link nonexistent source | `link_entries(from_entry_id: 999999, to_entry_id: <B>, ...)`                                                              | Returns `success: false`, message: `"One or both entries not found (from: 999999, to: <B>)"` |
| Link nonexistent target | `link_entries(from_entry_id: <A>, to_entry_id: 999999, ...)`                                                              | Returns `success: false`, message: `"One or both entries not found (from: <A>, to: 999999)"` |
| Visualize               | `visualize_relationships(entry_id: <A>)`                                                                                  | Mermaid diagram returned (raw text, not JSON-wrapped)                                        |
| Link with description   | `link_entries(from_entry_id: <A>, to_entry_id: <C>, relationship_type: "implements", description: "Implements the plan")` | Relationship created with `description` field                                                |
| Reverse duplicate       | `link_entries(from_entry_id: <B>, to_entry_id: <A>, relationship_type: "references")`                                     | Succeeds — only same-direction duplicates are checked (confirmed)                            |
| Visualize nonexistent   | `visualize_relationships(entry_id: 999999)`                                                                               | Returns `message: "Entry 999999 not found"`                                                  |
| Visualize by tags       | `visualize_relationships(tags: ["test"])`                                                                                 | Diagram scoped to entries with "test" tag                                                    |
| Visualize depth 3       | `visualize_relationships(entry_id: <A>, depth: 3)`                                                                        | Deeper traversal than default `depth: 2`                                                     |
| Visualize custom limit  | `visualize_relationships(entry_id: <A>, limit: 5)`                                                                        | Diagram limited to 5 entries                                                                 |
| Graph resource          | Read `memory://graph/recent`                                                                                              | Raw Mermaid text (`text/plain` MIME), arrows harmonized with `visualize_relationships`       |

### 4.2 Causal Relationship Types

| Test              | Command/Action                                                                        | Expected Result                                                                       |
| ----------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| blocked_by type   | `link_entries(from_entry_id: <A>, to_entry_id: <B>, relationship_type: "blocked_by")` | Relationship created with `blocked_by` type                                           |
| resolved type     | `link_entries(from_entry_id: <A>, to_entry_id: <B>, relationship_type: "resolved")`   | Relationship created with `resolved` type                                             |
| caused type       | `link_entries(from_entry_id: <A>, to_entry_id: <B>, relationship_type: "caused")`     | Relationship created with `caused` type                                               |
| Causal viz arrows | `visualize_relationships(entry_id: <A>)`                                              | Mermaid shows `--x` (blocked_by), `==>` (resolved), `-.->` (caused) arrows            |
| Graph harmonized  | Read `memory://graph/recent`                                                          | Raw Mermaid `text/plain`: `--x`, `==>`, `-.->` for causal types, `-->` for references |

---

## Phase 5: GitHub Integration (16 tools)

### 5.1 Read-Only Tools

| Test                  | Command/Action                                 | Expected Result                                          |
| --------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| Context               | `get_github_context`                           | Returns repo, branch, issues, PRs                        |
| List issues           | `get_github_issues(limit: 5)`                  | Returns open issues                                      |
| Issue milestone data  | Inspect issue objects                          | Issues include `milestone` field (if assigned)           |
| Get issue             | `get_github_issue(issue_number: <N>)`          | Returns issue details                                    |
| List PRs              | `get_github_prs(limit: 5)`                     | Returns open PRs                                         |
| List closed issues    | `get_github_issues(state: "closed", limit: 3)` | Returns closed issues                                    |
| List all issues       | `get_github_issues(state: "all", limit: 3)`    | Returns both open and closed issues                      |
| List closed PRs       | `get_github_prs(state: "closed", limit: 3)`    | Returns closed/merged PRs                                |
| List all PRs          | `get_github_prs(state: "all", limit: 3)`       | Returns both open and closed PRs                         |
| Get PR                | `get_github_pr(pr_number: <N>)`                | Returns PR details (use known closed PR)                 |
| Get nonexistent issue | `get_github_issue(issue_number: 999999)`       | Structured error: `{ error: "Issue #999999 not found" }` |
| Get nonexistent PR    | `get_github_pr(pr_number: 999999)`             | Structured error: `{ error: "PR #999999 not found" }`    |

### 5.2 Issue Lifecycle Tools

> [!CAUTION]
> These tools **create and close real GitHub issues**. Use with awareness.

| Test                          | Command/Action                                                                                                                                                                                       | Expected Result                                                                                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create issue + entry          | `create_github_issue_with_entry(title: "Test: Unreleased Verification", project_number: 5)`                                                                                                          | GitHub issue created + journal entry created + added to project                                                                                                                                                                                               |
| Create with milestone         | `create_github_issue_with_entry(title: "Test: Milestone", milestone_number: <N>)`                                                                                                                    | Issue assigned to milestone, verify on GitHub                                                                                                                                                                                                                 |
| Close issue + entry           | `close_github_issue_with_entry(issue_number: <new_issue>, resolution_notes: "Verified working")`                                                                                                     | Issue closed + resolution entry created                                                                                                                                                                                                                       |
| Close with move_to_done       | `close_github_issue_with_entry(issue_number: <new_issue>, move_to_done: true, project_number: 5)`                                                                                                    | Issue closed + `kanban` block in response. `kanban.moved: true` expected — uses idempotent `addProjectItem` to resolve item ID directly (no board-scan race condition)                                                                                        |
| Create with full params       | `create_github_issue_with_entry(title: "Test: Full", body: "Description", labels: ["test"], project_number: 5, initial_status: "In Progress", entry_content: "Custom journal text", tags: ["test"])` | Issue created with body/labels, project item in "In Progress", journal entry uses custom content                                                                                                                                                              |
| Close with comment            | `close_github_issue_with_entry(issue_number: <new_issue>, resolution_notes: "Done", comment: "Closing comment", tags: ["resolved"])`                                                                 | Issue closed with comment posted, entry tagged                                                                                                                                                                                                                |
| Close already closed          | `close_github_issue_with_entry(issue_number: <known_closed>)`                                                                                                                                        | Structured error: `{ success: false, error: "Issue #X is already closed" }`                                                                                                                                                                                   |
| Close move_to_done no project | `close_github_issue_with_entry(issue_number: <open_issue>, move_to_done: true)`                                                                                                                      | When `DEFAULT_PROJECT_NUMBER` is configured: uses default project, issue closes (`success: true`), Kanban move attempted against default project. When NOT configured: `kanban: { moved: false, error: "project_number required when move_to_done is true" }` |

### 5.3 Kanban Tools

| Test                | Command/Action                                                                     | Expected Result                                                       |
| ------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Get board           | `get_kanban_board(project_number: 5)`                                              | Returns board structure with columns/items                            |
| Kanban resource     | Read `memory://kanban/5`                                                           | JSON board data                                                       |
| Kanban diagram      | Read `memory://kanban/5/diagram`                                                   | Raw Mermaid text (`text/plain` MIME), not JSON-wrapped                |
| Move item           | `move_kanban_item(project_number: 5, item_id: <id>, target_status: "In Progress")` | Item status updated                                                   |
| Move invalid status | `move_kanban_item(project_number: 5, item_id: <id>, target_status: "Nonexistent")` | Structured error with `availableStatuses` array listing valid options |
| Board nonexistent   | `get_kanban_board(project_number: 99999)`                                          | Structured error: `{ error: "Project #99999 not found..." }`          |

### 5.4 Milestone Tools

> [!CAUTION]
> These tools **create, modify, and delete real GitHub milestones**. Clean up test milestones after testing.

| Test                 | Command/Action                                                                                   | Expected Result                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| List milestones      | `get_github_milestones(state: "open")`                                                           | Returns milestones array with `completion_percentage`, `open_issues`                                              |
| List all states      | `get_github_milestones(state: "all")`                                                            | Returns both open and closed milestones                                                                           |
| Get milestone detail | `get_github_milestone(milestone_number: <N>)`                                                    | Returns single milestone with full metadata                                                                       |
| Create milestone     | `create_github_milestone(title: "Test Milestone", description: "Testing", due_on: "YYYY-MM-DD")` | Returns `success: true`, created milestone with number and URL (⚠️ `due_on` must be `YYYY-MM-DD`, not ISO 8601)   |
| Update milestone     | `update_github_milestone(milestone_number: <new>, description: "Updated description")`           | Returns `success: true`, updated milestone                                                                        |
| Close milestone      | `update_github_milestone(milestone_number: <new>, state: "closed")`                              | Milestone state changed to `closed`                                                                               |
| Delete milestone     | `delete_github_milestone(milestone_number: <new>, confirm: true)`                                | Returns `success: true`, milestone removed from GitHub                                                            |
| Get nonexistent      | `get_github_milestone(milestone_number: 999999)`                                                 | Structured error: `{ error: "Milestone #999999 not found" }`                                                      |
| Milestone resource   | Read `memory://github/milestones`                                                                | Static resource lists open milestones with completion %                                                           |
| Milestone detail     | Read `memory://milestones/<N>`                                                                   | Template resource shows milestone with completion %, openIssues + closedIssues counts, and hint for issue details |

### 5.5 Repository Insights Tool

| Test              | Command/Action                             | Expected Result                                    |
| ----------------- | ------------------------------------------ | -------------------------------------------------- |
| Default (stars)   | `get_repo_insights`                        | Returns `stars`, `forks`, `watchers`, `openIssues` |
| Traffic section   | `get_repo_insights(sections: "traffic")`   | Returns 14-day `clones` and `views` aggregates     |
| Referrers section | `get_repo_insights(sections: "referrers")` | Returns top 5 referral sources                     |
| Paths section     | `get_repo_insights(sections: "paths")`     | Returns top 5 popular content paths                |
| All sections      | `get_repo_insights(sections: "all")`       | Returns full payload with all sections above       |

### 5.6 Copilot Review Tool

| Test                  | Command/Action                                        | Expected Result                                                               |
| --------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| Reviewed PR           | `get_copilot_reviews(pr_number: <known_reviewed_pr>)` | Returns `state`, `commentCount`, `comments` array with `path`, `line`, `body` |
| Unreviewed PR         | `get_copilot_reviews(pr_number: <unreviewed_pr>)`     | Returns `state: "none"`, `commentCount: 0`, empty `comments`                  |
| Auto-detect repo      | `get_copilot_reviews(pr_number: 1)`                   | Uses auto-detected owner/repo from git                                        |
| No GitHub integration | (server without `GITHUB_TOKEN`)                       | Returns `{ success: false, error: "GitHub integration not available" }`       |

### 5.7 GitHub Test Cleanup

> [!IMPORTANT]
> After GitHub testing, ensure all test artifacts are removed. Use the checklist below.

| Cleanup Step           | Command/Action                                                    |
| ---------------------- | ----------------------------------------------------------------- |
| Close test issues      | `close_github_issue_with_entry` for any unclosed test issues      |
| Delete test milestones | `delete_github_milestone` for any test milestones still on GitHub |
| Verify project board   | `get_kanban_board(project_number: 5)` — no orphaned test items    |

---

## Phase 6: Template Resources

> [!CAUTION]
> Issue and PR template URIs require the `/entries` or `/timeline` suffix — they are **NOT** bare `memory://issues/{number}` or `memory://prs/{number}`. Using bare URIs will return "Resource not found". Always use the full paths shown in the table below (e.g. `memory://issues/55/entries`, `memory://prs/67/timeline`).

### 6.1 Happy Path

| Template         | Test URI                       | Expected Result                                                                                                                     |
| ---------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Project timeline | `memory://projects/5/timeline` | Timeline data                                                                                                                       |
| Issue entries    | `memory://issues/55/entries`   | Entries linked to issue #55                                                                                                         |
| PR entries       | `memory://prs/67/entries`      | Entries linked to PR #67 (permanent test fixture)                                                                                   |
| PR timeline      | `memory://prs/67/timeline`     | PR lifecycle with `prMetadata` (live state) and `timelineNote`                                                                      |
| Kanban JSON      | `memory://kanban/5`            | Board JSON                                                                                                                          |
| Kanban diagram   | `memory://kanban/5/diagram`    | Raw Mermaid text (`text/plain` MIME), not JSON-wrapped                                                                              |
| Milestone detail | `memory://milestones/<N>`      | Milestone with completion %, `openIssues` + `closedIssues` counts, and hint to use `get_github_issues` for individual issue details |

### 6.2 Template Error Paths

| Template                   | Test URI                           | Expected Result                                                 |
| -------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| Nonexistent project        | `memory://projects/99999/timeline` | Empty or graceful response (no entries for nonexistent project) |
| Nonexistent issue          | `memory://issues/999999/entries`   | Empty entries array (no crash)                                  |
| Nonexistent PR             | `memory://prs/999999/entries`      | Empty entries array (no crash)                                  |
| Nonexistent PR timeline    | `memory://prs/999999/timeline`     | Graceful response with empty/null `prMetadata`                  |
| Nonexistent Kanban         | `memory://kanban/99999`            | Error or empty board (no crash)                                 |
| Nonexistent Kanban diagram | `memory://kanban/99999/diagram`    | Error or empty diagram (no crash)                               |
| Nonexistent milestone      | `memory://milestones/999999`       | Error or empty milestone data (no crash)                        |

---

## Phase 7: Admin & Backup Tools

| Test | Command/Action | Expected Result |
| ---- | -------------- | --------------- |

### 7.1 Tags

| Test              | Command/Action                                                | Expected Result                                                             |
| ----------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| List tags         | `list_tags`                                                   | Returns all tags with counts                                                |
| Create source tag | `create_entry(content: "Test tag merge", tags: ["test-old"])` | Creates "test-old" tag (pre-req)                                            |
| Merge tags        | `merge_tags(source_tag: "test-old", target_tag: "test-new")`  | Merges source into target, deletes source                                   |
| Verify merge      | `list_tags` + `search_entries(query: "Test tag merge")`       | "test-old" gone, "test-new" exists, entry now has "test-new" tag            |
| Merge same tag    | `merge_tags(source_tag: "test-new", target_tag: "test-new")`  | Structured error: `{ success: false, error: "..." }` (source equals target) |
| Merge nonexistent | `merge_tags(source_tag: "nonexistent-xyz", target_tag: "x")`  | Structured error: `{ success: false, error: "Source tag not found: ..." }`  |

> [!NOTE]
> If `restore_backup` is tested after `merge_tags`, the restored backup will revert the merge. This is expected behavior. Verify merge worked immediately after calling `merge_tags`, before any backup restoration.

### 7.2 Export

| Test                    | Command/Action                                                                     | Expected Result                          |
| ----------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------- |
| Export JSON             | `export_entries(format: "json", limit: 5)`                                         | JSON export with `entries` array         |
| Export markdown         | `export_entries(format: "markdown", limit: 5)`                                     | Markdown export with `content` string    |
| Export with tags        | `export_entries(format: "json", tags: ["test"], limit: 10)`                        | Only entries with matching tags returned |
| Export with dates       | `export_entries(format: "json", start_date: "2026-01-01", end_date: "2026-03-01")` | Only entries within date range returned  |
| Export with entry_types | `export_entries(format: "json", entry_types: ["planning"], limit: 10)`             | Only entries of specified type returned  |

### 7.3 Backup & Restore

| Test                  | Command/Action                                              | Expected Result                                                                  |
| --------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Create backup         | `backup_journal(name: "test-backup")`                       | Backup file created with `success`, `filename`, `path`, `sizeBytes`              |
| Auto-named backup     | `backup_journal`                                            | Backup created with auto-generated timestamped name                              |
| List backups          | `list_backups`                                              | Shows backup files with metadata including `path` field                          |
| Cleanup backups       | `cleanup_backups(keep_count: 5)`                            | Deletes old backups, keeps N most recent                                         |
| Backup path traversal | `backup_journal(name: "../../etc/passwd")`                  | Structured error: `{ success: false, error: "..." }` with path traversal message |
| Restore backup        | `restore_backup(filename: "test-backup.db", confirm: true)` | Restores + `revertedChanges` field with details                                  |
| Restore nonexistent   | `restore_backup(filename: "nonexistent.db", confirm: true)` | Structured error: `{ success: false, error: "Backup file not found: ..." }`      |

---

## Phase 8: Prompt Handler Verification (16 prompts) [DO NOT SKIP!]

> [!NOTE]
> Prompts return `GetPromptResult` objects with `messages` arrays. While the _workflows_ prompts describe require a human to act on, the **handlers themselves** are testable via `prompts/get` MCP calls. This phase verifies response shape, argument enforcement, and content generation.
>
> **How to test:** Call `prompts/get` with the prompt name and arguments. The MCP client should expose this as a callable action, or use the protocol directly.

### 8.1 Workflow Prompts (10 prompts)

#### No-Argument Prompts

| Prompt               | Arguments | Expected Response                                                                                               |
| -------------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| `prepare-standup`    | _(none)_  | `messages` array with 1 `user` role message containing "standup" and date references                            |
| `weekly-digest`      | _(none)_  | `messages` array with 1 `user` role message containing "weekly digest"                                          |
| `goal-tracker`       | _(none)_  | `messages` array with 1 `user` role message containing "goals" and "milestones"                                 |
| `get-context-bundle` | _(none)_  | `messages` array with 1 `user` role message containing "Project context bundle", recent entries, and statistics |
| `confirm-briefing`   | _(none)_  | `messages` array with 1 `user` role message containing "Session Context Received" and entry count               |
| `session-summary`    | _(none)_  | `messages` array with 1 `user` role message containing "session summary" and instructions for entry creation    |

#### Required-Argument Prompts

| Prompt           | Arguments                                            | Expected Response                                                                                             |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `find-related`   | `query: "architecture"`                              | `messages` array with 1 `user` role message containing `"architecture"` and matching entries (from seed data) |
| `analyze-period` | `start_date: "2026-01-01"`, `end_date: "2026-12-31"` | `messages` array with 1 `user` role message containing date range and statistics JSON                         |

#### Optional-Argument Prompts

| Prompt               | Arguments                      | Expected Response                                                                                         |
| -------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `prepare-retro`      | _(none — defaults to 14 days)_ | `messages` array with 1 `user` role message containing "retrospective" and "14 days"                      |
| `prepare-retro`      | `days: "7"`                    | `messages` array with 1 `user` role message containing "7 days"                                           |
| `get-recent-entries` | _(none — defaults to 10)_      | `messages` array with 1 `user` role message containing entries formatted with timestamps, types, and tags |
| `get-recent-entries` | `limit: "3"`                   | `messages` array with 1 `user` role message containing at most 3 entries                                  |

### 8.2 GitHub Prompts (6 prompts)

#### Required-Argument Prompts

| Prompt                      | Arguments             | Expected Response                                                                                                |
| --------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `project-status-summary`    | `project_number: "5"` | `messages` array with 1 `user` role message containing `"Project #5"` and status summary instructions            |
| `pr-summary`                | `pr_number: "67"`     | `messages` array with 1 `user` role message containing `"PR #67"` and journal entries for that PR (from seed S8) |
| `code-review-prep`          | `pr_number: "67"`     | `messages` array with 1 `user` role message containing `"PR #67"` and review checklist instructions              |
| `pr-retrospective`          | `pr_number: "67"`     | `messages` array with 1 `user` role message containing `"PR #67"` and retrospective instructions                 |
| `project-milestone-tracker` | `project_number: "5"` | `messages` array with 1 `user` role message containing `"Project #5"` and milestone entries (from seed S7)       |

#### No-Argument Prompts

| Prompt                   | Arguments | Expected Response                                                                                           |
| ------------------------ | --------- | ----------------------------------------------------------------------------------------------------------- |
| `actions-failure-digest` | _(none)_  | `messages` array with 1 `user` role message containing "CI/CD failures" and workflow entries (from seed S9) |

### 8.3 Error Handling

| Test                  | Action                                                | Expected Result                                                                         |
| --------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Missing required arg  | `prompts/get` for `find-related` with no `query`      | Structured error or empty query handled gracefully (handler uses `args['query'] ?? ''`) |
| Missing required arg  | `prompts/get` for `analyze-period` with no dates      | Structured error or empty dates handled gracefully                                      |
| Nonexistent prompt    | `prompts/get` for `nonexistent-prompt`                | MCP error: prompt not found                                                             |
| Invalid argument name | `prompts/get` for `prepare-standup` with `foo: "bar"` | Succeeds (no-argument prompt ignores extra args)                                        |

### 8.4 Response Shape Verification

For **every** prompt response, verify:

| Check                  | Expected                                                               |
| ---------------------- | ---------------------------------------------------------------------- |
| `messages` is an array | `Array.isArray(result.messages) === true`                              |
| At least 1 message     | `messages.length >= 1`                                                 |
| Message has `role`     | `messages[0].role === 'user'`                                          |
| Message has `content`  | `messages[0].content` is object with `type: 'text'` and `text: string` |
| Text is non-empty      | `messages[0].content.text.length > 0`                                  |

## Phase 9: Team Collaboration (20 tools + 2 resources)

> [!NOTE]
> Requires `TEAM_DB_PATH` to be configured in `mcp_config.json`. Team entries are stored in a separate public database with author attribution.
>
> **`team_delete_entry` is soft-delete only** — no `permanent` flag (unlike individual `delete_entry`).

### 9.1 Team Entry Creation

| Test               | Command/Action                                                      | Expected Result                                             |
| ------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| Basic create       | `team_create_entry(content: "Team test entry")`                     | `success: true`, `entry` with `author` field auto-populated |
| Explicit author    | `team_create_entry(content: "...", author: "TestBot")`              | `author: "TestBot"` in response                             |
| With tags          | `team_create_entry(content: "...", tags: ["team-test"])`            | Entry created with tags                                     |
| With issue linking | `team_create_entry(content: "...", issue_number: <N>)`              | `issueUrl` auto-populated from cached repo info             |
| With entry type    | `team_create_entry(content: "...", entry_type: "project_decision")` | Entry type set correctly                                    |
| Invalid entry_type | `team_create_entry(content: "...", entry_type: "invalid")`          | Structured error: `{ success: false, error: "..." }`        |

### 9.2 Team Read Tools

| Test            | Command/Action                                    | Expected Result                                  |
| --------------- | ------------------------------------------------- | ------------------------------------------------ |
| Get recent      | `team_get_recent(limit: 5)`                       | `entries` array (each with `author`), `count`    |
| Default limit   | `team_get_recent`                                 | Returns up to 10 entries (default)               |
| Search by text  | `team_search(query: "team test")`                 | Matching entries with `author` field             |
| Search by tags  | `team_search(tags: ["team-test"])`                | Tag-filtered results                             |
| Combined search | `team_search(query: "test", tags: ["team-test"])` | Text + tag filtered results                      |
| No query/tags   | `team_search`                                     | Returns recent entries (fallback to `getRecent`) |

### 9.3 Team Entry Detail

| Test                  | Command/Action                                                          | Expected Result                                                          |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Get by ID             | `team_get_entry_by_id(entry_id: <team_entry_id>)`                      | `success: true`, `entry` with `author`, optional `relationships`         |
| With importance       | Inspect response                                                        | `importance` object with `score` (0.0-1.0) and `breakdown`              |
| No relationships      | `team_get_entry_by_id(entry_id: <id>, include_relationships: false)`    | Response omits `relationships` array                                     |
| Nonexistent ID        | `team_get_entry_by_id(entry_id: 999999)`                                | Structured error: `{ success: false, error: "..." }`                    |

### 9.4 Team Tags

| Test       | Command/Action   | Expected Result                                |
| ---------- | ---------------- | ---------------------------------------------- |
| List tags  | `team_list_tags` | `tags` array with `{ name, count }` per tag    |
| Tag counts | Inspect response | Counts match entries created with those tags    |

### 9.5 Team Date Range Search

| Test               | Command/Action                                                                              | Expected Result                                                           |
| ------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Basic date range   | `team_search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31")`              | Returns `entries` array with `author` field, `count`                      |
| With entry_type    | `team_search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", entry_type: "standup")` | Only `standup` entries returned                                  |
| With tags filter   | `team_search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", tags: ["standup"])` | Only entries with `standup` tag                                      |
| Invalid date       | `team_search_by_date_range(start_date: "Jan 1", end_date: "Jan 31")`                       | Structured error with YYYY-MM-DD hint                                     |

### 9.6 Team Admin

| Test                      | Command/Action                                                            | Expected Result                                                             |
| ------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Update content            | `team_update_entry(entry_id: <id>, content: "Updated team content")`      | `success: true`, `entry` with updated content                               |
| Update tags               | `team_update_entry(entry_id: <id>, tags: ["updated-team"])`               | Tags changed on team entry                                                  |
| Update entry_type         | `team_update_entry(entry_id: <id>, entry_type: "technical_note")`         | Entry type changed                                                          |
| Update nonexistent        | `team_update_entry(entry_id: 999999, content: "x")`                       | Structured error: `{ success: false, error: "..." }`                        |
| Soft delete               | `team_delete_entry(entry_id: <id>)`                                       | `success: true`, `message` confirming deletion                              |
| Delete nonexistent        | `team_delete_entry(entry_id: 999999)`                                     | Structured error: `{ success: false, error: "..." }`                        |
| Merge tags                | `team_merge_tags(source_tag: "team-old", target_tag: "team-new")`         | `success: true`, `entriesUpdated`, `sourceDeleted`                          |
| Merge same tag            | `team_merge_tags(source_tag: "team-new", target_tag: "team-new")`         | Structured error: `{ success: false, error: "..." }`                        |
| Merge nonexistent source  | `team_merge_tags(source_tag: "nonexistent-xyz", target_tag: "x")`         | Structured error: `{ success: false, error: "..." }`                        |

### 9.7 Team Analytics

| Test             | Command/Action                           | Expected Result                                                      |
| ---------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| Default stats    | `team_get_statistics`                    | `totalEntries`, `entryTypes`, `topTags`, `authors` array             |
| Group by month   | `team_get_statistics(group_by: "month")` | `periodEntries`, periods grouped by month                            |
| Group by day     | `team_get_statistics(group_by: "day")`   | Periods grouped by day                                               |
| Author breakdown | Inspect `authors` field                  | Array of `{ author, count }` for each contributor                    |

### 9.8 Team Vector Search

| Test                    | Command/Action                                                            | Expected Result                                                         |
| ----------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Rebuild team index      | `team_rebuild_vector_index`                                               | `success: true`, `entriesIndexed` > 0                                   |
| Team vector stats       | `team_get_vector_index_stats`                                             | `available`, `itemCount`, `modelName`, `dimensions`                     |
| Team semantic query     | `team_semantic_search(query: "team standup")`                             | ≥ 1 result with `similarity` score                                      |
| Team semantic threshold | `team_semantic_search(query: "test", similarity_threshold: 0.5)`         | Fewer results than default threshold (0.25)                             |
| Team personal filter    | `team_semantic_search(query: "test", is_personal: true)`                 | Only personal entries in results                                        |
| Team add to index       | `team_add_to_vector_index(entry_id: <team_entry_id>)`                    | `success: true`, `entryId` in response                                  |
| Team add nonexistent    | `team_add_to_vector_index(entry_id: 999999)`                             | `{ success: false, error: "..." }`                                      |

### 9.9 Team Cross-Project Insights

| Test                    | Command/Action                                                                                     | Expected Result                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Default insights        | `team_get_cross_project_insights`                                                                  | `project_count`, `total_entries`, `projects` array |
| Insights with dates     | `team_get_cross_project_insights(start_date: "2026-01-01", end_date: "2026-03-01")`               | Date-filtered project insights                     |
| Insights min_entries    | `team_get_cross_project_insights(min_entries: 1)`                                                  | Lower threshold includes more projects             |

### 9.10 Team Relationships

| Test                    | Command/Action                                                                                           | Expected Result                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Link entries            | `team_link_entries(from_entry_id: <A>, to_entry_id: <B>, relationship_type: "references")`               | `success: true`, `relationship` object                          |
| Link with description   | `team_link_entries(from_entry_id: <A>, to_entry_id: <B>, relationship_type: "implements", description: "...")` | Relationship created with `description`                    |
| Duplicate link          | Call `team_link_entries` again with same params                                                           | `alreadyExists: true`, `message`                                |
| Link nonexistent        | `team_link_entries(from_entry_id: 999999, to_entry_id: <B>, ...)`                                        | Structured error: `{ success: false, error: "..." }`            |
| Visualize by entry      | `team_visualize_relationships(entry_id: <A>)`                                                            | `mermaid` string, `nodeCount`, `edgeCount`                      |
| Visualize by tag        | `team_visualize_relationships(tag: "team-test")`                                                         | Mermaid diagram scoped to tag                                   |
| Visualize nonexistent   | `team_visualize_relationships(entry_id: 999999)`                                                         | Structured error or empty diagram                               |

### 9.11 Team Export

| Test                    | Command/Action                                                                          | Expected Result                                |
| ----------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Export JSON             | `team_export_entries(format: "json", limit: 5)`                                         | `format: "json"`, `data` string, `count`       |
| Export markdown         | `team_export_entries(format: "markdown", limit: 5)`                                     | `format: "markdown"`, `data` string            |
| Export with tags        | `team_export_entries(format: "json", tags: ["team-test"], limit: 10)`                   | Only entries with matching tags                 |
| Export with dates       | `team_export_entries(format: "json", start_date: "2026-01-01", end_date: "2026-03-01")` | Only entries within date range                  |
| Export with entry_type  | `team_export_entries(format: "json", entry_type: "standup", limit: 10)`                 | Only entries of specified type                  |

### 9.12 Team Backup

| Test              | Command/Action                              | Expected Result                                                |
| ----------------- | ------------------------------------------- | -------------------------------------------------------------- |
| Named backup      | `team_backup(name: "team-test-backup")`     | `success: true`, `filename`, `path`, `sizeBytes`              |
| Auto-named backup | `team_backup`                               | Backup created with auto-generated timestamped name            |
| List backups      | `team_list_backups`                         | `backups` array with metadata, `total`, `backupsDirectory`     |

### 9.13 Team Resources

| Test             | URI                        | Expected Result                                                       |
| ---------------- | -------------------------- | --------------------------------------------------------------------- |
| Recent entries   | `memory://team/recent`     | JSON with `entries` (author-enriched), `count`, `source: "team"`      |
| Statistics       | `memory://team/statistics` | `configured: true`, `totalEntries`, `authors` array, `source: "team"` |
| Author breakdown | `memory://team/statistics` | `authors` contains `{ author: "<name>", count: N }` for each author   |

### 9.14 Cleanup

| Test        | Command/Action                                     | Expected Result                 |
| ----------- | -------------------------------------------------- | ------------------------------- |
| Delete test | `delete_entry(entry_id: <team_test_id>)` on teamDb | Test entries removed (optional) |

---

## Phase 10: Automated Scheduler — Run via Script [DO NOT SKIP!]

> [!IMPORTANT]
> The scheduler only activates in HTTP/SSE transport mode. Run the script below — it handles session init, health reads, and wait/verify automatically. See `test-server/README.md` for full details.

```powershell
# Terminal 1: Start HTTP server with short scheduler intervals
npm run build
node dist/cli.js --transport http --port 3099 --backup-interval 1 --keep-backups 3 --vacuum-interval 2 --rebuild-index-interval 2

# Terminal 2: Run scheduler test (waits 130s for jobs to fire)
node test-server/test-scheduler.mjs
```

| Check                       | Expected               |
| --------------------------- | ---------------------- |
| `scheduler.active`          | `true`, 3 jobs         |
| All jobs `lastResult`       | `"success"` after wait |
| All jobs `lastError`        | `null`                 |
| backup `runCount`           | ≥ 2                    |
| vacuum + rebuild `runCount` | ≥ 1 each               |

---

## Test Execution Order

0. **Phase 0**: Seed Test Data (creates entries for FTS5, filter, and semantic search tests)
1. **Phase 1**: Infrastructure (must pass before proceeding)
2. **Phase 2**: Entry CRUD (creates additional test data + validates CRUD operations)
3. **Phase 3**: Search + Analytics (requires entries from Phase 0 + 2)
4. **Phase 4**: Relationships (links entries from Phase 0 + 2)
5. **Phase 5**: GitHub Integration (tests live GitHub API including milestones + cleanup)
6. **Phase 6**: Template Resources (happy path + error paths for invalid IDs)
7. **Phase 7**: Admin/Backup (test last to avoid data loss)
8. **Phase 8**: Prompt Handler Verification (verify `prompts/get` response shape for all 16 prompts)
9. **Phase 9**: Team Collaboration (requires `TEAM_DB_PATH` configured)
10. **Phase 10**: Automated Scheduler (HTTP only — manual terminal test)

---

## Success Criteria

### Core Functionality

- [ ] All 61 tools execute without errors on happy paths
- [ ] All 7 template resources work with valid parameters
- [ ] All 7 template resources handle invalid/nonexistent IDs gracefully (no crashes)
- [ ] Server instructions length respects `--instruction-level`: essential (~1.2K tokens) < standard (~1.4K) < full (~6.7K)
- [ ] 33 core/local tools have `openWorldHint: false`; 16 GitHub tools have `openWorldHint: true` (49 total, 0 missing)

### Entry CRUD

- [ ] `create_entry` persists all optional fields: PR fields, workflow fields, `projectOwner`, `autoContext`
- [ ] `create_entry` with `share_with_team: true` creates entries in both personal and team DBs
- [ ] `create_entry` rejects invalid `entry_type` and `significance_type` with structured errors (not raw throws)
- [ ] `create_entry` with `issue_number` auto-populates `issueUrl` from cached repo info
- [ ] `get_entry_by_id` returns `importance` score (0.0-1.0) and `importanceBreakdown`
- [ ] `get_entry_by_id(include_relationships: false)` omits relationship data
- [ ] `get_recent_entries` with `is_personal` filter returns only matching entries
- [ ] `update_entry` updates `content`, `entry_type`, `tags`, and `is_personal` independently
- [ ] `update_entry` returns `success: false` for nonexistent entry IDs
- [ ] `delete_entry` returns `success: false` for nonexistent entry IDs
- [ ] Soft-deleted entries are hidden from `search_entries`, `get_recent_entries`, and `semantic_search`

### Search & Analytics

- [ ] `search_entries` FTS5 phrase queries return exact phrase matches
- [ ] `search_entries` FTS5 prefix queries (`auth*`) match word stems
- [ ] `search_entries` FTS5 boolean operators (`NOT`, `OR`) filter correctly
- [ ] `search_entries` gracefully falls back to LIKE for FTS5-unsafe queries (single quotes, `%`)
- [ ] `search_entries` filters work: `issue_number`, `pr_status`, `workflow_run_id`, `project_number`, `is_personal`
- [ ] `search_by_date_range` filters work: `entry_type`, `tags`, `is_personal`, `project_number`
- [ ] `search_by_date_range` rejects non-YYYY-MM-DD date strings with structured errors
- [ ] `search_entries` merges team results with `source: 'personal' | 'team'` marker
- [ ] `search_by_date_range` merges team results with `source` marker
- [ ] `semantic_search` with custom `similarity_threshold` affects result count
- [ ] `semantic_search` with `is_personal` filter returns only matching entries
- [ ] `semantic_search` with `hint_on_empty: false` still shows quality gate `hint` for noisy results (only suppresses advisory hints)
- [ ] `get_statistics` returns all 4 enhanced analytics metrics
- [ ] `get_statistics` with `group_by: "month"` and `"day"` produces correct groupings
- [ ] `get_cross_project_insights` returns all required schema fields even when empty
- [ ] `add_to_vector_index` succeeds for existing entries, errors for nonexistent

### Relationships

- [ ] Causal relationship types (`blocked_by`, `resolved`, `caused`) create correctly
- [ ] `link_entries` with `description` persists the description
- [ ] `link_entries` returns `success: false` with `"One or both entries not found (from: X, to: Y)"` for nonexistent entry IDs
- [ ] `visualize_relationships` shows distinct arrows for causal types
- [ ] `visualize_relationships` with `tags` filter scopes diagram correctly
- [ ] `visualize_relationships` with `depth: 1` and `depth: 3` produce different results
- [ ] `visualize_relationships` returns `"Entry X not found"` for nonexistent `entry_id`
- [ ] `memory://graph/recent` uses harmonized arrows matching `visualize_relationships`
- [ ] Reverse-direction duplicate behavior is documented (B→A when A→B exists)

### Prompt Handlers (Phase 8)

- [ ] All 16 prompts return valid `GetPromptResult` with `messages` array
- [ ] Every message has `role: 'user'` and `content` with `type: 'text'` and non-empty `text`
- [ ] Required-argument prompts (`find-related`, `analyze-period`, `project-status-summary`, `pr-summary`, `code-review-prep`, `pr-retrospective`, `project-milestone-tracker`) include argument values in response text
- [ ] Optional-argument prompts (`prepare-retro`, `get-recent-entries`) apply defaults when arguments omitted
- [ ] GitHub prompts reference seed data (S7 for project #5, S8 for PR #67, S9 for workflow entries)
- [ ] Nonexistent prompt name returns MCP error (not crash)

### GitHub Integration

- [ ] GitHub issue lifecycle tools create/close issues correctly
- [ ] `create_github_issue_with_entry` with `body`, `labels`, `initial_status`, `entry_content` works
- [ ] `create_github_issue_with_entry` with `milestone_number` assigns issue to milestone
- [ ] `close_github_issue_with_entry` with `comment` posts the comment on the issue
- [ ] `close_github_issue_with_entry` returns structured error for already-closed issues
- [ ] `close_github_issue_with_entry` with `move_to_done: true` but no `project_number`: when `DEFAULT_PROJECT_NUMBER` is set, uses that default (no error); when NOT set, returns `kanban: { moved: false, error: "project_number required..." }` (soft error, not blocking)
- [ ] `get_github_issues` and `get_github_prs` with `state: "closed"` and `state: "all"` work
- [ ] `get_github_issue` / `get_github_pr` / `get_github_milestone` return structured errors for nonexistent IDs
- [ ] `move_kanban_item` with invalid `target_status` returns structured error without breaking outputSchema
- [ ] Milestone CRUD lifecycle works end-to-end (create → update → close → delete)
- [ ] `memory://github/milestones` returns milestones with `completion_percentage`
- [ ] `memory://milestones/{number}` returns milestone with completion %, issue counts (`openIssues`, `closedIssues`), and a hint to use `get_github_issues` for individual issue details
- [ ] `get_repo_insights` returns correct data based on `sections` parameter
- [ ] `memory://github/insights` returns compact stats including traffic aggregates
- [ ] All GitHub test artifacts cleaned up after testing
- [ ] `memory://briefing` includes `userMessage` with milestone progress row and `templateResources`
- [ ] `memory://briefing` includes `rulesFile` metadata when `RULES_FILE_PATH` is set
- [ ] `memory://briefing` includes `skillsDir` metadata when `SKILLS_DIR_PATH` is set
- [ ] `memory://briefing` includes `workflowSummary` with counts when `BRIEFING_WORKFLOW_STATUS=true`
- [ ] `memory://briefing` CI row shows named runs or breakdown when workflow env vars are configured
- [ ] `get_copilot_reviews` returns review data with `state`, `commentCount`, `comments` for reviewed PRs
- [ ] `get_copilot_reviews` returns `state: "none"` for unreviewed PRs
- [ ] `memory://briefing` includes `copilotReviews` summary when `BRIEFING_COPILOT_REVIEWS=true`
- [ ] `memory://github/status` includes milestone summary data

### Admin & Backup

- [ ] `cleanup_backups` removes old backups and keeps N most recent
- [ ] `merge_tags` consolidates duplicate tags correctly — verified via `list_tags` and entry re-check
- [ ] `merge_tags` returns structured error when source equals target
- [ ] `merge_tags` returns structured error for nonexistent source tag
- [ ] `backup_journal` without `name` generates auto-timestamped backup
- [ ] `backup_journal` rejects names containing path traversal characters (`../`) with structured errors
- [ ] `restore_backup` with nonexistent filename returns structured error

### Team Collaboration

- [ ] `team_create_entry` creates entry with auto-detected `author` field
- [ ] `team_create_entry` accepts explicit `author` override
- [ ] `team_get_recent` returns entries with `author` field on each entry
- [ ] `team_search` filters by text, tags, or both
- [ ] `team_get_entry_by_id` returns entry with `author`, `importance`, and optional `relationships`
- [ ] `team_get_entry_by_id` with `include_relationships: false` omits relationship data
- [ ] `team_get_entry_by_id` returns structured error for nonexistent ID
- [ ] `team_list_tags` returns tags with counts
- [ ] `team_search_by_date_range` returns entries within date range with `author` field
- [ ] `team_search_by_date_range` filters by `entry_type` and `tags`
- [ ] `team_search_by_date_range` rejects invalid date format with structured error
- [ ] `team_update_entry` updates content, tags, and entry_type independently
- [ ] `team_update_entry` returns structured error for nonexistent ID
- [ ] `team_delete_entry` soft-deletes team entry (no `permanent` flag)
- [ ] `team_delete_entry` returns structured error for nonexistent ID
- [ ] `team_merge_tags` consolidates tags — source removed, entries re-tagged
- [ ] `team_merge_tags` returns structured errors for same-tag and nonexistent source
- [ ] `team_get_statistics` returns `totalEntries`, `entryTypes`, `topTags`, `authors`
- [ ] `team_get_statistics` respects `group_by` parameter
- [ ] `team_link_entries` creates relationships, detects duplicates, errors on nonexistent IDs
- [ ] `team_visualize_relationships` returns Mermaid diagram with `nodeCount`, `edgeCount`
- [ ] `team_export_entries` exports JSON and markdown with optional filters
- [ ] `team_backup` creates named and auto-named backups with `filename`, `path`, `sizeBytes`
- [ ] `team_list_backups` returns backup metadata array
- [ ] `team_rebuild_vector_index` indexes team entries successfully
- [ ] `team_get_vector_index_stats` returns `available`, `itemCount`, `modelName`, `dimensions`
- [ ] `team_semantic_search` returns semantically similar entries with `similarity` scores
- [ ] `team_add_to_vector_index` succeeds for existing entries, errors for nonexistent
- [ ] `team_get_cross_project_insights` returns `project_count`, `total_entries`, `projects` array
- [ ] All 20 team tools return structured errors when `TEAM_DB_PATH` not configured
- [ ] `memory://team/recent` returns author-enriched entries with `source: "team"`
- [ ] `memory://team/statistics` returns `configured: true`, `authors` array with `{ author, count }`
- [ ] `memory://briefing` includes team entry count ("Team DB" row)
- [ ] `memory://health` includes `teamDatabase` status block with `configured`, `entryCount`, `path`

### Scheduler (Phase 10)

- [ ] `memory://health` shows `scheduler.active: false` and empty `jobs` array in stdio mode
- [ ] No TypeScript/runtime errors in server logs
- [ ] Server logs confirm scheduler started with correct intervals (Phase 10)
- [ ] `memory://health` shows all 3 jobs active with `nextRun` timestamps (Phase 10)
- [ ] Backup job creates timestamped `.db` files and prunes to `--keep-backups` limit (Phase 10)
- [ ] Vacuum job logs `PRAGMA optimize` completion (Phase 10)
- [ ] Rebuild-index job logs vector index rebuild with entry count (Phase 10)
- [ ] All `lastResult` values are `"success"` after jobs fire (Phase 10)
- [ ] `lastError` remains `null` for all jobs (Phase 10)
- [ ] Error in one job does not prevent others from running (Phase 10)
