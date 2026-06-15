# Re-Test memory-journal-mcp — Team Author Aliases (Phase 14.6)

**Scope:** 5 team author alias tools (`team_add_author_alias`, `team_list_author_aliases`, `team_resolve_author`, `team_remove_author_alias`, `team_consolidate_authors`).

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas (e.g., Team Tools, Admin Tools).
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests.
- Seed data from `test-seed.md` must be present.
- `TEAM_DB_PATH` configured. 
- You MUST ensure the server was booted with your author name registered as an admin (e.g. via `--team-admin`), otherwise member management tools will reject your requests with `PERMISSION_DENIED`.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. Then stop so the USER can verify.
3. Clean up any test artifacts generated.
4. Provide a very brief final summary including the **Total Token Estimate**.

---

## Phase 14.6: Team Author Aliases

| Test | Command/Action | Expected Result |
|---|---|---|
| Add Alias | `team_add_author_alias(alias: "cm_alias", canonical_author: "cm_canon")` | `success: true`, returns alias details |
| Add Duplicate | `team_add_author_alias(alias: "cm_alias", canonical_author: "cm_canon")` | Structured error: Alias already exists |
| Resolve Alias | `team_resolve_author(author: "cm_alias")` | Returns `is_aliased: true`, `canonical_author: "cm_canon"` |
| Resolve Unknown | `team_resolve_author(author: "cm_unknown")` | Returns `is_aliased: false`, `canonical_author: "cm_unknown"` |
| List Aliases | `team_list_author_aliases` | Array includes `cm_alias` mapped to `cm_canon` |
| Consolidate Authors | `team_consolidate_authors(canonical_author: "cm_canon")` | `success: true`, returns updated entry count |
| Remove Alias | `team_remove_author_alias(alias: "cm_alias")` | `success: true` |
| Remove Nonexistent | `team_remove_author_alias(alias: "cm_alias")` | Structured error: Resource not found |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- `team_add_author_alias` successfully adds an alias.
- `team_add_author_alias` rejects duplicate aliases with a structured error.
- `team_resolve_author` resolves a known alias to its canonical author.
- `team_resolve_author` passes through an unknown author unmodified.
- `team_list_author_aliases` includes the newly added alias in the output array.
- `team_consolidate_authors` successfully retroactively updates old entries.
- `team_remove_author_alias` permanently deletes the alias from the database.
- `team_remove_author_alias` returns a structured `RESOURCE_NOT_FOUND` error for nonexistent aliases.
