# Re-Test memory-journal-mcp — Automated Scheduler

**Scope:** HTTP/SSE transport scheduler — backup, vacuum, and vector index rebuild jobs.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools whenever possible.** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 8: Automated Scheduler — Run via Script [DO NOT SKIP!]

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

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `memory://health` shows `scheduler.active: false` and empty `jobs` array in stdio mode
- All 4 jobs active with `nextRun` timestamps in HTTP mode
- All `lastResult` values are `"success"` after jobs fire
- Error in one job does not prevent others from running
