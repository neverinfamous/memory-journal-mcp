import { getAllToolNames } from '../../../filtering/tool-filter.js'
import { generateInstructions, type InstructionLevel } from '../../../constants/server-instructions.js'
import { getPrompts } from '../../prompts/index.js'
import { ICON_BRIEFING } from '../../../constants/icons.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../shared.js'

export const instructionsResource: InternalResourceDef = {
    uri: 'memory://instructions',
    name: 'Server Instructions',
    title: 'Full Server Behavioral Guidance',
    description: 'Full server instructions for AI agents.',
    mimeType: 'text/markdown',
    icons: [ICON_BRIEFING],
    annotations: {
        audience: ['assistant'],
        priority: 0.95,
    },
    handler: async (_uri: string, context: ResourceContext): Promise<ResourceResult> => {
        const level: InstructionLevel = 'full'

        const allToolNames = new Set(getAllToolNames())
        const enabledTools = context.filterConfig?.enabledTools ?? allToolNames

        const prompts = getPrompts().map((p) => {
            const prompt = p as { name: string; description?: string }
            return { name: prompt.name, description: prompt.description }
        })

        // Deferred import to avoid circular dependency (core → index → core)
        const { getResources } = await import('../index.js')
        const resources = getResources().map((r) => {
            const res = r as { uri: string; name: string; description?: string }
            return { uri: res.uri, name: res.name, description: res.description }
        })

        const instructions = generateInstructions(
            enabledTools,
            resources,
            prompts,
            undefined,
            level
        )

        return {
            data: instructions,
        }
    },
}
