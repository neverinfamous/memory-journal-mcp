# Re-Test memory-journal-mcp — Code Mode: Error Matrix & Zod Sweeps (Part 2)

Systematic verification of structured error handling across remaining API groups.

**Scope:** 1 tool (mj_execute_code), Phase 29B.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found.
2. Use code-map.md as a source of truth.
3. If you made code changes/fixes, update UNRELEASED.md and commit.
4. Re-test fixes with direct MCP calls.
5. Provide a very brief final summary.

---

## Phase 29B: Error Matrix via Code Mode (Continued)

### 29.6 GitHub Group — Empty Params & Not-Found

```javascript
// Test code (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
const issuesEmpty = await mj.github.getGithubIssues({})
const prsEmpty = await mj.github.getGithubPrs({})
const contextEmpty = await mj.github.getGithubContext({})
const milestonesEmpty = await mj.github.getGithubMilestones({})
const insightsEmpty = await mj.github.getRepoInsights({})

const issueBadNum = await mj.github.getGithubIssue({ issue_number: 999999 })
const prBadNum = await mj.github.getGithubPr({ pr_number: 999999 })
const msBadNum = await mj.github.getGithubMilestone({ milestone_number: 999999 })
const kanbanBadNum = await mj.github.getKanbanBoard({ workspace_id: 99999 })

const issueEmpty = await mj.github.getGithubIssue({})
const prEmpty = await mj.github.getGithubPr({})

return {
  issuesOk: Array.isArray(issuesEmpty.issues),
  prsOk: Array.isArray(prsEmpty.pullRequests),
  contextOk: !!contextEmpty.repoName,
  milestonesOk: Array.isArray(milestonesEmpty.milestones),
  insightsOk: typeof insightsEmpty.stars === 'number',
  issueBadNumError: !!issueBadNum.error,
  prBadNumError: !!prBadNum.error,
  msBadNumError: !!msBadNum.error,
  kanbanBadNumError: !!kanbanBadNum.error,
  issueEmptyError: !!issueEmpty.error || issueEmpty.success === false,
  prEmptyError: !!prEmpty.error || prEmpty.success === false,
}
```

| Check              | Expected                         |
| ------------------ | -------------------------------- |
| `issuesOk`         | `true` (defaults to open issues) |
| `contextOk`        | `true` (auto-detects repo)       |
| `issueBadNumError` | `true` (404 structured error)    |
| `prBadNumError`    | `true` (404 structured error)    |
| `issueEmptyError`  | `true` (issue_number required)   |



### 29.8 IO Group — Empty Params & Security

```javascript
// Test code:
const exportEmpty = await mj.io.exportEntries({})
const exportMdEmpty = await mj.io.exportMarkdown({})
const importMdEmpty = await mj.io.importMarkdown({})

// Type mismatches
const exportBadFormat = await mj.io.exportEntries({ format: 'xml' })
const exportLimitStr = await mj.io.exportEntries({ format: 'json', limit: 'abc' })

return {
  exportEmptyOk:
    exportEmpty.success !== undefined ||
    exportEmpty.entries !== undefined ||
    exportEmpty.content !== undefined,
  exportMdEmptyError: exportMdEmpty.success === false,
  importMdEmptyError: importMdEmpty.success === false,
  exportBadFormatHandled:
    exportBadFormat.success === false || typeof exportBadFormat.content === 'string',
  exportLimitStrHandled: exportLimitStr.success === false || exportLimitStr.entries !== undefined,
}
```

| Check                | Expected                     |
| -------------------- | ---------------------------- |
| `exportMdEmptyError` | `true` (output_dir required) |
| `importMdEmptyError` | `true` (source_dir required) |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- All 10 `mj.*` API groups tested with `{}` empty params
- Type mismatches (string where number, number where string) return structured errors
- Domain errors (nonexistent IDs, same-tag merge, 404s) return `{success: false}`
- Security boundaries (path traversal, limit overflow) enforced
- No sandbox crashes, no raw MCP exceptions leaked through Code Mode
- All results map to compact summaries (no large payload inflation)
