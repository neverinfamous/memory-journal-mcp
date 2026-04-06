# Test memory-journal-mcp — Admin Tool Group

**Scope:** Deterministic verification of Admin operations (`update_entry`, `delete_entry`, `merge_tags`, `list_tags`, `add_to_vector_index`, `rebuild_vector_index`) against strict error handling constraints.

## 1. Structured Error Matrix

| Tool | Happy Path | Domain Error Test | Zod Empty Param (`{}`) | Zod Type Mismatch |
|---|---|---|---|---|
| `update_entry` | Valid update | `entry_id: 999999` (not found) | ⚠️ Should return validation error | `entry_id: "abc"` |
| `delete_entry` | Soft delete | `entry_id: 999999` (not found) | ⚠️ Should return validation error | `entry_id: "abc"` |
| `merge_tags` | Merge valid tags | `source_tag: "nonexistent", target_tag: "abc"` | ⚠️ Should return validation error | `source_tag: 123` |
| `add_to_vector_index`| Add valid | `entry_id: 999999` | ⚠️ Should return validation error | `entry_id: "abc"` |

### Specific Domain Checks

- **Same-Tag Merging**: Ensure `merge_tags` where `source_tag` == `target_tag` returns a structured error.
- **Unavailable Vector**: Triggering `add_to_vector_index` without an initialized vector db should gracefully reject with `{success: false}`.

## 2. Integrity & Boundary Testing

| Test | Action | Verification |
|---|---|---|
| Merge Integrity | `merge_tags` | Ensure source tag is deleted and target tag count equals original sums. |
| Soft Delete Integrity | `delete_entry` | Entry hidden from standard views. |

## Success Criteria
- [ ] Administrative mutations correctly block non-existent targets.
- [ ] Vector integrations fallback safely without MCP crashes.
