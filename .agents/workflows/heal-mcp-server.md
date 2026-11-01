---
description: Use when you need to review MCP server agent issues (logs/agent-issues.jsonl), implement multi-layered anti-hallucination guardrails, run exhaustive validation, and clear the logs.
---

# MCP Server Optimization & Anti-Hallucination Guardrails

> [!IMPORTANT]
> **Core Philosophy**: Automate away as many problems as possible. When you encounter a hallucination, confusion, or artificial roadblock, DO NOT work around it or settle for a good error message. You MUST modify the underlying infrastructure (codebase, environment profiles, wrappers, schemas) to ensure execution succeeds seamlessly.

---

## 1. Workflow Initialization & Post-NREM Supervisor Audit (`CMS-04`)

1. Identify the target MCP server workspace (e.g. `C:\Users\chris\Desktop\memory-journal-mcp` or `C:\Users\chris\Desktop\mysql-mcp`).
2. **Post-NREM Supervisor Audit (when running on `memory-journal-mcp`)**:
   - Inspect the latest `CMS-02` (`database-optimizer` / `cms-02-nrem-consolidation`) maintenance entry and recent soft-deleted entries (`mj.admin.listDeletedEntries({ limit: 50 })`).
   - Verify that no entry with `significanceType !== null`, `impactScore >= 0.5`, or active relationships was erroneously soft-deleted; auto-restore via `mj.admin.restoreEntry` if found.
3. **Cross-Run Experience & Telemetry Mining**:
   - Read and review the error log file at `<repo_root>/logs/agent-issues.jsonl` and `logs/mcp-audit.jsonl`.
   - Categorize each error by source (`MCP`, `CLI`, `CodeMode`, `Protocol`, `Transports`, `Prompts`) and formulate a concrete healing plan.

---

## 2. Phase 1: Determine Layer of Healing

Prevent friction first; mitigate only as fallback. Address issues across the 6 architectural healing layers:

- **Layer 1: Schema & Instruction Hardening**
  - Add explicit `.describe()` anti-hallucination hints to Zod schemas.
  - Update markdown instruction constants (`src/constants/instructions/markdown/`) and run `pnpm run generate:instructions` (or equivalent code generation scripts).
- **Layer 2: Dispatcher Healing**
  - Implement type coercion, snake_case/camelCase normalization, and payload defaults in `param-normalizer.ts` or dispatcher middleware.
- **Layer 3: Sandbox Proxy Interceptors**
  - Intercept missing `await` calls, return proxy safe fallbacks for failed results (e.g., empty arrays, `.map` safe bindings), and protect against unhandled property accesses in `worker-api-proxy.ts` and `worker-result-proxy.ts`.
- **Layer 4: Alias Management**
  - Map common method variations, plurals, and deprecated names in `METHOD_ALIASES` (e.g., in `src/codemode/api-constants.ts`).
- **Layer 5: CLI Guardrails & Help Injection**
  - Support alternative Commander options/flags (e.g., `--database` for `--db`, `--http`/`--stdio` transport shorthands).
  - Add catch-all dummy commands (`[args...]`), rich `addHelpText` descriptions, and actionable `🛠️ AUTONOMOUS HEALING:` error messages.
- **Layer 6: Environment & Tooling Guardrails**
  - Use deterministic single-line or script edits for environment configuration files.
  - Prioritize agent-native tools (`view_file`, `grep_search`, `list_dir`) over CLI equivalents (`cat`, `grep`, `ls`).

---

## 3. Phase 2: Implementation & Dirty-Tree Conditional Single-Pass Validation Gate

1. Implement necessary source code fixes, schema updates, aliases, and normalizers in a single cohesive batch.
2. Add regression tests to the test suite (e.g., `tests/codemode-healing-guardrails.test.ts`).
3. **DIRTY-TREE CONDITIONAL SINGLE-PASS VALIDATION GATE (CRITICAL):**
   - Check uncommitted working tree state first:
     ```pwsh
     bun .\.agents\scripts\get-git-history-json.ts --uncommitted --stats
     ```
   - **Clean Tree (`0` modified/untracked files)**: **SKIP** `lint`, `typecheck`, `build`, `vitest`, and `playwright` completely! Do NOT execute heavy validation suites when no repository files changed.
   - **Dirty Tree (`>= 1` modified files)**:
     > [!WARNING]
     > **Override & Single-Writer Notice**: When files are modified, the full validation test suite below strictly **OVERRIDES** any default single-file testing rule. Terminate any active subagents first (`manage_subagents` `kill_all`) and run all 5 validation steps **strictly sequentially once** (never concurrently) before committing:

     ```pwsh
     pnpm run lint
     pnpm run typecheck
     pnpm run build
     npx vitest run
     npx playwright test
     ```
     *(Note: DO NOT run `pnpm run check` as it is an unmanaged meta-script that may hang or time out).*

4. If usability coordinator workflows apply, run them.
5. Commit your changes locally using `commit.ts` (when dirty tree was validated):
   ```pwsh
   bun .\.agents\scripts\commit.ts --msg "fix(infra): heal MCP server guardrails, aliases, and error handlers" --impact 0.7 --confidence 0.95 --validation passed --journal --add <paths>
   ```

---

## 4. Phase 3: Log Clearance

Once validation passes and the commit is recorded, purge the resolved issue entries from the log file to provide a clean slate for future runs:

```pwsh
Clear-Content -Path "logs/agent-issues.jsonl"
```
