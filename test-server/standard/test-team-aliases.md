# Re-Test memory-journal-mcp — Team Author Aliases (Phase 14.6)

**Scope:** 5 team author alias tools (`team_add_author_alias`, `team_list_author_aliases`, `team_resolve_author`, `team_remove_author_alias`, `team_consolidate_authors`).

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
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
