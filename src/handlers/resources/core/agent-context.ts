import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import type { InternalResourceDef, ResourceContext } from '../shared.js'
import { withPriority, ASSISTANT_FOCUSED } from '../../../utils/resource-annotations.js'

export function getAgentContextResource(): InternalResourceDef {
    return {
        uri: 'memory://agent-context/{+repo}',
        name: 'Agent Context',
        title: 'Agent Context',
        description: 'Lightweight context for mid-thread agent reorientation. Returns project number, workspace ID, and session rules.',
        mimeType: 'text/yaml',
        annotations: withPriority(1.0, ASSISTANT_FOCUSED),
        handler: (uri: string, context: ResourceContext) => {
            const config = context?.briefingConfig
            const registry = config?.projectRegistry ?? {}
            const defaultProjectNumber = config?.defaultProjectNumber

            const match = /^memory:\/\/agent-context\/(.+)$/.exec(uri)
            const repo = match?.[1] ?? 'default'

            let projectNumber = defaultProjectNumber ?? -1

            if (Object.keys(registry).length > 0) {
                // Allow looking up by key first
                const exactMatch = registry[repo]
                if (exactMatch) {
                    projectNumber = exactMatch.project_number ?? projectNumber
                } else {
                    // Try to match by path basename
                    const entries = Object.entries(registry)
                    const found = entries.find(([_, entry]) => {
                        return entry.path.endsWith(`/${repo}`) || entry.path.endsWith(`\\${repo}`)
                    })
                    if (found) {
                        projectNumber = found[1].project_number ?? projectNumber
                    }
                }
            }

            // resolveWorkspaceId takes explicitWorkspaceId first. We don't have an explicit one, 
            // we want it to resolve based on projectNumber and registry.
            // By passing config, we allow it to find the registry key just like tool handlers do.
            const finalWorkspaceId = resolveWorkspaceId(undefined, projectNumber, config)

            const content = [
                `Project: ${repo}`,
                `Project Number: ${projectNumber}`,
                `Workspace ID: ${finalWorkspaceId}`,
                `Instructions: Use your Conversation ID as the session_id for all tool calls.`,
            ].join('\n')

            return {
                contents: [
                    {
                        uri,
                        mimeType: 'text/yaml',
                        text: content,
                    },
                ],
            }
        },
    }
}
