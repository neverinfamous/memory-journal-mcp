import { readResource } from '../../../handlers/resources/index.js'
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
import type { ToolGroup, ToolHandlerConfig } from '../../../types/index.js'
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
        if (canonicalWs?.toLowerCase() === 'default' && registryProject === undefined) {
            if (briefingConfig.defaultWorkspaceId?.toLowerCase() !== 'default') {
                return undefined
            }
            if (applicableDefaultProj !== undefined) {
                return applicableDefaultProj
            }
            return sessionCtx.workspaceId?.toLowerCase() === 'default'
                ? sessionCtx.projectNumber
                : undefined
        }
        return candidateProj
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

/**
 * Synchronize live runtime config & resolved briefing defaults onto a shared `ToolHandlerConfig`.
 */
export function syncLiveHandlerConfig(
    target: ToolHandlerConfig,
    liveConfig: ReturnType<ServerContext['configManager']['getConfig']>,
    options: ServerOptions,
    liveBriefing: ReturnType<typeof resolveActiveBriefingConfig>
): void {
    target.briefingConfig = liveBriefing
    if (liveConfig.codemodeInternalFullAccess !== undefined) {
        target.codemodeInternalFullAccess = liveConfig.codemodeInternalFullAccess
    } else if (options.codemodeInternalFullAccess !== undefined) {
        target.codemodeInternalFullAccess = options.codemodeInternalFullAccess
    } else {
        delete target.codemodeInternalFullAccess
    }
    if (liveBriefing.defaultProjectNumber !== undefined) {
        target.defaultProjectNumber = liveBriefing.defaultProjectNumber
    } else {
        delete target.defaultProjectNumber
    }
    if (liveBriefing.defaultWorkspaceId !== undefined) {
        target.defaultWorkspaceId = liveBriefing.defaultWorkspaceId
    } else {
        delete target.defaultWorkspaceId
    }
    if (liveBriefing.projectRegistry !== undefined) {
        target.projectRegistry = liveBriefing.projectRegistry
    } else {
        delete target.projectRegistry
    }
}

/**
 * Create the MCP resource read callback bound to live config and runtime metrics.
 */
export function createResourceReadHandler(
    context: ServerContext,
    _options: ServerOptions
): (
    uri: URL,
    mimeType: string
) => Promise<{
    contents: {
        uri: string
        mimeType: string
        text: string
        annotations?: Record<string, unknown>
    }[]
}> {
    const { configManager, db, teamDb, vectorManager, github, scheduler, allowedIoRoots, runtime } =
        context
    return async (uri: URL, mimeType: string) => {
        const currentConfig = configManager.getConfig()
        const activeBriefingConfig = resolveActiveBriefingConfig(
            currentConfig.briefingConfig,
            allowedIoRoots,
            runtime
        )

        try {
            const result = await readResource(
                uri.href,
                db,
                vectorManager,
                currentConfig.toolFilterConfig,
                github,
                scheduler,
                teamDb ?? undefined,
                activeBriefingConfig,
                runtime
            )

            runtime.metrics.recordResourceRead(uri.href, false)

            const dataStr =
                typeof result.data === 'string'
                    ? result.data
                    : JSON.stringify(result.data, null, 2)
            return {
                contents: [
                    {
                        uri: uri.href,
                        mimeType,
                        text: dataStr,
                        ...(result.annotations !== undefined
                            ? { annotations: result.annotations }
                            : {}),
                    },
                ],
            }
        } catch (error) {
            runtime.metrics.recordResourceRead(uri.href, true)
            throw error
        }
    }
}
