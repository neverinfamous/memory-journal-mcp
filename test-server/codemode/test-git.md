# Code Mode Re-Test — Git History Mining

**Scope:** 6 git history mining tools executed exclusively through `mj_execute_code`.

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

## Phase 14: Git Integration Code Mode

| Test                  | Code Execution snippet                                              | Expected Result                                          |
| --------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| Get commit history    | `mj.git.getCommitHistory({ limit: 5 })`                             | Returns last 5 commits                                   |
| Search commits        | `mj.git.searchCommits({ query: "initial" })`                        | Returns commits matching "initial"                       |
| Get release info      | `mj.git.getReleaseInfo({})`                                         | Returns info for the latest release                      |
| Get unreleased commits| `mj.git.getUnreleasedCommits({})`                                   | Returns unreleased commits                               |
| Analyze commit pattern| `mj.git.analyzeCommitPatterns({ days: 30 })`                        | Returns commit analytics for last 30 days                |
| Check entry staleness | `mj.git.checkEntryStaleness({ id: 1 })`                       | Returns staleness info for entry                         |

---

## Success Criteria

- Agent reports Total Token Estimate.
- All 6 git tools function correctly via `mj.git.*` inside `mj_execute_code`.
