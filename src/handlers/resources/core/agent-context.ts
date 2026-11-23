import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'
import { ICON_BRIEFING } from '../../../constants/icons.js'
import { isFilterEffectivelyReadOnly } from '../../../filtering/tool-filter.js'
import { logger } from '../../../utils/logger.js'
import {
    loadProjectRegistryFromConfig,
    setActiveSessionProject,
} from '../../../utils/workspace-resolver.js'
import { exactRegistryKey, uniqueWorkspaceForProject } from '../../../utils/write-scope.js'
import {
    getBaseUri,
    resourceProjectNumber,
    resourceWorkspace,
    safeDecodeUriSegment,
    type InternalResourceDef,
    type ResourceContext,
    type ResourceResult,
} from '../shared.js'
import { withPriority, ASSISTANT_FOCUSED } from '../../../utils/resource-annotations.js'
import { parseCanonicalPositiveInt } from '../../../utils/safe-positive-int.js'
import { previewLabelText, resolveToolHintName } from './briefing/graph-pivots-section.js'
import { fenceUntrustedList, sanitizeDisplayIdentifier } from '../fencing-helpers.js'

function parsePinSessionOption(uri: string): boolean {
    const queryIdx = uri.indexOf('?')
    if (queryIdx === -1) return true
    const hashIdx = uri.indexOf('#', queryIdx)
    const rawQuery = hashIdx === -1 ? uri.slice(queryIdx + 1) : uri.slice(queryIdx + 1, hashIdx)
    return new URLSearchParams(rawQuery).get('pin_session')?.trim().toLowerCase() !== 'false'
}

function formatDefaultAgentContext(
    uri: string,
    context: ResourceContext,
    config: ResourceContext['briefingConfig'],
    fallbackRegistry: ReturnType<typeof loadProjectRegistryFromConfig>,
    runtime: ResourceContext['runtime'],
    pinSession: boolean
): ResourceResult {
    const defaultProjNum =
        fallbackRegistry?.['default']?.project_number ??
        (config?.defaultWorkspaceId?.trim().toLowerCase() === 'default'
            ? config.defaultProjectNumber
            : undefined)
    if (pinSession) {
        setActiveSessionProject(
            'default',
            defaultProjNum !== undefined && defaultProjNum > 0 ? defaultProjNum : null,
            runtime
        )
    }
    return {
        data: [
            'Project: default',
            `Project Number: ${defaultProjNum !== undefined && defaultProjNum > 0 ? String(defaultProjNum) : 'unresolved'}`,
            'Workspace ID: default',
            'Instructions: Use your Conversation ID as the session_id for all tool calls.',
            ...buildSessionEntryLines(uri, context, 'default'),
        ].join('\n'),
    }
}

function resolveExplicitTarget(
    rawRepo: string,
    config: ResourceContext['briefingConfig'],
    registry: ReturnType<typeof loadProjectRegistryFromConfig>
): { workspaceId?: string; projectNumber?: number; unresolvedRepo?: string } {
    const trimmed = rawRepo.trim()
    if (trimmed === '*') {
        throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            "Wildcard '*' is not supported for memory://agent-context/{+repo}. Specify a concrete repository name."
        )
    }
    const numericMatch = /^#?(\d+)$/.exec(trimmed)
    const numericRepo =
        numericMatch?.[1] !== undefined ? parseCanonicalPositiveInt(numericMatch[1]) : undefined
    const exactRepo = exactRegistryKey(trimmed, registry)
    const numericWorkspace =
        numericRepo !== undefined ? uniqueWorkspaceForProject(numericRepo, registry) : undefined
    const matched = exactRepo ?? numericWorkspace
    if (matched !== undefined) {
        return { workspaceId: matched, projectNumber: registry?.[matched]?.project_number }
    }
    const configuredDefaultWs = config?.defaultWorkspaceId?.trim()
    if (configuredDefaultWs?.toLowerCase() === trimmed.toLowerCase()) {
        return { workspaceId: configuredDefaultWs, projectNumber: config?.defaultProjectNumber }
    }
    const hasRegistry = registry !== undefined && Object.keys(registry).length > 0
    if (hasRegistry) {
        return { unresolvedRepo: trimmed }
    }
    return { workspaceId: trimmed }
}

