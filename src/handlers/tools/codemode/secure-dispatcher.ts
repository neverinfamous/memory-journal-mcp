/**
 * Secure dispatcher and project/GitHub context resolution for Code Mode tool execution.
 */

import * as path from 'node:path'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { injectProjectNames } from '../index.js'
import { VERSION_AWARE_TOOL_NAMES } from './schemas.js'
import { wrapWithMetrics } from '../../../observability/index.js'
import { enforceAccessBoundary } from '../../../auth/validation.js'
import { globalSubscriptionManager } from '../../../server/subscription-manager.js'
import { getGitHubIntegration } from '../../../github/github-integration/index.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import type { ExecuteCodeInput } from './payload-synthesizer.js'

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

export function deepCamelToSnake(obj: unknown, depth = 0): unknown {
    if (depth > 12) return obj
    if (Array.isArray(obj)) return obj.map((item) => deepCamelToSnake(item, depth + 1))
    if (isRecord(obj)) {
        const newObj: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(obj)) {
            if (FORBIDDEN_KEYS.has(k)) continue
            const snakeKey = k.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
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
    'add_team_member', 'update_team_member', 'remove_team_member',
])

function notifySubscriptionsIfMutated(toolName: string, result: unknown, sessionContext: ToolContext): void {
    if (!isRecord(result) || result['success'] !== true) return
    const isMutation =
        MUTATING_TOOL_NAMES.has(toolName) ||
        (toolName.startsWith('team_') && toolName !== 'team_search' && toolName !== 'get_team_entry_by_id')
    if (!isMutation) return

    const subMgr = sessionContext.config?.subscriptionManager ?? globalSubscriptionManager
    void subMgr.notifyResourceUpdated('memory://briefing')
    void subMgr.notifyResourceUpdated('memory://recent')
    void subMgr.notifyResourceUpdated('memory://statistics')

    if (toolName.startsWith('team_') || toolName.includes('team_member')) {
        void subMgr.notifyResourceUpdated('memory://team/recent')
        void subMgr.notifyResourceUpdated('memory://team/statistics')
    }
}

function lookupRegistryEntry(
    registry: NonNullable<ToolContext['config']>['projectRegistry'],
    key: string
): { path?: string; project_number?: number } | undefined {
    if (!registry) return undefined
    const direct = registry[key]
    if (direct) return direct
    if (key.includes('/')) {
        const repoName = key.split('/').pop()
        if (repoName !== undefined && repoName !== '') return registry[repoName]
    }
    return undefined
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

        let finalParams = deepCamelToSnake(toolParams)

        if (isRecord(finalParams)) {
            const paramsObj = { ...finalParams }
            if (paramsObj['project_number'] === undefined && projectId !== undefined && checkSchemaAcceptsKey(tool.inputSchema, 'project_number')) {
                paramsObj['project_number'] = projectId
            }
            if (paramsObj['workspace'] !== undefined && paramsObj['workspace_id'] === undefined) {
                paramsObj['workspace_id'] = paramsObj['workspace']
            }
            if (typeof paramsObj['workspace_id'] === 'number') {
                paramsObj['workspace_id'] = String(paramsObj['workspace_id'])
            }
            if (paramsObj['workspace_id'] === undefined && workspaceId !== undefined && checkSchemaAcceptsKey(tool.inputSchema, 'workspace_id')) {
                paramsObj['workspace_id'] = workspaceId
            }

            if (
                (paramsObj['issue_number'] !== undefined && paramsObj['issue_url'] === undefined) ||
                (paramsObj['pr_number'] !== undefined && paramsObj['pr_url'] === undefined)
            ) {
                if (sessionContext.github !== undefined) {
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
                    } catch {
                        // Ignore errors and proceed without auto-populated github URLs
                    }
                }
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
                        success: false,
                        error: `Invalid project_number: '${paramsObj['project_number']}'. Code Mode failed to resolve this to a known numeric ID. You can pass the exact numeric ID (e.g. 14), the repo name (e.g. 'mysql-mcp'), or simply OMIT the project_number field entirely to let the system auto-inject the current workspace's ID.`,
                    }
                }
            }

            finalParams = paramsObj
        }

        if (autoVersion && VERSION_AWARE_TOOL_NAMES.has(toolName) && isRecord(finalParams)) {
            const paramsObj = { ...finalParams }
            if (paramsObj['expected_version'] === undefined && typeof paramsObj['entry_id'] === 'number') {
                const entryId = paramsObj['entry_id']
                const targetDb = toolName.startsWith('team_') ? sessionContext.teamDb : sessionContext.db
                const existingEntry = targetDb?.getEntryById(entryId)
                if (existingEntry !== null && existingEntry !== undefined && 'version' in existingEntry) {
                    paramsObj['expected_version'] = existingEntry.version
                }
            }
            finalParams = paramsObj
        }

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
        notifySubscriptionsIfMutated(tool.name, result, sessionContext)
        return result
    }
}

