# Configuration Examples

Portable configuration file examples for `memory-journal-mcp`.

## Included Files

- [`memory-journal.config.yaml`](./memory-journal.config.yaml) — Annotated multi-repo YAML configuration demonstrating database paths, `projectRegistry` mappings, `allowedIoRoots`, Code Mode settings, `briefing*` tuning, audit logging, Prometheus telemetry, and lifecycle auto-prune options.
- [`../../memory-journal-config-example.json`](../../memory-journal-config-example.json) — Equivalent JSON baseline template at the repository root.

## Auto-Discovery & Precedence

`ConfigResolver` resolves configuration in strict order:

1. **CLI flags** (`--config`, `--tool-filter`, `--allowed-io-roots`, etc.)
2. **Environment variables** (`MEMORY_JOURNAL_MCP_TOOL_FILTER`, `ALLOWED_IO_ROOTS`, `DB_PATH`, etc.)
3. **Configuration file** (explicit `--config <path>` / `MEMORY_JOURNAL_CONFIG`, or first existing match from:
   `./memory-journal.config.yaml` → `./memory-journal.config.yml` → `./memory-journal.config.json` →
   `~/.gemini/config/memory-journal.config.json` → `~/.gemini/config/memory-journal.config.yaml` →
   `~/.memory-journal/config.json`)
4. **Built-in defaults**

Verify the resolved configuration (with secrets redacted) before launching in production:

```bash
memory-journal-mcp --config ./examples/configs/memory-journal.config.yaml --dump-config
```

## Hot-Reload vs. Startup-Only Keys

- **Hot-reloadable** (via file edits or the `update_configuration` MCP tool): `toolFilter`, `briefing*` keys, `defaultWorkspaceId`, `defaultProjectNumber`, and `codemodeInternalFullAccess` (ratcheted fail-closed: cannot escalate from `false` to `true` at runtime).
- **Startup-only**: `dbPath`, `teamDbPath`, `allowedIoRoots`, `auditLog`, `metricsExport`, `metricsPort`, `persistMetrics`, and `prune*` schedules require a process restart to take effect.
- **Secrets**: Keep `GITHUB_TOKEN`, `MCP_AUTH_TOKEN`, and `MJ_DB_ENCRYPTION_KEY` in environment variables or `secrets.env` rather than committing them into config files.