function handleAgentContextResource(uri: string, context: ResourceContext): ResourceResult {
    const config = context?.briefingConfig
    const fallbackRegistry = config?.projectRegistry ?? loadProjectRegistryFromConfig()
    const pinSession = parsePinSessionOption(uri)

    const match = /^memory:\/\/(?:agent-context|agent-id)(?:\/(.+))?$/.exec(getBaseUri(uri))
    const rawRepo = match?.[1] !== undefined ? safeDecodeUriSegment(match[1]) : undefined
    const trimmedRepo = rawRepo?.trim()
    if (trimmedRepo?.toLowerCase() === 'default') {
        return formatDefaultAgentContext(
            uri,
            context,
            config,
            fallbackRegistry,
            context?.runtime,
            pinSession
        )
    }

    let workspaceId: string
    let projectNumber: number | undefined
    if (trimmedRepo !== undefined && trimmedRepo !== '') {
        const target = resolveExplicitTarget(trimmedRepo, config, fallbackRegistry)
        if (target.unresolvedRepo !== undefined) {
            const safeRepo = sanitizeDisplayIdentifier(target.unresolvedRepo)
            const listHint = resolveToolHintName(
                context?.filterConfig,
                'list_projects',
                'mj.admin.listProjects'
            )
            const instructionsText = `'${safeRepo}' is not a registered project. Use ${listHint} (or the project registry) to find the correct repo, then re-read memory://agent-context/{repo}.`
            return {
                data: [
                    `Project: ${safeRepo}`,
                    'Project Number: unresolved',
                    'Workspace ID: unresolved',
                    `Instructions: ${JSON.stringify(instructionsText)}`,
                ].join('\n'),
            }
        }
        workspaceId = target.workspaceId ?? 'default'
        projectNumber = target.projectNumber
        if (pinSession && workspaceId !== 'default') {
            setActiveSessionProject(
                workspaceId,
                projectNumber !== undefined && projectNumber > 0 ? projectNumber : null,
                context?.runtime
            )
        }
    } else {
        // [INVARIANT] Bare memory://agent-context uses resourceWorkspace (session/config before CWD).
        workspaceId = resourceWorkspace({
            ...(config !== undefined ? { briefingConfig: config } : {}),
            ...(context?.runtime !== undefined ? { runtime: context.runtime } : {}),
        })
        projectNumber = resourceProjectNumber(
            {
                ...(config !== undefined ? { briefingConfig: config } : {}),
                ...(context?.runtime !== undefined ? { runtime: context.runtime } : {}),
            },
            workspaceId
        )
    }

    const safeWorkspace = sanitizeDisplayIdentifier(workspaceId)
    return {
        data: [
            `Project: ${safeWorkspace}`,
            `Project Number: ${projectNumber !== undefined && projectNumber > 0 ? String(projectNumber) : 'unresolved'}`,
            `Workspace ID: ${safeWorkspace}`,
            'Instructions: Use your Conversation ID as the session_id for all tool calls.',
            ...buildSessionEntryLines(uri, context, workspaceId),
        ].join('\n'),
    }
}

/** Maximum session entries listed by `?session_id=`. */
const SESSION_ENTRY_LIMIT = 10

/**
 * [INTENT] After context compaction an agent loses the ids of entries it already wrote, so it
 * cannot link new entries to them. `?session_id=<id>` lists them (newest first) with link degrees.
 */
function buildSessionEntryLines(uri: string, context: ResourceContext, workspaceId: string): string[] {
    const queryIdx = uri.indexOf('?')
    if (queryIdx === -1) return []
    const hashIdx = uri.indexOf('#', queryIdx)
    const sessionId = new URLSearchParams(
        hashIdx === -1 ? uri.slice(queryIdx + 1) : uri.slice(queryIdx + 1, hashIdx)
    )
        .get('session_id')
        ?.trim()
    const db = context?.db
    if (
        sessionId === undefined ||
        sessionId === '' ||
        db === undefined ||
        db === null ||
        typeof db.getEntriesBySession !== 'function'
    ) {
        return []
    }
    try {
        const entries = db.getEntriesBySession(sessionId, SESSION_ENTRY_LIMIT, workspaceId)
        if (entries.length === 0) return ['Session Entries: none yet (no entries written with this session_id)']
        const degrees =
            typeof db.getRelationshipDegrees === 'function'
                ? db.getRelationshipDegrees(
                      entries.map((e) => e.id),
                      workspaceId
                  )
                : new Map<number, number>()
        const items = entries.map((e) => {
            const deg = degrees.get(e.id)
            const suffix = deg === undefined ? '' : deg > 0 ? ` ↔${String(deg)}` : ' ⚪'
            return `#${String(e.id)} (${e.entryType})${suffix} ${previewLabelText(e.content)}`
        })
        const isReadonly = context?.filterConfig ? isFilterEffectivelyReadOnly(context.filterConfig) : false
        const label = isReadonly
            ? 'Session Entries (newest first)'
            : 'Session Entries (newest first; link targets)'
        return [`${label}: ${JSON.stringify(fenceUntrustedList(items))}`]
    } catch (error) {
        logger.warning('Agent context session-entries query failed (degraded)', {
            module: 'RESOURCES',
            operation: 'agent-context-session',
            error: error instanceof Error ? error.message : String(error),
        })
        return ['Session Entries: unavailable (database query failed)']
    }
}

export function getAgentContextResource(): InternalResourceDef {
    return {
        uri: 'memory://agent-context/{+repo}',
        name: 'Agent Context',
        title: 'Agent Context',
        description:
            'Lightweight context for mid-thread agent reorientation. Returns project number, workspace ID, and session rules. Append ?session_id=<conversation-id> to list entries written this session, or ?pin_session=false to inspect without re-pinning.',
        mimeType: 'text/yaml',
        icons: [ICON_BRIEFING],
        annotations: withPriority(1.0, ASSISTANT_FOCUSED),
        handler: handleAgentContextResource,
    }
}

export function getAgentIdResource(): InternalResourceDef {
    const base = getAgentContextResource()
    return {
        ...base,
        uri: 'memory://agent-id/{+repo}',
        name: 'Agent ID Context (alias)',
    }
}
