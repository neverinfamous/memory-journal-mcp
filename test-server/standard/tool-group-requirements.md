# Testing Prompts & Required Tool Groups

This document maps each standard testing prompt to the specific MCP tool groups that must be enabled (e.g., via `--tool-filter`) to execute the test successfully.

| Test Prompt                    | Primary Focus        | Required Tool Groups                                                                                    |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------- |
| `test-core-admin.md`           | Admin / Tagging      | `admin`, `backup`, `codemode`, `core`, `search`                                                         |
| `test-core-crud.md`            | CRUD Operations      | `admin`, `codemode`, `core`, `github`                                                                   |
| `test-core-infra.md`           | Sandbox / Codemode   | `analytics`, `codemode`, `core`                                                                         |
| `test-core-io.md`              | IO / Export          | `codemode`, `io`                                                                                        |
| `test-core-relationships.md`   | Graph Links          | `codemode`, `relationships`                                                                             |
| `test-core-scheduler.md`       | Scheduler Automation | `codemode`                                                                                              |
| `test-core-search.md`          | Search               | `admin`, `analytics`, `codemode`, `core`, `search`                                                      |
| `test-core-semantic.md`        | Semantic Search      | `admin`, `analytics`, `codemode`, `search`                                                              |
| `test-errors.md`               | General              | `admin`, `analytics`, `backup`, `codemode`, `core`, `full`, `github`, `relationships`, `search`, `team` |
| `test-github.md`               | GitHub Integrations  | `codemode`, `github`                                                                                    |
| `test-integrity.md`            | Data Integrity       | `admin`, `analytics`, `codemode`, `core`, `io`, `relationships`, `search`                               |
| `test-kanban-lifecycle.md`     | Kanban Lifecycles    | `codemode`, `github`                                                                                    |
| `test-payload-optimization.md` | Payload Limitations  | `codemode`, `core`, `github`, `search`                                                                  |
| `test-resources.md`            | General              | `analytics`, `codemode`, `core`, `github`                                                               |
| `test-schemas.md`              | General              | `admin`, `analytics`, `backup`, `codemode`, `core`, `github`, `io`, `relationships`, `search`, `team`   |
| `test-seed.md`                 | General              | `full`                                                                                                  |
| `test-team.md`                 | Team Operations      | `admin`, `codemode`, `team`                                                                             |
| `test-tool-group-admin.md`     | Admin / Tagging      | `admin`, `codemode`, `core`                                                                             |
| `test-tool-group-backup.md`    | General              | `backup`, `codemode`, `io`                                                                              |
| `test-tool-group-core.md`      | General              | `analytics`, `codemode`, `core`                                                                         |
| `test-tool-group-github.md`    | GitHub Integrations  | `codemode`, `github`                                                                                    |
| `test-tool-group-search.md`    | Search               | `codemode`, `search`                                                                                    |
| `test-tool-group-team.md`      | Team Operations      | `codemode`, `team`                                                                                      |
