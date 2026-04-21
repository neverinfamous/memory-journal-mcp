# Re-Test memory-journal-mcp — Team Collaboration

**Scope:** 25 team tools + 4 team resources — happy paths, core error paths, and feature verification for all team collaboration features including Hush Protocol flags.

**Execution Strategy:** **Use direct MCP tools, NOT Code Mode or scripts!** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.

**Prerequisites:** Seed data from `test-seed.md` must be present (S11, S12 for cross-DB; S15–S17 for team cross-project insights). `TEAM_DB_PATH` configured. MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. Then, stop so the **USER** can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. Re-test fixes with direct MCP calls.
5. Brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 10: Team Collaboration (25 tools + 4 resources)

> [!NOTE]
> Requires `TEAM_DB_PATH` to be configured in `mcp_config.json`. Team entries are stored in a separate public database with author attribution.
>
> **`team_delete_entry` is soft-delete only** — no `permanent` flag (unlike individual `delete_entry`).

### 10.1 Team Entry Creation

| Test               | Command/Action                                                      | Expected Result                                             |
| ------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| Basic create       | `team_create_entry(content: "Team test entry")`                     | `success: true`, `entry` with `author` field auto-populated |
| Explicit author    | `team_create_entry(content: "...", author: "TestBot")`              | `author: "TestBot"` in response                             |
| With tags          | `team_create_entry(content: "...", tags: ["team-test"])`            | Entry created with tags                                     |
| With issue linking | `team_create_entry(content: "...", issue_number: <N>)`              | `issueUrl` auto-populated from cached repo info             |
| With entry type    | `team_create_entry(content: "...", entry_type: "project_decision")` | Entry type set correctly                                    |
| Invalid entry_type | `team_create_entry(content: "...", entry_type: "invalid")`          | Structured error: `{ success: false, error: "..." }`        |

### 10.2 Team Read Tools

| Test            | Command/Action                                     | Expected Result                                  |
| --------------- | -------------------------------------------------- | ------------------------------------------------ |
| Get recent      | `team_get_recent(limit: 5)`                        | `entries` array (each with `author`), `count`    |
| Default limit   | `team_get_recent`                                  | Returns up to 10 entries (default)               |
| Search by text  | `team_search(query: "team test", mode: "fts")`     | Matching entries with `author` field             |
| Search by tags  | `team_search(tags: ["team-test"])`                 | Tag-filtered results                             |
| Combined search | `team_search(query: "test", tags: ["team-test"])`  | Text + tag filtered results                      |
| Hybrid search   | `team_search(query: "how did we fix performance")` | Auto-mode routes to semantic+FTS5 RRF            |
| No query/tags   | `team_search`                                      | Returns recent entries (fallback to `getRecent`) |

### 10.3 Team Entry Detail

| Test             | Command/Action                                                       | Expected Result                                                  |
| ---------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Get by ID        | `team_get_entry_by_id(entry_id: <team_entry_id>)`                    | `success: true`, `entry` with `author`, optional `relationships` |
| With importance  | Inspect response                                                     | `importance` object with `score` (0.0-1.0) and `breakdown`       |
| No relationships | `team_get_entry_by_id(entry_id: <id>, include_relationships: false)` | Response omits `relationships` array                             |
| Nonexistent ID   | `team_get_entry_by_id(entry_id: 999999)`                             | Structured error: `{ success: false, error: "..." }`             |

### 10.4 Team Tags

| Test       | Command/Action   | Expected Result                              |
| ---------- | ---------------- | -------------------------------------------- |
| List tags  | `team_list_tags` | `tags` array with `{ name, count }` per tag  |
| Tag counts | Inspect response | Counts match entries created with those tags |

### 10.5 Team Date Range Search

| Test             | Command/Action                                                                                       | Expected Result                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Basic date range | `team_search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31")`                        | Returns `entries` array with `author` field, `count` |
| With entry_type  | `team_search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", entry_type: "standup")` | Only `standup` entries returned                      |
| With tags filter | `team_search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", tags: ["standup"])`     | Only entries with `standup` tag                      |
| Invalid date     | `team_search_by_date_range(start_date: "Jan 1", end_date: "Jan 31")`                                 | Structured error with YYYY-MM-DD hint                |

