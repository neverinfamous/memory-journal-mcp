# Re-Test memory-journal-mcp — Git History Mining

**Scope:** 5 git history mining tools — commit history, search commits, release info, unreleased commits, and analytics.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- **Required Tool Groups:** `git`
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track.
- Seed data from `test-seed.md` must be present.
- **IMPORTANT**: In multi-workspace environments, always pass `repo: "memory-journal-mcp"` to Git tools to avoid silent fallbacks to the wrong repository.

**Workflow after testing:**

1. Create a plan to fix any issues found.
2. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing.
3. Stop so the **USER** can verify with tests.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary including Total Token Estimate.

---

## Phase 14: Git Integration (5 tools)

### 14.1 Git Tools

| Test                  | Command/Action                                 | Expected Result                                          |
| --------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| Get commit history    | `get_commit_history(limit: 5)`                 | Returns last 5 commits                                   |
| Search commits        | `search_commits(query: "initial")`             | Returns commits matching "initial"                       |
| Get release info      | `get_release_info()`                           | Returns info for the latest release                      |
| Get unreleased commits| `get_unreleased_commits()`                     | Returns unreleased commits                               |
| Analyze commit pattern| `analyze_commit_patterns(days: 30)`            | Returns commit analytics for last 30 days                |

---

## Success Criteria

- Agent reports the Total Token Estimate in the final summary.
- All 5 git tools function correctly via direct MCP.
