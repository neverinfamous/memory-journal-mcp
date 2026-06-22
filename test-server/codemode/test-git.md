# Code Mode Re-Test — Git History Mining

**Scope:** 5 git history mining tools executed exclusively through `mj_execute_code`.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- **Required Tool Groups:** `codemode`, `git`
- Do NOT call individual tools directly. All tests must be orchestrated through `mj_execute_code` using the `mj.git.*` namespace.
- **IMPORTANT**: In multi-workspace environments, pass `repo: "memory-journal-mcp"` to Git methods.

**Workflow after testing:**

1. Create a plan to fix any issues found.
2. If code changes made, commit without pushing.
3. Stop for **USER** verification.
4. Re-test.
5. Provide brief final summary including Total Token Estimate.

---

## Phase 14: Git Integration Code Mode

| Test                  | Code Execution snippet                                              | Expected Result                                          |
| --------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| Get commit history    | `mj.git.getCommitHistory({ limit: 5 })`                             | Returns last 5 commits                                   |
| Search commits        | `mj.git.searchCommits({ query: "initial" })`                        | Returns commits matching "initial"                       |
| Get release info      | `mj.git.getReleaseInfo({})`                                         | Returns info for the latest release                      |
| Get unreleased commits| `mj.git.getUnreleasedCommits({})`                                   | Returns unreleased commits                               |
| Analyze commit pattern| `mj.git.analyzeCommitPatterns({ days: 30 })`                        | Returns commit analytics for last 30 days                |

---

## Success Criteria

- Agent reports Total Token Estimate.
- All 5 git tools function correctly via `mj.git.*` inside `mj_execute_code`.
