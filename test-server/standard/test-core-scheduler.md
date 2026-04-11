# Test memory-journal-mcp — Automated Scheduler

**Scope:** HTTP/SSE transport scheduler — backup, vacuum, and vector index rebuild jobs.

**Execution Strategy:** **Use direct MCP tools, NOT Code Mode or scripts!** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.

**Prerequisites:** Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. Re-test fixes with direct MCP calls.
4. Brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 6: Automated Scheduler — Run via Script [DO NOT SKIP!]

> [!IMPORTANT]
> The scheduler only activates in HTTP/SSE transport mode. Run the script below — it handles session init, health reads, and wait/verify automatically. See `test-server/README.md` for full details.

```powershell
# Terminal 1: Start HTTP server with short scheduler intervals
npm run build
node dist/cli.js --transport http --port 3099 --backup-interval 1 --keep-backups 3 --vacuum-interval 2 --rebuild-index-interval 2 --digest-interval 2

# Terminal 2: Run scheduler test (waits 130s for jobs to fire)
node test-server/scripts/test-scheduler.mjs
```

| Check                                | Expected               |
| ------------------------------------ | ---------------------- |
| `scheduler.active`                   | `true`, 4 jobs         |
| All jobs `lastResult`                | `"success"` after wait |
| All jobs `lastError`                 | `null`                 |
| backup `runCount`                    | ≥ 2                    |
| vacuum + rebuild + digest `runCount` | ≥ 1 each               |

---

## Success Criteria

- [ ] `memory://health` shows `scheduler.active: false` and empty `jobs` array in stdio mode
- [ ] All 4 jobs active with `nextRun` timestamps in HTTP mode
- [ ] All `lastResult` values are `"success"` after jobs fire
- [ ] Error in one job does not prevent others from running
