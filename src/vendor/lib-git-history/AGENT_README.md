# 🤖 Agent README: lib-git-history

**Purpose**: This module serves as a **structured repository intelligence layer**, elevating raw version control data far beyond a simple changelog parser into an actionable, semantic model. It is the **Single Source of Truth (SSoT)** for Git history extraction within the `adamic` repository.

By pairing this deterministic history model with a deterministic execution bridge (`lib-agent-exec`), we eliminate the two largest sources of friction in agentic workflows: unpredictable command execution and opaque repository state. 

## Architecture

The module utilizes native Git `--name-status -z` and `--numstat -z` flags, leveraging `NUL` byte delimiting to perfectly parse complex repository states (e.g., file renames, carriage returns, spaces in file names) without string escaping flaws.

1. **`git-runner.ts`**: The execution bridge. It directly interfaces with `git` and handles low-level NUL-byte parsing to extract raw metric data (additions, deletions, statuses). Accepts an optional `cwd` argument, allowing cross-repository and vendor execution contexts without pathing errors.
2. **`parser.ts`**: The semantic engine export hub. To respect strict size constraints, the heavy parsing logic is split into specialized modules:
   - **`parser-record.ts`**: Natively parses raw NUL-delimited strings, `feat(scope)!`, `BREAKING CHANGE:` trailers, revert references (`revertedCommit`), and issue references. It extracts mapped trailers (`History-Category`, `History-Entry`, `History-Significance`, `History-Impact`, `History-Confidence`, `History-Validation`, `History-Journal`, `History-Journal-Project`, and deprecated `Trust`) into the commit's `metadata` object using pattern matching, populates `trailersObj` and `customTrailers`, and manages error boundaries.
   - **`parser-batch.ts`**: Handles the asynchronous correlation of patch data, numstats, and base commit data, and computes qualitative sizes (XS, S, M, L, XL). Sets boundary flags like `isPatchTruncated` and `isFilesTruncated` when output exceeds configured constraints.
   - **`parser-metadata.ts`**: Provides helper utilities for evaluating and extracting numeric metadata (like Impact, Confidence, and deprecated Trust) from string values.
3. **`schema.ts`**: The contract. Uses `zod` to enforce strict constraints (e.g., `.int()` precision for metrics). **Always consult this schema** if modifying the data returned by the parser.
4. **`../get-git-history-json.ts`**: The primary CLI entrypoint. Agent workflows invoke this file (using `bun`) to retrieve filtered JSON subsets of the history. Use the `--summary` flag to retrieve `metadata` without the heavy patch/body diffs, or the `--stats` flag for lightweight file modification metrics.
5. **`../search-conversation-history.ts`**: The conversation history search wrapper. Target-binds execution (`process.chdir`) to the `~/.gemini` repository to allow agents to search past conversation logs, session history, and system state snapshots.

## 🧹 Scratch Workspace Protocol

