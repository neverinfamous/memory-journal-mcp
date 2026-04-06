# Code Mode Sandbox Tests

> **This README is optimized for AI agent consumption.**

This directory contains agent-optimized test prompts specifically designed to validate the `mj_execute_code` (Code Mode) sandbox capabilities. These tests verify the secure execution environment, the `mj.*` API bridge, workflow orchestration, and cross-group data operations.

> **Note:** Code Mode tests should be executed *after* the core standard tests have completed, as they rely on a stable underlying database and robust tool handlers. 

> **Important Constraints (P401):** When verifying Code Mode scripts, explicitly ensure that scripts processing errors correctly handle boundary detection. A returned object MUST NOT bleed raw MCP exceptions. Pay close attention to the `_meta.tokenEstimate` to ensure token payloads do not breach thresholds during heavy array iterations.

## Test Modules

### Foundations & Security (from CM-1)

| File | Phase | Focus | When to Run |
|------|:-----:|-------|-------------|
| `test-cm-sandbox-basics.md` | 16 | Simple expressions, async, metrics, timeout | Always run first |
| `test-cm-api-discovery.md` | 17 | `mj.help()`, per-group help, aliases, positional args | After Phase 16 |
| `test-cm-readonly.md` | 18 | Readonly mode enforcement (read succeed, writes blocked) | After Phase 16 |
| `test-cm-security.md` | 19 | Input validation, blocked patterns, runtime errors, nulled globals | After Phase 16 |

### Core Data Operations (from CM-2)

| File | Phase | Focus | When to Run |
|------|:-----:|-------|-------------|
| `test-cm-crud.md` | 20 | Create/read/update/delete, full params, error paths | After Phases 16–19 |
| `test-cm-search.md` | 21 | FTS5, filters, date range, semantic search, analytics | After Phases 16–19 |

### Workflows & Relationships (from CM-3)

| File | Phase | Focus | When to Run |
|------|:-----:|-------|-------------|
| `test-cm-workflows.md` | 22 | Read-only pipelines, conditional branching, round-trips | After Phases 16–19 |
| `test-cm-orchestration.md` | 23 | Cross-group orchestration (health, tags, full pipeline) | After Phases 16–19 |
| `test-cm-relationships.md` | 24 | Link all types, duplicates, Mermaid visualization + cleanup for 22-24 | After Phases 16–19 |

### External, Admin & Team (from CM-4)

| File | Phase | Focus | When to Run |
|------|:-----:|-------|-------------|
| `test-cm-github.md` | 25 | GitHub 16 tools (read, Kanban, issues, milestones, insights) | After Phases 16–19 |
| `test-cm-admin-backup.md` | 26 | Tag management, export formats/filters, backup lifecycle | After Phases 16–19 |
| `test-cm-team-crud.md` | 27.1–27.3 | Team CRUD, error paths, date range search | After Phases 16–19 |
| `test-cm-team-admin.md` | 27.4–27.8 | Team admin, analytics, relationships, export, backup | After Team CRUD |
| `test-cm-team-vector-errors.md` | 27.9–27.10 | Team vector/insights, 18-path cross-tool error verification + cleanup | After Team Admin |

## Dependency DAG

```
Phase 16 (Sandbox Basics) ─── MUST PASS FIRST
    │
    ├── Phase 17 (API Discovery)
    ├── Phase 18 (Readonly)
    └── Phase 19 (Security)
         │
         ├── Phase 20 (CRUD) ──────────────── independent
         ├── Phase 21 (Search) ────────────── independent
         ├── Phase 22 (Workflows) ─────────── independent
         ├── Phase 23 (Orchestration) ─────── independent
         ├── Phase 24 (Relationships) ─────── cleanup for 22-24
         ├── Phase 25 (GitHub) ────────────── independent
         ├── Phase 26 (Admin/Backup) ──────── independent
         └── Phase 27.1-3 (Team CRUD) ─────── sequential
              └── Phase 27.4-8 (Team Admin)
                   └── Phase 27.9-10 (Team Vector/Errors + cleanup)
```

## Execution Workflow

1. Navigate to the `test-server/codemode/` directory.
2. Run `test-cm-sandbox-basics.md` (Phase 16) — must pass before proceeding.
3. Run Phases 17–19 in any order.
4. Continue with Phases 20–26 in any order (all independent after 16–19).
5. Run Phase 27 files sequentially (CRUD → Admin → Vector/Errors).
6. Cleanup is included in Phase 24 (for 22-24) and Phase 27.9-10 (for 25-27).
