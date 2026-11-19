/**
 * Memory Journal MCP Server - Workflow Prompt Helpers
 */

import type { IDatabaseAdapter, TeamRole } from '../../database/core/interfaces.js'
import type { PromptMessage } from './index.js'
import { ConfigurationError, ValidationError } from '../../types/errors.js'
import { logger } from '../../utils/logger.js'
import { loadProjectRegistryFromConfig } from '../../utils/workspace-resolver.js'
import { exactRegistryKey, workspacesForProject } from '../../utils/write-scope.js'
import type { BriefingConfig } from '../resources/shared.js'
import { RELATIONSHIP_TYPES } from '../../types/entities.js'
import { enforceTeamRbac, getCallerIdentity } from '../tools/team/rbac.js'
import {
    buildSummaryPromptText,
    buildUpdateEntryPromptText,
    fetchTargetEntryContext,
} from './workflow-prompt-builders.js'

interface PromptTeamRuntime {
    teamDefaultRole?: TeamRole | 'denied'
}

function enforceWorkflowTeamPromptRbac(
    teamDb: IDatabaseAdapter | undefined,
    requiredRole: TeamRole,
    workspaceId: string,
    briefingConfig?: Partial<BriefingConfig>,
    runtime?: PromptTeamRuntime | null
): void {
    if (teamDb?.isTeamRbacActive?.() !== true) return
    enforceTeamRbac(
        {
            db: teamDb,
            teamDb,
            config: {
                ...(briefingConfig?.defaultWorkspaceId !== undefined
                    ? { defaultWorkspaceId: briefingConfig.defaultWorkspaceId }
                    : {}),
                ...(briefingConfig?.defaultProjectNumber !== undefined
                    ? { defaultProjectNumber: briefingConfig.defaultProjectNumber }
                    : {}),
                ...(briefingConfig?.projectRegistry !== undefined
                    ? { projectRegistry: briefingConfig.projectRegistry }
                    : {}),
                teamDefaultRole: runtime?.teamDefaultRole ?? 'denied',
            },
        },
        getCallerIdentity(),
        requiredRole,
        workspaceId
    )
}

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
    const registry = briefingConfig?.projectRegistry ?? loadProjectRegistryFromConfig()
    const isImplicitDefault =
        workspaceId === '' || (workspaceId.toLowerCase() === 'default' && !explicitDefaultRequested)
    if (explicitProjectNumber === undefined) {
        if (isImplicitDefault) return ''
        const canonicalWs = exactRegistryKey(workspaceId, registry) ?? workspaceId
        const registryNumber = registry?.[canonicalWs]?.project_number
        return `, workspace_id: ${JSON.stringify(canonicalWs)}${registryNumber !== undefined ? `, project_number: ${String(registryNumber)}` : ''}`
    }
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
    if (isImplicitDefault) {
        if (owner !== undefined) {
            return `, workspace_id: ${JSON.stringify(owner)}, project_number: ${String(explicitProjectNumber)}`
        }
        return `, project_number: ${String(explicitProjectNumber)}`
    }
    const canonicalWs = exactRegistryKey(workspaceId, registry) ?? workspaceId
    if (owner !== undefined && owner.toLowerCase() !== canonicalWs.toLowerCase()) {
        throw new ValidationError(
            `project_number ${String(explicitProjectNumber)} belongs to workspace '${owner}', not '${canonicalWs}'.`,
            { workspaceId: canonicalWs, projectNumber: explicitProjectNumber }
        )
    }
    const registryNumber = registry?.[canonicalWs]?.project_number
    if (registryNumber !== undefined && explicitProjectNumber !== registryNumber) {
        throw new ValidationError(
            `workspace '${canonicalWs}' uses project_number ${String(registryNumber)}, not ${String(explicitProjectNumber)}.`,
            { workspaceId: canonicalWs, projectNumber: explicitProjectNumber }
        )
    }
    return `, workspace_id: ${JSON.stringify(canonicalWs)}, project_number: ${String(explicitProjectNumber)}`
}

