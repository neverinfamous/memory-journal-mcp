/**
 * Memory Journal MCP Server - Workflow Prompt Definitions
 *
 * Prompts: find-related, prepare-standup, prepare-retro, weekly-digest,
 * analyze-period, goal-tracker, get-context-bundle, get-recent-entries, confirm-briefing,
 * analyze-period, goal-tracker, get-context-bundle, get-recent-entries, confirm-briefing,
 * session-summary, team-session-summary, create-entry, create-team-entry,
 * update-entry, update-team-entry
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef, PromptMessage } from './index.js'
import { ConfigurationError } from '../../types/errors.js'
import { markUntrustedContent } from '../../utils/security-utils.js'


import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { fileURLToPath } from 'node:url'

let isGeneratingCodeMap = false

function getProjectRegistryHint(): string {
    try {
        const configPath = path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
        if (existsSync(configPath)) {
            const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
            if ('projectRegistry' in config && config['projectRegistry'] != null) {
                const projects = Object.entries(config['projectRegistry'] as Record<string, unknown>)
                    .map(([name, data]: [string, unknown]) => `${name} (${String((data as Record<string, unknown>)['project_number'])})`)
                    .join(', ')
                if (projects) {
                    return `\n**Projects:** ${projects} (Use these IDs instead of memory://agent-context/{repo} if applicable)\n`
                }
            }
        }
    } catch {
        // fail silently
    }
    return ''
}

function generateSummaryPrompt(
    db: IDatabaseAdapter, 
    teamDb: IDatabaseAdapter | undefined, 
    target: 'personal' | 'team'
): { messages: PromptMessage[] } {
    if (target === 'team' && !teamDb) {
        throw new ConfigurationError('Team database not configured')
    }

    const targetDb = target === 'team' && teamDb ? teamDb : db
    const { entries: recent } = targetDb.getRecentEntries(5)

    const entrySummary =
        recent.length > 0
            ? recent
                  .map(
                      (e) =>
                          `- #${String(e.id)} (${e.entryType}) ${e.content.slice(0, 80)}${e.content.length > 80 ? '...' : ''}`
                  )
                  .join('\n')
            : '- No entries yet'


    try {
        if (!isGeneratingCodeMap) {
            const packageJsonUrl = new URL('../../../package.json', import.meta.url)
            const packageJsonPath = fileURLToPath(packageJsonUrl)
            
            if (existsSync(packageJsonPath)) {
                const pkg: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
                if (pkg !== null && typeof pkg === 'object' && 'name' in pkg && pkg.name === 'memory-journal-mcp') {
                    isGeneratingCodeMap = true
                    const scriptUrl = new URL('../../../scripts/update-code-map.ts', import.meta.url)
                    const absoluteScriptPath = fileURLToPath(scriptUrl)
                    const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
                    const child = spawn(cmd, ['tsx', absoluteScriptPath], { 
                        stdio: 'ignore', 
                        shell: process.platform === 'win32',
                        windowsHide: true
                    })
                    child.on('exit', () => { isGeneratingCodeMap = false })
                    child.on('error', () => { isGeneratingCodeMap = false })
                    child.unref()
                }
            }
        }
    } catch {
        // Fail silently so we don't break the prompt fetch
        isGeneratingCodeMap = false
    }

    const registryHint = getProjectRegistryHint()

    return {
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `Create a ${target === 'team' ? 'team ' : ''}session summary journal entry using EXACTLY this template:

**Required YAML Frontmatter:**
At the top of your markdown file, include a YAML frontmatter block with the following keys:
\`\`\`yaml
---
type: "retrospective"
tags: ["session-summary", "your-tag-1", "your-tag-2"]
project: <Integer ID mapped from your active workspace context>
impact: <Decimal score analyzing blast radius (e.g., 0.9+ for core architecture, 0.1 for docs)>
trust: <Decimal score analyzing testing rigor. 0.3-0.5 for unverified, 0.8-1.0 if rigorously tested>
validation_status: "passed" # or "none", or "failed"
auto_context: 
  type: "session-commits"
  commits: ["<sha>"]
  branch: "<branch_name>"
  pr: <number>
relationships: 
  - target_id: 123
    relation_type: "resolves" # 'resolves', 'depends_on', 'implements', 'relates_to'
---
\`\`\`

**Required Content Structure (use EXACTLY these section headers):**
\`\`\`
## Accomplished
- [List non-code strategic items, decisions, and research. Do NOT list routine code changes or commits, as those belong in Git]

## Unfinished / Blocked
- [List pending items, blockers, open questions — or "None" if everything is complete]

## Context for Next Session
- [List key context: relevant entry IDs, branch names, PR numbers, pending decisions]
\`\`\`

**Rules:**
- Do NOT add extra top-level sections (no "## Summary", "## Overview", "## Notes", etc.)
- Do NOT omit any of the three required sections
- Use bullet points within each section
- Reference specific entry IDs, file names, and PR numbers where relevant
${registryHint}- If you lose track of your project number, workspace, or agent ID, read the \`memory://agent-context/{repo}\` resource to retrieve it instead of reloading the full briefing (which wastes tokens)

**Recent Entries (for context):**
${markUntrustedContent(entrySummary)}

**Execution:**
Write your markdown file (with the YAML frontmatter at the top) to your scratch directory (e.g. \`<appDataDir>\\brain\\<conversation-id>\\scratch\\\`) to avoid shell quotes. Then execute: \`memory-journal-mcp entry create ${target === 'team' ? '--team ' : ''}--file <scratch_dir>/session.md\``,
                },
            },
        ],
    }
}

function generateEntryPrompt(_db: IDatabaseAdapter, _teamDb: IDatabaseAdapter | undefined, target: 'personal' | 'team'): { messages: PromptMessage[] } {
    const registryHint = getProjectRegistryHint()

    return {
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `Create a ${target === 'team' ? 'team ' : ''}mid-thread journal entry using EXACTLY this template:

**Required YAML Frontmatter:**
At the top of your markdown file, include a YAML frontmatter block with the following keys:
\`\`\`yaml
---
type: "architecture" # MUST be "decision", "bug_fix", "milestone", or "architecture" (do NOT use "retrospective")
tags: ["domain-tag", "another-tag"]
project: <Integer ID mapped from your active workspace context>
impact: <Decimal score analyzing blast radius (e.g., 0.9+ for core architecture, 0.1 for docs)>
trust: <Decimal score analyzing testing rigor. 0.3-0.5 for unverified, 0.8-1.0 if rigorously tested>
validation_status: "passed" # or "none", or "failed"
relationships: 
  - target_id: 123
    relation_type: "resolves" # 'resolves', 'depends_on', 'implements', 'relates_to'
---
\`\`\`

**Required Content Structure:**
Just provide a concise markdown description of the specific architectural decision, strategic pivot, or blocker. Do NOT log routine code changes or bug fixes here; those belong strictly in Git. Keep it under 150 words. No top-level headers required.

**Rules:**
${registryHint}- If you lose track of your project number, workspace, or agent ID, read the \`memory://agent-context/{repo}\` resource to retrieve it instead of reloading the full briefing (which wastes tokens)

**Execution:**
Write your markdown file (with the YAML frontmatter at the top) to your scratch directory (e.g. \`<appDataDir>\\brain\\<conversation-id>\\scratch\\\`) to avoid shell quotes. Then execute: \`memory-journal-mcp entry create ${target === 'team' ? '--team ' : ''}--file <scratch_dir>/entry.md\``
                }
            }
        ]
    }
}

function generateUpdateEntryPrompt(db: IDatabaseAdapter, teamDb: IDatabaseAdapter | undefined, target: 'personal' | 'team'): { messages: PromptMessage[] } {
    const targetDb = target === 'team' && teamDb ? teamDb : db
    let entryContext = ''
    try {
        const recentRes = targetDb.getRecentEntries(1) as { entries?: unknown[] } | unknown[]
        const recent = (Array.isArray(recentRes) ? recentRes[0] : recentRes.entries?.[0]) as Record<string, unknown> | undefined
        if (recent) {
            entryContext = `
**Target Entry Details (Pre-fetched for your convenience):**
- **ID:** ${String(recent['id'])}
- **Version:** ${String(recent['version'])}
- **Type:** ${String(recent['entryType'])}
- **Tags:** ${recent['tags'] != null ? JSON.stringify(recent['tags']) : '[]'}
- **Content:**
\`\`\`markdown
${String(recent['content'])}
\`\`\`
`
        }
    } catch {
        // fail silently
    }

    return {
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `Update an existing ${target === 'team' ? 'team ' : ''}journal entry safely.

**Step 1: Identify the Target Entry**
- The most recent entry has been pre-fetched below for your convenience. If the user did not specify an ID, you MUST update this pre-fetched entry.
- You do NOT need to fetch it using mj.core.getEntryById unless the user asks to update a DIFFERENT entry ID.
${entryContext}

**Step 2: Apply Conditional Formatting Rules**
Look at the tags and structure of the target entry:
- If it has the \`session-summary\` tag: You MUST preserve the exact 3-header structure (\`## Accomplished\`, \`## Unfinished / Blocked\`, \`## Context for Next Session\`). Do not flatten the text; only append or modify the relevant bullet points.
- If it is a standard entry: Keep your modifications concise and under 150 words.

**Step 3: Execute the Update**
- You MUST pass the existing \`version\` as the \`expected_version\` parameter to prevent concurrent overwrites.
- Ensure you write the full updated \`content\` string to a markdown file in your scratch directory.
- If you want to modify fields like tags, trust, or impact, simply add a YAML frontmatter block (\`---\`... \`---\`) to the top of your markdown file. Otherwise, omit it to preserve existing values.

**Rules:**
${getProjectRegistryHint()}- If you lose track of your project number, workspace, or agent ID, read the \`memory://agent-context/{repo}\` resource to retrieve it instead of reloading the full briefing (which wastes tokens)

**Execution:**
Write your updated markdown file to your scratch directory (e.g. \`<appDataDir>\\brain\\<conversation-id>\\scratch\\\`) to avoid shell quotes. Then execute: \`memory-journal-mcp entry update ${target === 'team' ? '--team ' : ''}--id <ENTRY_ID> --expected-version <VERSION> --file <scratch_dir>/updated_entry.md\``
                }
            }
        ]
    }
}

/**
 * Get workflow prompt definitions
 */
