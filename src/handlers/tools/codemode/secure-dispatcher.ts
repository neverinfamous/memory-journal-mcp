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
import { activeProjectRegistry, pairStoredScope } from '../../../utils/write-scope.js'
import { lookupRegistryEntry } from './session-context.js'

export { resolveCodeModeSessionContext } from './session-context.js'

interface ZodLike {
    shape?: Record<string, unknown>
    _def?: {
        typeName?: string
        type?: string
        schema?: ZodLike
        in?: ZodLike
        out?: ZodLike
        left?: ZodLike
        right?: ZodLike
    }
    innerType?: () => ZodLike
}

export function checkSchemaAcceptsKey(schema: unknown, key: string): boolean {
    if (!isRecord(schema)) return false
    if ('properties' in schema && isRecord(schema['properties']) && key in schema['properties']) return true

    const s = schema as ZodLike
    if (isRecord(s.shape) && key in s.shape) return true

    if (s._def !== undefined && s._def !== null) {
        const typeName = s._def.typeName ?? s._def.type
        if ((typeName === 'ZodObject' || typeName === 'object') && isRecord(s.shape)) return key in s.shape
        if (['ZodEffects', 'pipe', 'ZodOptional', 'optional', 'ZodNullable', 'nullable'].includes(typeName ?? '')) {
            return checkSchemaAcceptsKey(s._def.schema ?? s._def.out ?? s._def.in ?? s.innerType?.(), key)
        }
        if (typeName === 'ZodIntersection' || typeName === 'intersection') {
            return checkSchemaAcceptsKey(s._def.left, key) || checkSchemaAcceptsKey(s._def.right, key)
        }
        if (typeName === 'ZodPipeline' || (s._def.out !== undefined && s._def.out !== null)) {
            return checkSchemaAcceptsKey(s._def.out, key)
        }
        if (s._def.schema !== undefined) return checkSchemaAcceptsKey(s._def.schema, key)
    }
    return false
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const UPPERCASE_RE = /[A-Z]/

export function deepCamelToSnake(obj: unknown, depth = 0): unknown {
    if (depth > 12) return obj
    if (Array.isArray(obj)) return obj.map((item) => deepCamelToSnake(item, depth + 1))
    if (isRecord(obj)) {
        const newObj: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(obj)) {
            if (FORBIDDEN_KEYS.has(k)) continue
            const snakeKey = UPPERCASE_RE.test(k)
                ? k.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
                : k
            if (FORBIDDEN_KEYS.has(snakeKey)) continue
            if (snakeKey === 'id' && !('entry_id' in obj)) {
                newObj['entry_id'] = deepCamelToSnake(v, depth + 1)
                continue
            }
            if (snakeKey === 'ids' && !('entry_ids' in obj)) {
                const vSnake = deepCamelToSnake(v, depth + 1)
                newObj['entry_ids'] = Array.isArray(vSnake) ? vSnake : [vSnake]
                continue
            }
            newObj[snakeKey] = deepCamelToSnake(v, depth + 1)
        }
        return newObj
    }
    return obj
}

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
    autoVersion: boolean
    dryRun: boolean
}

export function createSecureDispatcher(
    options: SecureDispatcherOptions
): (toolName: string, toolParams: unknown, isSimulation?: boolean) => Promise<unknown> {
    const { tools, sessionContext, projectId, workspaceId, autoVersion, dryRun } = options

    return async (toolName: string, toolParams: unknown, isSimulation?: boolean): Promise<unknown> => {
        const tool = tools.find((t) => t.name === toolName)
        if (!tool) {
            throw new Error(
                `[Security] Tool "${toolName}" is not available or registered in the environment. If you were trying to read a resource, use the proper readResource API instead.`
            )
        }

        const normalized = await normalizeDispatchParams(tool, toolParams, {
            sessionContext,
            projectId,
            workspaceId,
        })
        if ('errorResult' in normalized) return normalized.errorResult
        let finalParams = normalized.params

        finalParams = applyAutoVersion(tool, finalParams, autoVersion, sessionContext)

        if (tool.annotations?.readOnlyHint === false && dryRun) {
            return {
                success: true,
                dry_run: true,
                message: `Simulated successful execution of ${toolName}`,
                simulatedParams: finalParams,
            }
        }

        if (isSimulation === true && tool.annotations?.readOnlyHint === false) {
            return { success: true, simulated: true, params: finalParams }
        }

        return invokeToolWithGuards(tool, finalParams, sessionContext)
    }
}

interface DispatchParamContext {
    sessionContext: ToolContext
    projectId: number | string | undefined
    workspaceId: string | undefined
}

