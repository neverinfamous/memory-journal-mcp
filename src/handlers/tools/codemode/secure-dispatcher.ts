/**
 * Secure dispatcher and project/GitHub context resolution for Code Mode tool execution.
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { injectProjectNames } from '../index.js'
import { VERSION_AWARE_TOOL_NAMES } from './schemas.js'
import { wrapWithMetrics } from '../../../observability/index.js'
import { enforceAccessBoundary } from '../../../auth/validation.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { enforceTeamToolRbac } from '../team/rbac.js'
import { globalSubscriptionManager } from '../../../server/subscription-manager.js'
import { logger } from '../../../utils/logger.js'
import { activeProjectRegistry, uniqueWorkspaceForProject } from '../../../utils/write-scope.js'
import { getRpcExecutionOverrides } from '../../../codemode/rpc-context.js'
import { getRequestContext, requestContextStorage } from '../../../utils/request-context.js'
import {
    exceedsMaxToolInputElements,
    getValidatedToolInputMax,
    resolveEffectiveMaxToolInputElements,
} from '../../../utils/tool-input-bounds.js'
import { normalizeDispatchParams } from './dispatch-scope.js'
import { resolveEffectiveRpcScope, validateRpcOverrideBounds } from './dispatch-rpc-bounds.js'
import { getCodemodeInvocationState } from './invocation-store.js'

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
    explicitWorkspace?: boolean | undefined
    sessionId?: string | undefined
    autoVersion: boolean
    dryRun: boolean
    onMutatingDispatch?: (() => void) | undefined
}

function extractTestDbOverride(toolParams: unknown): {
    cleanToolParams: unknown
    callUseTestDb: boolean
} {
    if (!isRecord(toolParams)) {
        return { cleanToolParams: toolParams, callUseTestDb: false }
    }
    const callUseTestDb =
        toolParams['use_test_db'] === true || toolParams['useTestDb'] === true
    if ('use_test_db' in toolParams || 'useTestDb' in toolParams) {
        const cloned = { ...toolParams }
        delete cloned['use_test_db']
        delete cloned['useTestDb']
        return { cleanToolParams: cloned, callUseTestDb }
    }
    return { cleanToolParams: toolParams, callUseTestDb }
}

function enforceDispatcherElementBounds(
    toolParams: unknown,
    configuredMax: number | undefined
): Record<string, unknown> | undefined {
    const maxElements = resolveEffectiveMaxToolInputElements(configuredMax)
    const validatedMax = getValidatedToolInputMax(toolParams)
    if (validatedMax !== undefined && validatedMax <= maxElements) return undefined
    if (!exceedsMaxToolInputElements(toolParams, maxElements)) return undefined
    return {
        success: false,
        error: `Tool input exceeds maximum of ${String(maxElements)} elements.`,
        code: 'VALIDATION_ERROR',
        category: 'validation',
        recoverable: false,
    }
}

function runInAdjustedRequestContext(
    callUseTestDb: boolean,
    rpcOverrides: ReturnType<typeof getRpcExecutionOverrides>,
    effectiveUseSessionIdInCtx: string | undefined,
    executeWithScope: () => Promise<unknown>
): Promise<unknown> {
    const existingReqCtx = getRequestContext()
    const effectiveUseTestDb = callUseTestDb || rpcOverrides?.useTestDb === true || existingReqCtx?.useTestDb === true
    const needTestDbCtx = effectiveUseTestDb && existingReqCtx?.useTestDb !== true
    const needSessCtx =
        effectiveUseSessionIdInCtx !== undefined && existingReqCtx?.sessionId !== effectiveUseSessionIdInCtx
    if (!needTestDbCtx && !needSessCtx) return executeWithScope()
    return requestContextStorage.run(
        {
            ...(existingReqCtx ?? {}),
            ...(effectiveUseTestDb ? { useTestDb: true } : {}),
            ...(effectiveUseSessionIdInCtx !== undefined ? { sessionId: effectiveUseSessionIdInCtx } : {}),
        },
        executeWithScope
    )
}

function assertToolAccessAndMaintenance(tool: ToolDefinition, sessionContext: ToolContext): void {
    const runtime = sessionContext.config?.runtime
    enforceAccessBoundary(tool.name, 'tool', tool.capabilities, runtime?.auditLogger)
    if (tool.name !== 'restore_backup') {
        runtime?.maintenanceManager.assertNotInMaintenanceMode()
    }
}

function checkDispatcherModeBlock(
    tool: ToolDefinition,
    sessionContext: ToolContext,
    readonlyOverride: boolean | undefined
): Record<string, unknown> | undefined {
    if (tool.name === 'update_configuration' && sessionContext.config?.codemodeInternalFullAccess !== true) {
        return {
            success: false,
            error: "Operation 'update_configuration' is blocked inside Code Mode unless --codemode-internal-full-access is enabled.",
            code: 'PERMISSION_DENIED',
            category: 'authorization',
            recoverable: false,
        }
    }
    if (readonlyOverride === true && tool.annotations?.readOnlyHint !== true) {
        return {
            success: false,
            error: `🛠️ AUTONOMOUS HEALING: Operation '${tool.name}' is blocked in readonly mode. Read operations only.`,
            code: 'PERMISSION_DENIED',
            category: 'auth',
            recoverable: true,
        }
    }
    return undefined
}

async function executeDispatcherCall(
    tool: ToolDefinition,
    toolParams: unknown,
    isSimulation: boolean | undefined,
    options: SecureDispatcherOptions
): Promise<unknown> {
    const { sessionContext, projectId, workspaceId, explicitWorkspace, sessionId, autoVersion, dryRun } = options
    const limitErr = enforceDispatcherElementBounds(toolParams, sessionContext.config?.maxToolInputElements)
    if (limitErr !== undefined) return limitErr
    const { cleanToolParams, callUseTestDb } = extractTestDbOverride(toolParams)
    const rpcOverrides = getRpcExecutionOverrides()
    const reg = activeProjectRegistry(sessionContext.config?.projectRegistry)
    const scopeRes = resolveEffectiveRpcScope({ workspaceId, projectId, explicitWorkspace, sessionId }, rpcOverrides, reg)
    if ('errorResult' in scopeRes) return scopeRes.errorResult

    const effectiveAutoVersion = rpcOverrides?.autoVersion === false ? false : autoVersion
    const executeWithScope = async (): Promise<unknown> => {
        assertToolAccessAndMaintenance(tool, sessionContext)
        const modeBlockErr = checkDispatcherModeBlock(tool, sessionContext, rpcOverrides?.readonly)
        if (modeBlockErr !== undefined) return modeBlockErr

        const normalized = await normalizeDispatchParams(tool, cleanToolParams, {
            sessionContext,
            projectId: scopeRes.effectiveProjectId,
            workspaceId: scopeRes.effectiveWorkspaceId,
            ...(scopeRes.effectiveExplicitWorkspace !== undefined
                ? { explicitWorkspace: scopeRes.effectiveExplicitWorkspace }
                : {}),
            ...(scopeRes.effectiveSessionId !== undefined ? { sessionId: scopeRes.effectiveSessionId } : {}),
            ...(rpcOverrides?.projectNumber !== undefined ? { rpcPinnedProject: true } : {}),
            deferSideEffects: true,
        })
        if ('errorResult' in normalized) return normalized.errorResult
        const normalizedParams = normalized.params
        const boundsErr = validateRpcOverrideBounds(tool, normalizedParams, rpcOverrides, reg)
        if (boundsErr !== undefined) return boundsErr

        if (tool.group === 'team') {
            try {
                enforceTeamToolRbac(sessionContext, tool, normalizedParams)
            } catch (err) {
                return formatHandlerError(err)
            }
        }
        if (normalized.postRbacCheck !== undefined) {
            const postErr = await normalized.postRbacCheck()
            if (postErr !== undefined) return postErr
        }

        const isSim =
            tool.annotations?.readOnlyHint !== true &&
            (dryRun || rpcOverrides?.dryRun === true || isSimulation === true)
        const finalParams = isSim
            ? normalizedParams
            : applyAutoVersion(tool, normalizedParams, effectiveAutoVersion, sessionContext)
        if (tool.annotations?.readOnlyHint !== true && (dryRun || rpcOverrides?.dryRun === true)) {
            return {
                success: true,
                dry_run: true,
                message: `Simulated successful execution of ${tool.name}`,
                simulatedParams: finalParams,
            }
        }
        if (isSimulation === true && tool.annotations?.readOnlyHint !== true) {
            return { success: true, simulated: true, params: finalParams }
        }
        if (tool.annotations?.readOnlyHint !== true) options.onMutatingDispatch?.()
        return invokeToolWithGuards(tool, finalParams, sessionContext)
    }

    return runInAdjustedRequestContext(
        callUseTestDb,
        rpcOverrides,
        scopeRes.effectiveUseSessionIdInCtx,
        executeWithScope
    )
}

export function createSecureDispatcher(
    options: SecureDispatcherOptions
): (toolName: string, toolParams: unknown, isSimulation?: boolean) => Promise<unknown> {
    const toolByName = new Map(options.tools.map((t) => [t.name, t]))
    return async (toolName: string, toolParams: unknown, isSimulation?: boolean): Promise<unknown> => {
        const tool = toolByName.get(toolName)
        if (!tool) {
            throw new Error(
                `[Security] Tool "${toolName}" is not available or registered in the environment. If you were trying to read a resource, use the proper readResource API instead.`
            )
        }
        return executeDispatcherCall(tool, toolParams, isSimulation, options)
    }
}

/**
 * Create a cached-bundle dispatcher reading per-invocation state from `invocation-store.ts`.
 */
export function createContextualSecureDispatcher(
    tools: ToolDefinition[]
): (toolName: string, toolParams: unknown, isSimulation?: boolean) => Promise<unknown> {
    const toolByName = new Map(tools.map((t) => [t.name, t]))
    return async (toolName: string, toolParams: unknown, isSimulation?: boolean): Promise<unknown> => {
        const tool = toolByName.get(toolName)
        if (!tool) {
            throw new Error(
                `[Security] Tool "${toolName}" is not available or registered in the environment. If you were trying to read a resource, use the proper readResource API instead.`
            )
        }
        const state = getCodemodeInvocationState()
        if (state === undefined) {
            throw new Error('[Security] Code Mode invocation context is not active.')
        }
        return executeDispatcherCall(tool, toolParams, isSimulation, {
            tools,
            sessionContext: state.sessionContext,
            projectId: state.projectId,
            workspaceId: state.workspaceId,
            explicitWorkspace: state.explicitWorkspace,
            sessionId: state.sessionId,
            autoVersion: state.autoVersion,
            dryRun: state.dryRun,
            onMutatingDispatch: state.onMutatingDispatch,
        })
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
    const runtime = sessionContext.config?.runtime

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
