/**
 * Pre-dispatch parameter scope resolution, alias coercion, and GitHub URL auto-enrichment for Code Mode.
 */

import * as path from 'node:path'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { ValidationError } from '../../../types/errors.js'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { logger } from '../../../utils/logger.js'
import { activeProjectRegistry, pairStoredScope } from '../../../utils/write-scope.js'
import { lookupRegistryEntry } from './session-context.js'

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

/**
 * Recursively converts camelCase keys to snake_case.
 * [INVARIANT] `id -> entry_id` / `ids -> entry_ids` aliasing applies only to top-level keys
 * and never when the target schema itself accepts `id`/`ids`, so nested
 * payloads (anchors, relationships, auto_context) keep their own `id` fields intact.
 */
export function deepCamelToSnake(
    obj: unknown,
    depth = 0,
    acceptsKey?: (key: string) => boolean
): unknown {
    if (depth > 12) return obj
    if (Array.isArray(obj)) return obj.map((item) => deepCamelToSnake(item, depth + 1))
    if (isRecord(obj)) {
        const newObj: Record<string, unknown> = {}
        const canAlias = (alias: string): boolean => depth === 0 && !(acceptsKey?.(alias) ?? false)
        for (const [k, v] of Object.entries(obj)) {
            if (FORBIDDEN_KEYS.has(k)) continue
            const snakeKey = UPPERCASE_RE.test(k)
                ? k.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
                : k
            if (FORBIDDEN_KEYS.has(snakeKey)) continue
            if (snakeKey === 'id' && !('entry_id' in obj) && canAlias('id')) {
                newObj['entry_id'] = deepCamelToSnake(v, depth + 1)
                continue
            }
            if (snakeKey === 'ids' && !('entry_ids' in obj) && canAlias('ids')) {
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

export interface DispatchParamContext {
    sessionContext: ToolContext
    projectId: number | string | undefined
    workspaceId: string | undefined
    explicitWorkspace?: boolean
}

function normalizeFsPath(filePath: string): string {
    const resolved = path.resolve(filePath)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function isDefaultWorkspaceName(value: unknown): boolean {
    return typeof value === 'string' && value.trim().toLowerCase() === 'default'
}

function invalidProjectNumberResult(raw: unknown): { errorResult: Record<string, unknown> } {
    return {
        errorResult: {
            success: false,
            error: `Invalid project_number: '${String(raw)}'. Code Mode failed to resolve this to a known numeric ID. You can pass the exact numeric ID (e.g. 14), the repo name (e.g. 'mysql-mcp'), or simply OMIT the project_number field entirely to let the system auto-inject the current workspace's ID.`,
        },
    }
}

function coerceProjectNumberField(
    obj: Record<string, unknown>,
    registry: NonNullable<ToolContext['config']>['projectRegistry']
): { errorResult: Record<string, unknown> } | undefined {
    if (typeof obj['project_number'] === 'string') {
        const regEntry = lookupRegistryEntry(registry, obj['project_number'])
        if (regEntry?.project_number !== undefined) obj['project_number'] = regEntry.project_number
    }
    if (typeof obj['project_number'] === 'string') {
        const trimmed = obj['project_number'].trim()
        const parsed = trimmed !== '' ? Number(trimmed) : Number.NaN
        if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
            obj['project_number'] = parsed
        } else {
            return invalidProjectNumberResult(obj['project_number'])
        }
    }
    return undefined
}

async function autoPopulateGithubUrls(
    paramsObj: Record<string, unknown>,
    sessionContext: ToolContext,
    sessionWorkspaceId: string | undefined,
    sessionProjectId: number | string | undefined
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
    const targetWs =
        typeof paramsObj['workspace_id'] === 'string' ? paramsObj['workspace_id'].trim() : undefined
    if (targetWs === '*' || isDefaultWorkspaceName(targetWs)) return
    if (
        targetWs !== undefined &&
        sessionWorkspaceId !== undefined &&
        sessionWorkspaceId !== '*' &&
        targetWs.toLowerCase() !== sessionWorkspaceId.toLowerCase()
    ) {
        return
    }
    if (
        typeof paramsObj['project_number'] === 'number' &&
        typeof sessionProjectId === 'number' &&
        paramsObj['project_number'] !== sessionProjectId
    ) {
        return
    }
    const wsForLookup = targetWs ?? sessionWorkspaceId
    if (wsForLookup === '*' || isDefaultWorkspaceName(wsForLookup)) return
    if (wsForLookup !== undefined) {
        const reg = activeProjectRegistry(sessionContext.config?.projectRegistry)
        const wsReg = lookupRegistryEntry(reg, wsForLookup)
        if (
            wsReg?.path !== undefined &&
            wsReg.path !== '' &&
            normalizeFsPath(wsReg.path) !== normalizeFsPath(process.cwd())
        ) {
            return
        }
    }
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

export async function normalizeDispatchParams(
    tool: ToolDefinition,
    toolParams: unknown,
    ctx: DispatchParamContext
): Promise<{ params: unknown } | { errorResult: Record<string, unknown> }> {
    const { sessionContext, projectId, workspaceId, explicitWorkspace } = ctx
    const finalParams = deepCamelToSnake(toolParams, 0, (key) => checkSchemaAcceptsKey(tool.inputSchema, key))
    if (!isRecord(finalParams)) return { params: finalParams }

    const reg = activeProjectRegistry(sessionContext.config?.projectRegistry)
    const paramsObj = { ...finalParams }
    const aliasDerivedWs = paramsObj['_alias_derived_workspace'] === true
    delete paramsObj['_alias_derived_workspace']

    if (paramsObj['workspace'] !== undefined && paramsObj['workspace_id'] === undefined) {
        paramsObj['workspace_id'] = paramsObj['workspace']
    }
    if (typeof paramsObj['workspace_id'] === 'number') {
        paramsObj['workspace_id'] = String(paramsObj['workspace_id'])
    } else if (typeof paramsObj['workspace_id'] === 'string') {
        const trimmedWs = paramsObj['workspace_id'].trim()
        if (trimmedWs === '') {
            delete paramsObj['workspace_id']
        } else {
            paramsObj['workspace_id'] = trimmedWs
        }
    }

    const callerHasExplicitWs = paramsObj['workspace_id'] !== undefined && !aliasDerivedWs
    // When the caller named a project (or resolved workspace via project alias) inside an
    // explicitly pinned session, validate/override against the session workspace instead of escaping.
    const callerPassedProjectOnly = paramsObj['project_number'] !== undefined && !callerHasExplicitWs

    const topProjError = coerceProjectNumberField(paramsObj, reg)
    if (topProjError !== undefined) return topProjError

    if (
        aliasDerivedWs &&
        explicitWorkspace === true &&
        typeof workspaceId === 'string' &&
        workspaceId !== '*' &&
        typeof paramsObj['workspace_id'] === 'string' &&
        paramsObj['workspace_id'].toLowerCase() !== workspaceId.toLowerCase()
    ) {
        throw new ValidationError(
            `Project alias resolved workspace '${paramsObj['workspace_id']}' does not match session workspace '${workspaceId}'.`
        )
    }

    if (
        !callerHasExplicitWs &&
        callerPassedProjectOnly &&
        explicitWorkspace === true &&
        workspaceId !== undefined &&
        workspaceId !== '*'
    ) {
        const supplied = typeof paramsObj['project_number'] === 'number' ? paramsObj['project_number'] : undefined
        if (supplied !== undefined) {
            pairStoredScope(workspaceId, supplied, reg)
        }
        if (checkSchemaAcceptsKey(tool.inputSchema, 'workspace_id')) {
            paramsObj['workspace_id'] = workspaceId
        }
    }
    if (
        typeof paramsObj['workspace_id'] === 'string' &&
        paramsObj['workspace_id'] !== '*' &&
        checkSchemaAcceptsKey(tool.inputSchema, 'project_number')
    ) {
        const wsReg = lookupRegistryEntry(reg, paramsObj['workspace_id'])
        const supplied = typeof paramsObj['project_number'] === 'number' ? paramsObj['project_number'] : undefined
        if (supplied !== undefined) {
            pairStoredScope(paramsObj['workspace_id'], supplied, reg)
        } else if (!isDefaultWorkspaceName(paramsObj['workspace_id']) && wsReg?.project_number !== undefined) {
            paramsObj['project_number'] = wsReg.project_number
        }
    }

    const callerWorkspaceId =
        typeof paramsObj['workspace_id'] === 'string' ? paramsObj['workspace_id'] : undefined
    const callerTargetWs =
        typeof paramsObj['target_workspace_id'] === 'string' && paramsObj['target_workspace_id'].trim() !== ''
            ? paramsObj['target_workspace_id'].trim()
            : undefined
    const hasCrossWorkspaceTarget = callerTargetWs !== undefined && callerTargetWs !== workspaceId
    const batchArrayKey =
        (tool.name === 'batch_create_entries' || tool.name === 'team_batch_create_entries') &&
        Array.isArray(paramsObj['entries'])
            ? 'entries'
            : (tool.name === 'batch_update_entries' || tool.name === 'team_batch_update_entries') &&
                Array.isArray(paramsObj['updates'])
              ? 'updates'
              : undefined
    const isBatchScopedTool = batchArrayKey !== undefined

    // [INVARIANT] Explicit `workspace_id: 'default'` never inherits the session projectId.
    // Batch tools inherit per-item scope below so root defaults never clobber project-only items.
    if (
        !isBatchScopedTool &&
        !hasCrossWorkspaceTarget &&
        paramsObj['project_number'] === undefined &&
        projectId !== undefined &&
        (callerWorkspaceId === undefined ||
            (typeof workspaceId === 'string' &&
                callerWorkspaceId.toLowerCase() === workspaceId.toLowerCase())) &&
        !isDefaultWorkspaceName(callerWorkspaceId) &&
        checkSchemaAcceptsKey(tool.inputSchema, 'project_number')
    ) {
        paramsObj['project_number'] = projectId
    }
    // [H2] Wildcard `'*'` only propagates automatically to read-only tools.
    const canInheritSessionWorkspace = workspaceId !== '*' || tool.annotations?.readOnlyHint === true
    if (
        !isBatchScopedTool &&
        !callerPassedProjectOnly &&
        paramsObj['workspace_id'] === undefined &&
        workspaceId !== undefined &&
        canInheritSessionWorkspace &&
        (!isDefaultWorkspaceName(workspaceId) || explicitWorkspace === true) &&
        checkSchemaAcceptsKey(tool.inputSchema, 'workspace_id')
    ) {
        paramsObj['workspace_id'] = workspaceId
    }

    if (batchArrayKey !== undefined) {
        const nextItems: unknown[] = []
        for (const item of paramsObj[batchArrayKey] as unknown[]) {
            if (!isRecord(item)) {
                nextItems.push(item)
                continue
            }
            const nextItem = { ...item }
            const itemAliasDerivedWs = nextItem['_alias_derived_workspace'] === true
            delete nextItem['_alias_derived_workspace']

            const itemProjErr = coerceProjectNumberField(nextItem, reg)
            if (itemProjErr !== undefined) return itemProjErr

            const rawItemWs =
                typeof nextItem['workspace_id'] === 'string' && nextItem['workspace_id'].trim() !== ''
                    ? nextItem['workspace_id'].trim()
                    : undefined
            const itemProjNum =
                typeof nextItem['project_number'] === 'number' && Number.isFinite(nextItem['project_number'])
                    ? nextItem['project_number']
                    : undefined
            if (
                itemAliasDerivedWs &&
                explicitWorkspace === true &&
                typeof workspaceId === 'string' &&
                workspaceId !== '*'
            ) {
                if (rawItemWs !== undefined && rawItemWs.toLowerCase() !== workspaceId.toLowerCase()) {
                    throw new ValidationError(
                        `Project alias resolved workspace '${rawItemWs}' does not match session workspace '${workspaceId}'.`
                    )
                }
                if (itemProjNum !== undefined) {
                    pairStoredScope(workspaceId, itemProjNum, reg)
                }
                nextItem['workspace_id'] = workspaceId
            }

            const callerItemWs =
                typeof nextItem['workspace_id'] === 'string' && nextItem['workspace_id'].trim() !== ''
                    ? nextItem['workspace_id'].trim()
                    : undefined
            const hasItemWs = callerItemWs !== undefined && !itemAliasDerivedWs
            const hasItemProj = nextItem['project_number'] !== undefined
            const itemTargetWs =
                typeof nextItem['target_workspace_id'] === 'string' && nextItem['target_workspace_id'].trim() !== ''
                    ? nextItem['target_workspace_id'].trim()
                    : undefined
            const itemCrossWsMove =
                itemTargetWs !== undefined &&
                (typeof workspaceId !== 'string' || itemTargetWs.toLowerCase() !== workspaceId.toLowerCase())

            if (itemTargetWs !== undefined && itemProjNum !== undefined) {
                pairStoredScope(itemTargetWs, itemProjNum, reg)
            } else if (hasItemWs && callerItemWs !== '*' && !itemCrossWsMove) {
                const wsReg = lookupRegistryEntry(reg, callerItemWs)
                if (itemProjNum !== undefined) {
                    pairStoredScope(callerItemWs, itemProjNum, reg)
                } else if (
                    batchArrayKey === 'entries' &&
                    !isDefaultWorkspaceName(callerItemWs) &&
                    wsReg?.project_number !== undefined &&
                    nextItem['project_number'] === undefined
                ) {
                    nextItem['project_number'] = wsReg.project_number
                }
            }

            if (
                explicitWorkspace === true &&
                !hasItemWs &&
                itemProjNum !== undefined &&
                typeof workspaceId === 'string' &&
                workspaceId !== '*'
            ) {
                pairStoredScope(workspaceId, itemProjNum, reg)
                nextItem['workspace_id'] = workspaceId
            }
            if (
                !hasItemWs &&
                !hasItemProj &&
                workspaceId !== undefined &&
                workspaceId !== '*' &&
                (!isDefaultWorkspaceName(workspaceId) || explicitWorkspace === true)
            ) {
                nextItem['workspace_id'] = workspaceId
            }
            if (
                !itemCrossWsMove &&
                nextItem['project_number'] === undefined &&
                typeof projectId === 'number' &&
                !isDefaultWorkspaceName(callerItemWs) &&
                (callerItemWs === undefined ||
                    (typeof workspaceId === 'string' &&
                        callerItemWs.toLowerCase() === workspaceId.toLowerCase()))
            ) {
                nextItem['project_number'] = projectId
            }
            nextItems.push(nextItem)
        }
        paramsObj[batchArrayKey] = nextItems
    }

    await autoPopulateGithubUrls(paramsObj, sessionContext, workspaceId, projectId)

    return { params: paramsObj }
}
