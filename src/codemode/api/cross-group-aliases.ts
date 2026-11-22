/**
 * Cross-group alias wiring and entry-creation scope enrichment helpers for JournalApi.
 */

import type { ProjectRegistryEntry, ToolDefinition } from '../../types/index.js'
import { ValidationError } from '../../types/errors.js'
import {
    findCanonicalRegistryKey,
    resolveProjectContext,
} from '../../utils/workspace-resolver.js'
import {
    activeProjectRegistry,
    pairStoredScope,
} from '../../utils/write-scope.js'
import { isRecord } from '../normalizers/shared-utils.js'
import { readProjectRegistryPayload } from '../normalizers/generic-field-aliases.js'
import type { GroupApiRecord, ProjectRegistryProvider } from './types.js'

export interface CrossGroupAliasesContext {
    core: GroupApiRecord
    search: GroupApiRecord
    analytics: GroupApiRecord
    relationships: GroupApiRecord
    io: GroupApiRecord
    admin: GroupApiRecord
    backup: GroupApiRecord
    team: GroupApiRecord
    git: GroupApiRecord
    registryProvider?: ProjectRegistryProvider
    copyFnSchema(source: (...args: unknown[]) => Promise<unknown>, wrapper: (...args: unknown[]) => Promise<unknown>): void
    getToolDefinition?(methodName: string): ToolDefinition | undefined
}

function parseEntryProjectNumber(
    rec: Record<string, unknown>,
    registry?: Record<string, ProjectRegistryEntry>
): number | undefined {
    if (typeof rec['project_number'] === 'string') {
        const cleaned = rec['project_number'].trim()
        const pMatch = /^p-?([1-9]\d*)$/i.exec(cleaned)
        const candidate = pMatch?.[1] ?? cleaned
        const parsed = /^[1-9]\d*$/.test(candidate) ? Number(candidate) : Number.NaN
        if (Number.isSafeInteger(parsed) && parsed > 0 && String(parsed) === candidate) {
            rec['project_number'] = parsed
        } else {
            const regKey = findCanonicalRegistryKey(cleaned, registry)
            const regProj = regKey !== undefined ? registry?.[regKey]?.project_number : undefined
            if (typeof regProj !== 'number' || !Number.isSafeInteger(regProj) || regProj <= 0) {
                throw new ValidationError(
                    `Invalid project_number '${rec['project_number']}'. Expected a positive integer.`
                )
            }
            rec['project_number'] = regProj
        }
    }
    if (typeof rec['project_number'] === 'number') return rec['project_number']
    return typeof rec['projectNumber'] === 'number' ? rec['projectNumber'] : undefined
}

export function enrichEntryRecord(
    rec: Record<string, unknown>,
    registryProvider?: ProjectRegistryProvider,
    fallbackWs?: unknown,
    fallbackProj?: unknown,
    preloadedRegistry?: Record<string, ProjectRegistryEntry> | null
): void {
    const itemWs = rec['workspace_id'] ?? rec['workspaceId']
    const itemWsNorm = typeof itemWs === 'string' ? itemWs.trim().toLowerCase() : ''
    const fallbackWsNorm = typeof fallbackWs === 'string' ? fallbackWs.trim().toLowerCase() : ''
    const itemNamesOtherWs =
        itemWsNorm !== '' &&
        (itemWsNorm === 'default' ? fallbackWsNorm !== 'default' : itemWsNorm !== fallbackWsNorm)
    if (itemWs === undefined && fallbackWs !== undefined) {
        rec['workspace_id'] = fallbackWs
    }
    // [INVARIANT] Never propagate the batch root project_number onto an item that names another workspace.
    if (
        rec['project_number'] === undefined &&
        rec['projectNumber'] === undefined &&
        fallbackProj !== undefined &&
        !itemNamesOtherWs
    ) {
        rec['project_number'] = fallbackProj
    }
    const currentWsRaw = rec['workspace_id'] ?? rec['workspaceId']
    const hasExplicitWs =
        typeof currentWsRaw === 'string' && currentWsRaw.trim() !== '' && currentWsRaw.trim() !== '*'
    const needsRegistry = typeof rec['project_number'] === 'string' || hasExplicitWs
    const providerRegistry = !needsRegistry
        ? undefined
        : preloadedRegistry !== undefined
          ? (preloadedRegistry ?? undefined)
          : readProjectRegistryPayload(registryProvider?.())
    const activeReg = activeProjectRegistry(providerRegistry)
    const projNum = parseEntryProjectNumber(rec, activeReg)
    // [INVARIANT] No content/tag/CWD guessing: defer project-only workspace resolution
    // to `secure-dispatcher` so session scope pair-checking runs first.
    if (!hasExplicitWs) return

    const trimmedWs = currentWsRaw.trim()
    const resolved = resolveProjectContext(
        {
            workspace_id: trimmedWs,
            ...(projNum !== undefined ? { project_number: projNum } : {}),
        },
        providerRegistry !== undefined ? { projectRegistry: providerRegistry } : undefined
    )
    if (projNum !== undefined) {
        pairStoredScope(trimmedWs, projNum, activeReg)
    } else if (
        trimmedWs.toLowerCase() !== 'default' &&
        rec['project_number'] === undefined &&
        rec['projectNumber'] === undefined &&
        resolved.projectNumber !== undefined
    ) {
        rec['project_number'] = resolved.projectNumber
    }
}

