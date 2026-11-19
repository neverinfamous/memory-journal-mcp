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
import { deepCamelToSnake } from './dispatch-key-normalizer.js'

export { checkSchemaAcceptsKey, deepCamelToSnake }

export interface DispatchParamContext {
    sessionContext: ToolContext
    projectId: number | string | undefined
    workspaceId: string | undefined
    explicitWorkspace?: boolean
    sessionId?: string | undefined
    rpcPinnedProject?: boolean | undefined
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
    supplied: number | undefined,
    sessionProjectId: number | string | undefined
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
        const isWildcardMoveSource = paramsObj['workspace_id'] === '*' || workspaceId === '*'
        if (supplied !== undefined) {
            pairStoredScope(callerTargetWs, supplied, reg)
        } else if (
            !isWildcardMoveSource &&
            typeof sessionProjectId !== 'number' &&
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
    const { workspaceId, explicitWorkspace, projectId } = ctx
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
    const targetScopeRes = applyTargetWorkspaceScope(tool, paramsObj, reg, workspaceId, supplied, projectId)
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
    // Explicit `workspace_id: '*'` inherits session projectId only when a nested executeCode pinned `project_number` (`rpcPinnedProject === true`).
    const canInheritProjectOnCallerWs =
        callerWorkspaceId === undefined ||
        (callerWorkspaceId === '*'
            ? ctx.rpcPinnedProject === true
            : typeof workspaceId === 'string' &&
              callerWorkspaceId.toLowerCase() === workspaceId.toLowerCase())
    if (
        !flags.hasCrossWorkspaceTarget &&
        !repoTargetsForeignProject &&
        paramsObj['project_number'] === undefined &&
        projectId !== undefined &&
        canInheritProjectOnCallerWs &&
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

function verifyWildcardUpdateSourceProject(
    tool: ToolDefinition,
    paramsObj: Record<string, unknown>,
    flags: RootScopeFlags,
    sessionContext: ToolContext,
    workspaceId: string | undefined,
    projectId: number | string | undefined
): Record<string, unknown> | undefined {
    if (
        tool.name !== 'update_entry' ||
        !flags.hasCrossWorkspaceTarget ||
        typeof projectId !== 'number' ||
        (paramsObj['workspace_id'] !== '*' &&
            !(paramsObj['workspace_id'] === undefined && workspaceId === '*'))
    ) {
        return undefined
    }
    const rawEntryId = paramsObj['entry_id']
    if (typeof rawEntryId !== 'number' || typeof sessionContext.db?.getEntryById !== 'function') {
        return undefined
    }
    const sourceEntry = sessionContext.db.getEntryById(rawEntryId, '*')
    if (sourceEntry !== null && sourceEntry !== undefined && sourceEntry.projectNumber !== projectId) {
        return {
            success: false,
            error: `Entry ${String(rawEntryId)} not found`,
            code: 'RESOURCE_NOT_FOUND',
            category: 'resource',
            suggestion: 'Verify the entry ID and project number, and try again',
            recoverable: true,
        }
    }
    return undefined
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
    const sourceErr = verifyWildcardUpdateSourceProject(tool, paramsObj, flags, sessionContext, workspaceId, projectId)
    if (sourceErr !== undefined) return { errorResult: sourceErr }

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
            (paramsObj['workspace_id'] === '*' || paramsObj['workspace_id'] === undefined) &&
            paramsObj['project_number'] === undefined &&
            typeof projectId === 'number' &&
            workspaceId === '*'
        ) {
            paramsObj['project_number'] = projectId
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
