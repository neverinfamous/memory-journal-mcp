import { resolveProjectContext, resolveProjectNumberFromPath } from '../../../utils/workspace-resolver.js'
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
            const defaultProjectNumber = config?.defaultProjectNumber

            const match = /^memory:\/\/(?:agent-context|agent-id)(?:\/(.+))?$/.exec(uri)
            const rawRepo = match?.[1] !== undefined ? decodeURIComponent(match[1]) : undefined
            const repo = rawRepo === 'default' ? undefined : rawRepo

            const resolved = resolveProjectContext(
                repo !== undefined ? { workspace_id: repo } : {},
                config
            )

            let projectNumber = resolved.projectNumber ?? defaultProjectNumber ?? -1
            const workspaceId = resolved.workspaceId

            if (projectNumber === -1) {
                projectNumber = resolveProjectNumberFromPath(process.cwd()) ?? -1
            }

            const projectName = repo ?? (workspaceId !== 'default' ? workspaceId : 'default')

            const content = [
                `Project: ${projectName}`,
                `Project Number: ${projectNumber}`,
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
