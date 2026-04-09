# Test memory-journal-mcp — Data Integrity & Boundary Testing

**Scope:** Data round-trip fidelity, boundary value behavior, Unicode handling, concurrent-like operations, and implementation bug detection.

**Execution Strategy:** **Use direct MCP tools, NOT Code Mode or scripts!** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.

**Prerequisites:** Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. **USER** will verify with `npm run lint && npm run typecheck`, `npm run test`, `npm run test:e2e`.
4. Re-test fixes with direct MCP calls.
5. Brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the **total estimated tokens that ACTUALLY entered the context window during this test pass.**

---

## Phase 12: Data Integrity Verification

### 12.1 Round-Trip Fidelity

Create entries with specific data, then read them back to verify nothing is lost or mutated.

| Test                   | Create Action                                                                                                                                                                                                                     | Read-Back Verification                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| All fields persist     | `create_entry(content: "RT1", entry_type: "technical_note", tags: ["rt-test"], pr_number: 42, pr_status: "open", workflow_run_id: 100, workflow_name: "CI", workflow_status: "completed", project_number: 5, is_personal: false)` | `get_entry_by_id` — verify every field matches exactly                        |
| Unicode content        | `create_entry(content: "日本語テスト 🎉 Ñoño — em dash")`                                                                                                                                                                         | `get_entry_by_id` — verify content is byte-identical                          |
| Long content           | `create_entry(content: <10,000+ char string>)`                                                                                                                                                                                    | `get_entry_by_id` — verify content length matches                             |
| Multiline content      | `create_entry(content: "Line 1\nLine 2\nLine 3")`                                                                                                                                                                                 | `get_entry_by_id` — verify newlines preserved                                 |
| HTML-like content      | `create_entry(content: "<script>alert('xss')</script>")`                                                                                                                                                                          | `get_entry_by_id` — content stored as-is (no sanitization of journal content) |
| Update preserves unset | `create_entry(content: "Original", tags: ["a","b"])` then `update_entry(entry_id: N, content: "Updated")`                                                                                                                         | `get_entry_by_id` — tags still `["a","b"]`, only content changed              |

### 12.2 Boundary Values

| Test                   | Command/Action                                                           | Expected Result                                                   |
| ---------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Max content length     | `create_entry(content: <50,000 chars>)`                                  | Entry created successfully                                        |
| Content above max      | `create_entry(content: <100,001 chars>)`                                 | Structured validation error (exceeds `MAX_CONTENT_LENGTH`)        |
| Empty tags array       | `create_entry(content: "test", tags: [])`                                | Entry created with empty tags                                     |
| Single-char tag        | `create_entry(content: "test", tags: ["a"])`                             | Entry created — verify tag stored and retrievable via `list_tags` |
| Max limit on recent    | `get_recent_entries(limit: 500)`                                         | Returns ≤ 500 entries                                             |
| Over max limit         | `get_recent_entries(limit: 501)`                                         | Structured validation error                                       |
| Limit = 1              | `get_recent_entries(limit: 1)`                                           | Returns exactly 1 entry                                           |
| Search with max limit  | `search_entries(query: "test", limit: 500)`                              | Returns ≤ 500 entries                                             |
| Date at epoch boundary | `search_by_date_range(start_date: "1970-01-01", end_date: "1970-01-02")` | Returns 0 entries (no crash)                                      |
| Future date range      | `search_by_date_range(start_date: "2099-01-01", end_date: "2099-12-31")` | Returns 0 entries (no crash, no false results)                    |

### 12.3 Tag Operations Integrity

| Test                           | Command/Action                                                              | Expected Result                                                |
| ------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Merge consolidation count      | Create entries with `tag-a`, merge `tag-a → tag-b`, verify `entriesUpdated` | `entriesUpdated` equals the number of entries that had `tag-a` |
| Source tag deleted after merge | `merge_tags(source_tag: "old", target_tag: "new")` then `list_tags`         | `"old"` no longer in tag list                                  |
| Target tag has combined count  | After merge, `list_tags`                                                    | `"new"` count equals sum of old source + old target counts     |
| Case sensitivity               | Create with tag `"CamelCase"`, search with `tags: ["CamelCase"]`            | Returns the entry — tags are case-sensitive                    |
| Tag with spaces                | `create_entry(content: "test", tags: ["tag with spaces"])`                  | Entry created and tag retrievable                              |
| Duplicate tags in array        | `create_entry(content: "test", tags: ["dup", "dup"])`                       | Entry created — duplicates either deduplicated or stored as-is |

