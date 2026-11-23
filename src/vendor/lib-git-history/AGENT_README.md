# 🤖 Agent README: lib-git-history

> **[INTENT]**: Serves as the SSoT for Git history and working-tree extraction. **[INVARIANT]**: Do NOT parse raw `git log`, `git show`, `git status`, or `git diff` text. Always rely on the structured JSON payloads emitted by this module.

**Purpose**: A **structured repository intelligence layer** that turns raw Git history and working-tree state into a deterministic, Zod-validated semantic model across repositories.

## Architecture

Uses native Git `--raw --numstat -z` (single-pass uncached), `--name-status -z`, and per-process UUID boundary separators (`RECORD_SEPARATOR`, `FIELD_SEPARATOR`, `NUMSTAT_BOUNDARY_STR`, `PATCH_BOUNDARY_STR`) so filenames with spaces, quotes, renames, or carriage returns parse without escaping flaws.

| Module | Responsibility |
| :--- | :--- |
| `../get-git-history-json.ts` | Primary CLI entrypoint (`bun`). Validates `--help` and custom `--format` paths before cache/output setup; short-circuits `--limit 0` and `--uncommitted` before tag-range probes; skips DB creation on read-only `--cache` runs when no DB exists; streams single-pass `--raw --numstat` on cold/uncached runs and delegates warm `--cache` runs to `cache-stream.ts`; batches stdout/file writes in 64KB chunks; tears down processes, streams, and cache in `finally`/signal handlers. |
| `cli.ts` & `constants.ts` | `util.parseArgs` (honoring POSIX `--` end-of-options) + strict non-negative integer and non-blank string `cliArgsSchema` validation, `--help` manual, limits, linear O(N) regex constants (`REGEX_CONVENTIONAL_COMMIT`, `REGEX_BREAKING_CHANGE`, etc.), and `GIT_EXCLUDE_PATTERNS`. |
| `git-runner.ts` & `git-stream-buffers.ts` | Subprocess bridge (`cwd`-aware, `windowsHide: true`, `--end-of-options`, `stdio: 'ignore'` when unused, throttled 1s idle-timeout resets), single-spawn `getGitTagRange` (`describe --tags --long --abbrev=40 --always`), `buildGitBaseArgs` (never leaking standalone `-U`/`-c` that imply `-p`), chunk-buffered `TextStreamState`/`BinaryStreamState` O(N) boundary draining with slab detachment and 1-byte OOM guards, and `cleanupProcesses`. |
| `git-numstat.ts` & `git-patch.ts` | Shared `parseNumstatLineIntoMap` + `NUMSTAT_MAPS_WITH_ALIASES` (used by inline `--raw --numstat` and fallback `--stdin --no-walk`), `wantsPatchOutput`, and bounded `-p` patch streaming. |
| `uncommitted.ts` | Extracts staged, unstaged, and untracked working-tree status (`-uall`, `-uno` under `--no-body`, `--no-optional-locks`, 64KB chunk-streamed non-binary line counts up to 5MB with `path.relative` containment and 8-worker async concurrency). Clean-repo sync short-circuit, fails closed on `git status` errors, falls back to `git diff --cached` on unborn `HEAD`, and honors `--diff-context` / `--max-patch-length`. Exports sync `getUncommittedState` and concurrent async `getUncommittedStateAsync` (`Promise.allSettled`). |
| `parser.ts` | Semantic engine barrel re-exporting `parseGitRecord`, `processBatch`, and `extractNumericMetadata`. |
| `parser-record.ts` | Cursor-based record splitter, single-pass `--raw --numstat` / `--name-status` / `countOnly` (`--summary`) file parser, early `--type` & trailer-only filter short-circuits, conventional commit/breaking/revert/issue extraction, and V8 `flattenString` detachment. |
| `parser-trailers.ts` | Frozen `EMPTY_TRAILERS_RESULT` singleton fast-path and `switch`-based trailer parser (`History-*`, `BREAKING-CHANGE`, `Co-authored-by`, `Reviewed-by`, references, `customTrailers`, `trailersObj`) with prototype-pollution guards (`Object.create(null)`) and `\u200B` multiline stripping. |
| `parser-metadata.ts` & `parser-utils.ts` | Strict finite numeric metadata extraction/filtering (linear `FINITE_DECIMAL_RE`), shared `WeakMap`-cached CLI filter matching (`matchesTrailerFilters`, `matchesCommitEntryFilters`, `matchesRawRecordFilters`), `getLanguage`, O(1) `Set`-based `isNoiseFile`, linear cursor-based `extractIssues` (bounded custom regex cache, O(1) trailing-delim trim, linear `SIMPLE_LIST_REGEX`), cached `expandIssueTrackerUrl`/`resolveIssueTrackerUrl`, `getSlackMap` (cwd-keyed Zod-validated cache), and `truncateSafely`. |
| `parser-batch.ts` | Uses inline numstats when present (falling back to `getNumstatMap` + `getPatchMap` via `Promise.allSettled`), skips unused `files`/`body` construction under `--summary`/`--no-body`/uncached `--stats`, memoizes `patch: ''` on targeted empty/excluded commits (`preFetchedPatchMap = null` suppresses duplicate retry), computes size (`XS`–`XL`) with `SIZE_L_THRESHOLD` noise short-circuit, and validates via `entrySchema` + `parseWithFallbacks`. |
| `schema.ts` | Zod v4 contracts (`entrySchema` — 38 fields, `fileStatusSchema` with strict `.int()` metrics, `cliArgsSchema`). **Always consult before altering parser output.** |
| `cache.ts` | `bun:sqlite` `STRICT` cache (`PRAGMA busy_timeout=5000` before `WAL`, `synchronous=NORMAL`, `temp_store=MEMORY`, `cache_size=-16384`, `user_version=3` warm fast-path, partial `idx_commits_isBreaking_true WHERE isBreaking = 1`, `stmtCache` (32) LRU + finalization + `PRAGMA optimize` on `closeCache()`), positional `insertCommits`, targeted `updateCommitPatches`, `hasCachedCommits`, 3–4 column `batchProbeCommitFilters`, and 5-projection `CHUNK=500` `batchQueryCommits` (`full`/`no-patch`/`stats`/`summary`/`no-body`). |
| `output.ts`, `cache-stream.ts` & `formatters/{markdown,slack}.ts` | Delete-free `projectCommitEntry` & `stripChangelogFields`, `isCacheEligibleQuery`, `validateCustomFormatPath`, concurrent `resolveRepoOriginAsync`, CLI-only `cache-stream.ts` (warm SHA-only `git log --format=%H`, 4-column TS-filter probe with Phase 2 recovery, adaptive batching, concurrent coalesced mixed-batch `git log -p`, single-spawn cold cache writer), built-in Markdown/Slack formatters, and custom `.hbs`/`.txt`/JS/TS formatter loader. |

