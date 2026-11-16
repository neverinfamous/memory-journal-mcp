import { wrapWithMetrics } from '../../../observability/index.js'
import type { ServerRuntime } from '../../../utils/maintenance-lock.js'
import { TEAM_PROMPT_NAMES } from '../../../auth/scope-map.js'
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

/**
 * [BOUNDARY] Runs autonomous unknown-tool healing fallbacks through the same guards as
 * registered tools: maintenance lock, audit interceptor, and metrics (H5). Failed payloads
 * are surfaced with `isError: true` instead of a silent success envelope.
 */

function structuredOf(formatted: unknown): Record<string, unknown> | undefined {
    if (typeof formatted !== 'object' || formatted === null) return undefined
    if (!('structuredContent' in formatted)) return undefined
    const sc = formatted.structuredContent
    return typeof sc === 'object' && sc !== null ? (sc as Record<string, unknown>) : undefined
}

export async function runFallbackWithInterceptors(
    requestedTool: string,
    toolArgs: Record<string, unknown>,
    runtime: ServerRuntime,
    fallback: () => Promise<unknown>
): Promise<unknown> {
    let formatted: unknown
    const inner = async (): Promise<unknown> => {
        formatted = await fallback()
        return structuredOf(formatted) ?? formatted
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
        return formatTokenEstimatedError(formatToolFailure(error, requestedTool, toolArgs), true)
    }

    if (formatted === undefined) return undefined
    const sc = structuredOf(formatted)
    if (
        sc?.['success'] === false &&
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
    allToolNames: Set<string>,
    runtime: ServerRuntime
): Promise<unknown> {
    if (matchesExactName(requestedTool, DUMMY_LIST_TOOL_NAMES)) {
        enforceAccessBoundary('list_tools', 'tool', undefined, runtime.auditLogger)
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
        enforceAccessBoundary('server_info', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload(await handleServerInfo(toolArgs, requestedTool, toolContext))
    }

    if (
        matchesExactName(requestedTool, DUMMY_PROJECT_TOOL_NAMES) ||
        requestedTool === 'projects'
    ) {
        const target = requestedTool === 'projects' ? 'list_projects' : projectAliasTarget(requestedTool)
        if (target !== undefined) {
            enforceAccessBoundary(target, 'tool', undefined, runtime.auditLogger)
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
        enforceAccessBoundary('list_adapters', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload(handleListAdapters(requestedTool, toolContext))
    }

    if (matchesExactName(requestedTool, DUMMY_GREP_SEARCH_TOOL_NAMES)) {
        enforceAccessBoundary('grep_search', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload(await handleGrepSearch(toolArgs, requestedTool, toolContext))
    }

    if (DUMMY_FILE_VIEW_TOOL_NAMES.includes(requestedTool)) {
        enforceAccessBoundary('view_file', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload(await handleViewFile(toolArgs, requestedTool, toolContext))
    }

    if (DUMMY_DIR_LIST_TOOL_NAMES.includes(requestedTool)) {
        enforceAccessBoundary('list_dir', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload(await handleListDir(toolArgs, requestedTool, toolContext))
    }

    return undefined
}
