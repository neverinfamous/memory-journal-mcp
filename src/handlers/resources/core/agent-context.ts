import {
    resolveProjectContext,
    resolveProjectNumberFromPath,
    setActiveSessionProject,
} from '../../../utils/workspace-resolver.js'
import { exactRegistryKey, uniqueWorkspaceForProject } from '../../../utils/write-scope.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../shared.js'
import { withPriority, ASSISTANT_FOCUSED } from '../../../utils/resource-annotations.js'

export function getAgentContextResource(): InternalResourceDef {
    return {
        uri: 'memory://agent-context/{+repo}',
        name: 'Agent Context',
        title: 'Agent Context',
        description: 'Lightweight context for mid-thread agent reorientation. Returns project number, workspace ID, and session rules.',
        mimeType: 'text/yaml',
        annotations: withPriority(1.0, ASSISTANT_FOCUSED),
        handler: (uri: string, context: ResourceContext): ResourceResult => {
            const config = context?.briefingConfig

            const match = /^memory:\/\/(?:agent-context|agent-id)(?:\/(.+))?$/.exec(uri)
            const rawRepo = match?.[1] !== undefined ? decodeURIComponent(match[1]) : undefined
            if (rawRepo?.toLowerCase() === 'default') {
                return {
                    data: [
                        'Project: default',
                        'Project Number: unresolved',
                        'Workspace ID: default',
                        'Instructions: Use your Conversation ID as the session_id for all tool calls.',
                    ].join('\n'),
                }
            }
            const repo = rawRepo

            const numericRepo = repo !== undefined ? /^#?(\d+)$/.exec(repo) : null
            const exactRepo = repo !== undefined ? exactRegistryKey(repo, config?.projectRegistry) : undefined
            const numericWorkspace =
                numericRepo !== null
                    ? uniqueWorkspaceForProject(Number(numericRepo[1]), config?.projectRegistry)
                    : undefined
            const namedRepo = exactRepo ?? numericWorkspace
            const resolved = resolveProjectContext(
                namedRepo !== undefined ? { workspace_id: namedRepo } : {},
                {
                    ...config,
                    ...(context?.runtime !== undefined ? { runtime: context.runtime } : {}),
                }
            )

            let projectNumber = resolved.projectNumber ?? -1
            const workspaceId = resolved.workspaceId

            if (repo === undefined && projectNumber === -1) {
                projectNumber =
                    resolveProjectNumberFromPath(process.cwd(), config?.projectRegistry) ?? -1
            }

            if (
                repo !== undefined &&
                workspaceId !== 'default' &&
                resolved.projectNumber !== undefined
            ) {
                setActiveSessionProject(
                    workspaceId,
                    projectNumber > 0 ? projectNumber : undefined,
                    context?.runtime
                )
            }

            const projectName = repo ?? (workspaceId !== 'default' ? workspaceId : 'default')

            const content = [
                `Project: ${projectName}`,
                `Project Number: ${projectNumber === -1 ? 'unresolved' : String(projectNumber)}`,
                `Workspace ID: ${workspaceId}`,
                `Instructions: Use your Conversation ID as the session_id for all tool calls.`,
            ].join('\n')

            return {
                data: content,
            }
        },
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
