import {
    getEnabledGroups,
    isReadonlyMetaActive,
    isToolVisibleForFilter,
} from '../../../filtering/tool-filter.js'
import {
    generateStandardInstructions,
    generateCodeModeInstructions,
} from '../../../constants/server-instructions.js'
import { TOOL_GROUPS } from '../../../filtering/tool-constants.js'
import type { ToolGroup, ToolRegistration } from '../../../types/index.js'
import type { PromptDefinition } from '../../registration.js'
import type { ServerContext, ServerOptions } from '../types.js'

const READ_ONLY_HINTS_CACHE = new WeakMap<ToolRegistration[], Map<string, boolean | undefined>>()

/** Collect and memoize `readOnlyHint` annotations keyed by `allTools` array identity. */
export function getCachedReadOnlyHints(
    allTools: ToolRegistration[]
): Map<string, boolean | undefined> {
    const cached = READ_ONLY_HINTS_CACHE.get(allTools)
    if (cached !== undefined) return cached
    const hints = new Map<string, boolean | undefined>()
    for (const tool of allTools) {
        hints.set(tool.name, tool.annotations?.readOnlyHint)
    }
    READ_ONLY_HINTS_CACHE.set(allTools, hints)
    return hints
}

interface CachedInstructionsEntry {
    prompts: PromptDefinition[]
    allToolNamesSize: number
    readOnlyHints: ReadonlyMap<string, boolean | undefined> | undefined
    filterRaw: string | undefined
    enabledTools: ReadonlySet<string> | undefined
    instructionLevel: ServerOptions['instructionLevel']
    codemodeFull: boolean | undefined
    briefingJson: string
    instructions: string
}

const MAX_INSTRUCTIONS_CACHE = 16
const INSTRUCTIONS_CACHE: CachedInstructionsEntry[] = []

function computeServerInstructions(
    currentConfig: ReturnType<ServerContext['configManager']['getConfig']>,
    options: ServerOptions,
    prompts: PromptDefinition[],
    allToolNames: Set<string>,
    readOnlyHints?: ReadonlyMap<string, boolean | undefined>
): string {
    const filterRaw = currentConfig.toolFilterConfig?.raw
    let enabledSet = currentConfig.toolFilterConfig?.enabledTools ?? allToolNames
    if (isReadonlyMetaActive(filterRaw) && readOnlyHints !== undefined) {
        enabledSet = new Set(
            [...enabledSet].filter((name) =>
                isToolVisibleForFilter(name, readOnlyHints.get(name), filterRaw)
            )
        )
    }
    const groups = currentConfig.toolFilterConfig ? getEnabledGroups(enabledSet) : undefined

    const isCodeModeOnly =
        filterRaw?.trim() === 'codemode' ||
        (enabledSet.has('mj_execute_code') &&
            [...enabledSet].every(
                (t) => t === 'mj_execute_code' || t === 'update_configuration'
            ))
    const mappedPrompts = prompts.map((p) => {
        const prompt = p as { name: string; description?: string }
        return {
            name: prompt.name,
            ...(prompt.description !== undefined ? { description: prompt.description } : {}),
        }
    })

    const instructionConfig = {
        ...(currentConfig.briefingConfig ?? {}),
        ...(options.instructionLevel !== undefined
            ? { instructionLevel: options.instructionLevel }
            : {}),
    }

    if (isCodeModeOnly) {
        // [INTENT] Keep `enabledSet` scoped to registered MCP tools for `## Active Tools`;
        // expand only `finalGroups` when `codemodeInternalFullAccess` unlocks sandbox namespaces.
        const sandboxVisibleTools =
            isReadonlyMetaActive(filterRaw) && readOnlyHints !== undefined
                ? new Set(
                      [...allToolNames].filter((name) =>
                          isToolVisibleForFilter(name, readOnlyHints.get(name), filterRaw)
                      )
                  )
                : allToolNames
        const finalGroups =
            currentConfig.codemodeInternalFullAccess === true
                ? isReadonlyMetaActive(filterRaw)
                    ? getEnabledGroups(sandboxVisibleTools)
                    : new Set<ToolGroup>(
                          Object.keys(TOOL_GROUPS).filter((k): k is ToolGroup => k in TOOL_GROUPS)
                      )
                : groups

        return generateCodeModeInstructions(
            enabledSet,
            mappedPrompts,
            undefined,
            finalGroups,
            instructionConfig
        )
    }

    return generateStandardInstructions(enabledSet, mappedPrompts, undefined, groups, instructionConfig)
}

/** Build the server instructions for the currently enabled tools/groups (memoized per config/prompt set). */
export function buildServerInstructions(
    context: ServerContext,
    options: ServerOptions,
    prompts: PromptDefinition[],
    allToolNames: Set<string>,
    readOnlyHints?: ReadonlyMap<string, boolean | undefined>
): string {
    const currentConfig = context.configManager.getConfig()
    const filterRaw = currentConfig.toolFilterConfig?.raw
    const enabledTools = currentConfig.toolFilterConfig?.enabledTools
    const briefingJson = JSON.stringify(currentConfig.briefingConfig ?? null)

    const hit = INSTRUCTIONS_CACHE.find(
        (entry) =>
            entry.prompts === prompts &&
            entry.allToolNamesSize === allToolNames.size &&
            entry.readOnlyHints === readOnlyHints &&
            entry.filterRaw === filterRaw &&
            entry.enabledTools === enabledTools &&
            entry.instructionLevel === options.instructionLevel &&
            entry.codemodeFull === currentConfig.codemodeInternalFullAccess &&
            entry.briefingJson === briefingJson
    )
    if (hit !== undefined) return hit.instructions

    const instructions = computeServerInstructions(
        currentConfig,
        options,
        prompts,
        allToolNames,
        readOnlyHints
    )
    if (INSTRUCTIONS_CACHE.length >= MAX_INSTRUCTIONS_CACHE) {
        INSTRUCTIONS_CACHE.shift()
    }
    INSTRUCTIONS_CACHE.push({
        prompts,
        allToolNamesSize: allToolNames.size,
        readOnlyHints,
        filterRaw,
        enabledTools,
        instructionLevel: options.instructionLevel,
        codemodeFull: currentConfig.codemodeInternalFullAccess,
        briefingJson,
        instructions,
    })
    return instructions
}