export function getWorkflowPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'session-summary',
            description: 'Create a formatted session summary entry',
            icons: [ICON_PROMPT],
            handler: async (
                _args: Record<string, string> | undefined,
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter,
                _github?: unknown
            ) => {
                await Promise.resolve()
                return generateSummaryPrompt(db, teamDb, 'personal')
            },
        },
        {
            name: 'team-session-summary',
            description: 'Create a formatted team session summary entry',
            icons: [ICON_PROMPT],
            handler: async (
                _args: Record<string, string> | undefined,
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter,
                _github?: unknown
            ) => {
                await Promise.resolve()
                return generateSummaryPrompt(db, teamDb, 'team')
            },
        },
        {
            name: 'create-entry',
            description: 'Create a structured mid-thread journal entry',
            icons: [ICON_PROMPT],
            handler: async (
                _args: Record<string, string> | undefined,
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter
            ) => {
                await Promise.resolve()
                return generateEntryPrompt(db, teamDb, 'personal')
            },
        },
        {
            name: 'create-team-entry',
            description: 'Create a structured mid-thread team journal entry',
            icons: [ICON_PROMPT],
            handler: async (
                _args: Record<string, string> | undefined,
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter
            ) => {
                await Promise.resolve()
                return generateEntryPrompt(db, teamDb, 'team')
            },
        },
        {
            name: 'update-entry',
            description: 'Safely update an existing mid-thread entry or session summary',
            icons: [ICON_PROMPT],
            handler: async (
                _args: Record<string, string> | undefined,
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter
            ) => {
                await Promise.resolve()
                return generateUpdateEntryPrompt(db, teamDb, 'personal')
            },
        },
        {
            name: 'update-team-entry',
            description: 'Safely update an existing team entry or team session summary',
            icons: [ICON_PROMPT],
            handler: async (
                _args: Record<string, string> | undefined,
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter
            ) => {
                await Promise.resolve()
                return generateUpdateEntryPrompt(db, teamDb, 'team')
            },
        },
        {
            name: 'mcp-heal',
            description: 'Guide for modifying MCP codebase to proactively prevent, mitigate, and heal LLM hallucinations',
            icons: [ICON_PROMPT],
            handler: () => {
                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# MCP Server Optimization & Anti-Hallucination Guardrails

The primary philosophy of this workflow is: **Automate away as many problems as possible.** When you (the agent) encounter a hallucination, confusion, or an artificial roadblock, DO NOT just work around it or settle for throwing a "good error message".

You MUST modify the underlying infrastructure (codebase, environment profiles, wrappers) to ensure execution succeeds seamlessly without the agent even noticing.

## 1. Workflow Initialization

1. Identify the specific hallucination, confusion error, or roadblock that occurred.
2. Formulate a plan to heal the codebase using the strict hierarchy below.

## 2. Phase 1: Determine the Layer of Healing

There is a strict hierarchy of how you should heal the codebase:
1. **Prevent (Highest Preference - Frictionless Recovery):** Automate the problem away. Modify the API schemas, dispatchers, environment profiles, or interceptors to silently catch, transform, or permit the hallucinatory payload so the execution succeeds automatically.
2. **Mitigate (Fallback Only):** ONLY if the input cannot be safely inferred, coerced, or permitted without causing data destruction, intercept it and throw a highly actionable custom error explicitly guiding the agent on how to fix it immediately.

Determine which of the 4 layers needs modification:

### Layer 1: Schema & Instruction Hardening (The First Line of Defense)
The most robust way to prevent a hallucination is to explicitly instruct the agent via the tools list or initialization payload.

* **Schema \`.describe()\` Tags:** When an agent hallucinates a property, update the Zod schema. Add an explicit "Anti-Hallucination Hint" in the \`.describe()\` string. These surface directly in the JSON Schema that agents see on \`tools/list\`.
* **Server Instructions:** If a structural hallucination persists, update the markdown fragments in \`src/constants/server-instructions/\` and run the generator script (\`pnpm run generate:instructions\`). **DO NOT** edit \`src/constants/server-instructions.ts\` directly, as it is auto-generated and your changes will be overwritten!

### Layer 2: Dispatcher Healing (Frictionless Recovery)
If agents consistently hallucinate inputs that can be logically inferred or normalized, heal them silently in the dispatcher (\`src/codemode/api/group-factory.ts\` or \`param-normalizer.ts\`) before they reach Zod validation.

* **Type Coercion:** If agents pass strings instead of numbers, auto-resolve them.
* **Case Normalization:** Catch and heal \`camelCase\` variations automatically.
* **Explicit Interception:** If a string cannot be coerced, intercept it before validation and throw a highly actionable custom error prefixed with \`🛠️ AUTONOMOUS HEALING: \` to trigger an immediate agent hard-stop.

### Layer 3: Sandbox Proxy Interceptors (Actionable Errors)
When agents execute code in Code Mode, they often make standard Javascript mistakes. Instead of cryptic V8 runtime failures, add Proxy interceptors (e.g., \`worker-api-proxy.ts\`, \`worker-result-proxy.ts\`) to throw explicit guidance.

* **Missing \`await\` Catching:** Wrap all RPC Promise returns in an additional Proxy to catch synchronous access to async properties.
* **Array Method Healing:** Bind array methods dynamically to inner arrays if tools return objects containing arrays.

### Layer 4: Alias Management (The Shadowing Trap)
Agents commonly extrapolate method names based on patterns (e.g., trying to call \`mj.listEntries()\` instead of \`mj.searchEntries()\`).

* **Adding Aliases:** Add entries to the \`METHOD_ALIASES\` constant in \`src/codemode/api-constants.ts\`.
* **CRITICAL:** \`METHOD_ALIASES\` entries must point to either (a) a real tool method in the same group, or (b) another alias that eventually resolves to a real tool in the same group.

### Layer 5: CLI Guardrails & Help Injection
When an agent hallucinates CLI flags or usage patterns for standalone scripts or the commander CLI:
* **Option Aliasing:** Add hardcoded aliases for commonly truncated flags in commander (e.g., \`.option('--impact, --impact-score')\`) so execution naturally succeeds.
* **Dummy Command Interception:** When creating dummy commands to intercept agent hallucinations, ALWAYS use \`[args...]\` in the signature (e.g., \`.command('project [args...]')\`) to prevent Commander from throwing a "too many arguments" error before the action can execute.
* **Help Meta-Prompting:** Use Commander's \`addHelpText('after', ...)\` or append to manual help scripts to inject explicit \`🤖 AI AGENT INSTRUCTIONS\` directly into the \`--help\` output, forcing subsequent agents to read explicit guardrails before execution.
* **Actionable Errors:** Ensure that all CLI validation failures and process exits are prefixed with \`🛠️ AUTONOMOUS HEALING: \` to prevent agent loop retries.

### Layer 6: Environment & Tooling Guardrails (The Meta-Trap)
Agents often run into environment-level interceptors (like global PowerShell profiles, \`.bashrc\`, or global Git hooks) that throw hallucinatory errors or break command execution. 

* **Fragile Native Tools:** When attempting to heal global environment files (which are usually NOT version controlled by Git), **DO NOT** use the agent-native \`replace_file_content\` tool on large, ambiguous code blocks, as it uses loose heuristics that can permanently butcher files.
* **Safe Rewrites:** Instead, heal environment files by using precise \`multi_replace_file_content\` targeting single lines, or write a dedicated deterministic script to parse and rebuild the file safely.
* **Native Tool Priority:** If you trigger a system interceptor for using shell commands like \`cat\`, \`grep\`, or \`ls\`, you MUST autonomously switch to native tools (e.g., \`view_file\`, \`grep_search\`, \`list_dir\`). DO NOT ask the user for help or wait for permission.
* **Transient IDE Errors:** If shifting lines via code edits triggers IDE typing errors (e.g., "Unsafe argument of type error typed"), ALWAYS verify with \`tsc --noEmit\` before attempting complex type refactoring, as it may just be a stale ESLint cache.
* **Interceptor Awareness:** If an agent encounters a global interceptor that contradicts autonomous healing (e.g., telling the agent to "Stop and notify the user IMMEDIATELY"), that global profile itself must be healed to instruct the agent to autonomously recover instead.
* **Command Verification Trap:** In environments utilizing PowerShell proxy functions (like \`lib-agent-exec\`), native tools (e.g., \`pnpm\`, \`bun\`, \`git\`) exist as Aliases or Functions rather than traditional executables. DO NOT use \`Get-Command <tool> -CommandType Application\` to verify existence, as this explicitly filters out aliases and will falsely report the tool as missing. Use \`Get-Command <tool>\` without the \`-CommandType\` filter.

## 3. Phase 2: Implementation

1. Update the necessary files (e.g. schemas, instructions, normalizers, aliases).
2. Validate the integrity of your code changes by running \`pnpm run check\` (linting, typechecking, E2E tests).
3. **Agent-First Validation (CRITICAL):** Programmatic tests cannot verify if an AI agent is actually healed. You MUST verify the fix against an actual agent by running the usability coordinator workflows (e.g., \`test-server/codemode/coordinator-workflow.md\` or \`test-server/standard/coordinator-workflow.md\`).
4. Commit the changes locally.`
                            },
                        },
                    ],
                }
            },
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
