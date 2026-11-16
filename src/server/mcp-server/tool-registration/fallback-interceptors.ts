import { wrapWithMetrics } from '../../../observability/index.js'
import type { ServerRuntime } from '../../../utils/maintenance-lock.js'
import { TEAM_PROMPT_NAMES } from '../../../auth/scope-map.js'
import { AuthorizationError, PermissionError } from '../../../types/errors.js'
import {
    DUMMY_HEALING_TOOL_NAMES,
    DUMMY_LIST_TOOL_NAMES,
    DUMMY_SERVER_INFO_TOOL_NAMES,
    DUMMY_PROJECT_TOOL_NAMES,
    DUMMY_ADAPTER_TOOL_NAMES,
    DUMMY_GREP_SEARCH_TOOL_NAMES,
    DUMMY_FILE_VIEW_TOOL_NAMES,
    DUMMY_DIR_LIST_TOOL_NAMES,
} from '../../../handlers/tools/core/dummy-healing/alias-catalog.js'
import {
    handleServerInfo,
    handleListAdapters,
    handleGrepSearch,
    handleViewFile,
    handleListDir,
    projectAliasTarget,
} from '../../../handlers/tools/core/dummy-healing.js'
import { isToolVisibleForFilter } from '../../../filtering/tool-filter.js'
import { enforceAccessBoundary } from '../../../auth/validation.js'
import type { ToolFilterConfig, ToolRegistration, ToolHandlerConfig, ToolContext } from '../../../types/index.js'
import type { PromptDefinition } from '../../registration.js'
import { formatToolFailure } from './register-tools-helpers.js'
import {
    formatSuccessPayload,
    formatTokenEstimatedError,
    matchesExactName,
    resolveSingleProjectFromRegistry,
} from './call-interceptor-helpers.js'

export interface FallbackAccessTarget {
    targetName: string
    targetType: 'tool' | 'prompt' | 'resource'
    capabilities?:
        | {
              requiresTeamScope?: boolean
              requiresAdminScope?: boolean
              requiresAuditScope?: boolean
          }
        | undefined
}

export function resolveKnownFallbackAuditName(
    requestedTool: string,
    matchingPrompt: PromptDefinition | undefined
): string | undefined {
    if (matchingPrompt !== undefined) {
        return TEAM_PROMPT_NAMES.has(matchingPrompt.name) ? matchingPrompt.name : 'get_prompt'
    }
    if (requestedTool.startsWith('memory://')) {
        return requestedTool
    }
    if (DUMMY_HEALING_TOOL_NAMES.has(requestedTool)) {
        return requestedTool
    }
    return undefined
}

function resolveDispatchFallbackAccessTarget(
    requestedTool: string
): FallbackAccessTarget | undefined {
    if (matchesExactName(requestedTool, DUMMY_LIST_TOOL_NAMES)) {
        return { targetName: 'list_tools', targetType: 'tool' }
    }
    if (DUMMY_SERVER_INFO_TOOL_NAMES.includes(requestedTool)) {
        return { targetName: 'server_info', targetType: 'tool' }
    }
    if (matchesExactName(requestedTool, DUMMY_PROJECT_TOOL_NAMES) || requestedTool === 'projects') {
        const target = requestedTool === 'projects' ? 'list_projects' : projectAliasTarget(requestedTool)
        return target !== undefined ? { targetName: target, targetType: 'tool' } : undefined
    }
    if (matchesExactName(requestedTool, DUMMY_ADAPTER_TOOL_NAMES)) {
        return { targetName: 'list_adapters', targetType: 'tool' }
    }
    if (matchesExactName(requestedTool, DUMMY_GREP_SEARCH_TOOL_NAMES)) {
        return { targetName: 'grep_search', targetType: 'tool' }
    }
    if (DUMMY_FILE_VIEW_TOOL_NAMES.includes(requestedTool)) {
        return { targetName: 'view_file', targetType: 'tool' }
    }
    if (DUMMY_DIR_LIST_TOOL_NAMES.includes(requestedTool)) {
        return { targetName: 'list_dir', targetType: 'tool' }
    }
    return undefined
}

function enforceFallbackAccessTargets(
    requestedTool: string,
    runtime: ServerRuntime,
    accessTargets?: readonly FallbackAccessTarget[]
): void {
    const resolvedTargets =
        accessTargets ??
        (() => {
            const inferred = resolveDispatchFallbackAccessTarget(requestedTool)
            return inferred !== undefined ? [inferred] : []
        })()
    for (const target of resolvedTargets) {
        enforceAccessBoundary(
            target.targetName,
            target.targetType,
            target.capabilities,
            runtime.auditLogger
        )
    }
}

/**
 * [BOUNDARY] Runs autonomous unknown-tool healing fallbacks through the same guards as
 * registered tools: access boundary check first (outside audit/metrics/issue wrappers so
 * unauthorized calls do not double-log), then maintenance lock, audit interceptor, and
 * metrics (H5/M12). Failed payloads surface with `isError: true`.
 */
function structuredContentObject(formatted: unknown): object | undefined {
    if (typeof formatted !== 'object' || formatted === null) return undefined
    if (!('structuredContent' in formatted)) return undefined
    const sc = formatted.structuredContent
    return typeof sc === 'object' && sc !== null && !Array.isArray(sc) ? sc : undefined
}

