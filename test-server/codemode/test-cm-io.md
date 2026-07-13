# Re-Test memory-journal-mcp — Code Mode: IO & Markdown Interoperability

Test the unified IO namespace, testing both legacy `exportEntries` formats and the new filesystem-bound `.md` orchestration tools over Code Mode's `mj.io.*` binding.

**Scope:** 4 tools (`export_entries`, `export_markdown`, `import_markdown`, `import_external` inside Code Mode namespace `mj.io.*`), Phase 26 — covering IO and markdown interop.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Ensure `ALLOWED_IO_ROOTS` is configured in the environment to permit access to the mock directory.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Clean up any leftover test artifacts created during the run (e.g., exported `.md` files in `cm_test_export` folder) using the `run_command` tool.
6. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 26: IO & Interoperability via Code Mode

### 26.1 Legacy Export

```javascript
// Test code:
const jsonExport = await mj.io.exportEntries({ format: 'json', limit: 5 })
const mdExport = await mj.io.exportEntries({ format: 'markdown', limit: 5 })
const tagExport = await mj.io.exportEntries({
  format: 'json',
  tags: ['architecture'],
  limit: 10,
})

return {
  jsonHasEntries: Array.isArray(jsonExport.entries),
  jsonCount: jsonExport.entries?.length ?? 0,
  jsonTruncatedFlag:
    typeof jsonExport.truncated === 'boolean' || jsonExport.truncated === undefined,
  mdHasContent: typeof mdExport.content === 'string',
  tagFiltered:
    tagExport.entries?.every(
      (e) => e.tags?.includes('architecture') || e.tags?.some((t) => t === 'architecture')
    ) ?? false,
}
```

| Check               | Expected                                      |
| ------------------- | --------------------------------------------- |
| `jsonHasEntries`    | `true`                                        |
| `jsonTruncatedFlag` | `true`                                        |
| `mdHasContent`      | `true`                                        |
| `tagFiltered`       | `true` (only entries with "architecture" tag) |

### 26.2 Markdown File Orchestration

```javascript
// Test code:
const MOCK_DIR = 'c:/Users/chris/Desktop/memory-journal-mcp/test-server/codemode/cm_test_export'

// Export 5 entries to temporary directory
const exportResult = await mj.io.exportMarkdown({
  output_dir: MOCK_DIR,
  limit: 5,
})

// Run dry-run import on the sandbox folder
const importResult = await mj.io.importMarkdown({
  source_dir: MOCK_DIR,
  dry_run: true,
})

// Path Traversal Security
const traversal = await mj.io.exportMarkdown({
  output_dir: '../../../etc/shadow',
  limit: 1,
})

return {
  exportSuccess: exportResult.success,
  exportedCount: exportResult.exported_count ?? 0,
  validDir: exportResult.output_dir?.replace(/\\/g, '/') === MOCK_DIR,
  dryRunSuccess: importResult.success,
  isDryRun: importResult.dry_run === true,
  simulatedUpdates: typeof importResult.updated === 'number',
  traversalBlocked: traversal.success === false,
}
```

| Check              | Expected |
| ------------------ | -------- |
| `exportSuccess`    | `true`   |
| `exportedCount`    | `> 0`    |
| `validDir`         | `true`   |
| `dryRunSuccess`    | `true`   |
| `isDryRun`         | `true`   |
| `simulatedUpdates` | `true`   |
| `traversalBlocked` | `true`   |

### 26.3 External Imports (`importExternal`)

```javascript
// Test code:
const MOCK_DIR = 'c:/Users/chris/Desktop/memory-journal-mcp/test-server/codemode/cm_test_export'

// Note: Test depends on some files existing in the mock dir
const externalResult = await mj.io.importExternal({
  source_dir: MOCK_DIR,
  source_format: 'notion',
  dry_run: true,
})

return {
  externalSuccess: externalResult.success,
  isDryRun: externalResult.dry_run === true,
  simulatedCreated: typeof externalResult.created === 'number',
}
```

| Check              | Expected |
| ------------------ | -------- |
| `externalSuccess`  | `true`   |
| `isDryRun`         | `true`   |
| `simulatedCreated` | `true`   |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `mj.io.exportEntries` handles the JSON size boundary efficiently without sandbox memory crashes.
- `mj.io.exportMarkdown` securely sanitizes output paths and rejects `../` traversal attempts.
- `mj.io.importMarkdown` successfully identifies `.md` files and provides simulated dry-run statistics.
- `mj.io.importExternal` gracefully parses external `.md` files with dry-run support.
- `exportMarkdown` cleanly halts and throws structured errors attempting dir traversal or lacking `ALLOWED_IO_ROOTS` permission.
