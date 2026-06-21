/**
 * Memory Journal MCP Server - Workflow Prompt Definitions
 *
 * Prompts: find-related, prepare-standup, prepare-retro, weekly-digest,
 * analyze-period, goal-tracker, get-context-bundle, get-recent-entries, confirm-briefing,
 * session-summary
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'
import { ConfigurationError } from '../../types/errors.js'
import { markUntrustedContent, markUntrustedContentInline } from '../../utils/security-utils.js'
import { parseFlagContext } from '../../types/auto-context.js'
import type { GitHistoryClient } from '../../git/index.js'


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
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter
            ) => {
                const digestSignal = buildDigestSignalForPrompt(db)
                const flagSignal = buildFlagSignalForPrompt(teamDb)

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `${digestSignal}${flagSignal}Execute a standup analysis.
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
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter
            ) => {
                const digestSignal = buildDigestSignalForPrompt(db)
                const flagSignal = buildFlagSignalForPrompt(teamDb)

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `${digestSignal}${flagSignal}Execute a retro analysis.
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
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter
            ) => {
                const digestSignal = buildDigestSignalForPrompt(db)
                const flagSignal = buildFlagSignalForPrompt(teamDb)

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `${digestSignal}${flagSignal}Execute a weekly analysis.
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
            handler: (_args: Record<string, string>, db: IDatabaseAdapter) => {
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
                args: Record<string, string> | undefined,
                db: IDatabaseAdapter,
                teamDb?: IDatabaseAdapter,
                _github?: unknown,
                gitClient?: unknown
            ) => {
                const target = args?.['target'] ?? 'personal'
                
                if (target === 'team' && !teamDb) {
                    throw new ConfigurationError('Team database not configured')
                }

                const dbHint = target === 'team' 
                    ? 'YOU MUST USE `team_create_entry` OR `mj.team.teamCreateEntry` TO SAVE THIS ENTRY.'
                    : `Use \`create_entry\` or \`await mj.core.createEntry({ project_number: <CURRENT_PROJECT_NUMBER>, ... })\` via \`mj_execute_code\``

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

                let commitList = '- [List commit SHAs made during the session, or "None"]'
                const typedGitClient = gitClient as GitHistoryClient | undefined | null
                if (typedGitClient) {
                    try {
                        const history = await typedGitClient.getUnreleasedChangelog()
                        if (history.totalCount > 0) {
                            const entries: string[] = []
                            for (const category of Object.values(history.categories)) {
                                if (Array.isArray(category)) {
                                    for (const commit of category) {
                                        entries.push(`- ${commit.hash.substring(0,7)}: ${commit.message}`)
                                    }
                                }
                            }
                            if (entries.length > 0) {
                                commitList = entries.join('\n')
                            } else {
                                commitList = '- None'
                            }
                        } else {
                            commitList = '- None'
                        }
                    } catch {
                        // Fallback to placeholder on error
                    }
                }

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Create a ${target === 'team' ? 'team ' : ''}session summary journal entry using EXACTLY this template:

**Required Parameters:**
- \`entry_type: "retrospective"\`
- \`tags: ["session-summary"]\` (plus relevant domain tags)
- \`project_number\`: [REQUIRED] Integer ID mapped from your active workspace context
- \`impact_score\`: [REQUIRED] Decimal score (e.g., 0.5)
- \`trust_score\`: [REQUIRED] Decimal score (e.g., 0.9 if verified)
- \`validation_status\`: [REQUIRED] Validation outcome (MUST be "passed", "none", or "failed")
- \`auto_context\`: [REQUIRED] JSON string of commit metadata representing the session's work.
- ${dbHint}

**Required Content Structure (use EXACTLY these section headers):**
\`\`\`
## Accomplished
- [List concrete items: changes made, decisions taken, files modified, PRs submitted]

## Unfinished / Blocked
- [List pending items, blockers, open questions — or "None" if everything is complete]

## Context for Next Session
- [List key context: relevant entry IDs, branch names, PR numbers, pending decisions]

## Commits
${commitList}
\`\`\`

**Rules:**
- Do NOT add extra top-level sections (no "## Summary", "## Overview", "## Notes", etc.)
- Do NOT omit any of the four required sections
- Use bullet points within each section
- Reference specific entry IDs, file names, and PR numbers where relevant

**Recent Entries (for context):**
${markUntrustedContent(entrySummary)}`,
                            },
                        },
                    ],
                }
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
    return lines.join('\\n') + '\\n\\n'
}

/**
 * Build a concise active-flags signal string for injection into standup/retro prompts.
 * Returns empty string when team DB is not configured or no active flags exist.
 */
function buildFlagSignalForPrompt(teamDb?: IDatabaseAdapter): string {
    if (!teamDb) return ''

    try {
        const { entries: flagEntries } = teamDb.searchEntries('', {
            entryType: 'flag',
            limit: 20,
        })

        const now = Date.now()
        const activeFlags: {
            flag_type: string
            preview: string
            target_user: string | null
            age: string
        }[] = []

        for (const entry of flagEntries) {
            const ctx = parseFlagContext(entry.autoContext)
            if (!ctx || ctx.resolved) continue

            const ageMs = now - new Date(entry.timestamp).getTime()
            const hours = Math.floor(ageMs / 3_600_000)
            const days = Math.floor(ageMs / 86_400_000)
            const age =
                days > 0 ? `${String(days)}d ago` : hours > 0 ? `${String(hours)}h ago` : 'just now'

            const preview =
                entry.content.length > 80 ? entry.content.slice(0, 80) + '…' : entry.content

            activeFlags.push({
                flag_type: ctx.flag_type,
                preview,
                target_user: ctx.target_user ?? null,
                age,
            })
        }

        if (activeFlags.length === 0) return ''

        const lines: string[] = ['[Active Flags]']
        for (const f of activeFlags) {
            const target = f.target_user ? ` → @${f.target_user}` : ''
            lines.push(`🚩 ${f.flag_type}${target}: ${f.preview} (${f.age})`)
        }

        return lines.join('\\n') + '\\n\\n'
    } catch {
        // Graceful degradation — flags are supplementary context
        return ''
    }
}
