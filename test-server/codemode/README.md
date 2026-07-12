# Code Mode Sandbox Tests

> **This README is optimized for AI agent consumption.**

This directory contains agent-optimized test prompts specifically designed to validate the `mj_execute_code` (Code Mode) sandbox capabilities. These tests verify the secure execution environment, the `mj.*` API bridge, workflow orchestration, and cross-group data operations.

> **Note:** Code Mode tests should be executed _after_ the core standard tests have completed, as they rely on a stable underlying database and robust tool handlers.

> **Important Constraints (P401):** When verifying Code Mode scripts, explicitly ensure that scripts processing errors correctly handle boundary detection. A returned object MUST NOT bleed raw MCP exceptions. Pay close attention to the `_meta.tokenEstimate` to ensure token payloads do not breach thresholds during heavy array iterations.

## Test Modules

### Foundations & Security (from CM-1)

| File                        | Phase | Focus                                                              | When to Run      |
| --------------------------- | :---: | ------------------------------------------------------------------ | ---------------- |
| `test-cm-sandbox-basics.md` |  16   | Simple expressions, async, metrics, timeout, and schema index checks | Always run first |
| `test-cm-api-discovery.md`  |  17   | `mj.help()`, per-group help, aliases, positional args              | After Phase 16   |
| `test-cm-readonly.md`       |  18   | Readonly mode enforcement (read succeed, writes blocked)           | After Phase 16   |
| `test-cm-security.md`       |  19   | Input validation, blocked patterns, runtime errors, nulled globals | After Phase 16   |

### Core Data Operations (from CM-2)

| File                | Phase | Focus                                                 | When to Run        |
| ------------------- | :---: | ----------------------------------------------------- | ------------------ |
| `test-cm-crud-part-1.md`<br>`test-cm-crud-part-2.md` |  20   | Create/read/update/delete, error paths | After Phases 16–19 |
| `test-cm-crud-advanced-part-1.md`<br>`test-cm-crud-advanced-part-2.md` | 20B | Recovery, history tracking, archiving, pagination, full params | After Phase 20 |
| `test-cm-search.md` |  21   | FTS5, filters, date range | After Phases 16–19 |
| `test-cm-search-advanced-part-1.md`<br>`test-cm-search-advanced-part-2.md` | 21B | Semantic search, archiving & pagination, analytics | After Phase 21 |

### Workflows & Relationships (from CM-3)

| File                       | Phase | Focus                                                                 | When to Run        |
| -------------------------- | :---: | --------------------------------------------------------------------- | ------------------ |
| `test-cm-workflows.md`     |  22   | Read-only pipelines, conditional branching, round-trips               | After Phases 16–19 |
| `test-cm-orchestration.md` |  23   | Cross-group orchestration (health, tags, full pipeline)               | After Phases 16–19 |
| `test-cm-relationships.md` |  24   | Link all types, duplicates, Mermaid visualization + cleanup for 22-24 | After Phases 16–19 |

### External, Admin & Team (from CM-4)

| File                            |    Phase    | Focus                                                                 | When to Run        |
| ------------------------------- | :---------: | --------------------------------------------------------------------- | ------------------ |
| `test-cm-github-part-1.md`<br>`test-cm-github-part-2.md` |     25      | GitHub 18 tools (read, Kanban, issues, milestones, insights)          | After Phases 16–19 |
| `test-cm-kanban-lifecycle.md`   |    25.1     | End-to-end Code Mode pipelined execution of Kanban lifecycle tools    | After Phases 16–19 |
| `test-cm-io.md`                 |     26      | IO namespaces, Markdown orchestration roundtrips, and file schemas    | After Phases 16–19 |
| `test-cm-admin-projects.md`<br>`test-cm-admin-core.md`<br>`test-cm-admin-batch.md`<br>`test-cm-backup.md` |     27      | Project management, core admin, batch ops, backup lifecycle           | After Phases 16–19 |
| `test-cm-team-crud.md`          |  28.1–28.3  | Team CRUD, error paths, date range search                             | After Phases 16–19 |
| `test-cm-team-admin-core.md`<br>`test-cm-team-batch.md`<br>`test-cm-team-analytics-relationships.md`<br>`test-cm-team-admin-part-2.md` |  28.4–28.9  | Team admin, batch operations, recovery, archiving, analytics, relationships, IO logic, backup | After Team CRUD    |
| `test-cm-team-vector-errors-part-1.md`<br>`test-cm-team-vector-errors-part-2.md` | 28.10–28.11 | Team vector/insights, cross-tool error verification + cleanup         | After Team Admin   |
| `test-cm-team-aliases.md`<br>`test-cm-team-rbac.md` | 28.16–28.17 | Team author alias and member RBAC operations                          | After Team Admin   |
| `test-cm-error-matrix-part-1.md`<br>`test-cm-error-matrix-part-2.md` |     29      | Systematic `{}` Zod sweeps + type mismatches (Part 1)                 | After Phases 16–19 |
| `test-cm-error-matrix-part-3.md`|    29B      | Systematic `{}` Zod sweeps + type mismatches (Part 2)                 | After Phase 29     |
| `test-cm-hallucination-smoothing.md`<br>`test-cm-session-summary-healing.md`<br>`test-config-reload.md`<br>`test-git.md` |  31-31.5    | Hallucination smoothing, aliases, session summary healing, config reload, git | After Phases 16–19 |

