# Test memory-journal-mcp — Relationships & Visualization

**Scope:** Entry linking, causal relationship types, visualization (Mermaid), and graph resources.

**Prerequisites:** Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. User verifies: `npm run lint && npm run typecheck`, `npm run test`, `npm run test:e2e`.
4. Re-test fixes with direct MCP calls.
5. Brief final summary.

---

## Phase 4: Relationships & Visualization

### 4.1 Basic Relationships

| Test                    | Command/Action                                                                                                            | Expected Result                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Link entries            | `link_entries(from_entry_id: <A>, to_entry_id: <B>, relationship_type: "references")`                                     | Relationship created                                                                                      |
| Duplicate link          | Call `link_entries` again with same params                                                                                | Returns `duplicate: true`, `message`, existing relationship                                               |
| Link nonexistent source | `link_entries(from_entry_id: 999999, to_entry_id: <B>, ...)`                                                              | Returns `success: false`, message: `"One or both entries not found (from: 999999, to: <B>)"`              |
| Link nonexistent target | `link_entries(from_entry_id: <A>, to_entry_id: 999999, ...)`                                                              | Returns `success: false`, message: `"One or both entries not found (from: <A>, to: 999999)"`              |
| Visualize               | `visualize_relationships(entry_id: <A>)`                                                                                  | JSON object with `mermaid` string field containing diagram, `entry_count`, `relationship_count`, `legend` |
| Link with description   | `link_entries(from_entry_id: <A>, to_entry_id: <C>, relationship_type: "implements", description: "Implements the plan")` | Relationship created with `description` field                                                             |
| Reverse duplicate       | `link_entries(from_entry_id: <B>, to_entry_id: <A>, relationship_type: "references")`                                     | Succeeds — only same-direction duplicates are checked (confirmed)                                         |
| Visualize nonexistent   | `visualize_relationships(entry_id: 999999)`                                                                               | Returns `message: "Entry 999999 not found"`                                                               |
| Visualize by tags       | `visualize_relationships(tags: ["test"])`                                                                                 | Diagram scoped to entries with "test" tag                                                                 |
| Visualize depth 3       | `visualize_relationships(entry_id: <A>, depth: 3)`                                                                        | Deeper traversal than default `depth: 2`                                                                  |
| Visualize custom limit  | `visualize_relationships(entry_id: <A>, limit: 5)`                                                                        | Diagram limited to 5 entries                                                                              |
| Graph resource          | Read `memory://graph/recent`                                                                                              | Raw Mermaid text (`text/plain` MIME), arrows harmonized with `visualize_relationships`                    |

### 4.2 Causal Relationship Types

| Test              | Command/Action                                                                        | Expected Result                                                                       |
| ----------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| blocked_by type   | `link_entries(from_entry_id: <A>, to_entry_id: <B>, relationship_type: "blocked_by")` | Relationship created with `blocked_by` type                                           |
| resolved type     | `link_entries(from_entry_id: <A>, to_entry_id: <B>, relationship_type: "resolved")`   | Relationship created with `resolved` type                                             |
| caused type       | `link_entries(from_entry_id: <A>, to_entry_id: <B>, relationship_type: "caused")`     | Relationship created with `caused` type                                               |
| Causal viz arrows | `visualize_relationships(entry_id: <A>)`                                              | Mermaid shows `--x` (blocked_by), `==>` (resolved), `-.->` (caused) arrows            |
| Graph harmonized  | Read `memory://graph/recent`                                                          | Raw Mermaid `text/plain`: `--x`, `==>`, `-.->` for causal types, `-->` for references |

---

## Success Criteria

- [ ] Causal relationship types (`blocked_by`, `resolved`, `caused`) create correctly
- [ ] `link_entries` returns `success: false` for nonexistent entry IDs
- [ ] `visualize_relationships` shows distinct arrows for causal types
- [ ] `memory://graph/recent` uses harmonized arrows matching `visualize_relationships`
