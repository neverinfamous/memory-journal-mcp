# Test memory-journal-mcp — Code Mode: Session Summary Hallucination Healing

Test the Code Mode Sandbox resilience for Session Summary specific hallucinations.

**Scope:** `mj_execute_code`, Phase 31.5 — Session Summary Auto-Healing and Team Aliases.

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

## Phase 31.5: Session Summary Header Normalization & Team Alias Healing

Test that when an agent uses the `mj.team.teamCreateEntry` alias (instead of `teamCreateEntry`), it works.
Test that mangled headers (`## Accomplishments`) or completely missing headers in a session-summary tag are gracefully auto-healed in the dispatcher before Zod validation.

```javascript
// Test 1: mj.core.createEntry with mangled headers
const entry1 = await mj.core.createEntry({
  workspace_id: "test-ws",
  tags: ['session-summary'],
  type: 'retrospective',
  auto_context: { commits: ['abc1234'] },
  content: `
## Accomplishments
- Fixed some bugs

## Blockers
- None

## Next steps
- More tests
`
});

// Test 2: mj.team.teamCreateEntry with NO headers
const entry2 = await mj.team.teamCreateEntry({
  workspace_id: "test-ws",
  tags: ['session-summary'],
  type: 'retrospective',
  auto_context: { commits: ['abc1234'] },
  content: `This is just a flat blob of text. I forgot to use any headers.`
});

// Test 3: mj.team.teamUpdateEntry healing headers
const updateRes = await mj.team.teamUpdateEntry({
  id: entry2.id ?? entry2.entry?.id,
  workspace_id: "test-ws",
  content: `
## Done
- Updated

## Unfinished/Blocked
- None
`
});

// Verify test 1
const hasAccomplished1 = entry1.entry?.content?.includes('## Accomplished');
const hasCommits1 = entry1.entry?.content?.includes('## Commits'); // This should have been auto-appended

// Verify test 2
const hasAccomplished2 = entry2.entry?.content?.includes('## Accomplished');
const hasContext2 = entry2.entry?.content?.includes('## Context for Next Session');

// Verify test 3
const hasAccomplished3 = updateRes.entry?.content?.includes('## Accomplished');

// Cleanup
await mj.admin.deleteEntry({ id: entry1.id ?? entry1.entry?.id, permanent: true });
await mj.team.teamDeleteEntry({ workspace_id: "test-ws", id: entry2.id ?? entry2.entry?.id, expectedVersion: updateRes.entry?.version ?? 2 });

return {
  test1Success: entry1.success,
  test1MangledHealed: hasAccomplished1,
  test1MissingAppended: hasCommits1,
  test2Success: entry2.success,
  test2HeadersInjected: hasAccomplished2 && hasContext2,
  test3Success: updateRes.success,
  test3Healed: hasAccomplished3
}
```

| Check                  | Expected |
| ---------------------- | -------- |
| `test1Success`         | `true`   |
| `test1MangledHealed`   | `true`   |
| `test1MissingAppended` | `true`   |
| `test2Success`         | `true`   |
| `test2HeadersInjected` | `true`   |
| `test3Success`         | `true`   |
| `test3Healed`          | `true`   |

---

## Success Criteria

- The `mj.team.teamCreateEntry` alias resolves correctly to `teamCreateEntry`.
- Hallucinated headers like `## Accomplishments`, `## Blockers`, and `## Next steps` are regex-replaced with their canonical equivalents.
- Completely missing required headers (like `## Commits`) are automatically appended to the bottom of the content string to prevent a validation error.
