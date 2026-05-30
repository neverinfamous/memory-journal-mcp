# Re-Test memory-journal-mcp — Error Handling & Structured Responses

**Scope:** Prompt handler validation, structured error response verification across all tool groups, and numeric coercion boundary testing.

**Prerequisites:**

- MCP server instructions auto-received before starting.
- **Use direct MCP tools.** Code Mode preferred only to supplement direct calls.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found, using `code-map.md` as source of truth.
2. If code changed: update `UNRELEASED.md`, commit (no push). If clean pass: no changelog. Stop for **USER** to run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:e2e`.
3. After user verification, re-test fixes with direct MCP calls.
4. Provide brief final summary with **Total Token Estimate** (sum `_meta.tokenEstimate` from all responses, or read `memory://metrics/summary`).

---

## Phase 11: Error Handling Verification

### 11.1 Prompt Handler Validation

> [!NOTE]
> Prompts are tested via the existing script `test-server/scripts/test-prompts.mjs`. Run it directly — do **not** use a browser or try to invoke `get_prompt` through the MCP client.

**Command:**

```
node test-server/scripts/test-prompts.mjs
```

| Test                         | Expected Result                                                 |
| ---------------------------- | --------------------------------------------------------------- |
| List all prompts             | 19 prompts listed (11 workflow + 6 GitHub + 1 adversarial + 1 team) |
| All 19 named prompt calls    | 19/19 PASS with non-empty `messages[0].content.text`            |
| `nonexistent-prompt`         | MCP error returned (code `-32602`)                              |
| `find-related({})` (no args) | Error returned gracefully                                       |
| **Overall**                  | `21 pass, 0 fail (21 total)`                                    |

### 11.2 Structured Error Response Verification

Every tool must return `{success: false, error, code, category, suggestion, recoverable}` for errors — **never raw MCP exceptions**. Verify the pattern across representative tools from each group.

| Group      | Tool                   | Error Trigger                                      | Expected Result                                                            |
| ---------- | ---------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| **core**   | `create_entry`         | `entry_type: "invalid"`                            | `success:false`, `code:"VALIDATION_ERROR"`, `category:"validation"`, enum in error |
| **core**   | `get_entry_by_id`      | `entry_id: 999999`                                 | `success:false`, `code:"RESOURCE_NOT_FOUND"`, `category:"resource"`        |
| **search** | `search_by_date_range` | `start_date: "2026-12-31", end_date: "2026-01-01"` | `success:false`, `code:"VALIDATION_ERROR"`, `suggestion` with date hint    |
| **admin**  | `update_entry`         | `entry_id: 999999`                                 | `success:false`, `code:"RESOURCE_NOT_FOUND"`, `recoverable:true`           |
| **admin**  | `merge_tags`           | `source_tag: "x", target_tag: "x"`                 | `success:false`, same-tag error with `category:"validation"`               |
| **backup** | `restore_backup`       | `filename: "nonexistent.db"`                       | `success:false`, `code:"RESOURCE_NOT_FOUND"`, `details.resourceType`       |
| **github** | `get_github_issue`     | `issue_number: 999999`                             | `success:false`, `code:"RESOURCE_NOT_FOUND"`, `category:"resource"`        |
| **team**   | `team_create_entry`    | `entry_type: "invalid"`                            | `success:false`, `code:"VALIDATION_ERROR"`, enum listed in error           |
| **team**   | `team_update_entry`    | `entry_id: 999999`                                 | `success:false`, `code:"RESOURCE_NOT_FOUND"`, `recoverable:true`           |

### 11.3 Numeric Coercion Boundaries

The Dual-Schema pattern allows `.optional()` on the SDK-facing schema. Verify that type mismatches either coerce gracefully or return structured errors — **never raw `-32602`**.

| Test                  | Input                                          | Expected Result                                                                |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| String limit (core)   | `get_recent_entries(limit: "abc")`             | `VALIDATION_ERROR`: structured, not raw `-32602`                               |
| String limit (search) | `search_entries(query: "x", limit: "abc")`     | `VALIDATION_ERROR`: structured, not raw `-32602`                               |
| String entry_id       | `get_entry_by_id(entry_id: "abc")`             | `VALIDATION_ERROR`: structured, not raw `-32602`                               |
| String threshold      | `semantic_search(query: "x", similarity_threshold: "abc")` | `VALIDATION_ERROR`: structured, not raw `-32602`               |
| Negative limit        | `get_recent_entries(limit: -1)`                | `VALIDATION_ERROR`: min boundary enforced (`>=1`)                              |
| Zero limit            | `get_recent_entries(limit: 0)`                 | `VALIDATION_ERROR`: min boundary enforced (`>=1`)                              |
| Float entry_id        | `get_entry_by_id(entry_id: 1.5)`              | `VALIDATION_ERROR`: non-integer rejected                                       |
| Boolean where string  | `create_entry(content: true)`                  | ⚠️ SDK coerces to string `"true"` — accepted (expected SDK behavior)           |
| Array where string    | `create_entry(content: ["array"])`             | ⚠️ SDK coerces to `'["array"]'` — accepted (expected SDK behavior)             |

> [!NOTE]
> The two ⚠️ findings (boolean and array coercion) are MCP SDK-layer behavior. The SDK serializes all JSON values to strings before Zod sees them when the schema type is `string`. **No action required** — this is expected protocol-layer coercion and does not pose a security or data integrity risk for `content`.

### 11.4 Empty Parameter (`{}`) Sweep — Critical Tools

All tools must accept `{}` without crashing. Tools with required logical params should return structured validation errors.

| Tool                   | Input | Expected Result                                                   |
| ---------------------- | ----- | ----------------------------------------------------------------- |
| `create_entry`         | `{}`  | `VALIDATION_ERROR`: content required                              |
| `create_entry_minimal` | `{}`  | `VALIDATION_ERROR`: content required                              |
| `get_entry_by_id`      | `{}`  | `VALIDATION_ERROR`: entry_id required                             |
| `update_entry`         | `{}`  | `VALIDATION_ERROR`: entry_id required                             |
| `delete_entry`         | `{}`  | `VALIDATION_ERROR`: entry_id required                             |
| `link_entries`         | `{}`  | `VALIDATION_ERROR`: from_entry_id + to_entry_id both required     |
| `merge_tags`           | `{}`  | `VALIDATION_ERROR`: source_tag + target_tag both required         |
| `search_entries`       | `{}`  | `VALIDATION_ERROR`: requires query or at least one filter         |
| `get_recent_entries`   | `{}`  | Success — uses defaults (returns recent entries)                  |
| `get_statistics`       | `{}`  | Success — uses defaults (returns full stats)                      |
| `list_tags`            | `{}`  | Success — no params needed (returns all tags)                     |
| `test_simple`          | `{}`  | Success — echo response                                          |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `node test-server/scripts/test-prompts.mjs` reports all prompts pass
- Structured error responses include `success`, `error`, `code`, `category` fields
- No tools return raw MCP `-32602` exceptions for invalid input types
- `{}` empty param sweep completes without crashes for all critical tools
- Numeric coercion boundaries (string, negative, zero, float) are handled gracefully
- Boolean/array-where-string coercion: SDK serializes to string (acceptable behavior, no fix needed)
