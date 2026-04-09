# Test memory-journal-mcp — Code Mode: IO & Markdown Interoperability

Test the unified IO namespace, testing both legacy `exportEntries` formats and the new filesystem-bound `.md` orchestration tools over Code Mode's `mj.io.*` binding.

**Scope:** 4 tools (`export_entries`, `export_markdown`, `import_markdown` inside Code Mode namespace `mj.io.*`).

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. Use `code-map.md` as a source of truth.
3. After implementation, update `UNRELEASED.md` and commit without pushing. Then, stop so the **USER** can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total tokens used by this test pass.

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
  mdHasContent: typeof mdExport.content === 'string',
  tagFiltered:
    tagExport.entries?.every(
      (e) => e.tags?.includes('architecture') || e.tags?.some((t) => t === 'architecture')
    ) ?? false,
}
```

| Check            | Expected                                      |
| ---------------- | --------------------------------------------- |
| `jsonHasEntries` | `true`                                        |
| `mdHasContent`   | `true`                                        |
| `tagFiltered`    | `true` (only entries with "architecture" tag) |

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
  validDir: exportResult.output_dir === MOCK_DIR,
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

---

## Success Criteria

- [ ] `mj.io.exportEntries` provides JSON lists and raw markdown contents.
- [ ] `mj.io.exportMarkdown` dumps files to target directory safely via sandbox mapping.
- [ ] `mj.io.importMarkdown` successfully executes a simulation dry run using sandbox paths.
- [ ] `exportMarkdown` cleanly halts and throws structured errors attempting dir traversal.
