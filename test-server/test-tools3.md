# Test memory-journal-mcp — Error Handling, Integrity & Edge Cases

Exhaustively validate the memory-journal-mcp server's prompt handlers, structured error responses, data integrity, boundary values, and implementation correctness.

**Scope:** This file covers prompt handler verification, structured error testing, data integrity round-trips, boundary values, and implementation bug detection. Phases 3-7.

**Prerequisites:**

- The core tests in `test-tools.md` must have completed successfully and any fixes applied before running this file.
- The schema/resource/GitHub tests in `test-tools2.md` must have completed successfully before running this file.
- Confirm MCP server instructions were auto-received before starting.
- Use the MCP server directly for all tests — not the terminal or scripts.
- Use https://github.com/users/neverinfamous/projects/5 for project/Kanban testing.

**Workflow after testing:**

1. Create a plan to implement any fixes and/or improvement opportunities, including changes to `server-instructions.md`/`server-instructions.ts` or this file (`test-server/test-tools3.md`).
2. Use `code-map.md` as a source of truth and ensure fixes comply with `C:\Users\chris\Desktop\adamic\skills\mcp-builder`.
3. After implementation, update `UNRELEASED.md` and commit without pushing. Then, stop so the user can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.

> [!IMPORTANT]
> **Test Session Prerequisites**

1. The server instructions are auto-injected by the MCP protocol. Confirm receipt (no need to read `memory://instructions` separately).
2. Read `memory://briefing` to confirm context loaded (the briefing table confirms receipt).

---

## Phase 3: Prompt Handler Verification (16 prompts) - **DO NOT SKIP!**

> [!IMPORTANT]
> Prompts return `GetPromptResult` objects with `messages` arrays. Most MCP clients don't expose `prompts/get` as a callable tool — run the script below instead. It handles session init, prompt listing, and shape verification automatically. See `test-server/README.md` for full details.

```powershell
npm run build
node test-server/test-prompts.mjs
```

| Check                | Expected                                                       |
| -------------------- | -------------------------------------------------------------- |
| Prompts listed       | 16 prompts with correct argument signatures                    |
| All 18 prompt calls  | PASS — `messages[0].role === 'user'`, non-empty `content.text` |
| Nonexistent prompt   | MCP error (code `-32602`)                                      |
| Missing required arg | Error returned or handled gracefully                           |
| **Total**            | **20 pass, 0 fail**                                            |

The tables below document what the script tests — use them as a reference for manual verification or when adding new prompts.

### 3.1 Workflow Prompts (10 prompts)

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

### 3.2 GitHub Prompts (6 prompts)

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

### 3.3 Error Handling

| Test                  | Action                                                | Expected Result                                                                         |
| --------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Missing required arg  | `prompts/get` for `find-related` with no `query`      | Structured error or empty query handled gracefully (handler uses `args['query'] ?? ''`) |
| Missing required arg  | `prompts/get` for `analyze-period` with no dates      | Structured error or empty dates handled gracefully                                      |
| Nonexistent prompt    | `prompts/get` for `nonexistent-prompt`                | MCP error: prompt not found                                                             |
| Invalid argument name | `prompts/get` for `prepare-standup` with `foo: "bar"` | Succeeds (no-argument prompt ignores extra args)                                        |

### 3.4 Response Shape Verification

For **every** prompt response, verify:

| Check                  | Expected                                                               |
| ---------------------- | ---------------------------------------------------------------------- |
| `messages` is an array | `Array.isArray(result.messages) === true`                              |
| At least 1 message     | `messages.length >= 1`                                                 |
| Message has `role`     | `messages[0].role === 'user'`                                          |
| Message has `content`  | `messages[0].content` is object with `type: 'text'` and `text: string` |
| Text is non-empty      | `messages[0].content.text.length > 0`                                  |

---

## Phase 4: Structured Error Response Verification

> [!IMPORTANT]
> All 61 tools now use deterministic error handling via `formatHandlerError()` in `src/utils/error-helpers.ts`. Each handler is wrapped in a `try/catch` block that catches all errors (including Zod validation) and returns enriched structured responses. This phase verifies that no tool produces raw MCP error frames.

### Structured Error Response Pattern

All tools return errors as structured objects via `formatHandlerError()` (never thrown). A thrown error propagates as a raw MCP error, which is unhelpful to clients. The expected pattern:

```json
{
  "success": false,
  "error": "Human-readable error message",
  "code": "VALIDATION_ERROR",
  "category": "validation",
  "recoverable": false,
  "suggestion": "Check input parameters against the tool schema"
}
```

#### Handler Error vs MCP Error — How to Distinguish

There are two kinds of error responses. Only one is correct:

