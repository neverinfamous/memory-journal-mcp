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
import type { ToolGroup } from '../../../types/index.js'
import type { DEFAULT_BRIEFING_CONFIG } from '../../../handlers/resources/shared.js'
import type { PromptDefinition } from '../../registration.js'
import { globalSubscriptionManager } from '../../subscription-manager.js'
import { logAgentIssue } from '../../../utils/issue-logger.js'
import { findCanonicalRegistryKey, getActiveSessionProject } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../../utils/write-scope.js'
import type { ServerContext, ServerOptions } from '../types.js'

/**
 * Helpers extracted from `createServerInstance` (instruction generation, mutation
 * notifications, error formatting, briefing config resolution). Behaviour is unchanged.
 */

export const MUTATING_TOOLS = new Set([
    'create_entry',
    'update_entry',
    'delete_entry',
    'restore_entry',
    'batch_create_entries',
    'batch_update_entries',
    'batch_delete_entries',
    'team_add_member',
    'team_update_member_role',
    'team_remove_member',
])

/** Build the server instructions for the currently enabled tools/groups. */
export function buildServerInstructions(
    context: ServerContext,
    options: ServerOptions,
    prompts: PromptDefinition[],
    allToolNames: Set<string>,
    readOnlyHints?: ReadonlyMap<string, boolean | undefined>
): string {
    const currentConfig = context.configManager.getConfig()
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

/** Notify resource subscribers after a successful state-mutating tool call. */
export function notifyMutationSubscribers(toolName: string): void {
    void globalSubscriptionManager.notifyResourceUpdated('memory://briefing')
    void globalSubscriptionManager.notifyResourceUpdated('memory://recent')
    void globalSubscriptionManager.notifyResourceUpdated('memory://statistics')

    if (toolName.startsWith('team_')) {
        void globalSubscriptionManager.notifyResourceUpdated('memory://team/recent')
        void globalSubscriptionManager.notifyResourceUpdated('memory://team/statistics')
    }
}

/** Convert a thrown tool error into the structured error payload and log it for agent healing. */
export function formatToolFailure(
    error: unknown,
    toolName: string,
    args: unknown
): Record<string, unknown> {
    let errorResult: Record<string, unknown>
    if (
        error instanceof Error &&
        'toResponse' in error &&
        typeof (error as { toResponse?: unknown }).toResponse === 'function'
    ) {
        errorResult = (error as { toResponse: () => Record<string, unknown> }).toResponse()
    } else {
        const errorMessage = error instanceof Error ? error.message : String(error)
        errorResult = {
            success: false,
            error: errorMessage,
            code: 'INTERNAL_ERROR',
            category: 'internal',
            recoverable: false,
        }
    }

    logAgentIssue({
        source: 'MCP',
        action: toolName,
        input: args,
        error: (errorResult['error'] as string) ?? 'Unknown error',
    })
    return errorResult
}

/**
 * Merge live briefing config with server-level defaults.
 * [INVARIANT] Sticky session context is only consulted when `sessionRuntime` is supplied
 * (ephemeral, per-read resource/prompt resolution). Tool calls pass `undefined` so session
 * state is never written onto the shared `customToolHandlerConfig` (C1).
 * Explicit configured `defaultProjectNumber` wins over the registry-derived project.
 */
export function resolveActiveBriefingConfig(
    briefingConfig: typeof DEFAULT_BRIEFING_CONFIG,
    _options: ServerOptions,
    allowedIoRoots: string[],
    sessionRuntime?: object | null
): typeof DEFAULT_BRIEFING_CONFIG {
    const sessionCtx: { workspaceId?: string; projectNumber?: number } =
        sessionRuntime !== undefined ? getActiveSessionProject(sessionRuntime) : {}
    const resolvedRegistry = briefingConfig.projectRegistry
    const resolvedDefaultWs = briefingConfig.defaultWorkspaceId ?? sessionCtx.workspaceId
    const canonicalWs =
        resolvedDefaultWs !== undefined
            ? (findCanonicalRegistryKey(resolvedDefaultWs, resolvedRegistry) ?? resolvedDefaultWs)
            : undefined
    const canonicalConfigWs =
        briefingConfig.defaultWorkspaceId !== undefined
            ? (findCanonicalRegistryKey(briefingConfig.defaultWorkspaceId, resolvedRegistry) ??
              briefingConfig.defaultWorkspaceId)
            : undefined
    const briefingDefaultApplies =
        canonicalConfigWs === undefined ||
        canonicalConfigWs.toLowerCase() === canonicalWs?.toLowerCase()
    const registryProject =
        canonicalWs !== undefined ? resolvedRegistry?.[canonicalWs]?.project_number : undefined
    const applicableDefaultProj = briefingDefaultApplies
        ? briefingConfig.defaultProjectNumber
        : undefined
    const resolvedDefaultProj = ((): number | undefined => {
        if (canonicalConfigWs !== undefined && applicableDefaultProj !== undefined) {
            return (
                pairStoredScope(
                    canonicalConfigWs,
                    applicableDefaultProj,
                    activeProjectRegistry(resolvedRegistry)
                ).projectNumber ?? undefined
            )
        }
        const candidateProj =
            applicableDefaultProj ?? registryProject ?? sessionCtx.projectNumber
        const projClaimedElsewhere =
            canonicalConfigWs === undefined &&
            candidateProj !== undefined &&
            canonicalWs !== undefined &&
            resolvedRegistry !== undefined &&
            Object.entries(resolvedRegistry).some(
                ([k, v]) =>
                    v.project_number === candidateProj &&
                    k.toLowerCase() !== canonicalWs.toLowerCase()
            )
        if (projClaimedElsewhere) return registryProject
        if (
            canonicalConfigWs !== undefined &&
            registryProject === undefined &&
            sessionCtx.projectNumber !== undefined &&
            candidateProj === sessionCtx.projectNumber &&
            resolvedRegistry !== undefined &&
            Object.entries(resolvedRegistry).some(
                ([k, v]) =>
                    v.project_number === candidateProj &&
                    canonicalWs !== undefined &&
                    k.toLowerCase() !== canonicalWs.toLowerCase()
            )
        ) {
            return undefined
        }
        return canonicalWs === 'default' &&
            registryProject === undefined &&
            briefingConfig.defaultWorkspaceId !== 'default'
            ? registryProject
            : candidateProj
    })()
    const nextConfig: typeof DEFAULT_BRIEFING_CONFIG = {
        ...briefingConfig,
        allowedIoRoots,
    }
    if (resolvedDefaultProj !== undefined) nextConfig.defaultProjectNumber = resolvedDefaultProj
    else delete nextConfig.defaultProjectNumber
    if (resolvedRegistry !== undefined) nextConfig.projectRegistry = resolvedRegistry
    else delete nextConfig.projectRegistry
    if (resolvedDefaultWs !== undefined) nextConfig.defaultWorkspaceId = resolvedDefaultWs
    else delete nextConfig.defaultWorkspaceId
    return nextConfig
}
