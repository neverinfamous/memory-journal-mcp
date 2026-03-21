# Test memory-journal-mcp — Core & Mutations

Exhaustively test the memory-journal-mcp server's core functionality using the phased plan below. **Please make sure to use the correct resource names/urls as documented below.**

**Scope:** 25 core tools (entry CRUD, search, analytics, relationships, admin, backup), seed data — this file covers happy paths, core error paths, and feature verification (Phases 0-6). GitHub tools (16 tools), all 27 resources, and prompt handlers are tested in `test-tools2.md`. Team tools (20 tools) are tested in `test-tools-team.md`.

**Constraints:**

- Confirm MCP server instructions were auto-received before starting.
- Use the MCP server directly for all tests — not the terminal or scripts.
- Use https://github.com/users/neverinfamous/projects/5 for project/Kanban testing.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvements, including changes to `server-instructions.md`/`server-instructions.ts` or this file (`test-server/test-tools.md`).
2. If the plan requires no user decisions, proceed with implementation immediately. Use `code-map.md` as a source of truth and ensure fixes comply with `C:\Users\chris\Desktop\adamic\skills\mcp-builder`.
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

# Test B — Tool annotations (61 tools, 45 openWorldHint=false, 16 openWorldHint=true, 0 missing)
node test-server/test-tool-annotations.mjs
```

| Check              | Expected                                                             |
| ------------------ | -------------------------------------------------------------------- |
| Instruction levels | essential (~1.2K) < standard (~1.4K) < full (~6.7K tokens)           |
| Tool annotations   | 61 tools, all with `annotations`, 45 `false` + 16 `true` = 0 missing |

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

## Phase 5: Admin & Backup Tools


### 5.1 Tags

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

### 5.2 Export

| Test                    | Command/Action                                                                     | Expected Result                          |
| ----------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------- |
| Export JSON             | `export_entries(format: "json", limit: 5)`                                         | JSON export with `entries` array         |
| Export markdown         | `export_entries(format: "markdown", limit: 5)`                                     | Markdown export with `content` string    |
| Export with tags        | `export_entries(format: "json", tags: ["test"], limit: 10)`                        | Only entries with matching tags returned |
| Export with dates       | `export_entries(format: "json", start_date: "2026-01-01", end_date: "2026-03-01")` | Only entries within date range returned  |
| Export with entry_types | `export_entries(format: "json", entry_types: ["planning"], limit: 10)`             | Only entries of specified type returned  |

### 5.3 Backup & Restore

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

## Phase 6: Automated Scheduler — Run via Script [DO NOT SKIP!]

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
5. **Phase 5**: Admin/Backup (test last to avoid data loss)
6. **Phase 6**: Automated Scheduler (HTTP only — manual terminal test)

---

## Success Criteria

### Core Functionality

- [ ] All 25 core tools execute without errors on happy paths (GitHub tools tested in `test-tools2.md`, team tools in `test-tools-team.md`)
- [ ] Server instructions length respects `--instruction-level`: essential (~1.2K tokens) < standard (~1.4K) < full (~6.7K)
- [ ] 45 core/local tools have `openWorldHint: false`; 16 GitHub tools have `openWorldHint: true` (61 total, 0 missing)

### Entry CRUD

- [ ] `create_entry` persists all optional fields: PR fields, workflow fields, `projectOwner`, `autoContext`
- [ ] `create_entry` with `share_with_team: true` creates entries in both personal and team DBs
- [ ] `create_entry` rejects invalid `entry_type` and `significance_type` with structured errors (not raw throws)
- [ ] `create_entry` with `issue_number` auto-populates `issueUrl` from cached repo info
- [ ] `get_entry_by_id` returns `importance` score (0.0-1.0) and `importanceBreakdown`
- [ ] `get_recent_entries` with `is_personal` filter returns only matching entries
- [ ] `update_entry` returns `success: false` for nonexistent entry IDs
- [ ] `delete_entry` returns `success: false` for nonexistent entry IDs

### Search & Analytics

- [ ] `search_entries` FTS5 phrase, prefix, and boolean operators work correctly
- [ ] `search_entries` gracefully falls back to LIKE for FTS5-unsafe queries (single quotes, `%`)
- [ ] `search_entries` filters work: `issue_number`, `pr_status`, `workflow_run_id`, `project_number`, `is_personal`
- [ ] `search_by_date_range` filters work: `entry_type`, `tags`, `is_personal`, `project_number`
- [ ] `search_by_date_range` rejects non-YYYY-MM-DD date strings with structured errors
- [ ] Cross-DB merging includes `source: 'personal' | 'team'` marker
- [ ] `semantic_search` with custom `similarity_threshold` affects result count
- [ ] `get_statistics` returns all 4 enhanced analytics metrics with correct groupings
- [ ] `get_cross_project_insights` returns all required schema fields even when empty

### Relationships

- [ ] Causal relationship types (`blocked_by`, `resolved`, `caused`) create correctly
- [ ] `link_entries` returns `success: false` for nonexistent entry IDs
- [ ] `visualize_relationships` shows distinct arrows for causal types
- [ ] `memory://graph/recent` uses harmonized arrows matching `visualize_relationships`

### Admin & Backup

- [ ] `merge_tags` consolidates duplicate tags correctly — verified via `list_tags` and entry re-check
- [ ] `merge_tags` returns structured error when source equals target or source tag nonexistent
- [ ] `backup_journal` rejects names containing path traversal characters (`../`) with structured errors
- [ ] `restore_backup` with nonexistent filename returns structured error

### Scheduler (Phase 6)

- [ ] `memory://health` shows `scheduler.active: false` and empty `jobs` array in stdio mode
- [ ] All 3 jobs active with `nextRun` timestamps in HTTP mode
- [ ] All `lastResult` values are `"success"` after jobs fire
- [ ] Error in one job does not prevent others from running
