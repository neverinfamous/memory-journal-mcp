# Re-Test memory-journal-mcp — Workspace Isolation

**Scope:** Verify strict data isolation between multiple workspaces using the `workspace_id` parameter across CRUD, Search, and Analytics.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls to ensure tests hit the test database instead of production.
- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing.
4. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify with `pnpm run check` yourself—you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 17: Workspace Isolation

### 17.1 Workspace Initialization

| Test | Command/Action | Expected Result |
| --- | --- | --- |
| Create in Alpha | `create_entry(workspace_id: "alpha", content: "Initial research on neural networks for NLP.")` | `success: true`, entry created with `workspaceId: "alpha"` |
| Create in Beta | `create_entry(workspace_id: "beta", content: "Quarterly financial projections for Q3.")` | `success: true`, entry created with `workspaceId: "beta"` |

### 17.2 Recent Entries Isolation

| Test | Command/Action | Expected Result |
| --- | --- | --- |
| Alpha recent | `get_recent_entries(workspace_id: "alpha", limit: 5)` | Returns only the NLP research entry |
| Beta recent | `get_recent_entries(workspace_id: "beta", limit: 5)` | Returns only the financial projections entry |

### 17.3 Search Isolation

| Test | Command/Action | Expected Result |
| --- | --- | --- |
| Alpha search | `search_entries(workspace_id: "alpha", query: "research")` | Returns the alpha NLP entry |
| Beta search | `search_entries(workspace_id: "beta", query: "research")` | Returns 0 entries |

### 17.4 Date Range Isolation

| Test | Command/Action | Expected Result |
| --- | --- | --- |
| Alpha date range | `search_by_date_range(workspace_id: "alpha", start_date: "2020-01-01", end_date: "2030-01-01")` | Returns only the alpha entry |
| Beta date range | `search_by_date_range(workspace_id: "beta", start_date: "2020-01-01", end_date: "2030-01-01")` | Returns only the beta entry |

### 17.5 Statistics Isolation

| Test | Command/Action | Expected Result |
| --- | --- | --- |
| Alpha stats | `get_statistics(workspace_id: "alpha")` | Total entries count correctly scoped to alpha |
| Beta stats | `get_statistics(workspace_id: "beta")` | Total entries count correctly scoped to beta |

### 17.6 Cross-Workspace Isolation

| Test | Command/Action | Expected Result |
| --- | --- | --- |
| Default search | `search_entries(query: "research")` | Returns 0 entries (unless default workspace contains "research") |

### 17.7 Team Database Isolation

| Test | Command/Action | Expected Result |
| --- | --- | --- |
| Team create | `team_create_entry(workspace_id: "alpha", content: "Team alpha plan", project_number: 5)` | Entry created in alpha team DB |
| Team search | `team_search(workspace_id: "beta", query: "alpha")` | Returns 0 entries |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary.
- Entries created in "alpha" are strictly isolated from "beta".
- `get_recent_entries`, `search_entries`, `search_by_date_range`, and `get_statistics` respect `workspace_id`.
- Team DB tools also enforce `workspace_id` isolation.