## ⚡ Fast-Path Agent Command Recipes

Pick the lightest flag that satisfies your task (cost increases top to bottom):

| Goal | Recommended Command | Subprocesses / Diff Cost |
| :--- | :--- | :--- |
| Working-tree status + diffstat | the host's `get-git-history-json.ts --uncommitted --stats` wrapper (add `--path <dir>` to scope) | Concurrent `status` + `diff --numstat` + `config --get-regexp` (`--no-optional-locks`) |
| Latest commit metadata only | the host's `get-git-history-json.ts -n 1 --no-body` wrapper | 1 `git log` (no `--name-status`, no numstat, no patch) |
| Commit summaries + trailers | the host's `get-git-history-json.ts -n 20 --summary` wrapper | 1 `git log --name-status` (`countOnly` file scan, skips numstat & patch) |
| Commit metadata + file metrics | the host's `get-git-history-json.ts -n 20 --stats` wrapper | 1 `git log --raw --numstat` (single-pass inline numstats) |
| Warm cached history / TS filters | the host's `get-git-history-json.ts --cache -n 50 --stats` wrapper | 1 `git log --format=%H` + SQLite projected read / 4-col probe (0 tree diffs on hits) |
| Full diff search + patches | the host's `get-git-history-json.ts -G "<regex>" --include-patch` wrapper | `git log --raw --numstat` + `-p` (concurrent on cold cache misses) |
| Changelog output | the host's `get-git-history-json.ts -r "v1.0.0..HEAD" -f markdown --changelog-only` wrapper | Single-pass `--numstat` + concurrent `remote.origin.url`; supports `json`, `json-array`, `markdown`, `slack`, or custom path |

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
- **Validation**: After modifying this library, run **strictly sequentially**: `bun run lint` → `bun run typecheck` → the host's `bun test lib-git-history/tests/` suite (do NOT use Vitest or Playwright in this repo).

## 📖 Related Context & Usability Testing

- **Committing**: Use `pnpm exec tsx scripts/commit.ts` with explicit `--add <path>` flags (never raw `git commit`). Do not hand-edit generated changelogs.
