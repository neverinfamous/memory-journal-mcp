/**
 * Tool Dispatch Pre/Post Guard Helpers
 *
 * Extracted from `handlers/tools/index.ts` so module size remains well under the
 * repository line ceiling while keeping `callTool()` easy to audit.
 */

import type { ToolDefinition, ToolHandlerConfig } from '../../types/index.js'
import { enforceAccessBoundary } from '../../auth/validation.js'
import {
    captureActiveProjectRegistryState,
    restoreActiveProjectRegistryState,
    setActiveProjectRegistry,
} from '../../codemode/normalizers/project-alias-helpers.js'
import { ALREADY_HEALED_ARGS } from '../../server/mcp-server/tool-registration/healed-args-marker.js'
import {
    exceedsMaxToolInputElements,
    resolveEffectiveMaxToolInputElements,
} from '../../utils/tool-input-bounds.js'
import { applyArgInterceptions } from './arg-interceptions.js'
import { assertToolFilterAllowsCall } from './dummy-filter-helpers.js'

export function applyToolHealingArgs(
    name: string,
    args: Record<string, unknown>,
    config?: ToolHandlerConfig
): { args: Record<string, unknown> } | { error: Record<string, unknown> } {
    if (config?.agentHealing === false || ALREADY_HEALED_ARGS.has(args)) return { args }
    const prevRegistryState = captureActiveProjectRegistryState()
    setActiveProjectRegistry(config?.projectRegistry)
    try {
        const intercept = applyArgInterceptions(name, [args])
        if ('error' in intercept) return intercept
        return { args: (intercept.args[0] as Record<string, unknown>) ?? args }
    } finally {
        restoreActiveProjectRegistryState(prevRegistryState)
    }
}

export function enforceToolInputElementBound(
    args: Record<string, unknown>,
    config?: ToolHandlerConfig
): Record<string, unknown> | undefined {
    const maxElements = resolveEffectiveMaxToolInputElements(config?.maxToolInputElements)
    if (!exceedsMaxToolInputElements(args, maxElements)) return undefined
    return {
        success: false,
        error: `Tool input exceeds maximum element count (${String(maxElements)}).`,
        code: 'VALIDATION_ERROR',
        category: 'validation',
        suggestion: 'Reduce the number of keys, array items, or nesting depth in tool arguments.',
        recoverable: false,
    }
}

export function getEntryToResourceRewriteUri(
    name: string,
    args: Record<string, unknown>,
    mapToUse: Map<string, ToolDefinition>,
    config?: ToolHandlerConfig
): string | undefined {
    if (
        config?.agentHealing === false ||
        name !== 'get_entry_by_id' ||
        args['entry_id'] !== undefined
    ) {
        return undefined
    }
    const trimmedUri = typeof args['uri'] === 'string' ? args['uri'].trim() : undefined
    if (
        trimmedUri !== undefined &&
        trimmedUri.startsWith('memory://') &&
        !/^memory:\/\/(?:entries|entry)\/\d+$/i.test(trimmedUri) &&
        mapToUse.has('read_resource')
    ) {
        return trimmedUri
    }
    return undefined
}

export function enforcePreHealingToolGuards(
    name: string,
    preTool: ToolDefinition | undefined,
    config?: ToolHandlerConfig
): { blocked: boolean; result?: unknown } {
    if (preTool === undefined) return { blocked: false }
    if (config?.filterConfig) {
        const preDisabled = assertToolFilterAllowsCall(
            name,
            preTool.annotations.readOnlyHint,
            config.filterConfig,
            config.agentHealing,
            config.codemodeInternalFullAccess === true
        )
        if (preDisabled !== undefined) return { blocked: true, result: preDisabled }
    }
    if (config?.runtime?.maintenanceManager !== undefined) {
        try {
            enforceAccessBoundary(name, 'tool', preTool.capabilities, config.runtime.auditLogger)
        } catch (error) {
            return {
                blocked: true,
                result: Promise.reject(error instanceof Error ? error : new Error(String(error))),
            }
        }
    }
    return { blocked: false }
}
