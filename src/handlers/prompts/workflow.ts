/**
 * Memory Journal MCP Server - Workflow Prompt Definitions
 *
 * Prompts: find-related, prepare-standup, prepare-retro, weekly-digest,
 * analyze-period, goal-tracker, get-context-bundle, get-recent-entries, confirm-briefing,
 * session-summary, team-session-summary, create-entry, create-team-entry,
 * update-entry, update-team-entry
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'
import type { BriefingConfig } from '../resources/shared.js'
import { ValidationError } from '../../types/errors.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
} from '../../utils/workspace-resolver.js'
import { resolvePromptPriorWorkspace } from './adversarial-helpers.js'
import {
    WORKFLOW_WORKSPACE_ARGUMENTS,
    generateSummaryPrompt,
    generateEntryPrompt,
    generateUpdateEntryPrompt,
} from './workflow-helpers.js'

function resolveWorkflowPromptScope(
    args: Record<string, string> | undefined,
    briefingConfig?: Partial<BriefingConfig>
): {
    workspaceHint?: string
    projectNumber?: number
    explicitDefaultRequested: boolean
} {
    const rawWorkspace = args?.['workspace_id']?.trim()
    const rawProject = args?.['project_number']?.trim()
    if (rawWorkspace === '*') {
        throw new ValidationError(
            "workspace_id '*' is a read-only wildcard and cannot be used to target a workflow write prompt."
        )
    }

    let numericProject: number | undefined
    if (rawProject !== undefined && rawProject.length > 0) {
        const projMatch = /^#?(\d+)$/.exec(rawProject)
        const parsedNum = projMatch !== null ? Number(projMatch[1]) : undefined
        if (parsedNum === undefined || !Number.isSafeInteger(parsedNum) || parsedNum <= 0) {
            throw new ValidationError(
                `Invalid project_number "${rawProject}": must be a positive integer.`
            )
        }
        numericProject = parsedNum

        const registry = briefingConfig?.projectRegistry ?? loadProjectRegistryFromConfig()
        if (registry !== undefined && Object.keys(registry).length > 0) {
            const projectOwners = Object.entries(registry)
                .filter(([, entry]) => entry.project_number === numericProject)
                .map(([key]) => key)
            if (projectOwners.length === 0) {
                throw new ValidationError(
                    `project_number ${String(numericProject)} is not registered in projectRegistry.`
                )
            }
            if (rawWorkspace !== undefined && rawWorkspace.length > 0) {
                const wsKey = findCanonicalRegistryKey(rawWorkspace, registry) ?? rawWorkspace
                if (!projectOwners.some((owner) => owner.toLowerCase() === wsKey.toLowerCase())) {
                    throw new ValidationError(
                        `project_number ${String(numericProject)} belongs to "${projectOwners[0] ?? ''}", not "${rawWorkspace}".`
                    )
                }
            }
        }
    }

    const hasWorkspace = rawWorkspace !== undefined && rawWorkspace.length > 0
    const scope: {
        workspaceHint?: string
        projectNumber?: number
        explicitDefaultRequested: boolean
    } = {
        explicitDefaultRequested: rawWorkspace?.toLowerCase() === 'default',
    }
    if (hasWorkspace) {
        scope.workspaceHint = rawWorkspace
    } else if (numericProject !== undefined) {
        // [INVARIANT] A numeric project resolves through the registry only; an unmatched number
        // resolves to `default` (without explicitDefaultRequested) instead of cwd/session (C13).
        scope.workspaceHint = `#${String(numericProject)}`
    }
    if (numericProject !== undefined) {
        scope.projectNumber = numericProject
    }
    return scope
}

const MCP_HEAL_PROMPT_TEXT = `# MCP Server Optimization & Anti-Hallucination Guardrails

The primary philosophy of this workflow is: **Automate away as many problems as possible.** When you (the agent) encounter a hallucination, confusion, or an artificial roadblock, DO NOT just work around it or settle for throwing a "good error message".

You MUST modify the underlying infrastructure (codebase, environment profiles, wrappers, schemas) to ensure execution succeeds seamlessly without the agent even noticing.

## 1. Workflow Initialization

1. Identify the target MCP server workspace (e.g., \`C:\\Users\\chris\\Desktop\\memory-journal-mcp\` or \`C:\\Users\\chris\\Desktop\\mysql-mcp\`) and reference workflow (\`.agents/workflows/heal-mcp-server.md\`).
2. Read and review the error log file at \`<repo_root>/logs/agent-issues.jsonl\` (and \`logs/mcp-audit.jsonl\` if present).
3. Categorize each error by source (\`MCP\`, \`CLI\`, \`CodeMode\`, \`Protocol\`, \`Transports\`) and formulate a concrete healing plan using the strict hierarchy below.

## 2. Phase 1: Determine the Layer of Healing

There is a strict hierarchy of how you should heal the codebase:
1. **Prevent (Highest Preference - Frictionless Recovery):** Automate the problem away. Modify the API schemas, dispatchers, environment profiles, or interceptors to silently catch, transform, or permit the hallucinatory payload so the execution succeeds automatically.
2. **Mitigate (Fallback Only):** ONLY if the input cannot be safely inferred, coerced, or permitted without causing data destruction, intercept it and throw a highly actionable custom error explicitly guiding the agent on how to fix it immediately.

Determine which of the 6 architectural healing layers needs modification:

### Layer 1: Schema & Instruction Hardening (The First Line of Defense)
The most robust way to prevent a hallucination is to explicitly instruct the agent via the tools list or initialization payload.

* **Schema \`.describe()\` Tags:** When an agent hallucinates a property, update the Zod schema. Add an explicit "Anti-Hallucination Hint" in the \`.describe()\` string. These surface directly in the JSON Schema that agents see on \`tools/list\`.
* **Server Instructions:** If a structural hallucination persists, update the markdown fragments in \`src/constants/instructions/markdown/\` and run the generator script (\`pnpm run generate:instructions\`). **DO NOT** edit \`src/constants/server-instructions.ts\` directly, as it is auto-generated and your changes will be overwritten!

### Layer 2: Dispatcher Healing (Frictionless Recovery)
If agents consistently hallucinate inputs that can be logically inferred or normalized, heal them silently in the dispatcher (\`src/handlers/tools/schemas/hallucination-healer.ts\`, \`src/codemode/api/group-factory.ts\`, or \`param-normalizer.ts\`) before they reach Zod validation.

* **Type Coercion:** If agents pass strings instead of numbers, auto-resolve them.
* **Case Normalization:** Catch and heal \`camelCase\` / \`snake_case\` variations automatically.
* **Explicit Interception:** If a string cannot be coerced, intercept it before validation and throw a highly actionable custom error prefixed with \`🛠️ AUTONOMOUS HEALING: \` to trigger an immediate agent hard-stop.

### Layer 3: Sandbox Proxy Interceptors (Actionable Errors)
When agents execute code in Code Mode, they often make standard Javascript mistakes. Instead of cryptic V8 runtime failures, add Proxy interceptors (e.g., \`worker-api-proxy.ts\`, \`worker-result-proxy.ts\`) to throw explicit guidance or provide safe fallbacks.

* **Missing \`await\` Catching:** Wrap all RPC Promise returns in an additional Proxy to catch synchronous access to async properties.
* **Array Method & Property Healing:** Bind array methods dynamically to inner arrays or expose aliased collection properties (e.g., \`.relationships\` on \`visualizeRelationships\`) when tools return objects containing arrays.

### Layer 4: Alias Management (The Shadowing Trap)
Agents commonly extrapolate method names based on patterns (e.g., trying to call \`mj.listEntries()\` instead of \`mj.searchEntries()\`).

* **Adding Aliases:** Add entries to the \`METHOD_ALIASES\` constant in \`src/codemode/constants/method-aliases.ts\` (re-exported via \`src/codemode/api-constants.ts\`).
* **CRITICAL:** \`METHOD_ALIASES\` entries must point to either (a) a real tool method in the same group, or (b) another alias that eventually resolves to a real tool in the same group.

### Layer 5: CLI Guardrails & Help Injection
When an agent hallucinates CLI flags or usage patterns for standalone scripts or the commander CLI:
* **Option Aliasing:** Add hardcoded aliases for commonly truncated flags in commander (e.g., \`.option('--impact, --impact-score')\`) so execution naturally succeeds.
* **Dummy Command Interception:** When creating dummy commands to intercept agent hallucinations, ALWAYS use \`[args...]\` in the signature (e.g., \`.command('project [args...]')\`) to prevent Commander from throwing a "too many arguments" error before the action can execute.
* **Help Meta-Prompting:** Use Commander's \`addHelpText('after', ...)\` or append to manual help scripts to inject explicit \`🤖 AI AGENT INSTRUCTIONS\` directly into the \`--help\` output, forcing subsequent agents to read explicit guardrails before execution.
* **Actionable Errors:** Ensure that all CLI validation failures and process exits are prefixed with \`🛠️ AUTONOMOUS HEALING: \` to prevent agent loop retries.

### Layer 6: Environment, Workflow & Automation Guardrails (The Meta-Trap)
Agents often run into environment-level interceptors (like global PowerShell profiles, \`.bashrc\`, or global Git hooks) or scheduled automation prompts that throw hallucinatory errors or break command execution.

* **Native Tool Priority:** Always use declared native tools (\`read_file\`, \`edit_file\`, \`write_file\`, \`search_web\`) before shell commands; use \`rg\` or \`Get-ChildItem\` for file search and directory listings.
* **Safe Config & Profile Edits:** Update large/protected JSON configs via deterministic \`node -e\` / \`bun -e\` scripts without echoing secret values, or use surgical \`edit_file\` calls on single contiguous blocks.
* **Transient IDE Errors:** If shifting lines via code edits triggers IDE typing errors, ALWAYS verify with \`pnpm run typecheck\` before attempting complex type refactoring, as it may just be a stale ESLint/TSServer cache.
* **Command Verification Trap:** In environments utilizing PowerShell proxy functions (like \`lib-agent-exec\`), native tools (e.g., \`pnpm\`, \`bun\`, \`git\`) exist as Aliases or Functions rather than traditional executables. DO NOT use \`Get-Command <tool> -CommandType Application\` to verify existence, as this explicitly filters out aliases and will falsely report the tool as missing. Use \`Get-Command <tool>\` without the \`-CommandType\` filter.
* **Self-Improving Automations & Canonical Docs:** If you notice improvement opportunities in the scheduled CMS automations (\`~/.gemini/config/sidecars/*/sidecar.json\`) or the canonical CMS documentation (\`docs/cognitive-management-system.md\` in \`adamic\` and \`Automations.md\` in \`memory-journal-mcp.wiki\`), apply and commit those improvements alongside your code fixes.

## 3. Phase 2: Implementation & Dirty-Tree Conditional Single-Pass Validation Gate

> [!IMPORTANT]
> **HITL APPROVAL GUARDRAIL**: In interactive sessions, obtain explicit Human-in-the-Loop (HITL) approval from the user before modifying global environment files or executable source code. (Unattended \`CMS-04\` scheduled runs are pre-authorized to heal and validate autonomously).

1. Implement necessary source code fixes, schema updates, aliases, normalizers, and regression tests (e.g., \`tests/unit/cms-04-rem-healing.test.ts\`).
2. **Dirty-Tree Conditional Single-Pass Validation Gate:**
   - Check working tree state via \`bun .agents/scripts/get-git-history-json.ts --uncommitted --stats\` (or \`git status --porcelain\`).
   - **If \`0\` files are modified in \`memory-journal-mcp\`**: Skip \`lint\`, \`typecheck\`, \`build\`, \`vitest\`, and \`playwright\` completely.
   - **If \`>= 1\` files are modified in \`memory-journal-mcp\`**: Terminate any active subagents (\`manage_subagents\` \`Action: 'kill_all'\`) and execute the 5-stage validation matrix **strictly sequentially once** (never concurrently, never \`pnpm run check\`):
     \`\`\`pwsh
     pnpm run lint
     pnpm run typecheck
     pnpm run build
     pnpm exec vitest run
     pnpm exec playwright test
     \`\`\`
3. Commit your changes locally using \`commit.ts\`:
   \`\`\`pwsh
   bun .\\.agents\\scripts\\commit.ts --msg "fix(cms): heal MCP server guardrails, aliases, and error handlers" --impact 0.5 --confidence 0.95 --validation passed --journal --add <paths>
   \`\`\`
4. If you also improved any scheduled automation \`sidecar.json\` under \`~/.gemini/config/sidecars/\` or CMS documentation (\`adamic/docs/cognitive-management-system.md\` or \`memory-journal-mcp.wiki/Automations.md\`), commit those explicit files in their respective repositories (never use \`--add .\` in \`~/.gemini\`).

## 4. Phase 3: Log Clearance

Once validation passes and the commit is recorded, purge the resolved issue entries from \`logs/agent-issues.jsonl\` to provide a clean slate for future runs:

\`\`\`pwsh
Clear-Content -Path "logs/agent-issues.jsonl"
\`\`\``