### Cross-Cutting Optimization Tests

| File                              | Phase | Focus                                                                                           | When to Run        |
| --------------------------------- | :---: | ----------------------------------------------------------------------------------------------- | ------------------ |
| `test-cm-payload-optimization.md` |  30   | Payload optimization — Kanban throttling, body truncation, pagination cap (limits & cursors), Code Mode result cap | After Phases 16–19 |

## Dependency DAG

```
Phase 16 (Sandbox Basics) ─── MUST PASS FIRST
    │
    ├── Phase 17 (API Discovery)
    ├── Phase 18 (Readonly)
    └── Phase 19 (Security)
         │
         ├── Phase 20 (CRUD) ──────────────── independent
         │    └── Phase 20B (CRUD Adv)
         ├── Phase 21 (Search) ────────────── independent
         │    └── Phase 21B (Search Adv)
         ├── Phase 22 (Workflows) ─────────── independent
         ├── Phase 23 (Orchestration) ─────── independent
         ├── Phase 24 (Relationships) ─────── cleanup for 22-24
         ├── Phase 25 (GitHub) ────────────── independent
         ├── Phase 25.1 (Code Mode Kanban) ── independent
         ├── Phase 26 (IO & Markdown) ─────── independent
         ├── Phase 27 (Admin/Backup) ──────── independent
         ├── Phase 29 (Error Matrix) ─────── independent
         │    └── Phase 29B (Error Matrix Part 2)
         ├── Phase 30 (Payload Optimization)─ independent
         ├── Phase 31 (Hallucination Smoothing)─ independent
         └── Phase 28.1-3 (Team CRUD) ─────── sequential
              └── Phase 28.4-9 (Team Admin)
                   ├── Phase 28.10-11 (Team Vector/Errors + cleanup)
                   └── Phase 28.16 (Team RBAC)
```

## Execution Workflow

1. Navigate to the `test-server/codemode/` directory.
2. Run `test-cm-sandbox-basics.md` (Phase 16) — must pass before proceeding.
3. Run Phases 17–19 in any order.
4. Continue with Phases 20–27, 29, and 30 in any order (all independent after 16–19).
5. Run Phase 28 files sequentially (CRUD → Admin → Vector/Errors → RBAC).
6. Cleanup is included in Phase 24 (for 22-24), and Phase 28.10-11 (for 25-28).

## Token Estimate Reporting

All test workflows in `test-server/codemode/` require the agent to track and report the token estimate used during the test pass.

**How to calculate:**

- Every tool execution returns a `_meta.tokenEstimate` object in the response. Sum these values. (Estimates use a content-type-aware heuristic: prose=4.0, json=2.8, code=3.2 bytes/token).
- _Alternatively_, you may read the `memory://metrics/summary` resource before and after testing to find the delta, or report the session totals via `memory://audit`.
- Always provide this **Total Token Estimate** clearly in your final test report summary so the user can track context window consumption. The tokens tracked should only count the estimated tokens that actually entered the context window.

## Resource Metric Validation

During or after your execution workflows, explicitly verify that resource read telemetry is accumulating accurately:

1. Perform a read on a known resource (e.g. `memory://briefing` or `memory://status`).
2. Attempt a read on an invalid resource to trigger an error path.
3. Read the `memory://metrics/resources` resource and `memory://metrics/summary`.
4. Validate that `total_resource_reads` and the specific breakdown count for the read resources accurately reflect your actions.
