# Re-Test memory-journal-mcp — Code Mode: Error Matrix & Zod Sweeps

Systematic verification of structured error handling across all `mj.*` API groups via the Code Mode sandbox. Validates that `{}` empty params, type mismatches, and domain errors all return structured `{success: false}` responses — never raw MCP exceptions.

**Scope:** 1 tool (`mj_execute_code`), Phase 29 — consolidated Zod sweep and type mismatch tests across all 10 API groups.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 29B (Part 2): Error Matrix via Code Mode (Continued)

### 29.5 Backup Group — Empty Params & Security

```javascript
// Test code:
const backupEmpty = await mj.backup.backupJournal({})
const listEmpty = await mj.backup.listBackups({})
const restoreEmpty = await mj.backup.restoreBackup({})
const cleanupEmpty = await mj.backup.cleanupBackups({})

// Security
const backupTraversal = await mj.backup.backupJournal({ name: '../../etc/passwd' })
const restoreBadFile = await mj.backup.restoreBackup({ filename: 'nonexistent.db', confirm: true })
const cleanupZero = await mj.backup.cleanupBackups({ keep_count: 0 })

return {
  backupEmptyOk: backupEmpty.success === true,
  listEmptyOk: listEmpty.backups !== undefined || listEmpty.total !== undefined,
  restoreEmptyError: restoreEmpty.success === false,
  cleanupEmptyOk: cleanupEmpty.success === true || cleanupEmpty.success === false,
  traversalBlocked: backupTraversal.success === false,
  restoreBadFileError: restoreBadFile.success === false,
  cleanupZeroError: cleanupZero.success === false,
}
```

| Check                 | Expected                         |
| --------------------- | -------------------------------- |
| `backupEmptyOk`       | `true` (auto-names backup)       |
| `restoreEmptyError`   | `true` (filename required)       |
| `traversalBlocked`    | `true` (path traversal rejected) |
| `restoreBadFileError` | `true` (file not found)          |
| `cleanupZeroError`    | `true` (keep_count min 1)        |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- All 10 `mj.*` API groups tested with `{}` empty params
- Type mismatches (string where number, number where string) return structured errors
- Domain errors (nonexistent IDs, same-tag merge, 404s) return `{success: false}`
- Security boundaries (path traversal, limit overflow) enforced
- No sandbox crashes, no raw MCP exceptions leaked through Code Mode
- All results map to compact summaries (no large payload inflation)

