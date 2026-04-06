# Test memory-journal-mcp — Team Tool Group

**Scope:** Deterministic verification of Team tools (`team_create_entry`, `team_search`, etc.) against strict error handling constraints.

## 1. Structured Error Matrix

| Tool | Domain Error Test | Zod Empty Param (`{}`) | Zod Type Mismatch |
|---|---|---|---|
| All Team Tools | Team DB not configured -> Returns `{success: false}` | N/A | N/A |
| `team_create_entry` | `entry_type: "invalid"` | ⚠️ Should return validation error | `content: 123` |
| `team_update_entry` | `entry_id: 999999` | ⚠️ Should return validation error | `entry_id: "abc"` |
| `team_search_by_date_range`| `start_date: "Jan 1"` | ⚠️ Should return validation error | `limit: "abc"` |
| `team_merge_tags` | `source_tag: "x"; target_tag: "x"` | ⚠️ Should return validation error | N/A |

### Specific Domain Checks

- **Unavailable Team Vector**: Use `team_semantic_search` without vector initialization -> verify structured JSON error.
- **Team Insights**: Verify `team_get_cross_project_insights` returns the requisite fields even when the query returns absolutely zero rows.

## Success Criteria
- [ ] Team Database missing context natively halts and warns user without crashing the MCP worker.
- [ ] Missing models do not crash vector fallback pipelines.
