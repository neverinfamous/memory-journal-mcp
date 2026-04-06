# Test memory-journal-mcp — Data Integrity & Edge Cases

**Scope:** Data round-trip verification, soft delete isolation, backup/restore integrity, merge tags verification, boundary value tests, and implementation bug detection.

**Prerequisites:** Seed data from `test-seed.md` must be present. Core, schema, resource, and error tests should have passed. MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. User verifies: `npm run lint && npm run typecheck`, `npm run test`, `npm run test:e2e`.
4. Re-test fixes with direct MCP calls.
5. Brief final summary.

---

## Phase 5: Data Integrity & Round-Trip Tests

> [!NOTE]
> These tests verify that data survives full lifecycles and that operations compose correctly.

### 5.1 Create → Read Round-Trip

| Test                       | Steps                                                                                                                                                                                                                                         | Expected Result                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| All fields persist         | 1. `create_entry(content: "RT test", entry_type: "planning", tags: ["rt"], pr_number: 99, pr_status: "open", workflow_run_id: 1, workflow_name: "CI", workflow_status: "completed", project_number: 5)` 2. `get_entry_by_id(entry_id: <new>)` | All fields match: `prNumber`, `prStatus`, `workflowRunId`, `workflowName`, `workflowStatus`, `projectNumber` |
| share_with_team round-trip | 1. `create_entry(content: "Shared RT", share_with_team: true)` 2. `team_search(query: "Shared RT")`                                                                                                                                           | Entry appears in team search with `author` field                                                             |

### 5.2 Soft Delete Isolation

| Test                        | Steps                                                                                               | Expected Result                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Hidden from search          | 1. Create entry 2. `delete_entry(entry_id: <id>, permanent: false)` 3. `search_entries(query: ...)` | Entry does not appear in search results                                                 |
| Hidden from recent          | Same setup, then `get_recent_entries`                                                               | Entry does not appear in recent results                                                 |
| Hidden from semantic search | Same setup, then `semantic_search(query: ...)`                                                      | Entry does not appear in semantic results                                               |
| Still fetchable by ID       | Same setup, then `get_entry_by_id(entry_id: <id>)`                                                  | ⚠️ Verify behavior — document whether soft-deleted entries are retrievable by direct ID |

### 5.3 Backup → Restore Integrity

| Test                    | Steps                                                                                                                              | Expected Result                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Entry count preserved   | 1. Note `get_statistics` total 2. `backup_journal` 3. Create 2 entries 4. `restore_backup` 5. `get_statistics`                     | Total matches pre-backup count             |
| Specific entry survives | 1. Create entry with known content 2. `backup_journal` 3. `delete_entry(permanent: true)` 4. `restore_backup` 5. `get_entry_by_id` | Entry is restored with original content    |
| Relationships survive   | 1. Link two entries 2. `backup_journal` 3. Delete one entry 4. `restore_backup` 5. `visualize_relationships`                       | Relationship graph is intact after restore |
| Tags survive            | 1. `merge_tags` 2. `backup_journal` 3. `restore_backup` 4. `list_tags`                                                             | Tags reflect post-merge state from backup  |

### 5.4 Merge Tags Verification

| Test                      | Steps                                                                                                                             | Expected Result                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Entries re-tagged         | 1. Create entries with "old-tag" 2. `merge_tags(source_tag: "old-tag", target_tag: "new-tag")` 3. `search_entries` for each entry | Each entry now has "new-tag", not "old-tag"   |
| Source tag removed        | After merge, `list_tags`                                                                                                          | "old-tag" no longer appears                   |
| Target tag count accurate | After merge, `list_tags`                                                                                                          | "new-tag" count equals sum of original counts |

---

## Phase 6: Boundary Value Tests

> [!NOTE]
> These tests exercise min/max limits and edge values defined in Zod schemas.

| Test                            | Command/Action                                              | Expected Result                                      |
| ------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| Content at max length           | `create_entry(content: <50000 chars>)`                      | Entry created successfully                           |
| Content empty string            | `create_entry(content: "")`                                 | Structured error: min length 1                       |
| get_recent limit=0              | `get_recent_entries(limit: 0)`                              | Structured error or empty results — verify behavior  |
| get_recent limit=500            | `get_recent_entries(limit: 500)`                            | Returns up to 500 entries (max boundary)             |
| get_recent limit=501            | `get_recent_entries(limit: 501)`                            | Structured error: exceeds max 500                    |
| search limit=500                | `search_entries(query: "test", limit: 500)`                 | Returns up to 500 entries                            |
| search limit=501                | `search_entries(query: "test", limit: 501)`                 | Structured error: exceeds max 500                    |
| semantic_search limit=500       | `semantic_search(query: "test", limit: 500)`                | Returns up to 500 entries                            |
| semantic threshold=0.0          | `semantic_search(query: "test", similarity_threshold: 0.0)` | Returns all indexed entries (no threshold filtering) |
| semantic threshold=1.0          | `semantic_search(query: "test", similarity_threshold: 1.0)` | Returns zero or very few results (exact match only)  |
| visualize depth=1               | `visualize_relationships(entry_id: <A>, depth: 1)`          | Only direct relationships (no transitive)            |
| visualize depth=3               | `visualize_relationships(entry_id: <A>, depth: 3)`          | Maximum depth traversal                              |
| cleanup keep_count=1            | `cleanup_backups(keep_count: 1)`                            | Keeps only 1 backup, deletes rest                    |
| cleanup keep_count=0            | `cleanup_backups(keep_count: 0)`                            | Structured error: min 1                              |
| get_statistics invalid group_by | `get_statistics(group_by: "invalid")`                       | Structured error or validation failure               |
| export limit=500                | `export_entries(format: "json", limit: 500)`                | Returns up to 500 entries                            |

