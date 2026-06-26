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
import { markUntrustedContent, markUntrustedContentInline } from '../../utils/security-utils.js'

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
                    .map(([name, data]: [string, unknown]) => `- ${name}: ${String((data as Record<string, unknown>)['project_number'])}`)
                    .join('\n')
                if (projects) {
                    return `\n**Registered Projects & Numbers:**\n${projects}\nIf your active repository matches one of these, use its number instead of reading memory://agent-context/{repo}.\n`
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

    const dbHint = target === 'team' 
        ? 'YOU MUST USE THE CLI TO SAVE THIS ENTRY: `memory-journal-mcp entry create --team`. You MUST pass the markdown content via the `--file <path>` or `--content "<string>"` flag. Do NOT use MCP tools for mutation.'
        : 'YOU MUST USE THE CLI TO SAVE THIS ENTRY: `memory-journal-mcp entry create`. You MUST pass the markdown content via the `--file <path>` or `--content "<string>"` flag. Do NOT use MCP tools for mutation.'

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

**Required Parameters:**
- \`entry_type: "retrospective"\`
- \`tags\`: [REQUIRED] MUST include \`"session-summary"\` PLUS 2-3 specific domain/topological tags.
- \`project_number\`: [REQUIRED] Integer ID mapped from your active workspace context
- \`relationships\`: [REQUIRED] Array of links to previous entries/flags (e.g. \`[{"target_id": 123, "relation_type": "resolves"}]\`). Types: 'resolves', 'depends_on', 'implements', 'relates_to'
- \`impact_score\`: [REQUIRED] Decimal score analyzing blast radius (e.g., 0.9+ for core architecture, 0.1 for simple docs).
- \`trust_score\`: [REQUIRED] Decimal score analyzing testing rigor. MUST start lower (0.3-0.5) for unverified work, scale higher (0.8-1.0) only if rigorously tested.
- \`validation_status\`: [REQUIRED] Validation outcome (MUST be "passed", "none", or "failed")
- \`auto_context\`: [REQUIRED] JSON string of commit metadata MUST EXACTLY match this shape: \`{"type":"session-commits","commits":["<sha>"],"branch":"<branch_name>","pr":<number>}\`
- ${dbHint}

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

**Execution Template (Cross-Platform / PowerShell Safe):**
Write your markdown and JSON payloads to your conversation's designated scratch directory (e.g. \`<appDataDir>\\brain\\<conversation-id>\\scratch\\\`) to completely avoid shell quote-stripping issues. NEVER write temporary files to the repository workspace. Then execute:
\`\`\`bash
memory-journal-mcp entry create ${target === 'team' ? '--team ' : ''}\\
  -t retrospective \\
  --tags "session-summary,your,tags" \\
  --project <ID> \\
  --impact <SCORE> \\
  --trust <SCORE> \\
  --validation-status passed \\
  --auto-context-file <scratch_dir>/auto-context.json \\
  --rel-file <scratch_dir>/relationships.json \\
  --file <scratch_dir>/session.md
\`\`\``,
                },
            },
        ],
    }
}

function generateEntryPrompt(_db: IDatabaseAdapter, _teamDb: IDatabaseAdapter | undefined, target: 'personal' | 'team'): { messages: PromptMessage[] } {
    const dbHint = target === 'team' 
        ? 'YOU MUST USE THE CLI TO SAVE THIS ENTRY: `memory-journal-mcp entry create --team`. You MUST pass the markdown content via the `--file <path>` or `--content "<string>"` flag. Do NOT use MCP tools for mutation.'
        : 'YOU MUST USE THE CLI TO SAVE THIS ENTRY: `memory-journal-mcp entry create`. You MUST pass the markdown content via the `--file <path>` or `--content "<string>"` flag. Do NOT use MCP tools for mutation.'

    const registryHint = getProjectRegistryHint()

    return {
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `Create a ${target === 'team' ? 'team ' : ''}mid-thread journal entry using EXACTLY this template:

**Required Parameters:**
- \`entry_type\`: [REQUIRED] MUST be "decision", "bug_fix", "milestone", or "architecture" (do NOT use "retrospective").
- \`tags\`: [REQUIRED] 1-3 specific domain/topological tags.
- \`project_number\`: [REQUIRED] Integer ID mapped from your active workspace context.
- \`impact_score\`: [REQUIRED] Decimal score analyzing blast radius (e.g., 0.9+ for core architecture, 0.1 for simple docs).
- \`trust_score\`: [REQUIRED] Decimal score analyzing testing rigor. MUST start lower (0.3-0.5) for unverified work, scale higher (0.8-1.0) only if rigorously tested.
- \`validation_status\`: [REQUIRED] Validation outcome (MUST be "passed", "none", or "failed")
- \`relationships\`: [REQUIRED] Array of links to previous entries/flags (e.g. \`[{"target_id": 123, "relation_type": "resolves"}]\`). Types: 'resolves', 'depends_on', 'implements', 'relates_to'
- ${dbHint}

**Required Content Structure:**
Just provide a concise markdown description of the specific architectural decision, strategic pivot, or blocker. Do NOT log routine code changes or bug fixes here; those belong strictly in Git. Keep it under 150 words. No top-level headers required.

**Rules:**
${registryHint}- If you lose track of your project number, workspace, or agent ID, read the \`memory://agent-context/{repo}\` resource to retrieve it instead of reloading the full briefing (which wastes tokens)

**Execution Template (Cross-Platform / PowerShell Safe):**
Write your markdown and JSON payloads to your conversation's designated scratch directory (e.g. \`<appDataDir>\\brain\\<conversation-id>\\scratch\\\`) to completely avoid shell quote-stripping issues. NEVER write temporary files to the repository workspace. Then execute:
\`\`\`bash
memory-journal-mcp entry create ${target === 'team' ? '--team ' : ''}\\
  -t <TYPE> \\
  --tags "your,tags" \\
  --project <ID> \\
  --impact <SCORE> \\
  --trust <SCORE> \\
  --validation-status passed \\
  --rel-file <scratch_dir>/relationships.json \\
  --file <scratch_dir>/entry.md
\`\`\``
                }
            }
        ]
    }
}