### 12.4 Relationship Integrity

| Test                        | Command/Action                                                                              | Expected Result                                         |
| --------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Link persists after re-read | `link_entries(from: A, to: B, type: "references")` then `get_entry_by_id(A)`                | Relationships array includes the link                   |
| Duplicate link detection    | Link A→B twice with same type                                                               | Second call returns `duplicate: true`                   |
| Reverse link allowed        | Link B→A after A→B exists                                                                   | Succeeds — reverse direction is a separate relationship |
| Link to soft-deleted entry  | Soft-delete B, then `link_entries(from: A, to: B)`                                          | Structured error — target entry not found or hidden     |
| All relationship types      | Create links with each type: `references`, `implements`, `blocked_by`, `resolved`, `caused` | All succeed                                             |

### 12.5 Search Isolation After Delete

| Test                       | Command/Action                                                                 | Expected Result                                     |
| -------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| FTS5 isolation             | Create entry with unique term, delete it (soft), search for term               | Deleted entry does NOT appear in results            |
| Semantic isolation         | Create entry, add to vector index, soft-delete, then `semantic_search`         | Deleted entry does NOT appear in semantic results   |
| Date range isolation       | Create entry in known date, soft-delete, then `search_by_date_range` over date | Deleted entry does NOT appear in date range results |
| Permanent delete isolation | Create entry, permanently delete, then search                                  | Entry completely absent from all search methods     |

### 12.6 Filter Enforcement (Implementation Bug Detection)

> [!CAUTION]
> These tests detect **silent filter ignored** bugs — where a handler accepts filter params but ignores them.

| Test                                 | Command/Action                                                              | Expected Result                                                         |
| ------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `get_statistics` date filter         | `get_statistics(start_date: "2099-01-01", end_date: "2099-12-31")`          | ⚠️ Should return 0 entries. If returns all, handler ignores date filter |
| `export_entries` tag filter          | `export_entries(format: "json", tags: ["nonexistent-tag-xyz"], limit: 100)` | Should return 0 entries. If returns all, filter is ignored              |
| `export_entries` date filter         | `export_entries(format: "json", start_date: "2099-01-01", limit: 100)`      | Should return 0 entries. If returns all, date filter is ignored         |
| `search_by_date_range` with filters  | `search_by_date_range(..., entry_type: "nonexistent_type")`                 | Should return 0 entries — type filter respected                         |
| `get_recent_entries` personal filter | `get_recent_entries(limit: 100, is_personal: true)` vs `is_personal: false` | Results should be mutually exclusive                                    |

---

## Cleanup

After testing, permanently delete all entries created during Phase 12:

| Cleanup Step                 | Command/Action                                                        |
| ---------------------------- | --------------------------------------------------------------------- |
| Delete RT entries            | `delete_entry(entry_id: <RT_ids>, permanent: true)` for each RT entry |
| Delete boundary test entries | `delete_entry(entry_id: <boundary_ids>, permanent: true)`             |
| Delete merge test tags       | Clean up via `merge_tags` or delete associated entries                |

---

## Success Criteria

- [ ] All field round-trips preserve data exactly (content, tags, PR fields, workflow fields, project number, is_personal)
- [ ] Unicode, multiline, HTML-like, and long content stored and retrieved correctly
- [ ] `update_entry` preserves unset fields (partial update semantics)
- [ ] Content length boundaries enforced (max ~50K accepted, >100K rejected)
- [ ] Limit boundaries enforced (1–500 accepted, 501 rejected, -1 rejected)
- [ ] Tag merge operations correctly consolidate counts and delete source
- [ ] Soft-deleted entries excluded from FTS5, semantic, and date range search results
- [ ] Permanently deleted entries completely absent from all search methods
- [ ] Filter enforcement validated — no silent filter ignored bugs
- [ ] All relationship types persist and are queryable
