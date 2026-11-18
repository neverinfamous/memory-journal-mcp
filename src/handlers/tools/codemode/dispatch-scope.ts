/**
 * Pre-dispatch parameter scope resolution, alias coercion, and GitHub URL auto-enrichment for Code Mode.
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { ValidationError } from '../../../types/errors.js'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { activeProjectRegistry, pairStoredScope } from '../../../utils/write-scope.js'
import { parseCanonicalPositiveInt } from '../../../utils/safe-positive-int.js'
import { lookupRegistryEntry } from './session-context.js'
import { normalizeBatchDispatchItems } from './dispatch-batch-scope.js'
import { checkSchemaAcceptsKey } from './dispatch-schema-introspection.js'
import { autoPopulateGithubUrls } from './dispatch-github-urls.js'

export { checkSchemaAcceptsKey }

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const CANONICAL_SNAKE_SCOPE_KEYS = new Set([
    'workspaceId',
    'projectNumber',
    'projectId',
    'targetWorkspaceId',
    'repoName',
    'entryId',
    'entryIds',
    'fromEntryId',
    'toEntryId',
])

const UPPERCASE_RE = /[A-Z]/
const OPAQUE_VALUE_KEYS = new Set(['context', 'prompt', 'auto_context', 'autoContext'])

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
            if (OPAQUE_VALUE_KEYS.has(k)) {
                const opaqueKey = UPPERCASE_RE.test(k)
                    ? k.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
                    : k
                const shouldWrite =
                    k === opaqueKey
                        ? v !== undefined || !Object.hasOwn(newObj, opaqueKey)
                        : !Object.hasOwn(obj, opaqueKey) || obj[opaqueKey] === undefined
                if (!FORBIDDEN_KEYS.has(opaqueKey) && shouldWrite) {
                    newObj[opaqueKey] = v
                }
                continue
            }
            if (depth === 0 && !CANONICAL_SNAKE_SCOPE_KEYS.has(k) && (acceptsKey?.(k) ?? false)) {
                newObj[k] = deepCamelToSnake(v, depth + 1)
                continue
            }
            const snakeKey = UPPERCASE_RE.test(k)
                ? k.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
                : k
            if (FORBIDDEN_KEYS.has(snakeKey)) continue
            if (snakeKey === 'id' && !('entry_id' in obj) && !('entryId' in obj) && canAlias('id')) {
                newObj['entry_id'] = deepCamelToSnake(v, depth + 1)
                continue
            }
            if (snakeKey === 'ids' && !('entry_ids' in obj) && !('entryIds' in obj) && canAlias('ids')) {
                const vSnake = deepCamelToSnake(v, depth + 1)
                newObj['entry_ids'] = Array.isArray(vSnake) ? vSnake : [vSnake]
                continue
            }
            if (k !== snakeKey && Object.hasOwn(obj, snakeKey) && obj[snakeKey] !== undefined) {
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
    sessionId?: string | undefined
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
    registry: NonNullable<ToolContext['config']>['projectRegistry'],
    requirePositiveInt = false
): { errorResult: Record<string, unknown> } | undefined {
    const rawVal = obj['project_number']
    if (rawVal === undefined || rawVal === null) return undefined
    if (typeof rawVal === 'string') {
        const regEntry = lookupRegistryEntry(registry, rawVal)
        if (regEntry?.project_number !== undefined) {
            obj['project_number'] = regEntry.project_number
        } else {
            const trimmed = rawVal.trim()
            const parsed = parseCanonicalPositiveInt(trimmed)
            if (parsed !== undefined && (!requirePositiveInt || parsed > 0)) {
                obj['project_number'] = parsed
            } else if (!requirePositiveInt && trimmed === '0') {
                obj['project_number'] = 0
            } else {
                return invalidProjectNumberResult(rawVal)
            }
        }
    }
    const val = obj['project_number']
    if (typeof val !== 'number' || !Number.isFinite(val)) {
        return invalidProjectNumberResult(val)
    }
    if (val !== 0 && !Number.isSafeInteger(val)) {
        return invalidProjectNumberResult(val)
    }
    if (requirePositiveInt && (!Number.isInteger(val) || val <= 0)) {
        return invalidProjectNumberResult(val)
    }
    return undefined
}

function normalizeWorkspaceStringField(paramsObj: Record<string, unknown>): void {
    if (paramsObj['workspaceId'] !== undefined) {
        if (paramsObj['workspace_id'] === undefined) {
            paramsObj['workspace_id'] = paramsObj['workspaceId']
        }
        delete paramsObj['workspaceId']
    }
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
}

interface RootScopeFlags {
    callerPassedProjectOnly: boolean
    hasCrossWorkspaceTarget: boolean
}

const SESSION_INHERITANCE_EXCLUDED_TOOLS = new Set([
    'get_project',
    'register_project',
    'update_project',
    'delete_project',
    'list_projects',
    'update_configuration',
])

function applyTargetWorkspaceScope(
    tool: ToolDefinition,
    paramsObj: Record<string, unknown>,
    reg: NonNullable<ToolContext['config']>['projectRegistry'],
    workspaceId: string | undefined,
    supplied: number | undefined
): { hasCrossWorkspaceTarget: boolean } | { errorResult: Record<string, unknown> } {
    const callerTargetWs =
        typeof paramsObj['target_workspace_id'] === 'string' && paramsObj['target_workspace_id'].trim() !== ''
            ? paramsObj['target_workspace_id'].trim()
            : undefined
    if (callerTargetWs === '*') {
        return {
            errorResult: {
                success: false,
                error: "target_workspace_id cannot be '*'. Provide a concrete destination workspace.",
                code: 'VALIDATION_ERROR',
                category: 'validation',
                recoverable: true,
            },
        }
    }
    const hasCrossWorkspaceTarget =
        callerTargetWs !== undefined &&
        (typeof workspaceId !== 'string' || callerTargetWs.toLowerCase() !== workspaceId.toLowerCase())

    if (callerTargetWs !== undefined) {
        if (supplied !== undefined) {
            pairStoredScope(callerTargetWs, supplied, reg)
        } else if (
            !isDefaultWorkspaceName(callerTargetWs) &&
            checkSchemaAcceptsKey(tool.inputSchema, 'project_number')
        ) {
            const targetReg = lookupRegistryEntry(reg, callerTargetWs)
            if (targetReg?.project_number !== undefined) {
                paramsObj['project_number'] = targetReg.project_number
            }
        }
    }
    return { hasCrossWorkspaceTarget }
}

function resolveRootScopePairing(
    tool: ToolDefinition,
    paramsObj: Record<string, unknown>,
    reg: NonNullable<ToolContext['config']>['projectRegistry'],
    ctx: DispatchParamContext,
    aliasDerivedWs: boolean
): RootScopeFlags {
    const { workspaceId, explicitWorkspace } = ctx
    const callerHasExplicitWs = paramsObj['workspace_id'] !== undefined && !aliasDerivedWs
    const callerPassedProjectOnly = paramsObj['project_number'] !== undefined && !callerHasExplicitWs

    if (
        SESSION_INHERITANCE_EXCLUDED_TOOLS.has(tool.name) &&
        (!callerHasExplicitWs || paramsObj['project_number'] === undefined)
    ) {
        return { callerPassedProjectOnly: false, hasCrossWorkspaceTarget: false }
    }

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

    const supplied = typeof paramsObj['project_number'] === 'number' ? paramsObj['project_number'] : undefined
    const targetScopeRes = applyTargetWorkspaceScope(tool, paramsObj, reg, workspaceId, supplied)
    if ('errorResult' in targetScopeRes) {
        const rawErr = targetScopeRes.errorResult['error']
        throw new ValidationError(
            typeof rawErr === 'string' && rawErr.length > 0 ? rawErr : 'Invalid target_workspace_id'
        )
    }
    const { hasCrossWorkspaceTarget } = targetScopeRes

    if (
        !callerHasExplicitWs &&
        callerPassedProjectOnly &&
        explicitWorkspace === true &&
        workspaceId !== undefined &&
        workspaceId !== '*'
    ) {
        if (!hasCrossWorkspaceTarget && supplied !== undefined) pairStoredScope(workspaceId, supplied, reg)
        if (checkSchemaAcceptsKey(tool.inputSchema, 'workspace_id')) paramsObj['workspace_id'] = workspaceId
    }

    if (
        !hasCrossWorkspaceTarget &&
        typeof paramsObj['workspace_id'] === 'string' &&
        paramsObj['workspace_id'] !== '*' &&
        checkSchemaAcceptsKey(tool.inputSchema, 'project_number')
    ) {
        const wsReg = lookupRegistryEntry(reg, paramsObj['workspace_id'])
        if (supplied !== undefined) {
            pairStoredScope(paramsObj['workspace_id'], supplied, reg)
        } else if (!isDefaultWorkspaceName(paramsObj['workspace_id']) && wsReg?.project_number !== undefined) {
            paramsObj['project_number'] = wsReg.project_number
        }
    }

    return { callerPassedProjectOnly, hasCrossWorkspaceTarget }
}

function applyRootSessionInheritance(
    tool: ToolDefinition,
    paramsObj: Record<string, unknown>,
    ctx: DispatchParamContext,
    flags: RootScopeFlags,
    reg: NonNullable<ToolContext['config']>['projectRegistry']
): void {
    if (SESSION_INHERITANCE_EXCLUDED_TOOLS.has(tool.name)) return
    const { projectId, workspaceId, explicitWorkspace } = ctx
    const callerWorkspaceId =
        typeof paramsObj['workspace_id'] === 'string' ? paramsObj['workspace_id'] : undefined
    const callerRepoHint =
        typeof paramsObj['repo'] === 'string' && paramsObj['repo'].trim() !== ''
            ? paramsObj['repo'].trim()
            : typeof paramsObj['repo_name'] === 'string' && paramsObj['repo_name'].trim() !== ''
              ? paramsObj['repo_name'].trim()
              : undefined
    const repoReg = callerRepoHint !== undefined ? lookupRegistryEntry(reg, callerRepoHint) : undefined
    const repoTargetsForeignProject =
        callerRepoHint !== undefined &&
        ((repoReg?.project_number !== undefined &&
            typeof projectId === 'number' &&
            repoReg.project_number !== projectId) ||
            (typeof workspaceId === 'string' &&
                workspaceId !== '*' &&
                callerRepoHint.split(/[/\\]/).filter(Boolean).pop()?.toLowerCase() !==
                    workspaceId.toLowerCase()))
    if (
        repoTargetsForeignProject &&
        paramsObj['project_number'] === undefined &&
        repoReg?.project_number !== undefined &&
        checkSchemaAcceptsKey(tool.inputSchema, 'project_number')
    ) {
        paramsObj['project_number'] = repoReg.project_number
    }

    // [INVARIANT] Explicit `workspace_id: 'default'` inherits session projectId only when the session itself is explicit `'default'`.
    if (
        !flags.hasCrossWorkspaceTarget &&
        !repoTargetsForeignProject &&
        paramsObj['project_number'] === undefined &&
        projectId !== undefined &&
        (callerWorkspaceId === undefined ||
            (typeof workspaceId === 'string' &&
                callerWorkspaceId.toLowerCase() === workspaceId.toLowerCase())) &&
        (!isDefaultWorkspaceName(callerWorkspaceId) ||
            (isDefaultWorkspaceName(workspaceId) && explicitWorkspace === true)) &&
        checkSchemaAcceptsKey(tool.inputSchema, 'project_number')
    ) {
        paramsObj['project_number'] = projectId
    }
    // [H2] Wildcard `'*'` only propagates automatically to read-only tools.
    const canInheritSessionWorkspace = workspaceId !== '*' || tool.annotations?.readOnlyHint === true
    if (
        !flags.callerPassedProjectOnly &&
        !repoTargetsForeignProject &&
        paramsObj['workspace_id'] === undefined &&
        workspaceId !== undefined &&
        canInheritSessionWorkspace &&
        (!isDefaultWorkspaceName(workspaceId) || explicitWorkspace === true) &&
        checkSchemaAcceptsKey(tool.inputSchema, 'workspace_id')
    ) {
        paramsObj['workspace_id'] = workspaceId
    }
    if (
        ctx.sessionId !== undefined &&
        ctx.sessionId !== '' &&
        paramsObj['session_id'] === undefined &&
        checkSchemaAcceptsKey(tool.inputSchema, 'session_id')
    ) {
        paramsObj['session_id'] = ctx.sessionId
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

    normalizeWorkspaceStringField(paramsObj)
    const requirePositiveInt = tool.annotations?.readOnlyHint !== true
    const topProjError = coerceProjectNumberField(paramsObj, reg, requirePositiveInt)
    if (topProjError !== undefined) return topProjError
    if (typeof paramsObj['target_workspace_id'] === 'string' && paramsObj['target_workspace_id'].trim() === '*') {
        return {
            errorResult: {
                success: false,
                error: "target_workspace_id cannot be '*'. Provide a concrete destination workspace.",
                code: 'VALIDATION_ERROR',
                category: 'validation',
                recoverable: true,
            },
        }
    }

    const flags = resolveRootScopePairing(tool, paramsObj, reg, ctx, aliasDerivedWs)
    const batchArrayKey =
        (tool.name === 'batch_create_entries' || tool.name === 'team_batch_create_entries') &&
        Array.isArray(paramsObj['entries'])
            ? 'entries'
            : (tool.name === 'batch_update_entries' || tool.name === 'team_batch_update_entries') &&
                Array.isArray(paramsObj['updates'])
              ? 'updates'
              : undefined

    if (batchArrayKey !== undefined) {
        if (
            (tool.name === 'batch_update_entries' || tool.name === 'team_batch_update_entries') &&
            paramsObj['workspace_id'] === '*' &&
            paramsObj['project_number'] === undefined &&
            typeof projectId === 'number' &&
            explicitWorkspace !== false
        ) {
            // Only stamp session projectId onto wildcard batch updates when the caller did not
            // explicitly pass `workspace_id: '*'` on the batch_update_entries call itself
            // (i.e., when `workspaceId === '*'` came from the outer session).
            if (workspaceId === '*') {
                paramsObj['project_number'] = projectId
            }
        }
        const batchError = normalizeBatchDispatchItems(batchArrayKey, paramsObj, reg, {
            projectId,
            workspaceId,
            explicitWorkspace,
            isDefaultWorkspaceName,
            coerceProjectNumberField,
        })
        if (batchError !== undefined) return batchError
    } else {
        applyRootSessionInheritance(tool, paramsObj, ctx, flags, reg)
    }

    if (
        checkSchemaAcceptsKey(tool.inputSchema, 'issue_url') ||
        checkSchemaAcceptsKey(tool.inputSchema, 'pr_url')
    ) {
        await autoPopulateGithubUrls(paramsObj, sessionContext, workspaceId, projectId)
    }
    return { params: paramsObj }
}
