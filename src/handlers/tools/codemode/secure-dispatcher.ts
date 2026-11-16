/**
 * Secure dispatcher and project/GitHub context resolution for Code Mode tool execution.
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { injectProjectNames } from '../index.js'
import { VERSION_AWARE_TOOL_NAMES } from './schemas.js'
import { wrapWithMetrics } from '../../../observability/index.js'
import { enforceAccessBoundary } from '../../../auth/validation.js'
import { globalSubscriptionManager } from '../../../server/subscription-manager.js'
import { logger } from '../../../utils/logger.js'
import { activeProjectRegistry, uniqueWorkspaceForProject } from '../../../utils/write-scope.js'
import { getRpcExecutionOverrides } from '../../../codemode/rpc-context.js'
import { getRequestContext, requestContextStorage } from '../../../utils/request-context.js'
import { normalizeDispatchParams } from './dispatch-scope.js'

export { resolveCodeModeSessionContext } from './session-context.js'
export { checkSchemaAcceptsKey, deepCamelToSnake } from './dispatch-scope.js'

const MUTATING_TOOL_NAMES = new Set([
    'create_entry', 'update_entry', 'delete_entry', 'restore_entry',
    'batch_create_entries', 'batch_update_entries', 'batch_delete_entries',
    'team_add_member', 'team_update_member_role', 'team_remove_member',
])

function notifySubscriptionsIfMutated(tool: ToolDefinition, result: unknown, sessionContext: ToolContext): void {
    if (!isRecord(result) || result['success'] !== true) return
    const isMutation =
        MUTATING_TOOL_NAMES.has(tool.name) ||
        (tool.group === 'team' && tool.annotations.readOnlyHint !== true)
    if (!isMutation) return

    const subMgr = sessionContext.config?.subscriptionManager ?? globalSubscriptionManager
    const logSubErr = (err: unknown): void => {
        logger.debug('Subscription notification failed', { error: err })
    }
    void subMgr.notifyResourceUpdated('memory://briefing').catch(logSubErr)
    void subMgr.notifyResourceUpdated('memory://recent').catch(logSubErr)
    void subMgr.notifyResourceUpdated('memory://statistics').catch(logSubErr)

    if (tool.group === 'team') {
        void subMgr.notifyResourceUpdated('memory://team/recent').catch(logSubErr)
        void subMgr.notifyResourceUpdated('memory://team/statistics').catch(logSubErr)
    }
}

export interface SecureDispatcherOptions {
    tools: ToolDefinition[]
    sessionContext: ToolContext
    projectId: number | string | undefined
    workspaceId: string | undefined
    explicitWorkspace?: boolean
    autoVersion: boolean
    dryRun: boolean
    onMutatingDispatch?: () => void
}

export function createSecureDispatcher(
    options: SecureDispatcherOptions
): (toolName: string, toolParams: unknown, isSimulation?: boolean) => Promise<unknown> {
    const { tools, sessionContext, projectId, workspaceId, explicitWorkspace, autoVersion, dryRun } = options

    return async (toolName: string, toolParams: unknown, isSimulation?: boolean): Promise<unknown> => {
        const tool = tools.find((t) => t.name === toolName)
        if (!tool) {
            throw new Error(
                `[Security] Tool "${toolName}" is not available or registered in the environment. If you were trying to read a resource, use the proper readResource API instead.`
            )
        }

        let cleanToolParams = toolParams
        let callUseTestDb = false
        if (isRecord(toolParams)) {
            callUseTestDb =
                toolParams['use_test_db'] === true || toolParams['useTestDb'] === true
            if ('use_test_db' in toolParams || 'useTestDb' in toolParams) {
                const cloned = { ...toolParams }
                delete cloned['use_test_db']
                delete cloned['useTestDb']
                cleanToolParams = cloned
            }
        }

        const normalized = await normalizeDispatchParams(tool, cleanToolParams, {
            sessionContext,
            projectId,
            workspaceId,
            ...(explicitWorkspace !== undefined ? { explicitWorkspace } : {}),
        })
        if ('errorResult' in normalized) return normalized.errorResult
        const normalizedParams = normalized.params

        const rpcOverrides = getRpcExecutionOverrides()
        if (rpcOverrides?.readonly === true && tool.annotations?.readOnlyHint !== true) {
            return {
                success: false,
                error: `🛠️ AUTONOMOUS HEALING: Operation '${tool.name}' is blocked in readonly mode. Read operations only.`,
                code: 'PERMISSION_DENIED',
                category: 'auth',
                recoverable: true,
            }
        }

        const executeWithScope = async (): Promise<unknown> => {
            const finalParams = applyAutoVersion(tool, normalizedParams, autoVersion, sessionContext)

            if (tool.annotations?.readOnlyHint !== true && (dryRun || rpcOverrides?.dryRun === true)) {
                return {
                    success: true,
                    dry_run: true,
                    message: `Simulated successful execution of ${toolName}`,
                    simulatedParams: finalParams,
                }
            }

            if (isSimulation === true && tool.annotations?.readOnlyHint !== true) {
                return { success: true, simulated: true, params: finalParams }
            }

            if (tool.annotations?.readOnlyHint !== true) {
                options.onMutatingDispatch?.()
            }

            return invokeToolWithGuards(tool, finalParams, sessionContext)
        }

        const existingReqCtx = getRequestContext()
        const effectiveUseTestDb =
            callUseTestDb || rpcOverrides?.useTestDb === true || existingReqCtx?.useTestDb === true
        if (effectiveUseTestDb && existingReqCtx?.useTestDb !== true) {
            return requestContextStorage.run(
                { ...(existingReqCtx ?? {}), useTestDb: true },
                executeWithScope
            )
        }
        return executeWithScope()
    }
}

function applyAutoVersion(
    tool: ToolDefinition,
    finalParams: unknown,
    autoVersion: boolean,
    sessionContext: ToolContext
): unknown {
    if (!(autoVersion && VERSION_AWARE_TOOL_NAMES.has(tool.name) && isRecord(finalParams))) return finalParams
    const paramsObj = { ...finalParams }
    if (paramsObj['expected_version'] === undefined && typeof paramsObj['entry_id'] === 'number') {
        const entryId = paramsObj['entry_id']
        const targetDb = tool.group === 'team' ? sessionContext.teamDb : sessionContext.db
        // Look the entry up in the workspace the call targets; without it the lookup silently
        // defaults to 'default' and returns null for entries in any other workspace.
        let lookupWorkspace =
            typeof paramsObj['workspace_id'] === 'string' ? paramsObj['workspace_id'] : undefined
        if (lookupWorkspace === undefined && typeof paramsObj['project_number'] === 'number') {
            lookupWorkspace = uniqueWorkspaceForProject(
                paramsObj['project_number'],
                activeProjectRegistry(sessionContext.config?.projectRegistry)
            )
        }
        const existingEntry = targetDb?.getEntryById(entryId, lookupWorkspace)
        if (existingEntry !== null && existingEntry !== undefined && 'version' in existingEntry) {
            paramsObj['expected_version'] = existingEntry.version
        }
    }
    return paramsObj
}

async function invokeToolWithGuards(
    tool: ToolDefinition,
    finalParams: unknown,
    sessionContext: ToolContext
): Promise<unknown> {
    // Critical C-3 Fix: Enforce OAuth access boundary, metrics collection, audit logging, and resource notifications
    const runtime = sessionContext.config?.runtime
    enforceAccessBoundary(tool.name, 'tool', tool.capabilities, runtime?.auditLogger)
    if (tool.name !== 'restore_backup') {
        runtime?.maintenanceManager.assertNotInMaintenanceMode()
    }

    const argsRecord = isRecord(finalParams) ? finalParams : {}
    const rawInvoke = (a: Record<string, unknown>): Promise<unknown> => Promise.resolve(tool.handler(a))
    const metricsWrapped = runtime?.metrics !== undefined ? wrapWithMetrics(tool.name, rawInvoke, runtime.metrics) : rawInvoke
    const auditInterceptor = runtime?.auditInterceptor
    const result =
        auditInterceptor !== null && auditInterceptor !== undefined
            ? await auditInterceptor.around(tool.name, argsRecord, () => metricsWrapped(argsRecord))
            : await metricsWrapped(argsRecord)

    injectProjectNames(result, sessionContext.config?.projectRegistry)
    notifySubscriptionsIfMutated(tool, result, sessionContext)
    return result
}
