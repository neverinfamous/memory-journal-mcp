import {
    getAllToolNames,
    getEnabledGroups,
    isReadonlyMetaActive,
    isToolVisibleForFilter,
} from '../../../filtering/tool-filter.js'
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
    handler: async (_uri: string, context: ResourceContext): Promise<ResourceResult> => {
        const allToolNames = new Set(getAllToolNames())
        const filterRaw = context.filterConfig?.raw
        let enabledTools = context.filterConfig?.enabledTools ?? allToolNames
        let readOnlyHints: Map<string, boolean | undefined> | undefined

        if (isReadonlyMetaActive(filterRaw)) {
            const { getTools } = await import('../../tools/index.js')
            const toolDefs = getTools(
                context.db,
                null,
                context.vectorManager,
                context.github ?? undefined,
                context.runtime !== undefined ? { runtime: context.runtime } : undefined,
                context.teamDb,
                undefined
            ).filter((t) => allToolNames.has(t.name))
            readOnlyHints = new Map(toolDefs.map((t) => [t.name, t.annotations?.readOnlyHint]))
            enabledTools = new Set(
                [...enabledTools].filter((name) =>
                    isToolVisibleForFilter(name, readOnlyHints?.get(name), filterRaw)
                )
            )
        }

        const enabledGroups = context.filterConfig
            ? getEnabledGroups(enabledTools)
            : undefined

        const prompts = getPrompts().flatMap((p) => {
            if (!('name' in p) || typeof p.name !== 'string') return []
            const desc =
                'description' in p && typeof p.description === 'string'
                    ? p.description
                    : undefined
            return [{ name: p.name, ...(desc !== undefined ? { description: desc } : {}) }]
        })

        const isCodeModeOnly =
            filterRaw?.trim() === 'codemode' ||
            (enabledTools.has('mj_execute_code') &&
                [...enabledTools].every(
                    (t) => t === 'mj_execute_code' || t === 'update_configuration'
                ))
        const generatorFn = isCodeModeOnly
            ? generateCodeModeInstructions
            : generateStandardInstructions

        // [INTENT] Active Tools reflects actually registered MCP tools (`enabledTools`),
        // while `finalEnabledGroups` advertises sandbox-accessible `memory://help/{group}` docs.
        let finalEnabledGroups = enabledGroups

        if (isCodeModeOnly) {
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
                    const sandboxVisibleTools =
                        isReadonlyMetaActive(filterRaw) && readOnlyHints !== undefined
                            ? new Set(
                                  [...allToolNames].filter((name) =>
                                      isToolVisibleForFilter(
                                          name,
                                          readOnlyHints?.get(name),
                                          filterRaw
                                      )
                                  )
                              )
                            : allToolNames
                    finalEnabledGroups = isReadonlyMetaActive(filterRaw)
                        ? getEnabledGroups(sandboxVisibleTools)
                        : new Set<ToolGroup>(
                              Object.keys(TOOL_GROUPS).filter((k): k is ToolGroup => k in TOOL_GROUPS)
                          )
                }
            }
        }

        const instructions = generatorFn(
            enabledTools,
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
