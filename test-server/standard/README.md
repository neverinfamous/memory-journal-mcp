# Standard Feature Tests

> **This README is optimized for AI agent consumption.**

This directory contains the core modular test files for `memory-journal-mcp`. These tests execute direct `callTool` operations via MCP to validate the standard capabilities of the server.

> **CRITICAL:** `test-seed.md` **must** be executed first in any test session. All other test files in this directory depend on the seed data being present. Once seeded, you may run any of the other tests independently.

## Test Modules

| File                           | Purpose                                                                                                              | When to Read              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `test-seed.md`                 | **Seed Data** — Create 17 entries (S1–S17) required by all other test files                                          | **Always run first**      |
| `test-core-infra.md`           | **Infrastructure** — Health, briefing, protocol validation scripts, GitHub status resource                            | After seed                |
| `test-core-crud.md`            | **Entry CRUD** — Create, read, update, delete operations                                                             | After seed                |
| `test-core-search.md`          | **Text Search** — FTS5, phrase/prefix/boolean, LIKE fallback, hybrid auto-mode, date range, cross-DB, filters        | After seed                |
| `test-core-semantic.md`        | **Semantic Search & Analytics** — Vector search, index management, statistics, cross-project insights                 | After seed                |
| `test-core-relationships.md`   | **Relationships** — Entry linking, causal types, visualization (Mermaid), graph resources                             | After seed                |
| `test-core-admin.md`           | **Admin & Backup** — Tag management, export, backup/restore operations                                               | After seed                |
| `test-core-scheduler.md`       | **Scheduler** — HTTP/SSE transport scheduler jobs (terminal script)                                                   | After seed                |
| `test-schemas.md`              | **Output Schemas** — Verify all 60 outputSchema tools return `structuredContent`                                      | After seed                |
| `test-resources.md`            | **Resources** — All 28 resources (static + template, happy + error paths)                                             | After seed                |
| `test-github.md`               | **GitHub Integration** — 16 GitHub tools (read-only, lifecycle, Kanban, milestones, insights, Copilot, cleanup)       | After seed                |
| `test-errors.md`               | **Prompts & Error Handling** — 16 prompt handlers, structured error verification, numeric coercion                    | After seed                |
| `test-integrity.md`            | **Data Integrity & Edge Cases** — Round-trip verification, boundary values, implementation bug detection              | After seed                |
| `test-team.md`                 | **Team Collaboration** — 20 team tools + 2 team resources                                                            | After seed                |