/**
 * Get workflow prompt definitions
 */
export function getWorkflowPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'session-summary',
            description: 'Create a formatted session summary entry',
            icons: [ICON_PROMPT],
            arguments: WORKFLOW_WORKSPACE_ARGUMENTS,
            handler: (
                args: Record<string, string> | undefined,
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter,
                _github?: unknown,
                briefingConfig?: Partial<BriefingConfig>,
                runtime?: object | null
            ) => {
                const scope = resolveWorkflowPromptScope(args, briefingConfig)
                const ws = resolvePromptPriorWorkspace(
                    briefingConfig,
                    scope.workspaceHint,
                    undefined,
                    runtime
                )
                return generateSummaryPrompt(
                    db,
                    teamDb,
                    'personal',
                    ws,
                    briefingConfig,
                    scope.projectNumber,
                    scope.explicitDefaultRequested
                )
            },
        },
        {
            name: 'team-session-summary',
            description: 'Create a formatted team session summary entry',
            icons: [ICON_PROMPT],
            capabilities: { requiresTeamScope: true },
            arguments: WORKFLOW_WORKSPACE_ARGUMENTS,
            handler: (
                args: Record<string, string> | undefined,
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter,
                _github?: unknown,
                briefingConfig?: Partial<BriefingConfig>,
                runtime?: object | null
            ) => {
                const scope = resolveWorkflowPromptScope(args, briefingConfig)
                const ws = resolvePromptPriorWorkspace(
                    briefingConfig,
                    scope.workspaceHint,
                    undefined,
                    runtime
                )
                return generateSummaryPrompt(
                    db,
                    teamDb,
                    'team',
                    ws,
                    briefingConfig,
                    scope.projectNumber,
                    scope.explicitDefaultRequested,
                    runtime
                )
            },
        },
        {
            name: 'create-entry',
            description: 'Create a structured mid-thread journal entry',
            icons: [ICON_PROMPT],
            arguments: WORKFLOW_WORKSPACE_ARGUMENTS,
            handler: (
                args: Record<string, string> | undefined,
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter,
                _github?: unknown,
                briefingConfig?: Partial<BriefingConfig>,
                runtime?: object | null
            ) => {
                const scope = resolveWorkflowPromptScope(args, briefingConfig)
                const ws = resolvePromptPriorWorkspace(
                    briefingConfig,
                    scope.workspaceHint,
                    undefined,
                    runtime
                )
                return generateEntryPrompt(
                    db,
                    teamDb,
                    'personal',
                    ws,
                    briefingConfig,
                    scope.projectNumber,
                    scope.explicitDefaultRequested
                )
            },
        },
        {
            name: 'create-team-entry',
            description: 'Create a structured mid-thread team journal entry',
            icons: [ICON_PROMPT],
            capabilities: { requiresTeamScope: true },
            arguments: WORKFLOW_WORKSPACE_ARGUMENTS,
            handler: (
                args: Record<string, string> | undefined,
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter,
                _github?: unknown,
                briefingConfig?: Partial<BriefingConfig>,
                runtime?: object | null
            ) => {
                const scope = resolveWorkflowPromptScope(args, briefingConfig)
                const ws = resolvePromptPriorWorkspace(
                    briefingConfig,
                    scope.workspaceHint,
                    undefined,
                    runtime
                )
                return generateEntryPrompt(
                    db,
                    teamDb,
                    'team',
                    ws,
                    briefingConfig,
                    scope.projectNumber,
                    scope.explicitDefaultRequested,
                    runtime
                )
            },
        },
        {
            name: 'update-entry',
            description: 'Safely update an existing mid-thread entry or session summary',
            icons: [ICON_PROMPT],
            arguments: WORKFLOW_WORKSPACE_ARGUMENTS,
            handler: (
                args: Record<string, string> | undefined,
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter,
                _github?: unknown,
                briefingConfig?: Partial<BriefingConfig>,
                runtime?: object | null
            ) => {
                const scope = resolveWorkflowPromptScope(args, briefingConfig)
                const ws = resolvePromptPriorWorkspace(
                    briefingConfig,
                    scope.workspaceHint,
                    undefined,
                    runtime
                )
                return generateUpdateEntryPrompt(
                    db,
                    teamDb,
                    'personal',
                    ws,
                    briefingConfig,
                    scope.projectNumber,
                    scope.explicitDefaultRequested
                )
            },
        },
        {
            name: 'update-team-entry',
            description: 'Safely update an existing team entry or team session summary',
            icons: [ICON_PROMPT],
            capabilities: { requiresTeamScope: true },
            arguments: WORKFLOW_WORKSPACE_ARGUMENTS,
            handler: (
                args: Record<string, string> | undefined,
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter,
                _github?: unknown,
                briefingConfig?: Partial<BriefingConfig>,
                runtime?: object | null
            ) => {
                const scope = resolveWorkflowPromptScope(args, briefingConfig)
                const ws = resolvePromptPriorWorkspace(
                    briefingConfig,
                    scope.workspaceHint,
                    undefined,
                    runtime
                )
                return generateUpdateEntryPrompt(
                    db,
                    teamDb,
                    'team',
                    ws,
                    briefingConfig,
                    scope.projectNumber,
                    scope.explicitDefaultRequested,
                    runtime
                )
            },
        },
        {
            name: 'mcp-heal',
            description: 'Guide for modifying MCP codebase to proactively prevent, mitigate, and heal LLM hallucinations',
            icons: [ICON_PROMPT],
            handler: () => ({
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: MCP_HEAL_PROMPT_TEXT,
                        },
                    },
                ],
            }),
        },
        {
            name: 'project-setup',
            description: 'Guide for initializing and registering a new project in the memory-journal-mcp global registry',
            icons: [ICON_PROMPT],
            handler: () => {
                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# Project Initialization Workflow

When initializing a new project into the \`memory-journal-mcp\` global registry, you must follow these exact steps to ensure it is registered and tracked correctly.

## Primary Method: MCP Code Mode (Recommended)
You can natively register and initialize the project directly in the sandbox without needing to orchestrate shell commands.

1. Invoke the \`mj_execute_code\` tool.
2. Call the \`mj.admin.registerProject\` method:
\`\`\`javascript
const res = await mj.admin.registerProject("my-project", "C:/path/to/my-project", 123);
return res;
\`\`\`
This method automatically parses the config, registers the path, and securely initializes the database entry in one transaction.

## Fallback Method: Global CLI
If you prefer to use terminal commands, you can use the global CLI wrapper.

\`\`\`bash
memory-journal-mcp project create <project-name> --path <absolute-path-to-repo> --number <github-project-number>
\`\`\`

*Note: The CLI now AUTOMATICALLY initializes the project database entry under the hood. You no longer need to run a secondary \`memory-journal-mcp entry create\` command unless you explicitly pass the \`--skip-init\` flag.*

## Verify
Once the command or Code Mode execution succeeds, the project is officially registered and you may proceed with any further initialization tasks (e.g., scaffolding files, setting up CI/CD).`
                            },
                        },
                    ],
                }
            },
        },
    ]
}