| Type                 | Source                                                     | What you see                                                                                                          | Verdict            |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **Handler error** ✅ | Handler catches error and returns enriched `ErrorResponse` | Parseable JSON object with `success`, `error`, `code`, `category`, `recoverable` fields                               | Correct            |
| **MCP error** ❌     | Uncaught throw propagates to MCP framework                 | Raw text error string, often prefixed with `Error:`, wrapped in an `isError: true` content block — no `success` field | Bug — report as ❌ |

**Concrete examples:**

```
✅ Handler error (correct):
{"success": false, "error": "Entry 999999 not found"}

❌ MCP error (bug — handler threw instead of catching):
content: [{type: "text", text: "Error: Entry 999999 not found"}]
isError: true
```

The MCP error case means the handler is missing a `try/catch` block. When testing, if you see a raw error string (especially one without a `success` field), report it as ❌.

#### Zod Validation Errors

Calling a tool with wrong parameter types or missing required fields triggers a Zod validation error. If the handler has no outer `try/catch`, this surfaces as a raw MCP error (often `-32602`). Test every tool with `{}` (empty params) if it has required parameters — the response must be a handler error, not an MCP error.

### Error Path Testing Checklist

For each tool group, verify at least one scenario from each applicable row:

| Error Scenario                      | Tool Groups to Test                                                     | Example Input                                                           |
| ----------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Nonexistent entry ID                | core, admin, relationships                                              | `entry_id: 999999`                                                      |
| Invalid entry_type enum             | core (`create_entry`, `update_entry`)                                   | `entry_type: "invalid_type"`                                            |
| Invalid significance_type enum      | core (`create_entry`)                                                   | `significance_type: "invalid"`                                          |
| Invalid date format                 | search (`search_by_date_range`)                                         | `start_date: "Jan 1"`                                                   |
| Inverted date range                 | search (`search_by_date_range`)                                         | `start_date: "2026-12-31", end_date: "2026-01-01"` — verify behavior    |
| Vector manager unavailable          | search (`semantic_search`)                                              | Verify `{ success: false, error: "..." }` not raw throw                 |
| Add nonexistent to vector index     | admin (`add_to_vector_index`)                                           | `entry_id: 999999`                                                      |
| Nonexistent backup filename         | backup (`restore_backup`)                                               | `filename: "nonexistent.db"`                                            |
| Path traversal in backup name       | backup (`backup_journal`)                                               | `name: "../../etc/passwd"`                                              |
| Invalid relationship_type enum      | relationships (`link_entries`)                                          | `relationship_type: "invalid"`                                          |
| Missing required params (Zod)       | **Every tool with required params**                                     | `{}` (empty object — must return handler error, not MCP `-32602` error) |
| Wrong param type (Zod)              | **Tools with typed params**                                             | Pass string where number expected, etc.                                 |
| No GitHub token / unavailable       | github (all 16 tools)                                                   | Verify structured `{ error, requiresUserInput }` not raw throw          |
| Nonexistent GitHub issue            | github (`get_github_issue`)                                             | `issue_number: 999999` → `{ error: "Issue #999999 not found" }`         |
| Nonexistent GitHub PR               | github (`get_github_pr`)                                                | `pr_number: 999999` → `{ error: "PR #999999 not found" }`               |
| Nonexistent GitHub milestone        | github (`get_github_milestone`)                                         | `milestone_number: 999999` → `{ error: "Milestone #999999 not found" }` |
| Close already-closed issue          | github (`close_github_issue_with_entry`)                                | Close an issue that's already closed                                    |
| move_to_done without project_number | github (`close_github_issue_with_entry`)                                | `move_to_done: true` but no `project_number`                            |
| Invalid Kanban target_status        | github (`move_kanban_item`)                                             | `target_status: "Nonexistent"` — ⚠️ verify outputSchema compatibility   |
| Nonexistent Kanban project          | github (`get_kanban_board`)                                             | `project_number: 99999`                                                 |
| Merge same tag (source = target)    | admin (`merge_tags`)                                                    | `source_tag: "x", target_tag: "x"`                                      |
| Merge nonexistent source tag        | admin (`merge_tags`)                                                    | `source_tag: "nonexistent-xyz", target_tag: "test"`                     |
| Team DB not configured              | team (all 20 tools)                                                     | Returns `{ success: false, error: "Team database not configured..." }`  |
| Invalid team entry_type             | team (`team_create_entry`)                                              | `entry_type: "invalid"` → structured error                              |
| Nonexistent team entry ID           | team (`team_get_entry_by_id`, `team_update_entry`, `team_delete_entry`) | `entry_id: 999999` → structured error                                   |
| Invalid team date format            | team (`team_search_by_date_range`)                                      | `start_date: "Jan 1"` → structured error                                |
| Merge same team tag                 | team (`team_merge_tags`)                                                | `source_tag: "x", target_tag: "x"` → structured error                   |
| Team link nonexistent               | team (`team_link_entries`)                                              | `from_entry_id: 999999` → structured error                              |
| Team vector unavailable             | team (`team_semantic_search`)                                           | Verify `{ success: false, error: "..." }` not raw throw                 |
| Team add nonexistent to vector      | team (`team_add_to_vector_index`)                                       | `entry_id: 999999` → structured error                                   |
| Team insights empty                 | team (`team_get_cross_project_insights`)                                | Returns all required schema fields even when empty                      |

