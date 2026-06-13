# Re-Test memory-journal-mcp — Code Mode: Team Author Aliases

Test team author alias management tools and role-based access limits through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.17 — ~8 test cases covering team author alias operations via Code Mode.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- You MUST ensure `CODEMODE_INTERNAL_FULL_ACCESS: "true"` is set in your environment/config OR your user is already bootstrapped as an admin. Otherwise, Code Mode scripts will receive `PERMISSION_DENIED` errors when trying to manage aliases.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. Then stop so the USER can verify.
3. Clean up any test artifacts generated.
4. Provide a very brief final summary including the **Total Token Estimate**.

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
