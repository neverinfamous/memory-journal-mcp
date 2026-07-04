---
description: Exhaustive adversarial audit of MCP server Prompts to ensure compliance with the official protocol specification and internal execution safety standards.
---

# MCP Prompt Audit Workflow

> **Prerequisite**: Ensure your Git working directory is completely clean before starting. Stash or commit any unrelated changes.
> **Prerequisite**: You MUST read the `/mcp-builder` skill before proceeding, as it contains critical standards (e.g., argsSchema gotchas, Skill Injection Pattern) that this audit enforces.

Run an exhaustive subagent-based documentation and coverage audit of the **Prompts** (user-controlled instruction templates and workflows) exposed by an MCP server repository.

## 1. Audit Initialization

1. Ask the user for the absolute path to the target MCP repository, if they have not provided it (e.g. `C:\Users\chris\Desktop\mysql-mcp`). Do not guess; use the Briefing's registered workspaces to resolve the exact path.
2. Verify that the repository exposes Prompts by checking the server initialization capability block (e.g., `capabilities: { prompts: { ... } }`) in `src/index.ts` or `src/mcp-server.ts`.

---

## Phase 1: Source of Truth (SoT) Research

As the primary agent, you must first establish the ground truth for what prompts are exposed by the server. 

1. Read the architectural logic flows in `test-server/code-map.md`.
2. Locate the prompt registration logic (typically in `src/index.ts`, `src/mcp-server.ts`, or a dedicated `src/handlers/prompts/` directory).
3. Compile a master mapping of all exposed prompts, including their expected arguments.
4. **CRITICAL**: Write this master mapping to a scratch file (e.g., `<appDataDir>\brain\<conversation-id>\scratch\ssot-prompts-mapping.md`). Do not pass massive SSoT strings directly into the subagents' prompts; pass the scratch file path instead.

---

## Phase 2: Parallel Subagent Prompt Audit

You must exhaustively audit all prompt handlers. To prevent context exhaustion, delegate this to subagents.

1. **Define Subagents**: Define a specialized `prompt_auditor` subagent type equipped with `enable_write_tools = true`.
2. **Dispatch Subagents**:
   - Divide the prompt handlers logically among the subagents.
   - Provide the SSoT mapping scratch file path to each subagent.
   - **Crucial Instructions for Subagents**:
     - "**`argsSchema` Compliance**: Check all prompt registrations. If a prompt takes NO arguments or ALL OPTIONAL arguments, it MUST entirely omit the `argsSchema` (otherwise the TypeScript SDK will fail with `-32602`)."
     - "**Flat String Arguments**: Ensure all prompt argument schemas are restricted to flat string types (no nested objects or arrays), as per the MCP protocol specification (`Record<string, string>`)."
     - "**Message Content Types**: Ensure the prompt correctly returns an array of `PromptMessage` objects containing `role` ('user' or 'assistant') and `content`. Ensure `content.type` is correct (`text`, `image`, `audio`, or `resource`)."
     - "**Embedded Resources**: If the prompt embeds a `resource` in its message content, ensure it provides a valid `uri`, `mimeType`, and the `text` or `blob` data."
     - "**Skill Injection Pattern**: For prompts that interface with domain-specific technologies (like databases), ensure they dynamically inject the absolute path to the required `.agents/skills/*.md` file into the prompt output (e.g., `> **CRITICAL**: Before proceeding, you MUST read the domain skill...`)."
     - "**Error Handling**: Ensure the prompt properly returns `-32602` for missing or invalid arguments and `-32603` for internal execution errors."
     - "Ensure argument validation is strict (prefer Zod for parsing arguments if complex)."
       > **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
     - "Make the required structural fixes and return immediately. Do not get stuck in an endless loop attempting to resolve complex TypeScript/Linter errors; report them back."
     - "Report back with a detailed summary of your changes."
3. **Wait for Subagents**: Wait for all subagents to complete their execution and return their summaries before proceeding to Phase 3.

---

## Phase 3: Capability & Lifecycle Audit

1. **Audit Capabilities**: Check the server capability declaration. If the server dynamically updates its list of available prompts, ensure `listChanged: true` is declared inside `prompts`.
2. Ensure the server correctly emits `notifications/prompts/list_changed` when new prompts are added or removed dynamically.
3. Fix any capability gaps using your write tools.

---

## Phase 4: Final Consolidated Report & Committing

1. **Validation**: Run the repository's validation script (e.g., `pnpm run check`) to ensure the subagents haven't broken the build or introduced linter errors. Fix any outstanding issues manually if necessary.

> [!IMPORTANT]
> **HITL Checkpoint**: STOP HERE. Present the full audit report artifact to the user. Wait for explicit approval before proceeding to commit.

2. **Consolidated Report**: Produce a single structured artifact detailing:
   - **Summary of Audit**
   - **Prompt Fixes**: Which prompts had their `argsSchema` fixed, or had Skill Injection added.
   - **Message Fixes**: Which prompts were corrected to return valid `PromptMessage` objects.
3. Commit the changes to the repository:
   > **Note:** Always use the repository's custom commit wrapper (like `commit.ts`) if available, to adhere to global rules.
   ```bash
   git add .
   bun path/to/commit.ts --msg "test: exhaustive mcp prompt audit and protocol compliance" --category Changed --impact 0.5 --confidence 1.0
   ```
