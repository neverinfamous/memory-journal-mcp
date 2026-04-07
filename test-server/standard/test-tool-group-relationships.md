# Test memory-journal-mcp — Relationships Tool Group

**Scope:** Deterministic verification of the Relationships tool group (`link_entries`, `visualize_relationships`, `get_related_entries`) against the strict error handling matrix.

**Execution Strategy:** The agent is to use direct MCP tools whenever possible rather than Code Mode or scripts. Code Mode is preferred to scripts.

**Prerequisites:**

- Seed data active.

## 1. Automated Verification

The verification for the Relationships tool group has been fully automated and verified. 

Please run the provided integration test script:
```powershell
npx tsx test-server/scripts/test-relationships.ts
```

This script will verify:
- Domain Error tests (invalid relationship types, nonexistent IDs)
- Duplicate Links and Reverse Links
- Zod Empty Parameters and Type Mismatches
- Visualization bounds and deeply nested relationships

## Success Criteria

- [x] Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses).
- [x] `link_entries` correctly mitigates bad inputs.
- [x] `visualize_relationships` correctly bounds the depth parameter.
- [x] No raw `-32602` responses.
