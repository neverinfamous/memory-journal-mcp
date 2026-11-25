# Scripts Directory

> **Agent Protocol:** This directory contains automation and diagnostic scripts for the `memory-journal-mcp` repository. Do NOT attempt to run these scripts using raw `node` unless explicitly noted as a standard `.mjs` file.

## Script Execution Guidelines

- **TypeScript Scripts (`*.ts`)**: Always execute using `pnpm exec tsx <script-name>` or through their mapped `package.json` command. Do not use `ts-node`.
- **Node Modules (`*.mjs`)**: Execute using standard Node (`node <script-name>`).

## Inventory

| Script | Purpose | Execution Pattern |
|--------|---------|-------------------|
| `commit.ts` | Vendored conventional commit wrapper and Memory Journal linker CLI (delegates to `src/vendor/commit/commit.js`). | `pnpm run commit` / `pnpm exec tsx scripts/commit.ts` |
| `update-badges.ts` | Scans test outputs to generate coverage and E2E badges, updates `README.md` and `DOCKER_README.md`, and locally auto-commits modified badge files when run outside `GITHUB_ACTIONS`. | `pnpm exec tsx scripts/update-badges.ts` |
| `run-checks.ts` | Core diagnostic runner. Executes 4 checks when run without a target: ESLint + file-length ceiling check (`<= 500` lines), TypeScript `tsgo --noEmit` typecheck (default and `tsconfig.scripts.json`), `update-code-map.ts` code-map generation, and `check-unassigned-entries.ts` workspace isolation validation. | `pnpm exec tsx scripts/run-checks.ts [lint\|typecheck]` |
| `update-code-map.ts` | Analyzes source code to regenerate `test-server/code-map.md` with accurate prompt, tool, and resource tables. | `pnpm run generate:code-map` |
| `generate-instructions.ts` | Compiles Markdown help sources in `src/constants/instructions/markdown/*.md` into TypeScript instruction modules in `src/constants/instructions/*.ts`. | `pnpm run generate:instructions` |
| `check-unassigned-entries.ts` | Validates workspace isolation by auditing entries where `workspace_id = 'default' OR workspace_id IS NULL OR project_number = 0 OR project_number IS NULL` (resolving database path via `MEMORY_JOURNAL_DB_PATH` → `./data/mj-production.db` → `~/.gemini/antigravity/memory-journal.db` and encryption key via `MJ_DB_ENCRYPTION_KEY` → `DB_ENCRYPTION_KEY` → `~/.gemini/config/mcp_config.json`). | `pnpm run check:unassigned` / `pnpm exec tsx scripts/check-unassigned-entries.ts` |
| `test-import.ts` | Lightweight diagnostic script to verify that tool, resource, and prompt handlers load correctly without server startup. | `pnpm exec tsx scripts/test-import.ts` |
| `encrypt-db.ts` | Utility to encrypt an existing plaintext SQLite database into a new SQLCipher-encrypted copy via `PRAGMA rekey` (uses `MJ_DB_ENCRYPTION_KEY` or `DB_ENCRYPTION_KEY` from the environment). | `pnpm run encrypt-db -- --in <src.db> --out <enc.db>` |
| `check-orphans.mjs` | Diagnostic script to identify entries missing a strict `project_number`. Falls back to default `data/memory_journal.db` if no arg provided. | `node scripts/check-orphans.mjs [path]` |
| `query.ts` | Readonly SQLite diagnostic helper that lists active journal entries missing `session_id` (supports SQLCipher `MJ_DB_ENCRYPTION_KEY` / `DB_ENCRYPTION_KEY`). | `pnpm exec tsx scripts/query.ts` |
| `sync-vendor.ts` | Synchronizes vendor libraries from upstream tooling into `src/vendor/` with exclusive `.test-output/sync-vendor.lock` PID locking, atomic write-if-changed updates, and foreign-WIP / `.git/index.lock` collision guards (supports `--check`, `--lib <name>`, `--upstream-root <path>`, `--allow-dirty`, and `--test`; executed via `tsx`). | `pnpm run sync:vendor` / `pnpm run check:vendor-deps` / `pnpm exec tsx scripts/sync-vendor.ts` |
| `sync-vendor-guards.ts` | Concurrency lock, git worktree collision guard, and atomic write-if-changed helpers imported by `sync-vendor.ts`. | Imported by `scripts/sync-vendor.ts` |
| `vendor-doc-neutralizer.ts` | Strips host-local `.agents/scripts` invocations from synced vendor Markdown docs so vendored copies stay path-neutral. | Imported by `scripts/sync-vendor.ts` |
| `vendor-import-scanner.ts` | Lightweight comment/string/template/regex-aware ESM module specifier scanner used by `sync-vendor.ts` (avoiding `typescript` compiler cold-start overhead). | Imported by `scripts/sync-vendor.ts` |
| `print-summary.ts` | Utility to test the `session-summary` prompt generation output using the current repository context. | `pnpm exec tsx scripts/print-summary.ts` |

## Best Practices

1. **Working Directory:** Always execute scripts from the repository root (`<repo-root>`) unless a specific script documents otherwise.
2. **Environment Variables:** Some scripts may require `.env` or `secrets.env` (e.g., database keys). Ensure context is loaded if modifying these scripts.
