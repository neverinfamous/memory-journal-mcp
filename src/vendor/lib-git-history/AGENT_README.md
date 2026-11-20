# 🤖 Agent README: lib-git-history

> **[INTENT]**: Serves as the SSoT for Git history and working-tree extraction. **[INVARIANT]**: Do NOT parse raw `git log`, `git show`, `git status`, or `git diff` text. Always rely on the structured JSON payloads emitted by this module.

**Purpose**: A **structured repository intelligence layer** that turns raw Git history and working-tree state into a deterministic, Zod-validated semantic model across repositories.

## Architecture

Uses native Git `--name-status -z`, `--numstat -z`, and per-process UUID boundary separators (`RECORD_SEPARATOR`, `FIELD_SEPARATOR`, `NUMSTAT_BOUNDARY_STR`, `PATCH_BOUNDARY_STR`) so filenames with spaces, quotes, renames, or carriage returns parse without escaping flaws.

| Module | Responsibility |
| :--- | :--- |
| `../get-git-history-json.ts` | Primary CLI entrypoint (`bun`). Short-circuits `--limit 0` and `--uncommitted` before tag-range probes; skips `getHeadSha` on filtered/limited runs; closes SQLite cache in `finally`/signal handlers. |
| `cli.ts` & `constants.ts` | `util.parseArgs` + `cliArgsSchema` validation, `--help` manual, limits, regex constants, and `GIT_EXCLUDE_PATTERNS`. |
| `git-runner.ts` | Subprocess bridge (`cwd`-aware, `windowsHide: true`, `--end-of-options`), single-spawn `getGitTagRange` (`describe --tags --long --abbrev=40 --always`), `buildGitBaseArgs`, `streamGitRecords`, `spawnGitBinaryStream`, and `cleanupProcesses`. |
| `git-numstat.ts` & `git-patch.ts` | Binary `--numstat -z` and `-p` patch streamers (batched via `--stdin --no-walk` and run concurrently when both are needed). |
| `uncommitted.ts` | Extracts staged, unstaged, and untracked working-tree status (`-uall`, 64KB chunk-streamed non-binary line counts up to 5MB). Exports both sync `getUncommittedState` (tests/compat) and concurrent async `getUncommittedStateAsync` (`Promise.allSettled`, used by CLI and async callers). |
| `parser.ts` | Semantic engine barrel re-exporting `parseGitRecord`, `processBatch`, and `extractNumericMetadata`. |
| `parser-record.ts` | Cursor-based record splitter, 1-char file-status fast-path, conventional commit/breaking/revert/issue extraction, and `WeakMap`-cached CLI filters. |
| `parser-trailers.ts` | `switch`-based trailer parser (`History-*`, `BREAKING-CHANGE`, `Co-authored-by`, `Reviewed-by`, references, `customTrailers`, `trailersObj`) with prototype-pollution guards (`Object.create(null)`) and `\u200B` multiline stripping. |
| `parser-metadata.ts` & `parser-utils.ts` | Numeric metadata extraction/filtering (`impact`, `confidence`, deprecated `trust`), `getLanguage`, `isNoiseFile`, `extractIssues` (bounded custom regex cache), `getSlackMap` (cwd-keyed Zod-validated cache), and `truncateSafely`. |
| `parser-batch.ts` | Correlates `getNumstatMap` + `getPatchMap` via `Promise.allSettled` (skipping both on `--summary`/`--no-body`), computes qualitative size (`XS`–`XL`), applies `DEFAULT_MAX_BODY_LEN` truncation, and validates via `entrySchema` + `parseWithFallbacks`. |
| `schema.ts` | Zod v4 contracts (`entrySchema` — 38 fields, `fileStatusSchema` with strict `.int()` metrics, `cliArgsSchema`). **Always consult before altering parser output.** |
| `cache.ts` | `bun:sqlite` `STRICT` cache persisting all 38 `entrySchema` columns (WAL, `synchronous=NORMAL`, `temp_store=MEMORY`, `busy_timeout=5000`, `PRAGMA optimize` on `closeCache()`), composite `idx_commits_type_scope(type, scope)`, `CHUNK=500` positional `?` batch queries, bounded `stmtCache` (32), and cached `insertCommits` transaction. |
| `output.ts` & `formatters/{markdown,slack}.ts` | Centralized `projectCommitEntry` (`--no-body`/`--summary`/`--stats`), `resolveRepoOrigin`, built-in Markdown/Slack formatters, and custom `.hbs`/`.txt`/JS/TS formatter loader. |

## ⚡ Fast-Path Agent Command Recipes

Pick the lightest flag that satisfies your task (cost increases top to bottom):

