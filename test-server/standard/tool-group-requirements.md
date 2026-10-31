# Testing Prompts & Required Tool Groups

This document maps each standard testing prompt to the specific MCP tool groups that must be enabled (e.g., via `--tool-filter`) to execute the test successfully.

| Test Prompt | Required Tool Groups |
| ----------- | -------------------- |
| `test-config-reload.md` | `full` |
| `test-core-admin.md` | `admin`, `backup`, `codemode`, `core`, `search` |
| `test-core-crud-create.md` | `admin`, `codemode`, `core`, `github` |
| `test-core-crud-read.md` | `full` |
| `test-core-infra.md` | `analytics`, `codemode`, `core` |
| `test-core-io.md` | `codemode`, `io` |
| `test-core-relationships.md` | `codemode`, `relationships` |
| `test-core-search-filters.md` | `full` |
| `test-core-search-fts.md` | `admin`, `analytics`, `codemode`, `core`, `search` |
| `test-core-semantic.md` | `admin`, `analytics`, `codemode`, `search` |
| `test-errors-boundaries.md` | `admin`, `analytics`, `backup`, `codemode`, `core`, `full`, `github`, `relationships`, `search`, `team` |
| `test-errors-prompts.md` | `admin`, `analytics`, `backup`, `codemode`, `core`, `full`, `github`, `relationships`, `search`, `team` |
| `test-github-read.md` | `codemode`, `github` |
| `test-github-write.md` | `codemode`, `github` |
| `test-integrity.md` | `admin`, `analytics`, `codemode`, `core`, `io`, `relationships`, `search` |
| `test-kanban-lifecycle.md` | `codemode`, `github` |
| `test-payload-optimization.md` | `codemode`, `core`, `github`, `search` |
| `test-resources.md` | `analytics`, `codemode`, `core`, `github` |
| `test-schemas.md` | `admin`, `analytics`, `backup`, `codemode`, `core`, `github`, `io`, `relationships`, `search`, `team` |
| `test-seed.md` | `full` |
| `test-team-admin.md` | `admin`, `team`, `codemode` |
| `test-team-aliases.md` | `full` |
| `test-team-crud.md` | `team`, `codemode` |
| `test-team-rbac.md` | `team`, `admin` |
| `test-tool-group-admin.md` | `admin`, `codemode`, `core` |
| `test-tool-group-analytics.md` | `analytics`, `codemode` |
| `test-tool-group-backup.md` | `backup`, `codemode`, `io` |
| `test-tool-group-core.md` | `codemode`, `core` |
| `test-tool-group-git.md` | `git` |
| `test-tool-group-github.md` | `codemode`, `github` |
| `test-tool-group-search.md` | `codemode`, `search` |
| `test-tool-group-team.md` | `codemode`, `team` |
| `test-workspace-isolation.md` | `full` |