### 10.6 Team Admin

| Test                     | Command/Action                                                       | Expected Result                                      |
| ------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------- |
| Update content           | `team_update_entry(entry_id: <id>, content: "Updated team content")` | `success: true`, `entry` with updated content        |
| Update tags              | `team_update_entry(entry_id: <id>, tags: ["updated-team"])`          | Tags changed on team entry                           |
| Update entry_type        | `team_update_entry(entry_id: <id>, entry_type: "technical_note")`    | Entry type changed                                   |
| Update nonexistent       | `team_update_entry(entry_id: 999999, content: "x")`                  | Structured error: `{ success: false, error: "..." }` |
| Soft delete              | `team_delete_entry(entry_id: <id>)`                                  | `success: true`, `message` confirming deletion       |
| Delete nonexistent       | `team_delete_entry(entry_id: 999999)`                                | Structured error: `{ success: false, error: "..." }` |
| Merge tags               | `team_merge_tags(source_tag: "team-old", target_tag: "team-new")`    | `success: true`, `entriesUpdated`, `sourceDeleted`   |
| Merge same tag           | `team_merge_tags(source_tag: "team-new", target_tag: "team-new")`    | Structured error: `{ success: false, error: "..." }` |
| Merge nonexistent source | `team_merge_tags(source_tag: "nonexistent-xyz", target_tag: "x")`    | Structured error: `{ success: false, error: "..." }` |

### 10.7 Team Analytics

| Test             | Command/Action                           | Expected Result                                                     |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| Default stats    | `team_get_statistics`                    | `totalEntries`, `entriesByType`, `entriesByPeriod`, `authors` array |
| Group by month   | `team_get_statistics(group_by: "month")` | `entriesByPeriod` periods grouped by month                          |
| Group by day     | `team_get_statistics(group_by: "day")`   | `entriesByPeriod` periods grouped by day                            |
| Author breakdown | Inspect `authors` field                  | Array of `{ author, count }` for each contributor                   |

### 10.8 Team Vector Search

| Test                    | Command/Action                                                   | Expected Result                                     |
| ----------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| Rebuild team index      | `team_rebuild_vector_index`                                      | `success: true`, `entriesIndexed` > 0               |
| Team vector stats       | `team_get_vector_index_stats`                                    | `available`, `itemCount`, `modelName`, `dimensions` |
| Team semantic query     | `team_semantic_search(query: "team standup")`                    | ≥ 1 result with `similarity` score                  |
| Team related by ID      | `team_semantic_search(entry_id: <team_entry_id>)`                | Semantically similar team entries bypassing strings |
| Team semantic threshold | `team_semantic_search(query: "test", similarity_threshold: 0.5)` | Fewer results than default threshold (0.25)         |
| Team add to index       | `team_add_to_vector_index(entry_id: <team_entry_id>)`            | `success: true`, `entryId` in response              |
| Team add nonexistent    | `team_add_to_vector_index(entry_id: 999999)`                     | `{ success: false, error: "..." }`                  |

### 10.9 Team Cross-Project Insights

| Test                 | Command/Action                                                                      | Expected Result                                                                           |
| -------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Default insights     | `team_get_cross_project_insights`                                                   | `project_count ≥ 1`, project 5 with `entry_count ≥ 3`, `top_tags` and `time_distribution` |
| Insights with dates  | `team_get_cross_project_insights(start_date: "2026-01-01", end_date: "2026-03-01")` | Date-filtered — project 5 visible if S15–S17 fall within range                            |
| Insights min_entries | `team_get_cross_project_insights(min_entries: 1)`                                   | Same or more projects than default (`min_entries: 3`)                                     |
| Empty result         | `team_get_cross_project_insights(min_entries: 9999)`                                | `project_count: 0`, `projects: []`, `message` present                                     |

