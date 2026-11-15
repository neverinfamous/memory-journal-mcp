import { wrapWithMetrics } from '../../../observability/index.js'
import type { ServerRuntime } from '../../../utils/maintenance-lock.js'
import { TEAM_PROMPT_NAMES } from '../../../auth/scope-map.js'
import { DUMMY_HEALING_TOOL_NAMES } from '../../../handlers/tools/core/dummy-healing/alias-catalog.js'
import type { PromptDefinition } from '../../registration.js'
import { formatToolFailure } from './register-tools-helpers.js'
import { formatTokenEstimatedError } from './call-interceptor-helpers.js'

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
    const metricsWrapped = wrapWithMetrics(requestedTool, inner, runtime.metrics)
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