export async function resolveCodeModeSessionContext(
    context: ToolContext,
    input: ExecuteCodeInput
): Promise<
    | {
          sessionContext: ToolContext
          projectId: number | string | undefined
          numericProjectId: number | undefined
          workspaceId: string | undefined
      }
    | { errorResponse: Record<string, unknown> }
> {
    let projectId: number | string | undefined = input.project_number
    if (projectId === undefined || projectId === null) {
        if (context.config?.defaultProjectNumber !== undefined) {
            projectId = context.config.defaultProjectNumber
        } else if (context.config?.projectRegistry !== undefined) {
            const cwd = path.resolve(process.cwd()).toLowerCase()
            for (const entry of Object.values(context.config.projectRegistry)) {
                if (entry.path && path.resolve(entry.path).toLowerCase() === cwd && entry.project_number !== undefined) {
                    projectId = entry.project_number
                    break
                }
            }
        }
    }

    const numericProjectId = typeof projectId === 'number' ? projectId : undefined
    const workspaceId = resolveWorkspaceId(input.workspace_id, numericProjectId, context.config)

    let sessionContext = context
    const repo = input.repo
    if (repo !== undefined && repo !== '') {
        if (context.config?.codemodeInternalFullAccess !== true) {
            return {
                errorResponse: {
                    success: false,
                    error: 'Repo switching is restricted to internal administrative access.',
                    project_id: undefined,
                    executionTimeMs: 0,
                },
            }
        }
        const registryEntry = lookupRegistryEntry(context.config?.projectRegistry, repo)
        if (registryEntry?.path !== undefined && registryEntry.path !== '') {
            try {
                const injectedGithub = getGitHubIntegration(registryEntry.path, undefined, process.env['GITHUB_TOKEN'])
                await injectedGithub.getRepoInfo()
                sessionContext = { ...context, github: injectedGithub }
            } catch (error) {
                return {
                    errorResponse: {
                        success: false,
                        error: `Failed to initialize injected repository '${repo}': ${error instanceof Error ? error.message : String(error)}`,
                        project_id: undefined,
                        executionTimeMs: 0,
                    },
                }
            }
        }
    }

    if (typeof projectId === 'string') {
        const entry = lookupRegistryEntry(sessionContext.config?.projectRegistry, projectId)
        if (entry?.project_number !== undefined) projectId = entry.project_number
    }
    if (typeof projectId === 'string') {
        const parsed = Number(projectId)
        if (!Number.isNaN(parsed) && Number.isFinite(parsed)) projectId = parsed
    }

    if (projectId !== undefined && sessionContext.config?.projectRegistry !== undefined) {
        const registryEntry = Object.values(sessionContext.config.projectRegistry).find((r) => r.project_number === projectId)
        if (registryEntry?.path !== undefined && registryEntry.path !== '') {
            const isSameAsCwd = path.resolve(registryEntry.path).toLowerCase() === path.resolve(process.cwd()).toLowerCase()
            if (context.config?.codemodeInternalFullAccess === true || isSameAsCwd) {
                try {
                    const injectedGithub = getGitHubIntegration(registryEntry.path, undefined, process.env['GITHUB_TOKEN'])
                    sessionContext = { ...sessionContext, github: injectedGithub }
                } catch {
                    // Ignore injection failures; tools will fallback to global context or throw
                }
            }
        }
    }

    return { sessionContext, projectId, numericProjectId, workspaceId }
}