### What to Report

- ❌ **Fail**: Tool returns a raw MCP error (no JSON body with `success` field) instead of `{ success: false, error: "..." }`
- ⚠️ **Issue**: Tool silently succeeds for invalid input (e.g., `update_entry` returns `success: true` for nonexistent entry)
- ✅ **Pass**: Tool returns `{ success: false, error: "..." }` — correct structured error

### Wrong-Type Numeric Parameter Coercion

For every tool with optional numeric parameters, call the tool with `param: "abc"` (string instead of number). The tool must NOT return a raw MCP `-32602` error. Acceptable behaviors:

- Handler returns `{success: false, error: "..."}` with a validation message
- Handler silently applies the default value
- Handler coerces to NaN and returns a descriptive error

Unacceptable: Raw MCP error frame with `-32602` code.

| Tool                              | Parameter              | Test Call                                                                                     |
| --------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| `get_recent_entries`              | `limit`                | `get_recent_entries({limit: "abc"})`                                                          |
| `search_entries`                  | `limit`                | `search_entries({query: "test", limit: "abc"})`                                               |
| `search_by_date_range`            | `limit`                | `search_by_date_range({start_date: "2026-01-01", end_date: "2026-12-31", limit: "abc"})`      |
| `semantic_search`                 | `limit`                | `semantic_search({query: "test", limit: "abc"})`                                              |
| `semantic_search`                 | `similarity_threshold` | `semantic_search({query: "test", similarity_threshold: "abc"})`                               |
| `export_entries`                  | `limit`                | `export_entries({format: "json", limit: "abc"})`                                              |
| `cleanup_backups`                 | `keep_count`           | `cleanup_backups({keep_count: "abc"})`                                                        |
| `visualize_relationships`         | `depth`                | `visualize_relationships({entry_id: 1, depth: "abc"})`                                        |
| `visualize_relationships`         | `limit`                | `visualize_relationships({entry_id: 1, limit: "abc"})`                                        |
| `get_github_issues`               | `limit`                | `get_github_issues({limit: "abc"})`                                                           |
| `get_github_prs`                  | `limit`                | `get_github_prs({limit: "abc"})`                                                              |
| `team_get_recent`                 | `limit`                | `team_get_recent({limit: "abc"})`                                                             |
| `team_search_by_date_range`       | `limit`                | `team_search_by_date_range({start_date: "2026-01-01", end_date: "2026-12-31", limit: "abc"})` |
| `team_export_entries`             | `limit`                | `team_export_entries({format: "json", limit: "abc"})`                                         |
| `team_visualize_relationships`    | `depth`                | `team_visualize_relationships({entry_id: 1, depth: "abc"})`                                   |
| `get_cross_project_insights`      | `min_entries`          | `get_cross_project_insights({min_entries: "abc"})`                                            |
| `team_semantic_search`            | `limit`                | `team_semantic_search({query: "test", limit: "abc"})`                                         |
| `team_semantic_search`            | `similarity_threshold` | `team_semantic_search({query: "test", similarity_threshold: "abc"})`                          |
| `team_get_cross_project_insights` | `min_entries`          | `team_get_cross_project_insights({min_entries: "abc"})`                                       |

### Reporting Format

- ❌ Fail: Tool errors or produces incorrect results (include error message)
- ⚠️ Issue: Unexpected behavior or improvement opportunity
- 📦 Payload: Unnecessarily large response that could be optimized

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

## Test Execution Order

3. **Phase 3**: Prompt Handler Verification (scripted + response shape for all 16 prompts)
4. **Phase 4**: Structured Error Response Verification (expanded error path testing for all groups)
5. **Phase 5**: Data Integrity & Round-Trip Tests (create→read, backup→restore, merge→verify)
6. **Phase 6**: Boundary Value Tests (min/max limits, Zod schema edges)
7. **Phase 7**: Implementation Bug Detection (silent filter bugs, schema compatibility, duplicate directions)

---

## Success Criteria

### Prompt Handlers (Phase 3)

- [ ] All 16 prompts return valid `GetPromptResult` with `messages` array
- [ ] Every message has `role: 'user'` and non-empty `content.text`
- [ ] Nonexistent prompt name returns MCP error (not crash)

### Structured Error Verification (Phase 4)

- [ ] **All tools return structured handler errors — no raw MCP error frames**
- [ ] **Zod validation errors (empty params, wrong types) return `{ success: false, error: "..." }`**

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