async function autoPopulateGithubUrls(
    paramsObj: Record<string, unknown>,
    sessionContext: ToolContext
): Promise<void> {
    if (
        !(
            (paramsObj['issue_number'] !== undefined && paramsObj['issue_url'] === undefined) ||
            (paramsObj['pr_number'] !== undefined && paramsObj['pr_url'] === undefined)
        )
    ) {
        return
    }
    if (sessionContext.github === undefined) return
    try {
        const repoInfo = await sessionContext.github.getRepoInfo()
        if (repoInfo?.owner && repoInfo?.repo) {
            if (paramsObj['issue_number'] !== undefined && paramsObj['issue_url'] === undefined) {
                paramsObj['issue_url'] = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/issues/${String(Number(paramsObj['issue_number']))}`
            }
            if (paramsObj['pr_number'] !== undefined && paramsObj['pr_url'] === undefined) {
                paramsObj['pr_url'] = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/pull/${String(Number(paramsObj['pr_number']))}`
            }
        }
    } catch (err) {
        logger.debug('Could not auto-populate GitHub URLs; proceeding without them', {
            module: 'CodeMode',
            error: err instanceof Error ? err.message : String(err),
        })
    }
}

async function normalizeDispatchParams(
    tool: ToolDefinition,
    toolParams: unknown,
    ctx: DispatchParamContext
): Promise<{ params: unknown } | { errorResult: Record<string, unknown> }> {
    const { sessionContext, projectId, workspaceId } = ctx
    const finalParams = deepCamelToSnake(toolParams)
    if (!isRecord(finalParams)) return { params: finalParams }

    const paramsObj = { ...finalParams }
    // When the caller named a project but no workspace, let resolveProjectContext derive the
    // workspace from that project instead of overriding it with the session workspace.
    const callerPassedProjectOnly =
        paramsObj['project_number'] !== undefined && paramsObj['workspace_id'] === undefined && paramsObj['workspace'] === undefined
    if (paramsObj['workspace'] !== undefined && paramsObj['workspace_id'] === undefined) {
        paramsObj['workspace_id'] = paramsObj['workspace']
    }
    if (typeof paramsObj['workspace_id'] === 'number') {
        paramsObj['workspace_id'] = String(paramsObj['workspace_id'])
    }
    if (typeof paramsObj['project_number'] === 'string') {
        const regEntry = lookupRegistryEntry(sessionContext.config?.projectRegistry, paramsObj['project_number'])
        if (regEntry?.project_number !== undefined) paramsObj['project_number'] = regEntry.project_number
    }
    if (typeof paramsObj['project_number'] === 'string') {
        const parsed = Number(paramsObj['project_number'])
        if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
            paramsObj['project_number'] = parsed
        } else {
            return {
                errorResult: {
                    success: false,
                    error: `Invalid project_number: '${paramsObj['project_number']}'. Code Mode failed to resolve this to a known numeric ID. You can pass the exact numeric ID (e.g. 14), the repo name (e.g. 'mysql-mcp'), or simply OMIT the project_number field entirely to let the system auto-inject the current workspace's ID.`,
                },
            }
        }
    }
    if (
        typeof paramsObj['workspace_id'] === 'string' &&
        paramsObj['workspace_id'] !== '*' &&
        checkSchemaAcceptsKey(tool.inputSchema, 'project_number')
    ) {
        const wsReg = lookupRegistryEntry(sessionContext.config?.projectRegistry, paramsObj['workspace_id'])
        const supplied = typeof paramsObj['project_number'] === 'number' ? paramsObj['project_number'] : undefined
        if (supplied !== undefined) {
            pairStoredScope(
                paramsObj['workspace_id'],
                supplied,
                activeProjectRegistry(sessionContext.config?.projectRegistry)
            )
        } else if (paramsObj['workspace_id'] !== 'default' && wsReg?.project_number !== undefined) {
            paramsObj['project_number'] = wsReg.project_number
        }
    }
    const callerWorkspaceId =
        typeof paramsObj['workspace_id'] === 'string' ? paramsObj['workspace_id'] : undefined
    if (
        paramsObj['project_number'] === undefined &&
        projectId !== undefined &&
        (callerWorkspaceId === undefined ||
            callerWorkspaceId === 'default' ||
            callerWorkspaceId === workspaceId) &&
        checkSchemaAcceptsKey(tool.inputSchema, 'project_number')
    ) {
        paramsObj['project_number'] = projectId
    }
    if (
        !callerPassedProjectOnly &&
        paramsObj['workspace_id'] === undefined &&
        workspaceId !== undefined &&
        workspaceId !== 'default' &&
        checkSchemaAcceptsKey(tool.inputSchema, 'workspace_id')
    ) {
        paramsObj['workspace_id'] = workspaceId
    }

    await autoPopulateGithubUrls(paramsObj, sessionContext)

    return { params: paramsObj }
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
        const lookupWorkspace =
            typeof paramsObj['workspace_id'] === 'string' ? paramsObj['workspace_id'] : undefined
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
