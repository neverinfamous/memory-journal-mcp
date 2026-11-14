# Relationships Operations
- **Linking**: Connect entries with canonical types (`resolved`, `caused`, `blocked_by`, `evolves_from`, `implements`, `clarifies`, `response_to`, `references`). Causal types (`resolved`, `caused`, `blocked_by`) contribute 20% of the entry importance score; never use `'caused_by'` (invert source/target or use `'resolved'`/`'evolves_from'`).
- **Parameters & Constraints**: Pass a concrete `workspace_id` on `link_entries` (`workspace_id: "*"` is rejected on writes). `bidirectional: true` is valid ONLY with `relationship_type: "references"`.
- **Visualization**: Use `visualize_relationships({ entry_id, tag, depth, format })` (Mermaid graph or JSON) to expand context hubs around top search hits.

## Available Tools

- **Linking**: `link_entries`
- **Visualization**: `visualize_relationships`