### 10.10 Team Relationships

| Test                  | Command/Action                                                                                                 | Expected Result                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Link entries          | `team_link_entries(from_entry_id: <A>, to_entry_id: <B>, relationship_type: "references")`                     | `success: true`, `relationship` object               |
| Link with description | `team_link_entries(from_entry_id: <A>, to_entry_id: <B>, relationship_type: "implements", description: "...")` | Relationship created with `description`              |
| Duplicate link        | Call `team_link_entries` again with same params                                                                | `duplicate: true`, `message`                         |
| Link nonexistent      | `team_link_entries(from_entry_id: 999999, to_entry_id: <B>, ...)`                                              | Structured error: `{ success: false, error: "..." }` |
| Visualize by entry    | `team_visualize_relationships(entry_id: <A>)`                                                                  | `mermaid` string, `nodeCount`, `edgeCount`           |
| Visualize by tag      | `team_visualize_relationships(tag: "team-test")`                                                               | Mermaid diagram scoped to tag                        |
| Visualize nonexistent | `team_visualize_relationships(entry_id: 999999)`                                                               | Structured error or empty diagram                    |

### 10.11 Team IO & Export

| Test               | Command/Action                                                   | Expected Result                           |
| ------------------ | ---------------------------------------------------------------- | ----------------------------------------- |
| Export JSON        | `team_export_entries(format: "json", limit: 5)`                  | `format: "json"`, `data` string, `count`  |
| Export markdown    | `team_export_entries(format: "markdown", limit: 5)`              | `format: "markdown"`, `data` string       |
| IO Export markdown | `team_export_markdown(output_dir: "tmp_team_md", limit: 5)`      | Generates local `.md` files in target dir |
| IO Import dry run  | `team_import_markdown(source_dir: "tmp_team_md", dry_run: true)` | Returns mock counts, resolves `author`    |

### 10.12 Team Backup

| Test              | Command/Action                          | Expected Result                                            |
| ----------------- | --------------------------------------- | ---------------------------------------------------------- |
| Named backup      | `team_backup(name: "team-test-backup")` | `success: true`, `filename`, `path`, `sizeBytes`           |
| Auto-named backup | `team_backup`                           | Backup created with auto-generated timestamped name        |
| List backups      | `team_list_backups`                     | `backups` array with metadata, `total`, `backupsDirectory` |

### 10.13 Team Resources

| Test             | URI                        | Expected Result                                                       |
| ---------------- | -------------------------- | --------------------------------------------------------------------- |
| Recent entries   | `memory://team/recent`     | JSON with `entries` (author-enriched), `count`, `source: "team"`      |
| Statistics       | `memory://team/statistics` | `configured: true`, `totalEntries`, `authors` array, `source: "team"` |
| Author breakdown | `memory://team/statistics` | `authors` contains `{ author: "<name>", count: N }` for each author   |

### 10.14 Insights & Team Collaboration Metrics

| Test                 | Command/Action                                 | Expected Result                                                                |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Matrix structure     | `team_get_collaboration_matrix`                | `authorActivity` and `impactFactor` object arrays present                      |
| Matrix author        | Inspect `team_get_collaboration_matrix` result | Authors like "alice" and "bob" (from S15-S17) exist in metrics                 |
| Digest resource      | Read `memory://insights/digest`                | Either full snapshot JSON or graceful "no digest available" message            |
| Team collab resource | Read `memory://insights/team-collaboration`    | Same payload structure as `team_get_collaboration_matrix` with `success: true` |

### 10.15 Cleanup

| Test        | Command/Action                                     | Expected Result                 |
| ----------- | -------------------------------------------------- | ------------------------------- |
| Delete test | `delete_entry(entry_id: <team_test_id>)` on teamDb | Test entries removed (optional) |

### 10.16 Hush Protocol — Flag Creation