function generateUpdateEntryPrompt(db: IDatabaseAdapter, teamDb: IDatabaseAdapter | undefined, target: 'personal' | 'team'): { messages: PromptMessage[] } {
    const dbHint = target === 'team'
        ? 'YOU MUST USE THE CLI TO SAVE THIS ENTRY: `memory-journal-mcp entry update --team`. You MUST pass the markdown content via the `--file <path>` or `--content "<string>"` flag. Do NOT use MCP tools for mutation.'
        : 'YOU MUST USE THE CLI TO SAVE THIS ENTRY: `memory-journal-mcp entry update`. You MUST pass the markdown content via the `--file <path>` or `--content "<string>"` flag. Do NOT use MCP tools for mutation.'

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
- ${dbHint}
- You MUST pass the existing \`version\` as the \`expected_version\` parameter to prevent concurrent overwrites.
- Ensure you pass the full updated \`content\` string. Do not nest it under an \`updates\` object if calling the raw tool.

**Rules:**
${getProjectRegistryHint()}- If you lose track of your project number, workspace, or agent ID, read the \`memory://agent-context/{repo}\` resource to retrieve it instead of reloading the full briefing (which wastes tokens)

**Execution Template (Cross-Platform / PowerShell Safe):**
Write your markdown and JSON payloads to your conversation's designated scratch directory (e.g. \`<appDataDir>\\brain\\<conversation-id>\\scratch\\\`) to completely avoid shell quote-stripping issues. NEVER write temporary files to the repository workspace. Then execute:
\`\`\`bash
memory-journal-mcp entry update ${target === 'team' ? '--team ' : ''}\\
  --id <ENTRY_ID> \\
  --expected-version <VERSION> \\
  --tags "your,tags" \\
  --impact <SCORE> \\
  --trust <SCORE> \\
  --validation-status passed \\
  --rel-file <scratch_dir>/relationships.json \\
  --file <scratch_dir>/updated_entry.md
\`\`\``
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
            name: 'prepare-standup',
            description: 'Prepare a daily standup summary (Yesterday, Today, Blockers)',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (
                _args: Record<string, string> | undefined,
                db: IDatabaseAdapter
            ) => {
                const digestSignal = buildDigestSignalForPrompt(db)

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `${digestSignal}Execute a standup analysis.
Prepare a daily standup summary (Yesterday, Today, Blockers).

To complete this task, you MUST first fetch the relevant entries using \`search_by_date_range\` or read \`memory://recent\`. Do not hallucinate entries.`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'prepare-retro',
            description: 'Prepare a sprint retrospective (What went well, What could improve, Action items)',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (
                _args: Record<string, string> | undefined,
                db: IDatabaseAdapter
            ) => {
                const digestSignal = buildDigestSignalForPrompt(db)

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `${digestSignal}Execute a retro analysis.
Prepare a sprint retrospective (What went well, What could improve, Action items).

To complete this task, you MUST first fetch the relevant entries using \`search_by_date_range\` or read \`memory://recent\`. Do not hallucinate entries.`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'weekly-digest',
            description: 'Create a weekly digest formatted day-by-day',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (
                _args: Record<string, string> | undefined,
                db: IDatabaseAdapter
            ) => {
                const digestSignal = buildDigestSignalForPrompt(db)

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `${digestSignal}Execute a weekly digest analysis.
Create a weekly digest formatted day-by-day.

To complete this task, you MUST first fetch the relevant entries using \`search_by_date_range\` or read \`memory://recent\`. Do not hallucinate entries.`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'goal-tracker',
            description: 'Milestone and achievement tracking',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (_args: Record<string, string> | undefined, db: IDatabaseAdapter) => {
                const entries = db.getSignificantEntries(20)

                const mappedEntries = entries.map((e) => ({
                    id: e.id,
                    type: e.entryType,
                    timestamp: e.timestamp,
                    content: markUntrustedContentInline(
                        e.content.length > 250 ? e.content.slice(0, 250) + '...' : e.content
                    ),
                }))

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Track goals and milestones based on significant entries.
Summarize progress toward goals and highlight achievements.

Sources:
${JSON.stringify(mappedEntries, null, 2)}`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'session-summary',
            description: 'Create a formatted session summary entry',
            icons: [ICON_PROMPT],
            arguments: [],
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
            arguments: [],
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
            arguments: [],
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
            arguments: [],
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
            arguments: [],
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
            arguments: [],
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
            arguments: [],
            handler: () => {
                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# MCP Server Optimization & Anti-Hallucination Guardrails

The primary philosophy of this workflow is: **When you (the agent) encounter a hallucination, confusion, or are forced to use introspection to figure out an API, DO NOT just work around it.**

You MUST modify the server codebase to ensure future agents never face the same issue.

## 1. Workflow Initialization

1. Identify the specific hallucination or confusion error that occurred.
2. Formulate a plan to heal the codebase using the strict hierarchy below.

## 2. Phase 1: Determine the Layer of Healing

There is a strict hierarchy of how you should heal the codebase:
1. **Prevent (Highest Preference):** Modify the API schemas or the dispatcher to silently catch and transform the hallucinatory payload into a valid format so the execution succeeds automatically without the agent even noticing.
2. **Mitigate (Fallback):** If the input cannot be safely inferred or coerced, intercept it and throw a highly actionable custom error explicitly guiding the agent on how to fix it immediately.

Determine which of the 4 layers needs modification:

### Layer 1: Schema & Instruction Hardening (The First Line of Defense)
The most robust way to prevent a hallucination is to explicitly instruct the agent via the tools list or initialization payload.

* **Schema \`.describe()\` Tags:** When an agent hallucinates a property, update the Zod schema. Add an explicit "Anti-Hallucination Hint" in the \`.describe()\` string. These surface directly in the JSON Schema that agents see on \`tools/list\`.
* **Server Instructions:** If a structural hallucination persists, update \`src/constants/server-instructions.ts\` (or equivalent). This is the single source of truth for all instruction content.

### Layer 2: Dispatcher Healing (Frictionless Recovery)
If agents consistently hallucinate inputs that can be logically inferred or normalized, heal them silently in the dispatcher (\`src/codemode/api/group-factory.ts\` or \`param-normalizer.ts\`) before they reach Zod validation.

* **Type Coercion:** If agents pass strings instead of numbers, auto-resolve them.
* **Case Normalization:** Catch and heal \`camelCase\` variations automatically.
* **Explicit Interception:** If a string cannot be coerced, intercept it before validation and throw a highly actionable custom error.

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
* **Help Meta-Prompting:** Use Commander's \`addHelpText('after', ...)\` or append to manual help scripts to inject explicit \`🤖 AI AGENT INSTRUCTIONS\` directly into the \`--help\` output, forcing subsequent agents to read explicit guardrails before execution.

## 3. Phase 2: Implementation

1. Update the necessary files (e.g. schemas, instructions, normalizers, aliases).
2. Run automated tests to verify the changes don't break existing functionality (e.g., \`pnpm run check\`, \`pnpm run test\`, \`pnpm run test:e2e\`).
3. Commit the changes locally.
`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}

/**
 * Build a concise analytics signal string for injection into standup/retro prompts.
 * Returns empty string when no digest is available (graceful degradation).
 */
function buildDigestSignalForPrompt(db: IDatabaseAdapter): string {
    const snapshot = db.getLatestAnalyticsSnapshot?.('digest')
    if (!snapshot) return ''

    const data = snapshot.data
    const lines: string[] = ['[Analytics Context]']

    // Activity trend
    const growth = data['activityGrowthPercent'] as number | null | undefined
    const currentEntries = data['currentPeriodEntries'] as number | undefined
    if (growth !== null && growth !== undefined) {
        const sign = growth >= 0 ? '+' : ''
        lines.push(
            `Activity: ${sign}${String(growth)}% vs. last period (${String(currentEntries)} entries)`
        )
    }

    // Significance spike
    const sigMultiplier = data['significanceMultiplier'] as number | null | undefined
    const sigCount = data['currentPeriodSignificant'] as number | undefined
    if (sigMultiplier !== null && sigMultiplier !== undefined && sigMultiplier > 1.5) {
        lines.push(
            `Significance: ${String(sigCount)} significant entries (${String(sigMultiplier)}× historical avg)`
        )
    }

    // Stale projects
    const stale = data['staleProjects'] as
        | { projectNumber: number; daysSilent: number }[]
        | undefined
    if (stale && stale.length > 0) {
        const staleStr = stale
            .map((p) => `P${String(p.projectNumber)} (${String(p.daysSilent)}d silent)`)
            .join(', ')
        lines.push(`⚠ Stale: ${staleStr}`)
    }

    // Only return if we have actual signals beyond the header
    if (lines.length <= 1) return ''
    return lines.join('\n') + '\n\n'
}
