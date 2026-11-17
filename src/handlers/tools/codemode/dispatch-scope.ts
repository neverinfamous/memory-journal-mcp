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
import { normalizeBatchDispatchItems } from './dispatch-batch-scope.js'
import { checkSchemaAcceptsKey } from './dispatch-schema-introspection.js'

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

function isSameOrSubdirectory(targetDir: string, rootDir: string): boolean {
    const rel = path.relative(normalizeFsPath(rootDir), normalizeFsPath(targetDir))
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

function isPathOutsideCwd(
    reg: NonNullable<ToolContext['config']>['projectRegistry'],
    key: string
): boolean {
    const entry = lookupRegistryEntry(reg, key)
    return entry?.path !== undefined && entry.path !== '' && !isSameOrSubdirectory(process.cwd(), entry.path)
}

function resolveGithubUrlScope(
    paramsObj: Record<string, unknown>,
    sessionContext: ToolContext,
    sessionWorkspaceId: string | undefined,
    sessionProjectId: number | string | undefined
): { allowed: boolean; repoHint: string | undefined } {
    const targetWs = typeof paramsObj['workspace_id'] === 'string' ? paramsObj['workspace_id'].trim() : undefined
    if (targetWs === '*' || isDefaultWorkspaceName(targetWs)) return { allowed: false, repoHint: undefined }
    if (
        targetWs !== undefined &&
        sessionWorkspaceId !== undefined &&
        sessionWorkspaceId !== '*' &&
        targetWs.toLowerCase() !== sessionWorkspaceId.toLowerCase()
    ) {
        return { allowed: false, repoHint: undefined }
    }
    if (
        typeof paramsObj['project_number'] === 'number' &&
        typeof sessionProjectId === 'number' &&
        paramsObj['project_number'] !== sessionProjectId
    ) {
        return { allowed: false, repoHint: undefined }
    }
    const wsForLookup = targetWs ?? sessionWorkspaceId
    if (wsForLookup === '*' || isDefaultWorkspaceName(wsForLookup)) return { allowed: false, repoHint: undefined }
    const reg = activeProjectRegistry(sessionContext.config?.projectRegistry)
    if (wsForLookup !== undefined && isPathOutsideCwd(reg, wsForLookup)) return { allowed: false, repoHint: undefined }
    const repoHint =
        typeof paramsObj['repo'] === 'string' && paramsObj['repo'].trim() !== '' ? paramsObj['repo'].trim() : undefined
    if (repoHint !== undefined) {
        const repoSlug = repoHint.split(/[/\\]/).filter(Boolean).pop()?.trim() ?? repoHint
        const repoReg = lookupRegistryEntry(reg, repoHint) ?? lookupRegistryEntry(reg, repoSlug)
        if (repoReg?.path !== undefined && repoReg.path !== '' && !isSameOrSubdirectory(process.cwd(), repoReg.path)) {
            return { allowed: false, repoHint: undefined }
        }
    }
    return { allowed: true, repoHint }
}

async function autoPopulateGithubUrls(
    paramsObj: Record<string, unknown>,
    sessionContext: ToolContext,
    sessionWorkspaceId: string | undefined,
    sessionProjectId: number | string | undefined
): Promise<void> {
    const needsIssueUrl = paramsObj['issue_number'] !== undefined && paramsObj['issue_url'] === undefined
    const needsPrUrl = paramsObj['pr_number'] !== undefined && paramsObj['pr_url'] === undefined
    if ((!needsIssueUrl && !needsPrUrl) || sessionContext.github === undefined) return
    const scope = resolveGithubUrlScope(paramsObj, sessionContext, sessionWorkspaceId, sessionProjectId)
    if (!scope.allowed) return
    try {
        const repoInfo = await sessionContext.github.getRepoInfo()
        if (!repoInfo?.owner || !repoInfo?.repo) return
        if (scope.repoHint !== undefined) {
            const lowerHint = scope.repoHint.toLowerCase()
            const matchesRepo =
                lowerHint === repoInfo.repo.toLowerCase() ||
                lowerHint === `${repoInfo.owner}/${repoInfo.repo}`.toLowerCase()
            if (!matchesRepo) return
        }
        if (needsIssueUrl) {
            paramsObj['issue_url'] = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/issues/${String(Number(paramsObj['issue_number']))}`
        }
        if (needsPrUrl) {
            paramsObj['pr_url'] = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/pull/${String(Number(paramsObj['pr_number']))}`
        }
    } catch (err) {
        logger.debug('Could not auto-populate GitHub URLs; proceeding without them', {
            module: 'CodeMode',
            error: err instanceof Error ? err.message : String(err),
        })
    }
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
): boolean {
    const callerTargetWs =
        typeof paramsObj['target_workspace_id'] === 'string' && paramsObj['target_workspace_id'].trim() !== ''
            ? paramsObj['target_workspace_id'].trim()
            : undefined
    const hasCrossWorkspaceTarget =
        callerTargetWs !== undefined &&
        (typeof workspaceId !== 'string' || callerTargetWs.toLowerCase() !== workspaceId.toLowerCase())

    if (callerTargetWs !== undefined && callerTargetWs !== '*') {
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
    return hasCrossWorkspaceTarget
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
    const hasCrossWorkspaceTarget = applyTargetWorkspaceScope(tool, paramsObj, reg, workspaceId, supplied)

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
    const topProjError = coerceProjectNumberField(paramsObj, reg)
    if (topProjError !== undefined) return topProjError

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

    await autoPopulateGithubUrls(paramsObj, sessionContext, workspaceId, projectId)
    return { params: paramsObj }
}
