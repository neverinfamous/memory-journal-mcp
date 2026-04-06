# Test memory-journal-mcp — Relationships Tool Group

**Scope:** Deterministic verification of the Relationships tool group (`link_entries`, `visualize_relationships`, `get_related_entries`) against the strict error handling matrix.

**Prerequisites:** 
- Seed data active.

## 1. Structured Error Matrix

| Tool | Happy Path | Domain Error Test | Zod Empty Param (`{}`) | Zod Type Mismatch |
|---|---|---|---|---|
| `link_entries` | Link A to B | `relationship_type: "invalid"` | ⚠️ Should return validation error | `from_entry_id: "abc"` |
| `visualize_relationships` | Visualize | Nonexistent entry ID | ⚠️ Should return validation error | `depth: "abc"` |

### Specific Domain Checks

- **Duplicate Links**: Creating the link `A -> B` twice must return `duplicate: true`.
- **Reverse Links**: Creating `A -> B` then `B -> A`. Document if this correctly forms two links without throwing an exception.

## 2. Integrity & Boundary Testing

| Test | Action | Verification |
|---|---|---|
| Visualize Depth Traverse | `visualize_relationships(entry_id, depth: 1)` | Returns only direct relationships. |
| Visualize Depth Limit | `visualize_relationships(entry_id, depth: 3)` | Returns full deep traversal up to edge boundary. |
| Backup Survival | Restore after backing up links. | Relationships survive. |

## Success Criteria
- [ ] Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses).
- [ ] `link_entries` correctly mitigates bad inputs.
- [ ] `visualize_relationships` correctly bounds the depth parameter.
- [ ] No raw `-32602` responses.
