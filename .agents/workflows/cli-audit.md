---
description: Exhaustive adversarial audit of CLI entrypoints and scripts to ensure compliance with the cli-development skill standards, with a strict focus on Agent-Optimized Interfaces (stdio discipline, deep JSON schemas, and fallback behavior).
---

# Agent-Optimized CLI Audit Workflow

> **Prerequisite**: Ensure your Git working directory is completely clean before starting. Stash or commit any unrelated changes.
> **Prerequisite**: You MUST read the `/cli-development` skill before proceeding, as it contains critical standards that this audit enforces.

Run an exhaustive codebase audit of Command Line Interface (CLI) scripts and entrypoints to ensure they provide a top-tier UX for humans while remaining strictly **agent-optimized** and CI-compatible.

## 1. Audit Initialization

1. Ask the user for the absolute path to the target CLI script or the directory containing the CLI entrypoints.
2. Build a Source of Truth (SSoT) by running the target tools with their `--help` flag to understand the current argument and flag surface area.

---

## Phase 1: Architecture & Validation Audit

For each CLI entrypoint, analyze the parsing and validation logic:

1. **Argument Parsing**: If the script is manually parsing `process.argv` with complex regex or loops, refactor it to use `util.parseArgs` (for simple scripts) or `commander`/`cac` (for complex, multi-command tools).
2. **Type-Safe Boundaries**: Ensure the parsed flags and arguments are strictly validated using `zod` before being passed into the core domain logic. Do not pass untyped `any` or `unknown` objects into the core logic.

---

## Phase 2: Stdio Stream Discipline (CRITICAL)

This is the most critical phase. Agentic interactions heavily rely on structured outputs. If a CLI corrupts its `stdout` with decorative text or unparseable logs, it breaks the agent loop entirely.

1. **Audit `stdout`**: Review all instances of `console.log`, `process.stdout.write`, or `echo`. Ensure `stdout` is **strictly** reserved for the final structured output of the command (e.g., a JSON envelope or final piped data). 
2. **Route to `stderr`**: Ensure all out-of-band communication is routed to `stderr` (`console.error`, `process.stderr.write`). This includes:
   - Error messages and stack traces
   - Progress spinners (e.g., `ora` or `@clack/prompts` spinners)
   - Interactive prompts
   - Decorative or informational logs

---

## Phase 3: Agent-Optimized Interfaces & Fallbacks

A top-of-the-line CLI must provide an excellent human experience while remaining fully controllable by autonomous agents and CI systems.

1. **Terminal UI**: Replace basic `readline` or raw `prompt` queries with `@clack/prompts` for a beautiful, modern terminal aesthetic.
2. **Non-Interactive Fallbacks**: Ensure the CLI gracefully handles non-interactive environments.
   - Detect `process.env.CI` or `NonInteractive` flags.
   - If an interactive prompt is required but the environment is non-interactive (or an agent is executing it), the CLI MUST fail fast with a clear `stderr` message explaining which flag is missing, rather than hanging indefinitely waiting for input.
3. **Deep JSON Introspection (`--json`)**: Ensure the CLI supports a `--json` flag (if applicable) that suppresses all decorative UI and emits a single structured JSON envelope to `stdout`.
   - **Recursive Trees**: For multi-command tools, `--help --json` MUST recursively output the entire command tree (all subcommands, options, and arguments) in a single payload. Agents should not have to waste tokens executing `--help` repeatedly to discover subcommands.
   - **AI Instructions**: If the CLI defines `aiInstructions` in its help definitions, ensure the JSON mode cleanly formats them as a string array, stripping out any decorative terminal formatting (e.g., `🤖`).

---

## Phase 4: Parallel Subagent Execution (Optional)

If there are more than 3 CLI files to audit, delegate Phases 1-3 to parallel subagents to prevent context exhaustion. 

- Provide the subagents with the SSoT of the flags.
- Instruct them explicitly on the `stdout` vs `stderr` rule.
- Request they report back with the applied changes.

---

## Phase 5: Documentation Audit

A robust CLI must have accurate documentation.
1. Identify any `AGENT_README.md` or `README.md` files associated with the CLI tool.
2. Review and update the documentation to accurately reflect any new flags, standard stream disciplines, JSON behaviors, or UI improvements introduced during this audit. Ensure payload schemas or usage examples are kept up to date.

---

## Phase 6: Final Consolidated Report & Committing

> [!IMPORTANT]
> **HITL Checkpoint**: STOP HERE. Present the full audit report artifact to the user detailing the improvements made to argument parsing, stdio discipline, and UI fallbacks. Wait for explicit approval before proceeding to commit.

1. **Validation**: Run the project's build, lint, and test scripts (e.g., `pwsh -c "bun run check"`) to ensure the refactors did not break the core logic.
2. **Commit**: Use the repository's native commit wrapper (e.g., `commit.ts`) if available to commit the changes.
   ```bash
   bun path/to/commit.ts --msg "refactor(cli): enforce agent-optimized standards and strict stdio discipline" --category Changed --impact 0.6 --confidence 1.0 --validation passed
   ```
