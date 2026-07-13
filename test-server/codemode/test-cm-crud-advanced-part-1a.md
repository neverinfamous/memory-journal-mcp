# Re-Test memory-journal-mcp — Code Mode: Core CRUD Advanced

Test core CRUD operations through the Code Mode mj.* API bridge (Advanced cases).

**Scope:** 1 tool (mj_execute_code), Phase 20B — ~9 test cases.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Code Mode is included in all tool filtering presets by default.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. Use code-map.md as a source of truth.
3. If you made code changes/fixes, update UNRELEASED.md and commit.
4. Re-test fixes with direct MCP calls.
5. Provide a very brief final summary.

---

## Phase 20B: Core CRUD Advanced via Code Mode

### 20.11 Update Entry — is_personal Toggle

```javascript
// Test code:
const created = await mj.core.createEntry({ workspace_id: "test-ws",  content: 'CM3 personal toggle test' })
const id = created.entry.id

// Toggle to non-personal
const toggled = await mj.admin.updateEntry({ entry_id: id, is_personal: false })
const verify1 = await mj.core.getEntryById({ entry_id: id })

// Toggle back to personal
const toggledBack = await mj.admin.updateEntry({ entry_id: id, is_personal: true })
const verify2 = await mj.core.getEntryById({ entry_id: id })

return {
  toggleSuccess: toggled.success,
  isPersonalFalse: verify1.entry?.isPersonal === false,
  toggleBackSuccess: toggledBack.success,
  isPersonalTrue: verify2.entry?.isPersonal === true,
}
```

| Check               | Expected |
| ------------------- | -------- |
| `toggleSuccess`     | `true`   |
| `isPersonalFalse`   | `true`   |
| `toggleBackSuccess` | `true`   |
| `isPersonalTrue`    | `true`   |

### 20.12 Create Entry — issueUrl Auto-Population

| Test                    | Code                                                                                                                                                                                                                                       | Expected Result                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| issueUrl auto-populated | `const ctx = await mj.github.getGithubContext({}); const r = await mj.core.createEntry({ workspace_id: "test-ws", content: "CM3 issue link", issue_number: 1 }); return { success: r.success, issueUrl: r.entry?.issueUrl };` | `success: true`, `issueUrl` contains github URL or is auto-populated |

### 20.13 Get Entry History

```javascript
// Test code:
const created = await mj.core.createEntry({ workspace_id: "test-ws",  content: 'CM3 history test v1' })
const id = created.entry.id

await mj.admin.updateEntry({ entry_id: id, content: 'CM3 history test v2' })
await mj.admin.updateEntry({ entry_id: id, content: 'CM3 history test v3' })

const history = await mj.core.getEntryHistory({ entry_id: id })

return {
  historyCount: history.revisions?.length,
  firstRevNumber: history.revisions?.[0]?.revisionNumber,
  firstRevContent: history.revisions?.[0]?.contentSnapshot,
  secondRevNumber: history.revisions?.[1]?.revisionNumber,
  secondRevContent: history.revisions?.[1]?.contentSnapshot,
}
```

| Check              | Expected                |
| ------------------ | ----------------------- |
| `historyCount`     | `2`                     |
| `firstRevNumber`   | `2`                     |
| `firstRevContent`  | `"CM3 history test v2"` |
| `secondRevNumber`  | `1`                     |
| `secondRevContent` | `"CM3 history test v1"` |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.
- See part 2 for remaining success criteria.