| Test                | Command/Action                                                                                                       | Expected Result                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Blocker flag        | `pass_team_flag(flag_type: "blocker", message: "FK constraint blocks migration", target_user: "@sarah")`             | `success: true`, `flag_type: "blocker"`, `target_user: "sarah"`   |
| FYI flag            | `pass_team_flag(flag_type: "fyi", message: "New lint rule added")`                                                   | `success: true`, no `target_user`                                 |
| Needs review        | `pass_team_flag(flag_type: "needs_review", message: "Auth refactor ready", target_user: "chris", issue_number: <N>)` | Entry has `issueNumber` set                                       |
| Help requested      | `pass_team_flag(flag_type: "help_requested", message: "Race condition on Windows")`                                  | `success: true`, all 4 vocabulary types accepted                  |
| With link           | `pass_team_flag(flag_type: "blocker", message: "Migration file", link: "src/db/migrations/005.ts")`                  | `auto_context.link` populated                                     |
| With project_number | `pass_team_flag(flag_type: "fyi", message: "Scoped flag", project_number: 5)`                                        | Entry has `projectNumber: 5`                                      |
| Entry structure     | `team_get_entry_by_id(entry_id: <flag_id>)`                                                                          | `entryType: "flag"`, tags include `flag:blocker` and `@sarah`     |
| Auto_context shape  | Inspect `autoContext` JSON from entry detail                                                                         | Contains `flag_type`, `target_user`, `link`, `resolved: false`    |
| Invalid vocab       | `pass_team_flag(flag_type: "urgent", message: "test")`                                                               | `{ success: false, code: "VALIDATION_ERROR" }`, lists valid types |
| Missing message     | `pass_team_flag(flag_type: "blocker")`                                                                               | Structured error: message required                                |
| Missing flag_type   | `pass_team_flag(message: "test")`                                                                                    | Structured error: flag_type required                              |
| Empty params        | `pass_team_flag({})`                                                                                                 | Structured error: both required                                   |

### 10.17 Hush Protocol — Flag Resolution

| Test                  | Command/Action                                                        | Expected Result                                                 |
| --------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| Resolve with comment  | `resolve_team_flag(flag_id: <id>, resolution: "Fixed by migration")`  | `success: true`, `resolved: true`, `resolution` set             |
| Content marker        | `team_get_entry_by_id(entry_id: <id>)` after resolve                  | Content contains `[RESOLVED: Fixed by migration]`               |
| Auto_context resolved | Inspect `autoContext` JSON after resolve                              | `resolved: true`, `resolved_at` ISO timestamp, `resolution` set |
| Idempotent re-resolve | `resolve_team_flag(flag_id: <id>, resolution: "Should not override")` | `success: true`, original resolution retained                   |
| Bare resolve          | `resolve_team_flag(flag_id: <new_flag>)` without resolution           | `success: true`, content contains `[RESOLVED]` (no comment)     |
| Nonexistent flag ID   | `resolve_team_flag(flag_id: 999999)`                                  | `{ success: false, code: "RESOURCE_NOT_FOUND" }`                |
| Non-flag entry        | `resolve_team_flag(flag_id: <non_flag_entry_id>)`                     | `{ success: false, code: "VALIDATION_ERROR" }`                  |
| Empty params          | `resolve_team_flag({})`                                               | Structured error: flag_id required                              |

### 10.18 Hush Protocol — Flag Resources

| Test               | URI                         | Expected Result                                                           |
| ------------------ | --------------------------- | ------------------------------------------------------------------------- |
| Active flags       | `memory://flags`            | JSON with `activeFlags` array, each with `flag_type`, `target_user`, etc. |
| No active flags    | `memory://flags`            | After resolving all flags — `activeFlags` empty or resource returns `[]`  |
| Flag vocabulary    | `memory://flags/vocabulary` | JSON with default vocabulary: blocker, needs_review, help_requested, fyi  |
| Briefing flags     | `memory://briefing`         | `activeFlags` section present when unresolved flags exist                 |
| Briefing localTime | `memory://briefing`         | `localTime` field present with human-readable timestamp                   |

### 10.19 Hush Protocol — Cleanup