---

## Phase 7: Implementation Bug Detection

> [!IMPORTANT]
> These tests are designed to surface known or suspected implementation bugs where tool handlers accept parameters via Zod but silently ignore them. If a filter has no effect, report it as ⚠️ — the handler accepts the parameter but doesn't pass it to the database query.

### 7.1 Silent Filter Bugs

| Test                       | Command/Action                                                                                                              | Verification                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| export_entries tag filter  | 1. Create entries with tag "export-test" and without 2. `export_entries(format: "json", tags: ["export-test"], limit: 100)` | ⚠️ All results should have "export-test" tag — if unfiltered, handler bug                   |
| export_entries date filter | `export_entries(format: "json", start_date: "2099-01-01", end_date: "2099-12-31")`                                          | ⚠️ Should return 0 entries for future dates — if returns entries, handler ignores dates     |
| export_entries type filter | `export_entries(format: "json", entry_types: ["milestone"], limit: 100)`                                                    | ⚠️ Should only return "milestone" type — if unfiltered, handler bug                         |
| get_statistics date filter | `get_statistics(start_date: "2099-01-01", end_date: "2099-12-31")`                                                          | ⚠️ Should return 0 entries for future dates — if returns all entries, handler ignores dates |
| get_statistics project     | `get_statistics(project_breakdown: true)`                                                                                   | ⚠️ Verify if response includes project-level breakdown (currently not implemented)          |
| search_by_date_range issue | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", issue_number: 44)`                                  | ⚠️ Verify if issue filter applies (handler may not pass to DB query)                        |
| search_by_date_range PR    | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", pr_number: 67)`                                     | ⚠️ Verify if PR filter applies (handler may not pass to DB query)                           |
| search_by_date_range wf    | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", workflow_run_id: 999)`                              | ⚠️ Verify if workflow filter applies (handler may not pass to DB query)                     |

### 7.2 OutputSchema Compatibility on Error Paths

> [!NOTE]
> Some tools return extra fields in error responses that aren't declared in their outputSchema. This can cause `-32602` errors when `structuredContent` validation is strict.

| Test                              | Command/Action                                                             | Verification                                                                         |
| --------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| move_kanban_item invalid status   | `move_kanban_item(project_number: 5, item_id: <id>, target_status: "Bad")` | Error response includes `availableStatuses` — verify this doesn't break outputSchema |
| get_repo_insights partial failure | `get_repo_insights(sections: "traffic")` (may require push access)         | Verify partial API failures don't produce fields outside outputSchema                |

### 7.3 Duplicate Relationship Direction

| Test                     | Command/Action                                                      | Verification                                                                             |
| ------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Same-direction duplicate | `link_entries(from: A, to: B, type: "references")` twice            | Second call returns `duplicate: true` — correct                                          |
| Reverse-direction        | `link_entries(from: B, to: A, type: "references")` after A→B exists | ⚠️ Creates a second relationship (only same-direction checked) — document if intentional |

---

## Success Criteria

### Data Integrity (Phase 5)

- [ ] All `create_entry` fields survive round-trip through `get_entry_by_id`
- [ ] Soft-deleted entries are hidden from all search/recent; direct ID fetch behavior documented
- [ ] Backup → restore preserves entry counts, specific entries, relationships, and tags
- [ ] `merge_tags` results verified: entries re-tagged, source removed, target count accurate

### Boundary Values (Phase 6)

- [ ] Content at max length (50,000 chars) creates successfully
- [ ] Empty content rejected
- [ ] Limit boundaries: 0, 500, 501 behave correctly
- [ ] `similarity_threshold` at 0.0 and 1.0 produce expected result counts

### Implementation Bugs (Phase 7)

- [ ] ⚠️ `export_entries` filters (`tags`, `start_date/end_date`, `entry_types`) functional or documented
- [ ] ⚠️ `get_statistics` filters (`start_date`, `end_date`, `project_breakdown`) functional or documented
- [ ] ⚠️ `move_kanban_item` error path `availableStatuses` field doesn't break outputSchema
- [ ] ⚠️ Reverse-direction relationship duplicate behavior documented as intentional or fixed
