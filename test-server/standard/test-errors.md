# Test memory-journal-mcp — Prompts & Error Handling

**Scope:** Prompt handler verification (16 prompts, scripted), structured error response testing for all 61 tools, and numeric parameter coercion checks.

**Prerequisites:** Seed data from `test-seed.md` must be present. Core, schema, and resource tests should have passed. MCP server instructions auto-injected. Use https://github.com/users/neverinfamous/projects/5 for project/Kanban testing.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. User verifies: `npm run lint && npm run typecheck`, `npm run test`, `npm run test:e2e`.
4. Re-test fixes with direct MCP calls.
5. Brief final summary.

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

### 3.3 Prompt Error Handling

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

## Success Criteria

### Prompt Handlers (Phase 3)

- [ ] All 16 prompts return valid `GetPromptResult` with `messages` array
- [ ] Every message has `role: 'user'` and non-empty `content.text`
- [ ] Nonexistent prompt name returns MCP error (not crash)

### Structured Error Verification (Phase 4)

- [ ] **All tools return structured handler errors — no raw MCP error frames**
- [ ] **Zod validation errors (empty params, wrong types) return `{ success: false, error: "..." }`**
