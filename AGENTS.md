# `memory-journal-mcp` Repository Rules

## Package Manager & Quality Gates (`pnpm`)

- Always use `pnpm` (`pnpm install`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, `pnpm exec vitest run <file>`, `$env:PLAYWRIGHT_WORKERS='1'; pnpm exec playwright test`). Never run `bun install` or `bun test` here, and never use raw `npm`/`npx`/`yarn`.
- Never run `lint`, `typecheck`, `build`, `vitest`, or `playwright` concurrently; execute them sequentially one at a time.

## Codegen & Vendored Boundaries

- Never edit generated TypeScript files (`src/constants/instructions/*.ts`) directly: edit `src/constants/instructions/markdown/*.md` and run `pnpm run generate:instructions`.
- Regenerate `test-server/code-map.md` with `pnpm run generate:code-map` after structural changes.
- Keep `src/vendor/` (`VENDOR.json`), `skills/memory-journal-mcp/SKILL.md`, `DOCKER_README.md` (`< 25,000` chars), and all docs 100% path-neutral (no local home-directory paths or private workspace names). Verify vendor parity with `pnpm run sync:vendor -- --check` and `pnpm run test:vendor`.

## Commits & Logs

- Commit explicit `--add <path>` targets via `pnpm exec tsx scripts/commit.ts --msg "type(scope): summary" --impact <0.1-1.0> --confidence <0.1-1.0> --validation <passed|none|failed> --journal --journal-project 5 --session-id <id> --add <path>` (never `--add .`, never raw `git commit`, never auto-push).
- Never truncate `logs/agent-issues.jsonl` with `Clear-Content` while running; use `node -e "require('node:fs').truncateSync('logs/agent-issues.jsonl', 0)"`.
