# 🤖 Agent README: lib-git-history

**Purpose**: This module serves as a **structured repository intelligence layer**, elevating raw version control data far beyond a simple changelog parser into an actionable, semantic model. It is the **Single Source of Truth (SSoT)** for Git history extraction within the `adamic` repository.

By pairing this deterministic history model with a deterministic execution bridge (`lib-agent-exec`), we eliminate the two largest sources of friction in agentic workflows: unpredictable command execution and opaque repository state. 

## Architecture

The module utilizes native Git `--name-status -z` and `--numstat -z` flags, leveraging `NUL` byte delimiting to perfectly parse complex repository states (e.g., file renames, carriage returns, spaces in file names) without string escaping flaws.

1. **`git-runner.ts`**: The execution bridge. It directly interfaces with `git` and handles low-level NUL-byte parsing to extract raw metric data (additions, deletions, statuses).
2. **`parser.ts`**: The semantic engine. It batches commits and maps raw headers into structured conventional commit shapes. It natively parses `feat(scope)!`, `BREAKING CHANGE:` trailers, issue references, co-authors, and computes qualitative sizes (XS, S, M, L, XL).
3. **`schema.ts`**: The contract. Uses `zod` to enforce strict constraints (e.g., `.int()` precision for metrics). **Always consult this schema** if modifying the data returned by the parser.
4. **`../get-git-history-json.ts`**: The primary CLI entrypoint. Agent workflows invoke this file (using `bun`) to retrieve filtered JSON subsets of the history.

## 🧹 Scratch Workspace Protocol

> [!CAUTION]
> **STRICT SCRATCH FILE POLICY**: Agents often mistakenly create temporary files or mock repositories in `.agents/scratch`, `.agents/scripts/scratch-repo`, or the root workspace. This is **STRICTLY FORBIDDEN** and creates a messy workspace.
> 
> **ALWAYS** write your test/scratch files exclusively to the isolated conversation directory:
> `<appDataDir>\brain\<conversation-id>\scratch\`
> 
> NEVER leave scratch files or temporary databases in the active project workspace.

## 🛠️ Usage Guidelines for Agents

- **Read-Only**: Treat this library as core infrastructure. If you must modify it, ensure you run the rigorous Vitest suite in `tests/get-git-history-json.test.ts` to prevent regressions.
- **Data Coercion**: Metrics inside `totalInsertions`, `similarityScore`, etc., are explicitly strict integers. Do not attempt to parse them loosely or pass floating point decimals.
- **File Renames**: Be aware that file renames (status `R`) are structured with both an `oldFile` and `file` property in the file status object.
- **Validation**: Any changes to this module **must** pass `pwsh -c "bun run check"`. The tests depend on carefully constructed mock Git histories.

## 📖 Related Context

- If you need to write a commit using this system, refer to the `C:\Users\chris\Desktop\adamic\.agents\workflows\commit.md` workflow.
- Do NOT edit `.agents/workflows/changelog.md` (or similar changelog files); always extract history using `get-git-history-json.ts` instead.