> [!CAUTION]
> **STRICT SCRATCH FILE POLICY**: Agents often mistakenly create temporary files or mock repositories in `.agents/scratch`, `.agents/scripts/scratch-repo`, or the root workspace. This is **STRICTLY FORBIDDEN** and creates a messy workspace.
> 
> **ALWAYS** write your test/scratch files exclusively to the isolated conversation directory:
> `<appDataDir>\brain\<conversation-id>\scratch\`
> 
> NEVER leave scratch files or temporary databases in the active project workspace.

## 🚫 Anti-Patterns

- **NEVER** use `git log`, `git shortlog`, or `git show` to read or parse commit history in any repository. 
- **NEVER** use `git status` or `git diff` and try to parse the raw text to read the current uncommitted state.
- The `get-git-history-json.ts` script is the required mechanism for all history AND current uncommitted state exploration. 
- If you simply need the current HEAD SHA, use `git rev-parse HEAD` or `git rev-parse --short HEAD`.

## 🛠️ Usage Guidelines for Agents

- **CLI Help**: The script has a comprehensive built-in manual. Run `bun .\.agents\scripts\get-git-history-json.ts --help` to explore all available filtering and formatting options. Key flags include:
  - `--type <type>`, `--category <cat>`, `--breaking` (filter by conventional commit parameters)
  - `--impact <val>`, `--confidence <val>` (filter by numerical impact/confidence thresholds)
  - `--diff-filter <filter>`, `--patch-search <pattern>`, `--reverse` (filter by file status, patch content, or order)
  - `--diff-context <lines>`, `--max-body-length <bytes>`, `--max-patch-length <bytes>` (constrain diff patch and body memory boundaries)
- **Uncommitted State**: To get a deterministic JSON readout of the current staged, unstaged, and untracked files in the working directory, use `bun .\.agents\scripts\get-git-history-json.ts --uncommitted --stats`. Do NOT parse raw `git status` text.
- **Historical Conversation Search**: To search Antigravity conversation logs, session histories, or state snapshots tracked in `~/.gemini`, use `bun .\.agents\scripts\search-conversation-history.ts` (e.g., `--search "query"` or `--summary`).
- **Output Formats & Streaming**: The default output is a JSON object. Use `--jsonl` to stream JSON Lines output. Use `--stream-to-file <path>` to write directly to disk and avoid stdout buffer limits. Use `--no-body` to skip retrieving expensive diff patches, file metrics, and commit bodies. You can also specify `--max-body-length` (default 100MB) to constrain parser memory.
- **Context & Caching**: Use `--package-version` to inject the `package.json` version into the output metadata. Enable caching with `--cache` and auto-expand issue references (e.g., `#123`) using `--issue-tracker <url>`.
- **Read-Only**: Treat this library as core infrastructure. If you must modify it, ensure you run the rigorous test suite using **Bun** (`bun test`) to prevent regressions. Do NOT attempt to run Vitest or Playwright.
- **Data Coercion**: Metrics inside `totalInsertions`, `totalDeletions`, `similarityScore`, `insertions` and `deletions` are explicitly strict integers. Do not attempt to parse them loosely or pass floating point decimals.
- **File Renames**: Be aware that file renames (status `R`) are structured with both an `oldFile` and `file` property in the file status object.
- **Trailers & Metadata**: Custom trailers (such as `History-Journal` and `History-Journal-Project` generated by the memory journal integration) are fully extracted into `trailersObj` and `metadata.customTrailers`. Explicitly mapped metadata are stored natively at the root of the strongly-typed `metadata` object. *Note: Internally, the `commit.ts` CLI normalizes multiline text with zero-width spaces (`\u200B`) to bypass Git's trailer block truncation rules on empty lines, and `parser-record.ts` explicitly removes them when extracting JSON.*
- **Validation**: Any changes to this module **must** pass `bun run check`. The tests depend on carefully constructed mock Git histories.
- **Custom Formatting**: The script supports custom templating using `.hbs` or `.txt` Handlebars templates, as well as JS/TS modules (`.ts`, `.js`, `.mjs`, `.cjs`) that export a `default` or `format` function. Provide the absolute path to your template/module via the `--format <path>` flag. The template has access to a `commits` array and a structured `versionMap`. Note that custom formatters (and built-in markdown/slack) will include ALL commits by default; if you want to restrict output to a changelog (only feat, fix, etc.), you MUST explicitly pass the `--changelog-only` flag.

## 📖 Related Context

- If you need to write a commit using this system, use the `/mcp:memory-journal-mcp:commit` or `/mcp:memory-journal-mcp:quick-commit` prompts.
- Do NOT edit `.agents/workflows/changelog.md` (or similar changelog files); always extract history using `get-git-history-json.ts` instead.

## 🧪 Usability & Hallucination Testing

If you are modifying the history parsing logic, you MUST run the usability testing suite to ensure LLMs do not hallucinate or break when piping large JSON responses.
- **Run the Fuzzing Suite:** Ask the user to "Execute the `/dynamic-audit-usability` workflow", or manually trigger the subagents defined in `.agents/scripts/usability/coordinator-workflow.md`.
- **Test Auto-Generation:** The tests in `test-usability-*.md` are **auto-generated**. Do not edit them directly. Update `.agents/scripts/usability/scripts/test-manifest.ts` or the `content/` partials instead, then run `bun .\.agents\scripts\usability\scripts\generate-tests.ts`.

---

## 📈 Continuous Self-Improvement
As an agent operating within this workspace, you are expected to practice continuous self-improvement. If you identify gaps, ambiguities, or missing instructions during an audit or execution task, **proactively update this `AGENT_README.md`** and relevant testing prompts. You are empowered to refine your own processes.
