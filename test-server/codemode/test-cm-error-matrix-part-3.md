# Re-Test memory-journal-mcp — Code Mode: Error Matrix & Zod Sweeps (Part 2)

Systematic verification of structured error handling across remaining API groups.

**Scope:** 1 tool (mj_execute_code), Phase 29B.

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

## Phase 29B: Error Matrix via Code Mode (Continued)

### 29.6 GitHub Group — Empty Params & Not-Found

```javascript
// Test code (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
const issuesEmpty = await mj.github.getGithubIssues({})
const prsEmpty = await mj.github.getGithubPrs({})
const contextEmpty = await mj.github.getGithubContext({})
const milestonesEmpty = await mj.github.getGithubMilestones({})
const insightsEmpty = await mj.github.getRepoInsights({})

const issueBadNum = await mj.github.getGithubIssue({ issueNumber: 999999 })
const prBadNum = await mj.github.getGithubPr({ prNumber: 999999 })
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
| `issueEmptyError`  | `true` (issueNumber required)   |



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
