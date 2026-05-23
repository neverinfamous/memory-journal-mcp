# Copilot Performance Prompts

Reference for Phase 4 of the adversarial performance protocol — the
independent external validation pass using the GitHub Copilot CLI.

## Prerequisites

1. **Copilot CLI installed**: `gh extension list | grep copilot` or install via `gh extension install github/gh-copilot`
2. **Authenticated**: `gh auth status` and `gh copilot --version`

If unavailable, skip Phase 4 gracefully.

## Prompt Templates

### Full Repository Performance Audit

> **Note:** The `gh copilot` CLI extension does not natively support non-interactive file stream piping for open-ended prompts like the deprecated `@github/copilot` npm package did.
> For Phase 4 audits, you must either:
> 1. Fall back to manual Copilot Chat window usage.
> 2. Use `gh copilot explain <file>` individually for hot-path files (e.g., `gh copilot explain src/codemode/sandbox.ts`).

If automated validation is strictly required and `gh copilot` cannot execute the prompt non-interactively, document the limitation in the `perf_copilot` journal entry and mark Phase 4 as manually bypassed.

## Parsing Copilot Output

1. **Extract findings** — parse tables or numbered lists
2. **Map to categories** — classify against the 7 audit categories
3. **Quantify impact** — if Copilot didn't estimate improvement, add
   your own estimates based on the code context
4. **Deduplicate** — compare against Phase 2 findings
5. **Disposition** — apply Accept/Reject/Modify/Defer from Phase 3

## Prompt Selection Guide

| Audit Depth | Project Profile | Prompts to Use |
| --- | --- | --- |
| Scan | Any | Full Repository only |
| Standard | Non-MCP | Full Repository + Dependencies |
| Standard | MCP Server | Full Repository + Dependencies + MCP Token |
| Intensive | Any | All 3 prompts |