export async function runFallbackWithInterceptors(
    requestedTool: string,
    toolArgs: Record<string, unknown>,
    runtime: ServerRuntime,
    fallback: () => Promise<unknown>,
    accessTargets?: readonly FallbackAccessTarget[]
): Promise<unknown> {
    try {
        enforceFallbackAccessTargets(requestedTool, runtime, accessTargets)
    } catch (error: unknown) {
        if (error instanceof PermissionError || error instanceof AuthorizationError) {
            return formatTokenEstimatedError({ ...error.toResponse() }, true)
        }
        return formatTokenEstimatedError(formatToolFailure(error, requestedTool, toolArgs), true)
    }

    let formatted: unknown
    const inner = async (): Promise<unknown> => {
        formatted = await fallback()
        return structuredContentObject(formatted) ?? formatted
    }
    const metricToolName = requestedTool.startsWith('memory://') ? 'read_resource' : requestedTool
    const metricsWrapped = wrapWithMetrics(metricToolName, inner, runtime.metrics)
    const interceptor = runtime.auditInterceptor

    try {
        await runtime.maintenanceManager.withActiveJob(() =>
            interceptor !== null
                ? interceptor.around(requestedTool, toolArgs, () => metricsWrapped(toolArgs))
                : metricsWrapped(toolArgs)
        )
    } catch (error: unknown) {
        if (error instanceof PermissionError || error instanceof AuthorizationError) {
            return formatTokenEstimatedError({ ...error.toResponse() }, true)
        }
        return formatTokenEstimatedError(formatToolFailure(error, requestedTool, toolArgs), true)
    }

    if (formatted === undefined) return undefined
    const sc = structuredContentObject(formatted)
    if (
        sc !== undefined &&
        'success' in sc &&
        sc.success === false &&
        typeof formatted === 'object' &&
        formatted !== null &&
        !('isError' in formatted)
    ) {
        return { ...formatted, isError: true }
    }
    return formatted
}

/**
 * Dispatch non-prompt/non-resource healing fallback tools (`list_tools`, `server_info`,
 * project registry, adapters, and read-only FS fallbacks).
 */
export async function dispatchKnownGroupFallbackTools(
    requestedTool: string,
    toolArgs: Record<string, unknown>,
    toolContext: ToolContext,
    toolFilterConfig: ToolFilterConfig | null | undefined,
    fallbackConfig: ToolHandlerConfig,
    allTools: ToolRegistration[],
    allToolNames: Set<string>
): Promise<unknown> {
    if (matchesExactName(requestedTool, DUMMY_LIST_TOOL_NAMES)) {
        const enabledSet = toolFilterConfig?.enabledTools ?? allToolNames
        const raw = toolFilterConfig?.raw
        const toolsList = allTools
            .filter(
                (t) =>
                    enabledSet.has(t.name) &&
                    isToolVisibleForFilter(t.name, t.annotations?.readOnlyHint, raw)
            )
            .map((t) => ({ name: t.name, title: t.title, description: t.description, annotations: t.annotations }))
        return formatSuccessPayload({
            success: true,
            tools: toolsList,
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${requestedTool}' was called as an MCP tool instead of an MCP protocol request (tools/list). The available tools were returned successfully.`,
        })
    }

    if (DUMMY_SERVER_INFO_TOOL_NAMES.includes(requestedTool)) {
        return formatSuccessPayload(await handleServerInfo(toolArgs, requestedTool, toolContext))
    }

    if (
        matchesExactName(requestedTool, DUMMY_PROJECT_TOOL_NAMES) ||
        requestedTool === 'projects'
    ) {
        const target = requestedTool === 'projects' ? 'list_projects' : projectAliasTarget(requestedTool)
        if (target !== undefined) {
            if (target === 'get_project') {
                return formatSuccessPayload(
                    resolveSingleProjectFromRegistry(fallbackConfig.projectRegistry, toolArgs, requestedTool)
                )
            }
            return formatSuccessPayload({
                success: true,
                projects: fallbackConfig.projectRegistry ?? {},
                _healing_note: `🛠️ AUTONOMOUS HEALING: '${requestedTool}' was called as an MCP tool. Returned registered projects from projectRegistry successfully.`,
            })
        }
    }

    if (matchesExactName(requestedTool, DUMMY_ADAPTER_TOOL_NAMES)) {
        return formatSuccessPayload(handleListAdapters(requestedTool, toolContext))
    }

    if (matchesExactName(requestedTool, DUMMY_GREP_SEARCH_TOOL_NAMES)) {
        return formatSuccessPayload(await handleGrepSearch(toolArgs, requestedTool, toolContext))
    }

    if (DUMMY_FILE_VIEW_TOOL_NAMES.includes(requestedTool)) {
        return formatSuccessPayload(await handleViewFile(toolArgs, requestedTool, toolContext))
    }

    if (DUMMY_DIR_LIST_TOOL_NAMES.includes(requestedTool)) {
        return formatSuccessPayload(await handleListDir(toolArgs, requestedTool, toolContext))
    }

    return undefined
}
