import {
    loadProjectRegistryFromConfig,
    resolveProjectContext,
    setActiveSessionProject,
} from '../../../utils/workspace-resolver.js'
import { exactRegistryKey, uniqueWorkspaceForProject } from '../../../utils/write-scope.js'
import {
    getBaseUri,
    safeDecodeUriSegment,
    type InternalResourceDef,
    type ResourceContext,
    type ResourceResult,
} from '../shared.js'
import { withPriority, ASSISTANT_FOCUSED } from '../../../utils/resource-annotations.js'
import { parseCanonicalPositiveInt } from '../../../utils/safe-positive-int.js'
import { previewLabel } from './briefing/graph-pivots-section.js'
import { fenceNonCanonicalRefOrKey } from '../../../utils/security-utils.js'

function formatDefaultAgentContext(
    uri: string,
    context: ResourceContext,
    config: ResourceContext['briefingConfig'],
    fallbackRegistry: ReturnType<typeof loadProjectRegistryFromConfig>,
    runtime: ResourceContext['runtime']
): ResourceResult {
    const defaultProjNum =
        fallbackRegistry?.['default']?.project_number ??
        (config?.defaultWorkspaceId?.trim().toLowerCase() === 'default'
            ? config.defaultProjectNumber
            : undefined)
    setActiveSessionProject(
        'default',
        defaultProjNum !== undefined && defaultProjNum > 0 ? defaultProjNum : null,
        runtime
    )
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

function handleAgentContextResource(uri: string, context: ResourceContext): ResourceResult {
    const config = context?.briefingConfig
    const fallbackRegistry = config?.projectRegistry ?? loadProjectRegistryFromConfig()

    const match = /^memory:\/\/(?:agent-context|agent-id)(?:\/(.+))?$/.exec(getBaseUri(uri))
    const rawRepo = match?.[1] !== undefined ? safeDecodeUriSegment(match[1]) : undefined
    if (rawRepo?.toLowerCase() === 'default') {
        return formatDefaultAgentContext(uri, context, config, fallbackRegistry, context?.runtime)
    }

    const repo = rawRepo
    const numericRepo = repo !== undefined ? parseCanonicalPositiveInt(repo) : undefined
    const exactRepo = repo !== undefined ? exactRegistryKey(repo, fallbackRegistry) : undefined
    const numericWorkspace =
        numericRepo !== undefined
            ? uniqueWorkspaceForProject(numericRepo, fallbackRegistry)
            : undefined
    const namedRepo = exactRepo ?? numericWorkspace
    // [INVARIANT] An explicit but unknown repo never falls back to cwd/session/first
    // registry context (H1): report it as unresolved instead.
    if (repo !== undefined && namedRepo === undefined) {
        const safeRepo = fenceNonCanonicalRefOrKey(repo, true)
        return {
            data: [
                `Project: ${safeRepo}`,
                'Project Number: unresolved',
                'Workspace ID: unresolved',
                `Instructions: '${safeRepo}' is not a registered project. Use list_projects (or the project registry) to find the correct repo, then re-read memory://agent-context/{repo}.`,
            ].join('\n'),
        }
    }

    const resolved = resolveProjectContext(
        namedRepo !== undefined ? { workspace_id: namedRepo } : {},
        {
            ...config,
            ...(context?.runtime !== undefined ? { runtime: context.runtime } : {}),
        }
    )

    const projectNumber = resolved.projectNumber ?? -1
    const workspaceId = resolved.workspaceId
    if (repo !== undefined && workspaceId !== 'default') {
        // [INTENT] `null` clears a stale project number when the repo is unnumbered.
        setActiveSessionProject(
            workspaceId,
            projectNumber > 0 ? projectNumber : null,
            context?.runtime
        )
    }

    const projectName = repo ?? (workspaceId !== 'default' ? workspaceId : 'default')
    return {
        data: [
            `Project: ${projectName}`,
            `Project Number: ${projectNumber === -1 ? 'unresolved' : String(projectNumber)}`,
            `Workspace ID: ${workspaceId}`,
            'Instructions: Use your Conversation ID as the session_id for all tool calls.',
            ...buildSessionEntryLines(uri, context, workspaceId),
        ].join('\n'),
    }
}

/** Maximum session entries listed by `?session_id=`. */
const SESSION_ENTRY_LIMIT = 10

/**
 * [INTENT] After context compaction an agent loses the ids of entries it already wrote, so it
 * cannot link new entries to them. `?session_id=<id>` lists them (newest first) as link targets.
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
    if (sessionId === undefined || sessionId === '' || typeof context.db.getEntriesBySession !== 'function') {
        return []
    }
    const entries = context.db.getEntriesBySession(sessionId, SESSION_ENTRY_LIMIT, workspaceId)
    if (entries.length === 0) return ['Session Entries: none yet (no entries written with this session_id)']
    const items = entries.map((e) => `#${String(e.id)} (${e.entryType}) ${previewLabel(e.content)}`)
    return [`Session Entries (newest first; link targets): ${items.join(' · ')}`]
}

export function getAgentContextResource(): InternalResourceDef {
    return {
        uri: 'memory://agent-context/{+repo}',
        name: 'Agent Context',
        title: 'Agent Context',
        description: 'Lightweight context for mid-thread agent reorientation. Returns project number, workspace ID, and session rules. Append ?session_id=<conversation-id> to also list entries you already wrote this session (link targets after context compaction).',
        mimeType: 'text/yaml',
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
