/**
 * Memory Journal MCP Server - Workflow Prompt Helpers
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { PromptMessage } from './index.js'
import { ConfigurationError, ValidationError } from '../../types/errors.js'
import { markUntrustedContent } from '../../utils/security-utils.js'
import { logger } from '../../utils/logger.js'
import { loadProjectRegistryFromConfig } from '../../utils/workspace-resolver.js'
import { workspacesForProject } from '../../utils/write-scope.js'
import type { BriefingConfig } from '../resources/shared.js'
import { RELATIONSHIP_TYPES } from '../../types/entities.js'

export const WORKFLOW_WORKSPACE_ARGUMENTS = [
    {
        name: 'workspace_id',
        description:
            'Optional target project workspace ID or name (default: resolved from active session/CWD/server config)',
        required: false,
    },
    {
        name: 'project_number',
        description:
            'Optional target GitHub project number (default: resolved from active session/CWD/server config)',
        required: false,
    },
]

export function getProjectRegistryHint(briefingConfig?: Partial<BriefingConfig>): string {
    try {
        const registry = briefingConfig?.projectRegistry ?? loadProjectRegistryFromConfig()
        if (registry !== undefined) {
            const projects = Object.entries(registry)
                .map(([name, data]) => `${name} (${String(data.project_number)})`)
                .join(', ')
            if (projects) {
                return `\n**Projects:** ${projects} (Use these IDs instead of memory://agent-context/{repo} if applicable)\n`
            }
        }
    } catch (err) {
        logger.debug('Project registry hint unavailable', {
            module: 'workflow-prompts',
            error: String(err),
        })
    }
    return ''
}

export function buildExplicitAttributionArgs(
    workspaceId: string,
    briefingConfig?: Partial<BriefingConfig>,
    explicitProjectNumber?: number,
    explicitDefaultRequested = false
): string {
    if (workspaceId === '') return ''
    // [INVARIANT] Generated snippets never hardcode `workspace_id: "default"` unless the caller
    // explicitly asked for `default` (C8); omitting it lets the server resolve the project.
    if (workspaceId.toLowerCase() === 'default' && !explicitDefaultRequested) return ''
    const registry = briefingConfig?.projectRegistry ?? loadProjectRegistryFromConfig()
    const registryNumber = registry?.[workspaceId]?.project_number
    let projNum = registryNumber
    if (explicitProjectNumber !== undefined) {
        if (!Number.isFinite(explicitProjectNumber)) {
            throw new ValidationError(
                `project_number ${String(explicitProjectNumber)} is not a finite number.`,
                { projectNumber: explicitProjectNumber }
            )
        }
        const owners = workspacesForProject(explicitProjectNumber, registry)
        if (owners.length > 1) {
            throw new ValidationError(
                `project_number ${String(explicitProjectNumber)} is registered to more than one workspace.`,
                { projectNumber: explicitProjectNumber }
            )
        }
        const owner = owners[0]
        if (owner !== undefined && owner.toLowerCase() !== workspaceId.toLowerCase()) {
            throw new ValidationError(
                `project_number ${String(explicitProjectNumber)} belongs to workspace '${owner}', not '${workspaceId}'.`,
                { workspaceId, projectNumber: explicitProjectNumber }
            )
        }
        if (registryNumber !== undefined && explicitProjectNumber !== registryNumber) {
            throw new ValidationError(
                `workspace '${workspaceId}' uses project_number ${String(registryNumber)}, not ${String(explicitProjectNumber)}.`,
                { workspaceId, projectNumber: explicitProjectNumber }
            )
        }
        projNum = explicitProjectNumber
    }
    return `, workspace_id: "${workspaceId}"${projNum !== undefined ? `, project_number: ${String(projNum)}` : ''}`
}

export function generateSummaryPrompt(
    db: IDatabaseAdapter,
    teamDb: IDatabaseAdapter | undefined,
    target: 'personal' | 'team',
    workspaceId = 'default',
    briefingConfig?: Partial<BriefingConfig>,
    projectNumber?: number,
    explicitDefaultRequested = false
): { messages: PromptMessage[] } {
    if (target === 'team' && !teamDb) {
        throw new ConfigurationError('Team database not configured')
    }

    const targetDb = target === 'team' && teamDb ? teamDb : db
    const { entries: recent } = targetDb.getRecentEntries(
        5,
        undefined,
        'timestamp',
        undefined,
        false,
        workspaceId
    )

    const entrySummary =
        recent.length > 0
            ? recent
                  .map(
                      (e) =>
                          `- #${String(e.id)} (${e.entryType}) ${e.content.slice(0, 80)}${e.content.length > 80 ? '...' : ''}`
                  )
                  .join('\n')
            : '- No entries yet'

    const registryHint = getProjectRegistryHint(briefingConfig)
    const attributionArgs = buildExplicitAttributionArgs(
        workspaceId,
        briefingConfig,
        projectNumber,
        explicitDefaultRequested
    )

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
project: <Integer ID or repository name - OPTIONAL, auto-resolved from active workspace>
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
    relation_type: "resolved" # one of: ${RELATIONSHIP_TYPES.join(', ')}
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

## Commits
- \`<sha>\`: [Short commit summary or "None" if no commits were made]
\`\`\`

**Rules:**
- Do NOT add extra top-level sections (no "## Summary", "## Overview", "## Notes", etc.)
- Do NOT omit any of the four required sections
- Use bullet points within each section
- Reference specific entry IDs, file names, and PR numbers where relevant
- To populate \`auto_context.commits\`, use \`bun .\\.agents\\scripts\\get-git-history-json.ts --summary -n 20\` to retrieve recent commit SHAs. Do NOT use raw \`git log\`.
- Note: \`workspace_id\` and \`project_number\` are automatically resolved from your active workspace context if omitted.
${registryHint}- If you lose track of your project number, workspace, or agent ID, read the \`memory://agent-context/{repo}\` resource to retrieve it instead of reloading the full briefing (which wastes tokens)

**Recent Entries (for context):**
${markUntrustedContent(entrySummary)}

**Execution:**
- **Option 1 (Code Mode / MCP Tool - Recommended):** Execute directly via \`mj.core.createEntry({ content: "...", entry_type: "retrospective", tags: ["session-summary"], auto_context: { commits: ["<sha>"] }${attributionArgs}${target === 'team' ? ', share_with_team: true' : ''} })\`.
- **Option 2 (CLI Scratch File):** Write markdown file (with YAML frontmatter) to your scratch directory (e.g. \`<appDataDir>\\brain\\<conversation-id>\\scratch\\\`) then execute: \`memory-journal-mcp entry create ${target === 'team' ? '--team ' : ''}--file <scratch_dir>/session.md\``,
                },
            },
        ],
    }
}

export function generateEntryPrompt(
    _db: IDatabaseAdapter,
    _teamDb: IDatabaseAdapter | undefined,
    target: 'personal' | 'team',
    workspaceId = 'default',
    briefingConfig?: Partial<BriefingConfig>,
    projectNumber?: number,
    explicitDefaultRequested = false
): { messages: PromptMessage[] } {
    const registryHint = getProjectRegistryHint(briefingConfig)
    const attributionArgs = buildExplicitAttributionArgs(
        workspaceId,
        briefingConfig,
        projectNumber,
        explicitDefaultRequested
    )

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
type: "project_decision" # canonical entry_type, e.g. project_decision, bug_fix, milestone, technical_note, feature_implementation (do NOT use "retrospective")
tags: ["domain-tag", "another-tag"]
project: <Integer ID or repository name - OPTIONAL, auto-resolved from active workspace>
impact: <Decimal score analyzing blast radius (e.g., 0.9+ for core architecture, 0.1 for docs)>
trust: <Decimal score analyzing testing rigor. 0.3-0.5 for unverified, 0.8-1.0 if rigorously tested>
validation_status: "passed" # or "none", or "failed"
relationships: 
  - target_id: 123
    relation_type: "resolved" # one of: ${RELATIONSHIP_TYPES.join(', ')}
---
\`\`\`

**Required Content Structure:**
Just provide a concise markdown description of the specific architectural decision, strategic pivot, or blocker. Do NOT log routine code changes or bug fixes here; those belong strictly in Git. Keep it under 150 words. No top-level headers required.

**Rules:**
- Note: \`workspace_id\` and \`project_number\` are automatically resolved from your active workspace context if omitted.
${registryHint}- If you lose track of your project number, workspace, or agent ID, read the \`memory://agent-context/{repo}\` resource to retrieve it instead of reloading the full briefing (which wastes tokens)

**Execution:**
- **Option 1 (Code Mode / MCP Tool - Recommended):** Execute directly via \`mj.core.createEntry({ content: "...", entry_type: "project_decision", tags: ["tag1"]${attributionArgs}${target === 'team' ? ', share_with_team: true' : ''} })\`.
- **Option 2 (CLI Scratch File):** Write markdown file (with YAML frontmatter) to your scratch directory (e.g. \`<appDataDir>\\brain\\<conversation-id>\\scratch\\\`) then execute: \`memory-journal-mcp entry create ${target === 'team' ? '--team ' : ''}--file <scratch_dir>/entry.md\``,
                },
            },
        ],
    }
}

export function generateUpdateEntryPrompt(
    db: IDatabaseAdapter,
    teamDb: IDatabaseAdapter | undefined,
    target: 'personal' | 'team',
    workspaceId = 'default',
    briefingConfig?: Partial<BriefingConfig>,
    projectNumber?: number,
    explicitDefaultRequested = false
): { messages: PromptMessage[] } {
    const targetDb = target === 'team' && teamDb ? teamDb : db
    let entryContext = ''
    try {
        const recentRes = targetDb.getRecentEntries(
            1,
            undefined,
            'timestamp',
            undefined,
            false,
            workspaceId
        ) as { entries?: unknown[] } | unknown[]
        const recent = (Array.isArray(recentRes) ? recentRes[0] : recentRes.entries?.[0]) as
            | Record<string, unknown>
            | undefined
        if (recent) {
            entryContext = `
**Target Entry Details (Pre-fetched for your convenience):**
- **ID:** ${String(recent['id'])}
- **Version:** ${String(recent['version'])}
- **Type:** ${String(recent['entryType'])}
- **Tags:** ${recent['tags'] !== null && recent['tags'] !== undefined ? JSON.stringify(recent['tags']) : '[]'}
- **Content:**
${markUntrustedContent(String(recent['content']))}
`
        }
    } catch (err) {
        logger.debug('Target entry pre-fetch failed', {
            module: 'workflow-prompts',
            error: String(err),
        })
    }

    const registryHint = getProjectRegistryHint(briefingConfig)
    const attributionArgs = buildExplicitAttributionArgs(
        workspaceId,
        briefingConfig,
        projectNumber,
        explicitDefaultRequested
    )
    const cliWorkspaceFlag =
        workspaceId !== 'default' && workspaceId !== '' ? `--workspace ${workspaceId} ` : ''

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
- If it has the \`session-summary\` tag: You MUST preserve the exact 4-header structure (\`## Accomplished\`, \`## Unfinished / Blocked\`, \`## Context for Next Session\`, \`## Commits\`). Do not flatten the text; only append or modify the relevant bullet points.
- If it is a standard entry: Keep your modifications concise and under 150 words.

**Step 3: Execute the Update**
- You MUST pass the existing \`version\` as the \`expected_version\` parameter to prevent concurrent overwrites.
- Ensure you write the full updated \`content\` string to a markdown file in your scratch directory.
- If you want to modify fields like tags, trust, or impact, simply add a YAML frontmatter block (\`---\`... \`---\`) to the top of your markdown file. Otherwise, omit it to preserve existing values.

**Rules:**
${registryHint}- If you lose track of your project number, workspace, or agent ID, read the \`memory://agent-context/{repo}\` resource to retrieve it instead of reloading the full briefing (which wastes tokens)

**Execution:**
- **Option 1 (Code Mode / MCP Tool):** Execute via \`mj.admin.updateEntry({ entry_id: <ENTRY_ID>, expected_version: <VERSION>, content: "..."${attributionArgs} })\`.
- **Option 2 (CLI Scratch File):** Write your updated markdown file to your scratch directory (e.g. \`<appDataDir>\\brain\\<conversation-id>\\scratch\\\`) to avoid shell quotes. Then execute: \`memory-journal-mcp entry update ${target === 'team' ? '--team ' : ''}${cliWorkspaceFlag}--id <ENTRY_ID> --expected-version <VERSION> --file <scratch_dir>/updated_entry.md\``,
                },
            },
        ],
    }
}
