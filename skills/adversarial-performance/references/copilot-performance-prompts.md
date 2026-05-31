# Copilot Performance Prompts

Reference for Phase 4 of the adversarial performance protocol — the
independent external validation pass using the GitHub Copilot CLI.

## Prerequisites

1. **GitHub CLI installed**: `gh --version` (v2.x+)
2. **Authenticated**: `gh auth status` passing
3. **Copilot available**: `gh copilot --version` — the `copilot` subcommand is built into modern `gh` CLI (no separate extension needed)

If Copilot CLI is not available, skip Phase 4 gracefully.

## Prompt Templates

> **⚠️ CRITICAL — Non-Interactive Mode**: The `gh copilot` CLI must be run in
> non-interactive mode using the `-p` (or `--prompt`) flag. Interactive mode
> will hang indefinitely in an automated agent context. Use:
>
> ```
> gh copilot -p "<prompt>" --allow-tool "shell(find,cat,head,grep)"
> ```
>
> The `--allow-tool` flag grants Copilot read access to the repository files.

- Expect 60–120 seconds per prompt. In environments with hard synchronous timeouts (like Antigravity's 10s `WaitMsBeforeAsync` limit), allow the command to naturally fall into the background. Use the `schedule` tool or wait for the system notification to retrieve the results. Do not skip execution due to timeout constraints.

## Parsing Copilot Output

1. **Extract findings** — parse tables or numbered lists
2. **Map to categories** — classify against the 7 audit categories
3. **Quantify impact** — if Copilot didn't estimate improvement, add
   your own estimates based on the code context
4. **Deduplicate** — compare against Phase 2 findings
5. **Disposition** — apply Accept/Reject/Modify/Defer from Phase 3

## Prompt Selection Guide

| Audit Depth | Project Profile | Prompts to Use                             |
| ----------- | --------------- | ------------------------------------------ |
| Scan        | Any             | Full Repository only                       |
| Standard    | Non-MCP         | Full Repository + Dependencies             |
| Standard    | MCP Server      | Full Repository + Dependencies + MCP Token |
| Intensive   | Any             | All 3 prompts                              |
