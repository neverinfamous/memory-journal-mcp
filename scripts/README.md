# Scripts Directory

> **Agent Protocol:** This directory contains automation and diagnostic scripts for the `memory-journal-mcp` repository. Do NOT attempt to run these scripts using raw `node` unless explicitly noted as a standard `.mjs` file.

## Script Execution Guidelines

- **TypeScript Scripts (`*.ts`)**: Always execute using `pnpm dlx tsx <script-name>` or through their mapped `package.json` command. Do not use `ts-node`.
- **Node Modules (`*.mjs`)**: Execute using standard Node (`node <script-name>`).

## Inventory

| Script | Purpose | Execution Pattern |
|--------|---------|-------------------|
| `update-badges.ts` | Scans test outputs to generate coverage badges and applies them automatically to `README.md` and `DOCKER_README.md`. | `pnpm dlx tsx scripts/update-badges.ts` |
| `run-checks.ts` | Core diagnostic runner. Executes code-map generation, lint, and typecheck to assert repository health. | `pnpm dlx tsx scripts/run-checks.ts` |
| `update-code-map.ts` | Analyzes source code to regenerate `test-server/code-map.md` with accurate prompt, tool, and resource tables. | `pnpm run generate:code-map` |
| `test-import.ts` | Lightweight diagnostic script to verify that tool, resource, and prompt handlers load correctly without server startup. | `pnpm dlx tsx scripts/test-import.ts` |
| `encrypt-db.ts` | Utility to encrypt an existing SQLite database using SQLCipher. | `pnpm run encrypt-db` |
| `check-orphans.mjs` | Diagnostic script to identify entries missing a strict `project_number`. Falls back to default `data/memory_journal.db` if no arg provided. | `node scripts/check-orphans.mjs [path]` |
| `sync-vendor.ts` | Synchronizes and updates vendor libraries from the main adamic repository into the local `src/vendor` folder. | `pnpm run sync:vendor` |
| `print-summary.ts` | Utility to test the `session-summary` prompt generation output using the current repository context. | `pnpm dlx tsx scripts/print-summary.ts` |

## Best Practices

1. **Working Directory:** Always execute scripts from the root directory (`C:\Users\chris\Desktop\memory-journal-mcp`) unless a specific script documents otherwise.
2. **Environment Variables:** Some scripts may require `.env` or `secrets.env` (e.g., database keys). Ensure context is loaded if modifying these scripts.
