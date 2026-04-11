# Re-Test memory-journal-mcp — Error Handling & Structured Responses

**Scope:** Prompt handler validation, structured error response verification across all tool groups, and numeric coercion boundary testing.

**Execution Strategy:** **Use direct MCP tools, NOT Code Mode or scripts!** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.

**Prerequisites:** Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. Then, stop so the **USER** can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. Re-test fixes with direct MCP calls.
5. Brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 11: Error Handling Verification

### 11.1 Prompt Handler Validation

> [!NOTE]
> Prompts are invoked via `getPrompt()` / `prompts/get`, not `callTool()`. Use the MCP `get_prompt` mechanism (or equivalent client capability) to validate prompt handlers.

| Test                   | Command/Action                                   | Expected Result                                              |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| List all prompts       | List available prompts                           | Returns 17 workflow prompts (11 workflow + 6 GitHub)         |
| `find-related`         | `getPrompt("find-related", { entry_id: "<N>" })` | Returns formatted messages with related entries              |
| `prepare-standup`      | `getPrompt("prepare-standup")`                   | Returns standup template with recent entries                 |
| `weekly-digest`        | `getPrompt("weekly-digest")`                     | Returns digest of recent activity                            |
| `get-context-bundle`   | `getPrompt("get-context-bundle")`                | Returns comprehensive context for session initialization     |
| `session-summary`      | `getPrompt("session-summary")`                   | Returns session summary template                             |
| `team-session-summary` | `getPrompt("team-session-summary")`              | Returns team-aware session summary (requires `TEAM_DB_PATH`) |
| Invalid prompt name    | `getPrompt("nonexistent-prompt")`                | Returns error (prompt not found)                             |
| Missing required arg   | `getPrompt("find-related", {})`                  | Returns error or graceful empty (missing `entry_id`)         |

### 11.2 Structured Error Response Verification

Every tool must return `{success: false, error, code, category, suggestion, recoverable}` for errors — **never raw MCP exceptions**. This section verifies the pattern across representative tools from each group.

| Group      | Tool                   | Error Trigger                                      | Expected Structured Fields                                                 |
| ---------- | ---------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| **core**   | `create_entry`         | `entry_type: "invalid"`                            | `success: false`, `code`, `category: "validation"`, `suggestion` with enum |
| **core**   | `get_entry_by_id`      | `entry_id: 999999`                                 | `success: false`, `code: "RESOURCE_NOT_FOUND"`, `category: "resource"`     |
| **search** | `search_by_date_range` | `start_date: "2026-12-31", end_date: "2026-01-01"` | `success: false`, `code: "VALIDATION_ERROR"`, `suggestion`                 |
| **admin**  | `update_entry`         | `entry_id: 999999`                                 | `success: false`, `code: "RESOURCE_NOT_FOUND"`                             |
| **admin**  | `merge_tags`           | `source_tag: "x", target_tag: "x"`                 | `success: false`, same-tag structured error                                |
| **backup** | `restore_backup`       | `filename: "nonexistent.db"`                       | `success: false`, file-not-found error                                     |
| **github** | `get_github_issue`     | `issue_number: 999999`                             | `success: false`, 404 structured error                                     |
| **team**   | `team_create_entry`    | `entry_type: "invalid"`                            | `success: false`, enum validation error                                    |
| **team**   | `team_update_entry`    | `entry_id: 999999`                                 | `success: false`, not-found error                                          |

### 11.3 Numeric Coercion Boundaries

The Dual-Schema pattern allows `.optional()` on the SDK-facing schema. Verify that type mismatches either coerce gracefully or return structured errors — **never raw `-32602`**.

| Test                  | Command/Action                                                | Expected Result                                         |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| String limit (core)   | `get_recent_entries(limit: "abc")`                            | Structured error or default behavior — NOT raw `-32602` |
| String limit (search) | `search_entries(query: "test", limit: "abc")`                 | Structured error or default behavior — NOT raw `-32602` |
| String entry_id       | `get_entry_by_id(entry_id: "abc")`                            | Structured error — NOT raw `-32602`                     |
| String threshold      | `semantic_search(query: "test", similarity_threshold: "abc")` | Structured error — NOT raw `-32602`                     |
| Negative limit        | `get_recent_entries(limit: -1)`                               | Structured validation error (min 1)                     |
| Zero limit            | `get_recent_entries(limit: 0)`                                | Structured validation error or empty result             |
| Float to int coercion | `get_entry_by_id(entry_id: 1.5)`                              | Coerces to integer or structured error                  |
| Boolean where string  | `create_entry(content: true)`                                 | Structured error — content must be string               |
| Array where string    | `create_entry(content: ["array"])`                            | Structured error — content must be string               |

### 11.4 Empty Parameter (`{}`) Sweep — Critical Tools

All tools must accept `{}` without crashing. Tools with required logical params should return structured validation errors.

| Tool                   | Input | Expected Result                                                        |
| ---------------------- | ----- | ---------------------------------------------------------------------- |
| `create_entry`         | `{}`  | Structured error (content required)                                    |
| `create_entry_minimal` | `{}`  | Structured error (content required)                                    |
| `get_entry_by_id`      | `{}`  | Structured error (entry_id required)                                   |
| `update_entry`         | `{}`  | Structured error (entry_id required)                                   |
| `delete_entry`         | `{}`  | Structured error (entry_id required)                                   |
| `link_entries`         | `{}`  | Structured error (from/to entry_id required)                           |
| `merge_tags`           | `{}`  | Structured error (source_tag/target_tag required)                      |
| `search_entries`       | `{}`  | Structured error or returns recent (query optional if filters present) |
| `get_recent_entries`   | `{}`  | Success — uses defaults                                                |
| `get_statistics`       | `{}`  | Success — uses defaults                                                |
| `list_tags`            | `{}`  | Success — no params needed                                             |
| `test_simple`          | `{}`  | Success — returns echo                                                 |

---

## Success Criteria

- [ ] All 17 prompts are listed and at least 5 core prompts return valid formatted messages
- [ ] Structured error responses include `success`, `error`, `code`, `category` fields
- [ ] No tools return raw MCP `-32602` exceptions for invalid input types
- [ ] `{}` empty param sweep completes without crashes for all critical tools
- [ ] Numeric coercion boundaries (string, negative, zero, float, boolean, array) are handled gracefully