function wrapEntryCreatorFn(
    origFn: (...args: unknown[]) => Promise<unknown>,
    ctx: CrossGroupAliasesContext
): (...args: unknown[]) => Promise<unknown> {
    const wrapper = async (...args: unknown[]): Promise<unknown> => {
        const params = args[0]
        if (isRecord(params)) {
            const hasBatch = Array.isArray(params['entries'])
            const preloadedRegistry = hasBatch
                ? (readProjectRegistryPayload(ctx.registryProvider?.()) ?? null)
                : undefined
            enrichEntryRecord(params, ctx.registryProvider, undefined, undefined, preloadedRegistry)
            if (hasBatch) {
                const topWs = params['workspace_id'] ?? params['workspaceId']
                const topProj = params['project_number'] ?? params['projectNumber']
                for (const item of params['entries'] as unknown[]) {
                    if (isRecord(item)) {
                        enrichEntryRecord(item, ctx.registryProvider, topWs, topProj, preloadedRegistry)
                    }
                }
            }
        }
        return await origFn(...args)
    }
    ctx.copyFnSchema(origFn, wrapper)
    return wrapper
}

function replaceGroupFn(
    group: GroupApiRecord,
    methodName: string,
    ctx: CrossGroupAliasesContext,
    extraAlias?: string
): void {
    const origFn = group[methodName]
    if (!origFn) return
    const wrappedFn = wrapEntryCreatorFn(origFn, ctx)
    for (const key of Object.keys(group)) {
        if (group[key] === origFn) group[key] = wrappedFn
    }
    if (extraAlias !== undefined) group[extraAlias] = wrappedFn
}

export function wireCrossGroupAliasesHelper(ctx: CrossGroupAliasesContext): void {
    const searchEntriesFn = ctx.search['searchEntries']
    if (searchEntriesFn) {
        ctx.core['searchEntries'] = searchEntriesFn
        ctx.core['search'] = searchEntriesFn
        ctx.core['listEntries'] = searchEntriesFn
        const readQueryFn = async (...args: unknown[]): Promise<unknown> => {
            const res = await searchEntriesFn(...args)
            return isRecord(res) && 'entries' in res ? { ...res, rows: res['entries'] } : res
        }
        ctx.copyFnSchema(searchEntriesFn, readQueryFn)
        ctx.core['readQuery'] = readQueryFn
    }

    replaceGroupFn(ctx.core, 'createEntry', ctx, 'upsert')
    replaceGroupFn(ctx.team, 'teamCreateEntry', ctx)
    replaceGroupFn(ctx.admin, 'batchCreateEntries', ctx)
    replaceGroupFn(ctx.team, 'teamBatchCreateEntries', ctx)

    for (const adminKey of ['deleteEntry', 'updateEntry', 'mergeTags', 'restoreEntry', 'searchAuditLog'] as const) {
        const fn = ctx.admin[adminKey]
        if (fn) ctx.core[adminKey] = fn
    }
    if (ctx.search['listDeletedEntries']) ctx.core['listDeletedEntries'] = ctx.search['listDeletedEntries']

    const semanticFn = ctx.search['semanticSearch']
    if (semanticFn) {
        const wrappedSemanticFn = async (...args: unknown[]): Promise<unknown> => {
            const res = await semanticFn(...args)
            if (isRecord(res) && Array.isArray(res['entries']) && res['entries'].length === 0) {
                return { ...res, warning: 'Semantic search returned no entries' }
            }
            return res
        }
        ctx.copyFnSchema(semanticFn, wrappedSemanticFn)
        for (const group of [ctx.search, ctx.core]) {
            for (const key of Object.keys(group)) {
                if (group[key] === semanticFn) group[key] = wrappedSemanticFn
            }
        }
        ctx.search['semanticSearch'] = wrappedSemanticFn
        ctx.core['semanticSearch'] = wrappedSemanticFn
    }

    if (ctx.search['getVectorIndexStats']) {
        ctx.core['getVectorIndexStats'] = ctx.search['getVectorIndexStats']
        ctx.core['vectorStats'] = ctx.search['getVectorIndexStats']
    }
    if (ctx.admin['rebuildVectorIndex']) ctx.core['rebuildVectorIndex'] = ctx.admin['rebuildVectorIndex']
    if (ctx.admin['addToVectorIndex']) ctx.core['addToVectorIndex'] = ctx.admin['addToVectorIndex']
    if (ctx.io['exportEntries']) ctx.core['exportEntries'] = ctx.io['exportEntries']
    if (ctx.backup['backupJournal']) {
        ctx.core['backupJournal'] = ctx.backup['backupJournal']
        ctx.admin['backup'] = ctx.backup['backupJournal']
    }
    if (ctx.backup['restoreBackup']) ctx.admin['restoreBackup'] = ctx.backup['restoreBackup']
    if (ctx.analytics['getStatistics']) {
        ctx.core['count'] = ctx.analytics['getStatistics']
        ctx.admin['analyze'] = ctx.analytics['getStatistics']
    }
    if (ctx.core['getEntryById']) ctx.core['exists'] = ctx.core['getEntryById']
    if (ctx.core['markAnchorsStale']) ctx.git['markAnchorsStale'] = ctx.core['markAnchorsStale']
    if (ctx.git['checkEntryStaleness']) ctx.core['checkEntryStaleness'] = ctx.git['checkEntryStaleness']
}