| Goal | Recommended Command | Subprocesses / Diff Cost |
| :--- | :--- | :--- |
| Working-tree status + diffstat | the host's `get-git-history-json.ts --uncommitted --stats` wrapper (add `--path <dir>` to scope) | Concurrent `status` + `diff --numstat` + `config --get-regexp` |
| Latest commit metadata only | the host's `get-git-history-json.ts -n 1 --no-body` wrapper | 1 `git log` (no `--name-status`, no numstat, no patch) |
| Commit summaries + trailers | the host's `get-git-history-json.ts -n 20 --summary` wrapper | 1 `git log --name-status` (skips numstat & patch) |
| Commit metadata + file metrics | the host's `get-git-history-json.ts -n 20 --stats` wrapper | `git log` + `git log --numstat` |
| Full diff search + patches | the host's `get-git-history-json.ts -G "<regex>" --include-patch` wrapper | `git log` + concurrent `--numstat` & `-p` |
| Changelog output | the host's `get-git-history-json.ts -r "v1.0.0..HEAD" -f markdown --changelog-only` wrapper | Supports `json`, `json-array`, `markdown`, `slack`, or custom path |

## 🧹 Scratch Workspace Protocol

> [!CAUTION]
> **STRICT SCRATCH FILE POLICY**: Never create temporary files, test DBs, or mock repositories in `.agents/scratch`, `.agents/scripts/scratch-repo`, or the repository root.
> **ALWAYS** write scratch scripts/fixtures exclusively to `<appDataDir>\brain\<conversation-id>\scratch\` (and temp SQLite DBs to `os.tmpdir()` with `.db`/`-wal`/`-shm` cleanup in `finally`).

## 🚫 Anti-Patterns

- **NEVER** run raw `git log`, `git shortlog`, `git show`, `git status`, or `git diff` to parse history or working-tree state.
- **OK**: `git rev-parse HEAD` / `git rev-parse --short HEAD` when you only need the bare HEAD SHA.
- **NEVER** use `Promise.all` for parallel `git` child-process spawns (use `Promise.allSettled` so an early rejection never leaves sibling processes holding Windows `cwd` locks).

## 🛠️ Usage & Modification Guidelines

- **CLI Flags**: Run the host's `get-git-history-json.ts --help` wrapper for the full reference. Key filters: `--type`, `--category`, `--breaking`, `--impact`, `--confidence`, `--author`, `--path`, `--since`/`--until`, `--diff-filter`, `--patch-search` (`-G`), `--pickaxe` (`-S`), `--reverse`, `--first-parent`, `--include-merges`, `--all`.
- **Memory & Truncation Bounds**: `--max-body-length <chars>` controls output body truncation (default `DEFAULT_MAX_BODY_LEN = 10,000` chars; the stream record buffer ceiling defaults to `100MB`). `--max-patch-length <bytes>` defaults to `20,000` bytes. Use `--jsonl` or `--stream-to-file <path>` for large histories.
- **Cross-OS & Context**: Always pass explicit `--cwd <path>` when targeting another repository (including mapped Windows/WSL UNC paths `\\wsl.localhost\...`). Use `--package-version`, `--cache`, `--issue-tracker <url>`, `--issue-pattern <regex>`, `--mailmap <file>`, and `--slack-map <file>` as needed.
- **Schema & Trailer Contracts**: `totalInsertions`, `totalDeletions`, `similarityScore`, `insertions`, `deletions`, and `fileCount` are strict `.int()` integers. Renames (`R`) carry both `oldFile` and `file`. Mapped trailers populate `metadata`; all trailers populate `trailersObj` and `metadata.customTrailers` (`parser-trailers.ts` strips `\u200B` multiline markers emitted by `commit.ts`).
- **Custom Formatting**: `--format <path>` (resolved relative to `--cwd`) supports `.hbs`/`.txt` Handlebars templates and `.ts`/`.js`/`.mjs`/`.cjs` modules exporting `default` or `format`. Built-in (`markdown`, `slack`) and custom formatters include all commits unless `--changelog-only` is passed.
- **Code Quality & Vendor Budgets**: Keep every file `<= 450` lines, every function `<= 80` lines with control-flow nesting `<= 4`, preserve `-z`/UUID delimiters and `--end-of-options`, and keep all files/docs path-neutral (no machine-local paths or private repo names). Register any newly extracted `.ts` file in downstream `VENDOR.json`.
- **Validation**: After modifying this library, run **strictly sequentially**: `bun run lint` → `bun run typecheck` → `bun test .agents/scripts/lib-git-history/tests/` (do NOT use Vitest or Playwright in this repo).

## 📖 Related Context & Usability Testing

- **Committing**: Use `pnpm exec tsx scripts/commit.ts` with explicit `--add <path>` flags (never raw `git commit`). Do not hand-edit generated changelogs.
- **Usability / Fuzzing Suite**: When changing parsing contracts, verify against `skills/lib-agent-exec/references/usability-audit.md` / the host's `usability/coordinator-workflow.md`. Auto-generated `test-usability-*.md` files are regenerated via the host's `usability/scripts/generate-tests.ts` wrapper.
