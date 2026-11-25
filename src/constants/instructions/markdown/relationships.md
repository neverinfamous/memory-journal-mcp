# Relationships Operations
- **Linking**: Connect entries with canonical types (`resolved`, `caused`, `blocked_by`, `evolves_from`, `implements`, `clarifies`, `response_to`, `references`). Causal types (`resolved`, `caused`, `blocked_by`) contribute 20% of the entry importance score; never use `'caused_by'` (invert source/target or use `'resolved'`/`'evolves_from'`).
- **Parameters & Constraints**: Pass a concrete `workspace_id` on `link_entries` (`workspace_id: "*"` is rejected on writes). Relationship links are directed from `from_entry_id` to `to_entry_id`.
- **Visualization**: Use `visualize_relationships({ entry_id, tags, depth, include_content, format, source })` (`include_content: false` default uses 120-char previews; `format: 'mermaid' | 'edges' | 'both'`; `source: 'team'` delegates with Team RBAC, and Code Mode `mj.relationships.visualizeRelationships` auto-routes missing personal roots silently with `_healed: { routedTo: 'team' }`). For a compact markdown edge list of the last 14 days, node degrees, and unlinked recent IDs without full entry bodies, read `memory://graph/{+repo}` (or `memory://graph`).

## Available Tools

- **Linking**: `link_entries`
- **Visualization**: `visualize_relationships`
