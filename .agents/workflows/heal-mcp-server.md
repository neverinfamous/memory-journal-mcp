---
description: Use when you need to review MCP server agent issues (logs/agent-issues.jsonl), implement multi-layered anti-hallucination guardrails, run exhaustive validation, and clear the logs.
---

# MCP Server Optimization & Anti-Hallucination Guardrails

> [!IMPORTANT]
> **Core Philosophy**: Automate away as many problems as possible. When you encounter a hallucination, confusion, or artificial roadblock, DO NOT work around it or settle for a good error message. You MUST modify the underlying infrastructure (codebase, environment profiles, wrappers, schemas) to ensure execution succeeds seamlessly.

---

## 1. Workflow Initialization

1. Identify the target MCP server workspace (e.g. `C:\Users\chris\Desktop\memory-journal-mcp` or `C:\Users\chris\Desktop\mysql-mcp`).
2. Read and review the error log file at `<repo_root>/logs/agent-issues.jsonl`.
3. Categorize each error by source (`MCP`, `CLI`, `CodeMode`, `Protocol`, `Transports`) and formulate a concrete healing plan.

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

## 3. Phase 2: Implementation & Mandatory Quality Gates

1. Implement necessary source code fixes, schema updates, aliases, and normalizers.
2. Add regression tests to the test suite (e.g., `tests/codemode-healing-guardrails.test.ts`).
3. **MANDATORY VALIDATION MATRIX (CRITICAL GATE):**
   > [!WARNING]
   > **Override Notice**: The full validation test suite execution below strictly **OVERRIDES** any default single-file testing rule. You must run all validation steps sequentially before committing.

   Execute the following commands in order:
   ```pwsh
   pnpm run lint
   pnpm run typecheck
   pnpm run build
   npx vitest run
   npx playwright test
   ```
   *(Note: DO NOT run `pnpm run check` as it is an unmanaged meta-script that may hang or time out).*

4. If usability coordinator workflows apply, run them.
5. Commit your changes locally using `commit.ts`:
   ```pwsh
   bun .\.agents\scripts\commit.ts --msg "fix(infra): heal MCP server guardrails, aliases, and error handlers" --impact 0.7 --confidence 0.95 --validation passed --journal --add <paths>
   ```

---

## 4. Phase 3: Log Clearance

Once validation passes and the commit is recorded, purge the resolved issue entries from the log file to provide a clean slate for future runs:

```pwsh
Clear-Content -Path "logs/agent-issues.jsonl"
```
