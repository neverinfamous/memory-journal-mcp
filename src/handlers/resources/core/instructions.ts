import { getAllToolNames, getEnabledGroups } from '../../../filtering/tool-filter.js'
import {
    generateStandardInstructions,
    generateCodeModeInstructions,
} from '../../../constants/server-instructions.js'
import { TOOL_GROUPS } from '../../../filtering/tool-constants.js'
import type { ToolGroup } from '../../../types/index.js'
import { getPrompts } from '../../prompts/index.js'
import { ICON_BRIEFING } from '../../../constants/icons.js'
import { withPriority, ASSISTANT_FOCUSED } from '../../../utils/resource-annotations.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../shared.js'

export const instructionsResource: InternalResourceDef = {
    uri: 'memory://instructions',
    name: 'Server Instructions',
    title: 'Full Server Behavioral Guidance',
    description: 'Full server instructions for AI agents.',
    mimeType: 'text/markdown',
    icons: [ICON_BRIEFING],
    annotations: withPriority(0.95, ASSISTANT_FOCUSED),
    handler: (_uri: string, context: ResourceContext): ResourceResult => {
        const allToolNames = new Set(getAllToolNames())
        const enabledTools = context.filterConfig?.enabledTools ?? allToolNames
        const enabledGroups = context.filterConfig
            ? getEnabledGroups(context.filterConfig.enabledTools)
            : undefined

        const prompts = getPrompts().flatMap((p) => {
            if (!('name' in p) || typeof p.name !== 'string') return []
            const desc =
                'description' in p && typeof p.description === 'string'
                    ? p.description
                    : undefined
            return [{ name: p.name, ...(desc !== undefined ? { description: desc } : {}) }]
        })

        const isCodeModeOnly = enabledTools.size === 1 && enabledTools.has('mj_execute_code')
        const generatorFn = (isCodeModeOnly || context.filterConfig?.raw === 'codemode') 
            ? generateCodeModeInstructions 
            : generateStandardInstructions;

        let finalEnabledTools = enabledTools
        let finalEnabledGroups = enabledGroups

        if (isCodeModeOnly || context.filterConfig?.raw === 'codemode') {
            const rawMgr = context.runtime?.configManager
            if (
                rawMgr !== null &&
                rawMgr !== undefined &&
                typeof rawMgr === 'object' &&
                'getConfig' in rawMgr &&
                typeof rawMgr.getConfig === 'function'
            ) {
                const currentConfig: unknown = (rawMgr as { getConfig: () => unknown }).getConfig()
                if (
                    currentConfig !== null &&
                    currentConfig !== undefined &&
                    typeof currentConfig === 'object' &&
                    'codemodeInternalFullAccess' in currentConfig &&
                    currentConfig.codemodeInternalFullAccess === true
                ) {
                    finalEnabledTools = allToolNames
                    finalEnabledGroups = new Set<ToolGroup>(
                        Object.keys(TOOL_GROUPS).filter((k): k is ToolGroup => k in TOOL_GROUPS)
                    )
                }
            }
        }

        const instructions = generatorFn(
            finalEnabledTools,
            prompts,
            undefined,
            finalEnabledGroups,
            context.briefingConfig
        )

        return {
            data: instructions,
        }
    },
}