export function buildCliAttributionFlags(
    workspaceId: string,
    briefingConfig?: Partial<BriefingConfig>,
    explicitProjectNumber?: number,
    explicitDefaultRequested = false
): string {
    const explicitArgs = buildExplicitAttributionArgs(
        workspaceId,
        briefingConfig,
        explicitProjectNumber,
        explicitDefaultRequested
    )
    if (explicitArgs === '') return ''
    const wsMatch = /workspace_id:\s*("(?:[^"\\]|\\.)*")/.exec(explicitArgs)
    const projMatch = /project_number:\s*(\d+)/.exec(explicitArgs)
    const parts: string[] = []
    if (wsMatch?.[1] !== undefined) {
        const parsedWs: unknown = JSON.parse(wsMatch[1])
        if (typeof parsedWs === 'string') {
            parts.push(`--workspace ${JSON.stringify(parsedWs)}`)
        }
    }
    if (projMatch?.[1] !== undefined) {
        parts.push(`--project-number ${projMatch[1]}`)
    }
    return parts.length > 0 ? `${parts.join(' ')} ` : ''
}

function resolveWorkflowEffectiveProjectNumber(
    workspaceId: string,
    briefingConfig?: Partial<BriefingConfig>,
    explicitProjectNumber?: number,
    explicitDefaultRequested = false
): number | undefined {
    if (explicitProjectNumber !== undefined) return explicitProjectNumber
    const registry = briefingConfig?.projectRegistry ?? loadProjectRegistryFromConfig()
    const canonical = exactRegistryKey(workspaceId, registry)
    if (canonical !== undefined && registry?.[canonical]?.project_number !== undefined) {
        return registry[canonical].project_number
    }
    if (workspaceId.toLowerCase() === 'default' && !explicitDefaultRequested) {
        const defProj = briefingConfig?.defaultProjectNumber
        if (defProj !== undefined && workspacesForProject(defProj, registry).length === 0) {
            return defProj
        }
    }
    return undefined
}

function assertTeamWorkflowProjectScope(
    workspaceId: string,
    effectiveProjectNumber: number | undefined,
    explicitDefaultRequested: boolean,
    briefingConfig?: Partial<BriefingConfig>
): void {
    if (effectiveProjectNumber !== undefined) return
    const registry = briefingConfig?.projectRegistry ?? loadProjectRegistryFromConfig()
    const hasRegistry = registry !== undefined && Object.keys(registry).length > 0
    if (
        explicitDefaultRequested ||
        workspaceId.toLowerCase() !== 'default' ||
        hasRegistry ||
        briefingConfig?.defaultProjectNumber !== undefined
    ) {
        throw new ValidationError(
            'Missing project_number for team workflow prompt on shared or unregistered workspace. Pass project_number or target a registered workspace.'
        )
    }
}

export function generateSummaryPrompt(
    db: IDatabaseAdapter,
    teamDb: IDatabaseAdapter | undefined,
    target: 'personal' | 'team',
    workspaceId = 'default',
    briefingConfig?: Partial<BriefingConfig>,
    projectNumber?: number,
    explicitDefaultRequested = false,
    runtime?: PromptTeamRuntime | null
): { messages: PromptMessage[] } {
    const effectiveProjectNumber = resolveWorkflowEffectiveProjectNumber(
        workspaceId,
        briefingConfig,
        projectNumber,
        explicitDefaultRequested
    )
    if (target === 'team') {
        if (!teamDb) {
            throw new ConfigurationError('Team database not configured')
        }
        enforceWorkflowTeamPromptRbac(teamDb, 'member', workspaceId, briefingConfig, runtime)
        assertTeamWorkflowProjectScope(
            workspaceId,
            effectiveProjectNumber,
            explicitDefaultRequested,
            briefingConfig
        )
    }

    const targetDb = target === 'team' && teamDb ? teamDb : db
    const { entries: recent } = targetDb.getRecentEntries(
        5,
        undefined,
        'timestamp',
        undefined,
        false,
        workspaceId,
        effectiveProjectNumber
    )

    const entrySummary =
        recent.length > 0
            ? recent
                  .map((e) => `- #${String(e.id)} (${e.entryType}) ${e.content.slice(0, 80)}${e.content.length > 80 ? '...' : ''}`)
                  .join('\n')
            : '- No entries yet'
    const registryHint = getProjectRegistryHint(briefingConfig)
    const attributionArgs = buildExplicitAttributionArgs(workspaceId, briefingConfig, projectNumber, explicitDefaultRequested)
    const cliFlags = buildCliAttributionFlags(workspaceId, briefingConfig, projectNumber, explicitDefaultRequested)

    return {
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: buildSummaryPromptText({ target, registryHint, entrySummary, attributionArgs, cliFlags }),
                },
            },
        ],
    }
}

