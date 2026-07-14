# Re-Test memory-journal-mcp — Code Mode: Error Matrix & Zod Sweeps

Systematic verification of structured error handling across all `mj.*` API groups via the Code Mode sandbox. Validates that `{}` empty params, type mismatches, and domain errors all return structured `{success: false}` responses — never raw MCP exceptions.

**Scope:** 1 tool (`mj_execute_code`), Phase 29 — consolidated Zod sweep and type mismatch tests across all 10 API groups.

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
   - DO NOT perform live server verification. DO NOT wait for a server restart. DO NOT pause or send a message asking the user to refresh the server.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 29B: Error Matrix via Code Mode (Continued)

### 29.3 Admin Group — Empty Params & Domain Errors

```javascript
// Test code:
const updateEmpty = await mj.admin.updateEntry({})
const deleteEmpty = await mj.admin.deleteEntry({})
const mergeEmpty = await mj.admin.mergeTags({})
const addVecEmpty = await mj.admin.addToVectorIndex({})
const rebuildEmpty = await mj.admin.rebuildVectorIndex({})
const auditEmpty = await mj.admin.searchAuditLog({})

// Domain errors
const updateBadId = await mj.admin.updateEntry({ id: 999999, content: 'fail' })
const deleteBadId = await mj.admin.deleteEntry({ id: 999999 })
const mergeSame = await mj.admin.mergeTags({ source_tag: 'same', target_tag: 'same' })
const addVecBadId = await mj.admin.addToVectorIndex({ id: 999999 })

// Type mismatches
const updateStrId = await mj.admin.updateEntry({ id: 'abc', content: 'fail' })
const deleteStrId = await mj.admin.deleteEntry({ id: 'abc' })
const auditLimitStr = await mj.admin.searchAuditLog({ limit: 'abc' })
const auditLimitNeg = await mj.admin.searchAuditLog({ limit: -1 })

return {
  updateEmptyError: updateEmpty.success === false,
  deleteEmptyError: deleteEmpty.success === false,
  mergeEmptyError: mergeEmpty.success === false,
  addVecEmptyError: addVecEmpty.success === false,
  rebuildOk: rebuildEmpty.success === true,
  updateBadIdError: updateBadId.success === false,
  deleteBadIdError: deleteBadId.success === false,
  mergeSameError: mergeSame.success === false,
  addVecBadIdError: addVecBadId.success === false,
  updateStrIdError: updateStrId.success === false,
  deleteStrIdError: deleteStrId.success === false,
  auditEmptyOk: Array.isArray(auditEmpty.results) || auditEmpty.success === false,
  auditLimitStrError: auditLimitStr.success === false,
  auditLimitNegError: auditLimitNeg.success === false,
}
```

| Check              | Expected                                |
| ------------------ | --------------------------------------- |
| `updateEmptyError` | `true` (id required)              |
| `deleteEmptyError` | `true` (id required)              |
| `mergeEmptyError`  | `true` (source_tag/target_tag required) |
| `addVecEmptyError` | `true` (id required)              |
| `rebuildOk`        | `true` (no required params)             |
| `mergeSameError`   | `true` (same tag blocked)               |
| `updateStrIdError` | `true` (id must be number)        |
| `auditEmptyOk`     | `true` (no required params)             |
| `auditLimitStrError`| `true` (limit must be number)          |
| `auditLimitNegError`| `true` (limit min 1)                   |

### 29.4 Relationships Group — Empty Params & Errors

```javascript
// Test code:
const linkEmpty = await mj.relationships.linkEntries({})
const vizEmpty = await mj.relationships.visualizeRelationships({})

const linkBadSource = await mj.relationships.linkEntries({
  from_entry_id: 999999,
  to_entry_id: 1,
  relationship_type: 'references',
})
const linkBadTarget = await mj.relationships.linkEntries({
  from_entry_id: 1,
  to_entry_id: 999999,
  relationship_type: 'references',
})
const linkBadType = await mj.relationships.linkEntries({
  from_entry_id: 1,
  to_entry_id: 2,
  relationship_type: 'invalid_type',
})

return {
  linkEmptyError: linkEmpty.success === false,
  vizEmptyHandled: typeof vizEmpty.mermaid === 'string' || vizEmpty.success === false,
  linkBadSourceError: linkBadSource.success === false,
  linkBadTargetError: linkBadTarget.success === false,
  linkBadTypeError: linkBadType.success === false,
}
```

| Check                | Expected                           |
| -------------------- | ---------------------------------- |
| `linkEmptyError`     | `true` (from/to id required) |
| `linkBadSourceError` | `true` (source entry not found)    |
| `linkBadTargetError` | `true` (target entry not found)    |
| `linkBadTypeError`   | `true` (invalid relationship type) |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.
- See part 2 for remaining success criteria.
