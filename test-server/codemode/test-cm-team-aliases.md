# Re-Test memory-journal-mcp — Code Mode: Team Author Aliases

Test team author alias management tools and role-based access limits through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.17 — ~8 test cases covering team author alias operations via Code Mode.

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Code Mode is included in all tool filtering presets by default.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `test-server/tool-reference.md` and `test-server/scripts/tool-map.json` as sources of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 28: Team RBAC via Code Mode

### 28.17 Team Author Aliases

```javascript
// Test code:
const added = await mj.team.teamAddAuthorAlias({
  alias: 'cm_alias',
  canonical_author: 'cm_canon'
})

let duplicateCaught = false;
try {
  const dup = await mj.team.teamAddAuthorAlias({
    alias: 'cm_alias',
    canonical_author: 'cm_canon'
  })
  const __ = dup.alias
} catch (error) {
  duplicateCaught = true;
}

const resolveAlias = await mj.team.teamResolveAuthor({
  author: 'cm_alias'
})

const resolveUnknown = await mj.team.teamResolveAuthor({
  author: 'cm_unknown'
})

const listAliases = await mj.team.teamListAuthorAliases({})

const consolidated = await mj.team.teamConsolidateAuthors({
  canonical_author: 'cm_canon'
})

const removed = await mj.team.teamRemoveAuthorAlias({
  alias: 'cm_alias'
})

let notFoundCaught = false;
try {
  const nf = await mj.team.teamRemoveAuthorAlias({
    alias: 'cm_alias'
  })
  const __ = nf.alias
} catch (error) {
  notFoundCaught = true;
}

return {
  addSuccess: added.success,
  addedAlias: added.alias?.alias === 'cm_alias',
  duplicateCaught,
  resolveAliasSuccess: resolveAlias.is_aliased === true && resolveAlias.canonical_author === 'cm_canon',
  resolveUnknownSuccess: resolveUnknown.is_aliased === false && resolveUnknown.canonical_author === 'cm_unknown',
  listHasAlias: listAliases.aliases?.some(a => a.alias === 'cm_alias'),
  consolidateSuccess: consolidated.success,
  removeSuccess: removed.success,
  notFoundCaught
}
```

| Check             | Expected |
| ----------------- | -------- |
| `addSuccess`      | `true`   |
| `addedAlias`      | `true`   |
| `duplicateCaught` | `true`   |
| `resolveAliasSuccess` | `true`   |
| `resolveUnknownSuccess` | `true`   |
| `listHasAlias`    | `true`   |
| `consolidateSuccess` | `true`   |
| `removeSuccess`   | `true`   |
| `notFoundCaught`  | `true`   |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `mj.team.teamAddAuthorAlias` successfully adds an alias.
- `mj.team.teamAddAuthorAlias` rejects duplicate aliases by throwing an error.
- `mj.team.teamResolveAuthor` resolves a known alias.
- `mj.team.teamResolveAuthor` passes through an unknown author.
- `mj.team.teamListAuthorAliases` includes the newly added alias in the output array.
- `mj.team.teamConsolidateAuthors` successfully updates old entries.
- `mj.team.teamRemoveAuthorAlias` permanently deletes the alias from the database.
- `mj.team.teamRemoveAuthorAlias` rejects nonexistent aliases by throwing an error.