function buildEntryTemplateText(
    target: 'personal' | 'team',
    registryHint: string,
    attributionArgs: string,
    cliFlags: string
): string {
    return `Create a ${target === 'team' ? 'team ' : ''}mid-thread journal entry using EXACTLY this template:

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
- **Option 2 (CLI Scratch File):** Write markdown file (with YAML frontmatter) to your scratch directory (e.g. \`<appDataDir>\\brain\\<conversation-id>\\scratch\\\`) then execute: \`memory-journal-mcp entry create ${target === 'team' ? '--team ' : ''}${cliFlags}--file <scratch_dir>/entry.md\``
}

export function generateEntryPrompt(
    _db: IDatabaseAdapter,
    teamDb: IDatabaseAdapter | undefined,
    target: 'personal' | 'team',
    workspaceId = 'default',
    briefingConfig?: Partial<BriefingConfig>,
    projectNumber?: number,
    explicitDefaultRequested = false,
    runtime?: PromptTeamRuntime | null
): { messages: PromptMessage[] } {
    const effectiveProjectNumber = resolveWorkflowEffectiveProjectNumber(
        workspaceId,
        briefingConfig,
        projectNumber,
        explicitDefaultRequested
    )
    if (target === 'team') {
        if (!teamDb) {
            throw new ConfigurationError('Team database not configured')
        }
        enforceWorkflowTeamPromptRbac(teamDb, 'member', workspaceId, briefingConfig, runtime)
        assertTeamWorkflowProjectScope(
            workspaceId,
            effectiveProjectNumber,
            explicitDefaultRequested,
            briefingConfig
        )
    }
    const registryHint = getProjectRegistryHint(briefingConfig)
    const attributionArgs = buildExplicitAttributionArgs(
        workspaceId,
        briefingConfig,
        effectiveProjectNumber,
        explicitDefaultRequested
    )
    const cliFlags = buildCliAttributionFlags(
        workspaceId,
        briefingConfig,
        effectiveProjectNumber,
        explicitDefaultRequested
    )

    return {
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: buildEntryTemplateText(target, registryHint, attributionArgs, cliFlags),
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
    explicitDefaultRequested = false,
    runtime?: PromptTeamRuntime | null
): { messages: PromptMessage[] } {
    const effectiveProjectNumber = resolveWorkflowEffectiveProjectNumber(
        workspaceId,
        briefingConfig,
        projectNumber,
        explicitDefaultRequested
    )
    if (target === 'team') {
        if (!teamDb) {
            throw new ConfigurationError('Team database not configured')
        }
        enforceWorkflowTeamPromptRbac(teamDb, 'member', workspaceId, briefingConfig, runtime)
        assertTeamWorkflowProjectScope(
            workspaceId,
            effectiveProjectNumber,
            explicitDefaultRequested,
            briefingConfig
        )
    }
    const targetDb = target === 'team' && teamDb ? teamDb : db
    const entryContext = fetchTargetEntryContext(targetDb, workspaceId, effectiveProjectNumber)
    const registryHint = getProjectRegistryHint(briefingConfig)
    const attributionArgs = buildExplicitAttributionArgs(
        workspaceId,
        briefingConfig,
        projectNumber,
        explicitDefaultRequested
    )
    const cliFlags = buildCliAttributionFlags(
        workspaceId,
        briefingConfig,
        projectNumber,
        explicitDefaultRequested
    )
    const updateApiCall = target === 'team' ? 'mj.team.teamUpdateEntry' : 'mj.admin.updateEntry'

    return {
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: buildUpdateEntryPromptText({
                        target,
                        entryContext,
                        registryHint,
                        updateApiCall,
                        attributionArgs,
                        cliFlags,
                    }),
                },
            },
        ],
    }
}
