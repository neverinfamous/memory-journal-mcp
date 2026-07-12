# Re-Test memory-journal-mcp — Data Integrity & Boundary Testing (Part 1)

**Scope:** Data round-trip fidelity, boundary value behavior, Unicode handling, concurrent-like operations, and implementation bug detection.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls to ensure tests hit the test database instead of production.
- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing.
4. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify with `pnpm run check` yourself—you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 12.1: Data Integrity Verification (Part 1)

### 12.1.1 Round-Trip Fidelity

Create entries with specific data, then read them back to verify nothing is lost or mutated.

| Test                   | Create Action                                                                                                                                                                                                                     | Read-Back Verification                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| All fields persist     | `create_entry(content: "RT1", entry_type: "technical_note", tags: ["rt-test"], pr_number: 42, pr_status: "open", workflow_run_id: 100, workflow_name: "CI", workflow_status: "completed", project_number: 5, is_personal: false)` | `get_entry_by_id` — verify every field matches exactly                        |
| Unicode content        | `create_entry(project_number: 5, content: "日本語テスト 🎉 Ñoño — em dash")`                                                                                                                                                      | `get_entry_by_id` — verify content is byte-identical                          |
| Long content           | `create_entry(project_number: 5, content: <10,000+ char string>)`                                                                                                                                                                 | `get_entry_by_id` — verify content length matches                             |
| 12.6 Bad Expected Version | `update_entry(entry_id: <history_id>, content: "bad version", expected_version: 9999)` | Fails with `VALIDATION_ERROR` (version mismatch) |
| 12.7 Revision Eviction | Update entry 12 times to produce 12 revisions, then `get_entry_history(entry_id: <history_id>)` | Returns ≤10 revisions (oldest evicted). The first two snapshot contents are no longer present. |
| Multiline content      | `create_entry(project_number: 5, content: "Line 1\nLine 2\nLine 3")`                                                                                                                                                              | `get_entry_by_id` — verify newlines preserved                                 |
| HTML-like content      | `create_entry(project_number: 5, content: "<script>alert('xss')</script>")`                                                                                                                                                       | `get_entry_by_id` — content stored as-is (no sanitization of journal content) |
| Update preserves unset | `create_entry(project_number: 5, content: "Original", tags: ["a","b"])` then `update_entry(project_number: 5, entry_id: N, content: "Updated")`                                                                                   | `get_entry_by_id` — tags still `["a","b"]`, only content changed              |

### 12.1.2 Boundary Values

> [!WARNING]
> **Payload Limit Learnings:** The default Express JSON parser limit is **1MB**. Scripts testing the upper boundary for `413 Payload Too Large` MUST exceed 1MB. Additionally, testing HTTP/SSE manually with raw `fetch()` or `curl` requires first initializing the session via `POST /mcp/session` to obtain an `x-mcp-session-id` header. Without this handshake, POSTing `tools/call` directly to `/mcp` will fail with a 500 or 400 validation error (e.g. `!isInitializeRequest(req.body)`). It is far more reliable to perform these tests directly over the standard Stdio MCP connection.

| Test                   | Command/Action                                                                              | Expected Result                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Max content length     | `create_entry(project_number: 5, content: <50,000 char string>)`                            | Entry created successfully (50k chars)                            |
| Content above max      | `create_entry(project_number: 5, content: <100,000 char string>)`                           | Structured validation error (`<= 50000 characters`)               |
| Empty tags array       | `create_entry(project_number: 5, content: "test", tags: [])`                                | Entry created with empty tags                                     |
| Single-char tag        | `create_entry(project_number: 5, content: "test", tags: ["a"])`                             | Entry created — verify tag stored and retrievable via `list_tags` |
| Max limit on recent    | `get_recent_entries(project_number: 5, limit: 500)`                                         | Returns ≤ 500 entries                                             |
| Over max limit         | `get_recent_entries(project_number: 5, limit: 501)`                                         | Structured validation error (`limit: Too big`)                    |
| Limit = 1              | `get_recent_entries(project_number: 5, limit: 1)`                                           | Returns exactly 1 entry                                           |
| Search with max limit  | `search_entries(project_number: 5, query: "test", limit: 500)`                              | Returns ≤ 500 entries                                             |
| Date at epoch boundary | `search_by_date_range(project_number: 5, start_date: "1970-01-01", end_date: "1970-01-02")` | Returns 0 entries (no crash)                                      |
| Future date range      | `search_by_date_range(project_number: 5, start_date: "2099-01-01", end_date: "2099-12-31")` | Returns 0 entries (no crash, no false results)                    |

### 12.1.3 Tag Operations Integrity

| Test                           | Command/Action                                                                | Expected Result                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Merge consolidation count      | Create entries with `tag-a`, merge `tag-a → tag-b`, verify `entriesUpdated`   | `entriesUpdated` equals the number of entries that had `tag-a`                     |
| Source tag deleted after merge | `merge_tags(source_tag: "old", target_tag: "new")` then `list_tags`           | `"old"` no longer in tag list                                                      |
| Target tag has combined count  | After merge, `list_tags`                                                      | `"new"` count equals sum of old source + old target counts                         |
| Case normalization             | Create with tag `"CamelCase"`, verify with `get_entry_by_id`                  | Tag is automatically normalized to lowercase `"camelcase"`                         |
| Tag with spaces                | `create_entry(project_number: 5, content: "test", tags: ["tag with spaces"])` | Entry created and tag retrievable (spaces convert to hyphens: `"tag-with-spaces"`) |
| Duplicate tags in array        | `create_entry(project_number: 5, content: "test", tags: ["dup", "dup"])`      | Entry created — duplicates either deduplicated or stored as-is                     |

---

## Cleanup

After testing, permanently delete all entries created during Phase 12.1. Since no automated cleanup script exists, you MUST manually call `delete_entry(permanent: true)` via direct MCP tool calls for every entry ID generated during this test phase.

| Cleanup Step       | Command/Action                                                     |
| ------------------ | ------------------------------------------------------------------ |
| Purge test entries | Call `delete_entry(entry_id: N, permanent: true)` for all test IDs |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary.
- All field round-trips preserve data exactly (content, tags, PR fields, workflow fields, project number, is_personal)
- Unicode, multiline, HTML-like, and long content stored and retrieved correctly
- `update_entry` preserves unset fields (partial update semantics)
- Content length boundaries enforced (max ~50K accepted, >100K rejected)
- Limit boundaries enforced (1–500 accepted, 501 rejected, -1 rejected)
- Tag merge operations correctly consolidate counts and delete source