| Test         | Command/Action                                         | Expected Result               |
| ------------ | ------------------------------------------------------ | ----------------------------- |
| Delete flags | `team_delete_entry(entry_id: <flag_id>)` for each flag | All test flag entries removed |

---

## Success Criteria

- [ ] `team_create_entry` creates entry with auto-detected `author` field
- [ ] `team_create_entry` accepts explicit `author` override
- [ ] `team_get_recent` returns entries with `author` field on each entry
- [ ] `team_search` filters by text, tags, or both
- [ ] `team_search` properly delegates to Hybrid/RRF when `mode: 'auto'`
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
- [ ] `team_get_statistics` returns `totalEntries`, `entriesByType`, `entriesByPeriod`, `authors`
- [ ] `team_get_statistics` respects `group_by` parameter
- [ ] `team_link_entries` creates relationships, detects duplicates, errors on nonexistent IDs
- [ ] `team_visualize_relationships` returns Mermaid diagram with `nodeCount`, `edgeCount`
- [ ] `team_export_entries` exports JSON and markdown with optional filters
- [ ] `team_export_markdown` exports entries to .md files successfully
- [ ] `team_import_markdown` runs dry_runs and parses standard team features
- [ ] `team_backup` creates named and auto-named backups with `filename`, `path`, `sizeBytes`
- [ ] `team_list_backups` returns backup metadata array
- [ ] `team_rebuild_vector_index` indexes team entries successfully
- [ ] `team_get_vector_index_stats` returns `available`, `itemCount`, `modelName`, `dimensions`
- [ ] `team_semantic_search` returns semantically similar entries with `similarity` scores
- [ ] `team_semantic_search` accepts `entry_id` for "Related by ID" lookup
- [ ] `team_add_to_vector_index` succeeds for existing entries, errors for nonexistent
- [ ] `team_get_cross_project_insights` returns `project_count ≥ 1` with seed entries S15–S17 present (project 5 has 3 entries, meeting `min_entries: 3`)
- [ ] `team_get_cross_project_insights` response includes `top_tags`, `first_entry`, `last_entry`, `active_days`, `time_distribution` per project
- [ ] `team_get_cross_project_insights` returns `project_count: 0`, `projects: []`, and `message` when no projects meet the threshold
- [ ] All 22 team tools return structured errors when `TEAM_DB_PATH` not configured
- [ ] `pass_team_flag` creates entries with `entry_type: "flag"` and structured `auto_context`
- [ ] `pass_team_flag` strips `@` prefix from `target_user` before storage
- [ ] `pass_team_flag` generates `flag:{type}` and `@{user}` tags automatically
- [ ] `pass_team_flag` validates against configured vocabulary (rejects invalid types)
- [ ] `pass_team_flag` requires both `flag_type` and `message`
- [ ] `resolve_team_flag` transitions flag to resolved state with `[RESOLVED]` content marker
- [ ] `resolve_team_flag` is idempotent — re-resolving returns success with original state
- [ ] `resolve_team_flag` rejects non-flag entries with `VALIDATION_ERROR`
- [ ] `resolve_team_flag` returns `RESOURCE_NOT_FOUND` for nonexistent IDs
- [ ] `memory://flags` returns active (unresolved) flag dashboard
- [ ] `memory://flags/vocabulary` returns the server-wide flag vocabulary
- [ ] `memory://briefing` includes `activeFlags` when unresolved flags exist
- [ ] `memory://briefing` includes `localTime` for chronological grounding
- [ ] `memory://team/recent` returns author-enriched entries with `source: "team"`
- [ ] `memory://team/statistics` returns `configured: true`, `authors` array with `{ author, count }`
- [ ] `memory://briefing` includes team entry count ("Team DB" row)
- [ ] `memory://health` includes `teamDatabase` status block with `configured`, `entryCount`, `path`
- [ ] `team_get_collaboration_matrix` returns populated `authorActivity` and `impactFactor` metrics
- [ ] `memory://insights/digest` handles un-configured digest gracefully or returns valid JSON
- [ ] `memory://insights/team-collaboration` returns static matrix metrics without error
