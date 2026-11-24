# Memory Journal MCP Examples

Deployment, authentication, configuration, and observability templates for `memory-journal-mcp`.

## Directories & Templates

| Path | Purpose |
| --- | --- |
| [`observability/`](./observability/) | Self-hosted Prometheus, Grafana, Loki, Grafana Alloy, and Datadog OpenMetrics Autodiscovery v2 monitoring stack with pre-provisioned overview, AI efficiency, and audit-log dashboards. |
| [`oauth-keycloak/`](./oauth-keycloak/) | Local Keycloak 26.4.7 OAuth 2.1 development stack with imported `mcp` realm, all 6 canonical scopes (`read`, `write`, `team`, `audit`, `admin`, `full`), Audience Mapper (`aud: memory-journal-mcp`), and `curl` verification flow. |
| [`configs/`](./configs/) | Annotated multi-repo YAML configuration (`memory-journal.config.yaml`) and precedence/hot-reload guide. |

## Root Quick-Start Files

These existing root-level templates remain at the repository root:

- [`mcp-config-example.json`](../mcp-config-example.json) — MCP client configuration snippets for Cursor, Antigravity, and stdio hosts.
- [`memory-journal-config-example.json`](../memory-journal-config-example.json) — JSON baseline equivalent of `examples/configs/memory-journal.config.yaml`.
- [`docker-compose.yml`](../docker-compose.yml) — Production-hardened single-service `stdio` / `--profile http` container setup.

## Additional Guides

- [Examples & Tutorials (Wiki)](https://github.com/neverinfamous/memory-journal-mcp/wiki/Examples) — Prompting patterns, Code Mode recipes, Knowledge Graph workflows, and agent best practices.
- [Configuration Reference (Wiki)](https://github.com/neverinfamous/memory-journal-mcp/wiki/Configuration) — Environment variables, CLI flags, multi-tenancy, and auto-prune settings.
- [HTTP Transport & OAuth 2.1 (Wiki)](https://github.com/neverinfamous/memory-journal-mcp/wiki/HTTP-Transport) — Streamable HTTP, Legacy SSE, fail-closed startup guards, and scope mapping.
