# 🤖 Agent README: Workspace Guidelines (`.agents`)

> **[System Instruction]** You are reading the operational index for the `.agents` directory. This is your primary instruction manual for workflows and scripts within the `neverinfamous` ecosystem. Read strictly and adhere to all listed constraints.

## Architecture
- `workflows/`: Reusable markdown-based instructional plans invoked via slash commands (e.g., `/update-deps`).
- `scripts/`: Standalone Node/Bun/Shell scripts (e.g., `commit.ts`, `get-git-history-json.ts`, `sync-workflows.ts`) used to automate exact logic.

## Workflow Execution Rules
When the USER invokes a slash command, you **MUST**:
1. Open the corresponding `workflows/<workflow-name>.md` file using `view_file`.
2. Follow its instructions exactly, step-by-step.
3. Obey global rules (`<RULE[user_global]>`) over local workflow rules if a conflict occurs.

## Canonical Workflows List

| Slash Command | File Location | Goal / Purpose |
|---------------|---------------|----------------|
| `/bump-deploy` | `workflows/bump-deploy.md` | Version bump, release notes, full validation, and PR/tag deployment. |
| `/cli-audit` | `workflows/cli-audit.md` | Exhaustive audit of CLI entrypoints and scripts for standards compliance. |
| `/doc-audit` | `workflows/doc-audit.md` | Adversarial audit of repo documentation and drift detection. |
| `/dynamic-context-audit` | `workflows/dynamic-context-audit.md` | Exhaustive adversarial audit of MCP dynamic context (prompts, code-map, instructions) via subagents. |
| `/mcp-prompt-audit` | `workflows/mcp-prompt-audit.md` | Exhaustive adversarial audit of MCP server Prompts for protocol compliance. |
| `/mcp-resource-audit` | `workflows/mcp-resource-audit.md` | Exhaustive adversarial audit of MCP server Resources for protocol compliance. |
| `/sync-vendor-plugins` | `workflows/sync-vendor-plugins.md` | Synchronize core infra scripts into memory-journal-mcp. |
| `/update-deps` | `workflows/update-deps.md` | Audit/Update dependencies, lint, typecheck, and commit. |
| `/build-wiki` | `workflows/build-wiki.md` | Scaffold a professional GitHub Wiki repository. |

## Workflow Authoring Standards
If requested to create a new workflow, you MUST:
1. **Naming**: Use `kebab-case.md` matching the slash command.
2. **Path**: Save to `C:\Users\chris\Desktop\adamic\.agents\workflows\`.
3. **Format**: Use concise markdown with actionable steps. Omit standard prose.
4. **Execution**: If running commands, write exact PowerShell or Bun CLI strings. Remember that pipeline chain operators (`&&`, `||`) are forbidden in PowerShell.
