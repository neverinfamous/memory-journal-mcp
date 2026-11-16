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

function formatDefaultAgentContext(
    config: ResourceContext['briefingConfig'],
    fallbackRegistry: ReturnType<typeof loadProjectRegistryFromConfig>,
    runtime: ResourceContext['runtime']
): ResourceResult {
    const defaultProjNum =
        fallbackRegistry?.['default']?.project_number ??
        (config?.defaultWorkspaceId === 'default' ? config.defaultProjectNumber : undefined)
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
        ].join('\n'),
    }
}

function handleAgentContextResource(uri: string, context: ResourceContext): ResourceResult {
    const config = context?.briefingConfig
    const fallbackRegistry = config?.projectRegistry ?? loadProjectRegistryFromConfig()

    const match = /^memory:\/\/(?:agent-context|agent-id)(?:\/(.+))?$/.exec(getBaseUri(uri))
    const rawRepo = match?.[1] !== undefined ? safeDecodeUriSegment(match[1]) : undefined
    if (rawRepo?.toLowerCase() === 'default') {
        return formatDefaultAgentContext(config, fallbackRegistry, context?.runtime)
    }

    const repo = rawRepo
    const numericRepo = repo !== undefined ? /^#?(\d+)$/.exec(repo) : null
    const exactRepo = repo !== undefined ? exactRegistryKey(repo, fallbackRegistry) : undefined
    const numericWorkspace =
        numericRepo !== null
            ? uniqueWorkspaceForProject(Number(numericRepo[1]), fallbackRegistry)
            : undefined
    const namedRepo = exactRepo ?? numericWorkspace
    // [INVARIANT] An explicit but unknown repo never falls back to cwd/session/first
    // registry context (H1): report it as unresolved instead.
    if (repo !== undefined && namedRepo === undefined) {
        return {
            data: [
                `Project: ${repo}`,
                'Project Number: unresolved',
                'Workspace ID: unresolved',
                `Instructions: '${repo}' is not a registered project. Use list_projects (or the project registry) to find the correct repo, then re-read memory://agent-context/{repo}.`,
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
        ].join('\n'),
    }
}

export function getAgentContextResource(): InternalResourceDef {
    return {
        uri: 'memory://agent-context/{+repo}',
        name: 'Agent Context',
        title: 'Agent Context',
        description: 'Lightweight context for mid-thread agent reorientation. Returns project number, workspace ID, and session rules.',
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
