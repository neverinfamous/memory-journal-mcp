# Test memory-journal-mcp — Code Mode: Session Summary Hallucination Healing

Test the Code Mode Sandbox resilience for Session Summary specific hallucinations.

**Scope:** `mj_execute_code`, Phase 31.5 — Session Summary Auto-Healing and Team Aliases.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

---

## Phase 31.5: Session Summary Header Normalization & Team Alias Healing

Test that when an agent uses the `mj.team.createEntry` alias (instead of `teamCreateEntry`), it works.
Test that mangled headers (`## Accomplishments`) or completely missing headers in a session-summary tag are gracefully auto-healed in the dispatcher before Zod validation.

```javascript
// Test 1: mj.core.createEntry with mangled headers
const entry1 = await mj.core.createEntry({
  project_number: 5,
  tags: ['session-summary'],
  entry_type: 'retrospective',
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

// Test 2: mj.team.createEntry with NO headers
const entry2 = await mj.team.createEntry({
  project_number: 5,
  tags: ['session-summary'],
  entry_type: 'retrospective',
  auto_context: { commits: ['abc1234'] },
  content: `This is just a flat blob of text. I forgot to use any headers.`
});

// Test 3: mj.team.updateEntry healing headers
const updateRes = await mj.team.updateEntry({
  entry_id: entry2.id ?? entry2.entry?.id,
  project_number: 5,
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
await mj.core.deleteEntry({ entry_id: entry1.id ?? entry1.entry?.id, permanent: true });
await mj.team.deleteEntry({ project_number: 5, entry_id: entry2.id ?? entry2.entry?.id, expected_version: updateRes.entry?.version ?? 2 });

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

- The `mj.team.createEntry` alias resolves correctly to `teamCreateEntry`.
- Hallucinated headers like `## Accomplishments`, `## Blockers`, and `## Next steps` are regex-replaced with their canonical equivalents.
- Completely missing required headers (like `## Commits`) are automatically appended to the bottom of the content string to prevent a validation error.
