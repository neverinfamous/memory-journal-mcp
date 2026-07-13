# Code Mode Re-Test — Git History Mining

**Scope:** 6 git history mining tools executed exclusively through `mj_execute_code`.

**Prerequisites:**

- **Required Tool Groups:** `codemode`, `git`
- Do NOT call individual tools directly. All tests must be orchestrated through `mj_execute_code` using the `mj.git.*` namespace.
- **IMPORTANT**: In multi-workspace environments, pass `repo: "memory-journal-mcp"` to Git methods.

**Workflow after testing:**

1. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
2. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
3. Provide brief final summary including Total Token Estimate.

---

## Phase 14: Git Integration Code Mode

| Test                  | Code Execution snippet                                              | Expected Result                                          |
| --------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| Get commit history    | `mj.git.getCommitHistory({ limit: 5 })`                             | Returns last 5 commits                                   |
| Search commits        | `mj.git.searchCommits({ query: "initial" })`                        | Returns commits matching "initial"                       |
| Get release info      | `mj.git.getReleaseInfo({})`                                         | Returns info for the latest release                      |
| Get unreleased commits| `mj.git.getUnreleasedCommits({})`                                   | Returns unreleased commits                               |
| Analyze commit pattern| `mj.git.analyzeCommitPatterns({ days: 30 })`                        | Returns commit analytics for last 30 days                |
| Check entry staleness | `mj.git.checkEntryStaleness({ entry_id: 1 })`                       | Returns staleness info for entry                         |

---

## Success Criteria

- Agent reports Total Token Estimate.
- All 6 git tools function correctly via `mj.git.*` inside `mj_execute_code`.
