# Standard Feature Tests

> **This README is optimized for AI agent consumption.**

This directory contains the core modular test files for `memory-journal-mcp`. These tests execute direct `callTool` operations via MCP to validate the standard capabilities of the server.

> **CRITICAL:** `test-seed.md` **must** be executed first in any test session. All other test files in this directory depend on the seed data being present. Once seeded, you may run any of the other tests independently.

## Test Modules

### Seed & Infrastructure

| File                  | Phase | Purpose                                                                                            | When to Run        |
| --------------------- | :---: | -------------------------------------------------------------------------------------------------- | ------------------ |
| `test-seed.md`        |   0   | **Seed Data** — Create 17 entries (S1–S17) required by all other test files                        | **Always run first** |
| `test-core-infra.md`  |   1   | **Infrastructure** — Health, briefing, protocol validation scripts, GitHub status resource          | After seed         |

### Core Functional Tests

| File                         | Phase | Purpose                                                                                             | When to Run |
| ---------------------------- | :---: | --------------------------------------------------------------------------------------------------- | ----------- |
| `test-core-crud.md`          |   2   | **Entry CRUD** — Create, read, update, delete operations                                            | After seed  |
| `test-core-search.md`        |   3   | **Text Search** — FTS5, phrase/prefix/boolean, LIKE fallback, hybrid auto-mode, date range, filters | After seed  |
| `test-core-semantic.md`      |   4   | **Semantic Search & Analytics** — Vector search, index management, statistics, cross-project        | After seed  |
| `test-core-relationships.md` |   5   | **Relationships** — Entry linking, causal types, visualization (Mermaid), graph resources            | After seed  |
| `test-core-io.md`            |   6   | **IO & Interoperability** — Export/Import Markdown roundtrips, slugification, JSON legacy exports    | After seed  |
| `test-core-admin.md`         |   7   | **Admin & Backup** — Tag management, backup/restore operations                                      | After seed  |
| `test-core-scheduler.md`     |   8   | **Scheduler** — HTTP/SSE transport scheduler jobs (terminal script)                                  | After seed  |

### Cross-Cutting Validation

| File                   | Phase | Purpose                                                                                 | When to Run |
| ---------------------- | :---: | --------------------------------------------------------------------------------------- | ----------- |
| `test-schemas.md`      |   9   | **Output Schemas** — Verify all 60 outputSchema tools return `structuredContent`        | After seed  |
| `test-resources.md`    |  10   | **Resources** — All 28 resources (static + template, happy + error paths)               | After seed  |
| `test-errors.md`       |  11   | **Error Handling** — Prompt handlers, structured error verification, numeric coercion   | After seed  |
| `test-integrity.md`    |  12   | **Data Integrity** — Boundary values, round-trip fidelity, implementation bug detection | After seed  |

### External Integrations

| File                    | Phase | Purpose                                                                                            | When to Run |
| ----------------------- | :---: | -------------------------------------------------------------------------------------------------- | ----------- |
| `test-github.md`        |  13   | **GitHub Integration** — 16 GitHub tools (read-only, lifecycle, Kanban, milestones, insights, Copilot, cleanup) | After seed  |
| `test-team.md`          |  14   | **Team Collaboration** — 22 team tools + 2 team resources                                          | After seed  |

### Granular Tool Group Stress Tests

| File                        | Phase | Purpose                                                                    | When to Run |
| --------------------------- | :---: | -------------------------------------------------------------------------- | ----------- |
| `test-tool-group-core.md`   |  15a  | **Core** — Structured error matrix, Zod sweeps, boundary testing           | After seed  |
| `test-tool-group-admin.md`  |  15b  | **Admin** — Structured error matrix, Zod sweeps, integrity tests           | After seed  |
| `test-tool-group-backup.md` |  15c  | **Backup** — Structured error matrix, filter boundary enforcement          | After seed  |
| `test-tool-group-search.md` |  15d  | **Search** — Structured error matrix, limit/threshold boundaries           | After seed  |
| `test-tool-group-github.md` |  15e  | **GitHub** — Structured error matrix, OutputSchema compliance              | After seed  |
| `test-tool-group-team.md`   |  15f  | **Team** — Structured error matrix, missing DB context, vector fallbacks   | After seed  |

## Dependency DAG

```
Phase 0 (Seed Data) ─── MUST PASS FIRST
    │
    ├── Phase 1 (Infrastructure)
    ├── Phase 2 (CRUD) ──────────────── independent
    ├── Phase 3 (Search) ────────────── independent
    ├── Phase 4 (Semantic) ──────────── independent
    ├── Phase 5 (Relationships) ─────── independent
    ├── Phase 6 (IO) ────────────────── independent
    ├── Phase 7 (Admin) ─────────────── independent
    ├── Phase 8 (Scheduler) ─────────── independent (terminal script)
    ├── Phase 9 (Schemas) ───────────── independent
    ├── Phase 10 (Resources) ────────── independent
    ├── Phase 11 (Errors) ───────────── independent
    ├── Phase 12 (Integrity) ────────── independent
    ├── Phase 13 (GitHub) ───────────── independent
    ├── Phase 14 (Team) ─────────────── independent
    └── Phase 15a–f (Tool Groups) ──── independent (any order)
```

## Execution Workflow

1. Run `test-seed.md` (Phase 0) — **must pass before proceeding**.
2. Run `test-core-infra.md` (Phase 1) to verify server health and connectivity.
3. Continue with Phases 2–14 in any order (all independent after seed).
4. Run the 6 `test-tool-group-*.md` files (Phase 15) in any order for Zod sweep / structured error verification.
5. Cleanup is handled within individual test files where applicable.

## Token Estimate Reporting

All test workflows in `test-server/standard/` require the agent to track and report the token estimate used during the test pass.

**How to calculate:**

- Every tool execution returns a `_meta.tokenEstimate` object in the response. Sum these values.
- _Alternatively_, you may read the `memory://metrics/summary` resource before and after testing to find the delta, or report the session totals via `memory://audit`.
- Always provide this **Total Token Estimate** clearly in your final test report summary so the user can track context window consumption.
