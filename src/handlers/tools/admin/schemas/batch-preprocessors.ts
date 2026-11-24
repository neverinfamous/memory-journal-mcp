/**
 * Shared Zod preprocessors for batch create, update, and delete tool schemas.
 */

import { isRecord } from '../../../../utils/type-guards.js'
import { parseCanonicalPositiveInt } from '../../../../utils/safe-positive-int.js'

const WORKSPACE_ALIAS_KEYS = ['workspace_id', 'workspaceId', 'workspace', 'repo'] as const
const ROOT_WORKSPACE_PROMOTE_KEYS = ['workspaceId', 'workspace', 'repo'] as const
const PROJECT_ALIAS_KEYS = [
    'project_number',
    'projectNumber',
    'project_name',
    'projectName',
    'project',
] as const
const ROOT_NUMERIC_PROJECT_KEYS = ['projectNumber', 'project', 'project_id', 'projectId'] as const
const ROOT_NAMED_PROJECT_KEYS = ['project_name', 'projectName'] as const

function firstDefinedEntry(
    obj: Record<string, unknown>,
    keys: readonly string[]
): { key: string; value: unknown } | undefined {
    for (const key of keys) {
        if (obj[key] !== undefined) return { key, value: obj[key] }
    }
    return undefined
}

function promoteStringWorkspaceAlias(obj: Record<string, unknown>, alias: string): void {
    const raw = obj[alias]
    if (typeof raw !== 'string') return
    const trimmed = raw.trim()
    if (trimmed === '') return
    if (obj['workspace_id'] === undefined) {
        obj['workspace_id'] = trimmed
        Reflect.deleteProperty(obj, alias)
        return
    }
    if (
        typeof obj['workspace_id'] === 'string' &&
        obj['workspace_id'].trim().toLowerCase() === trimmed.toLowerCase()
    ) {
        Reflect.deleteProperty(obj, alias)
    }
}

function promoteProjectNumberAlias(obj: Record<string, unknown>, alias: string, value: unknown): void {
    if (value === undefined) return
    if (obj['project_number'] === undefined) {
        obj['project_number'] = value
        Reflect.deleteProperty(obj, alias)
        return
    }
    if (obj['project_number'] === value) {
        Reflect.deleteProperty(obj, alias)
    }
}

function normalizeRootBatchAliases(obj: Record<string, unknown>): void {
    for (const alias of ROOT_WORKSPACE_PROMOTE_KEYS) {
        promoteStringWorkspaceAlias(obj, alias)
    }
    for (const alias of ROOT_NUMERIC_PROJECT_KEYS) {
        if (obj[alias] !== undefined) promoteProjectNumberAlias(obj, alias, obj[alias])
    }
    for (const alias of ROOT_NAMED_PROJECT_KEYS) {
        const raw = obj[alias]
        if (typeof raw === 'number') {
            promoteProjectNumberAlias(obj, alias, raw)
        } else if (typeof raw === 'string' && raw.trim() !== '') {
            const parsedNum = parseCanonicalPositiveInt(raw.trim())
            if (parsedNum !== undefined) {
                promoteProjectNumberAlias(obj, alias, parsedNum)
            } else {
                promoteStringWorkspaceAlias(obj, alias)
            }
        }
    }
}

export function inheritRootBatchScope(
    itemObj: Record<string, unknown>,
    rootObj: Record<string, unknown>,
    inheritProject: boolean,
    inheritWorkspaceOnItemProject = false
): void {
    const rootWs = firstDefinedEntry(rootObj, WORKSPACE_ALIAS_KEYS)
    const rootProj = firstDefinedEntry(rootObj, PROJECT_ALIAS_KEYS)
    const itemWs = firstDefinedEntry(itemObj, WORKSPACE_ALIAS_KEYS)
    const itemTargetWs = firstDefinedEntry(itemObj, ['target_workspace_id', 'targetWorkspaceId'])
    const itemProj = firstDefinedEntry(itemObj, PROJECT_ALIAS_KEYS)
    const differsFromRoot = (entry: { value: unknown } | undefined): boolean =>
        entry !== undefined &&
        (rootWs === undefined ||
            (typeof entry.value === 'string' && typeof rootWs.value === 'string'
                ? entry.value.trim().toLowerCase() !== rootWs.value.trim().toLowerCase()
                : entry.value !== rootWs.value))
    const hasConcreteTargetWs =
        itemTargetWs !== undefined &&
        (typeof itemTargetWs.value !== 'string' || itemTargetWs.value.trim() !== '')
    const itemIsDefaultWs =
        itemWs !== undefined &&
        typeof itemWs.value === 'string' &&
        itemWs.value.trim().toLowerCase() === 'default'
    const namesOtherWorkspace =
        differsFromRoot(itemWs) || (hasConcreteTargetWs && differsFromRoot(itemTargetWs))
    if (
        inheritProject &&
        itemProj === undefined &&
        rootProj !== undefined &&
        !namesOtherWorkspace &&
        !itemIsDefaultWs
    ) {
        itemObj[rootProj.key] = rootProj.value
    }
    if (itemWs === undefined && (inheritWorkspaceOnItemProject || itemProj === undefined) && rootWs !== undefined) {
        itemObj[rootWs.key] = rootWs.value
    }
}

export function preprocessBatchCreateEntries(val: unknown): unknown {
    if (Array.isArray(val)) {
        return { entries: val as unknown[] }
    }
    if (isRecord(val)) {
        const obj: Record<string, unknown> = { ...val }
        normalizeRootBatchAliases(obj)
        if (obj['entries'] === undefined && Array.isArray(obj['items'])) {
            obj['entries'] = obj['items']
            Reflect.deleteProperty(obj, 'items')
        }
        if (Array.isArray(obj['entries'])) {
            obj['entries'] = obj['entries'].map((e: unknown) => {
                if (isRecord(e)) {
                    const eObj: Record<string, unknown> = { ...e }
                    inheritRootBatchScope(eObj, obj, true, true)
                    return eObj
                }
                return e
            })
            return obj
        }
        return obj
    }
    return val
}

export function preprocessBatchUpdates(val: unknown, propagateRootProject = true): unknown {
    if (!Array.isArray(val) && !isRecord(val)) {
        return val
    }
    const obj: Record<string, unknown> = Array.isArray(val)
        ? { updates: val as unknown[] }
        : { ...val }

    normalizeRootBatchAliases(obj)
    let updatesArr = obj['updates']
    if (updatesArr === undefined && Array.isArray(obj['items'])) {
        updatesArr = obj['items']
        obj['updates'] = updatesArr
        Reflect.deleteProperty(obj, 'items')
    }
    if (updatesArr === undefined && Array.isArray(obj['entries'])) {
        updatesArr = obj['entries']
        obj['updates'] = updatesArr
        Reflect.deleteProperty(obj, 'entries')
    }
    if (Array.isArray(updatesArr)) {
        const newUpdates = updatesArr.map((u: unknown) => {
            if (isRecord(u)) {
                const uObj: Record<string, unknown> = { ...u }
                if (uObj['id'] !== undefined && uObj['entry_id'] === undefined) {
                    uObj['entry_id'] = uObj['id']
                    Reflect.deleteProperty(uObj, 'id')
                }
                inheritRootBatchScope(uObj, obj, propagateRootProject)
                return uObj
            }
            return u
        })
        return { ...obj, updates: newUpdates }
    }
    return obj
}

function parseBatchIdItem(item: unknown): unknown {
    if (typeof item === 'string') {
        const cleaned = item.trim().replace(/^#/, '')
        if (/^[1-9]\d*$/.test(cleaned)) {
            const parsed = Number(cleaned)
            if (Number.isSafeInteger(parsed) && String(parsed) === cleaned) {
                return parsed
            }
        }
    }
    return item
}

export function preprocessBatchDeleteIds(val: unknown): unknown {
    if (Array.isArray(val)) {
        return { entry_ids: (val as unknown[]).map(parseBatchIdItem) }
    }
    if (isRecord(val)) {
        const obj: Record<string, unknown> = { ...val }
        normalizeRootBatchAliases(obj)
        for (const aliasKey of ['ids', 'id', 'items', 'entries'] as const) {
            if (obj[aliasKey] !== undefined && obj['entry_ids'] === undefined) {
                const raw = obj[aliasKey]
                obj['entry_ids'] = Array.isArray(raw) ? raw : [raw]
                Reflect.deleteProperty(obj, aliasKey)
                break
            }
        }
        if (Array.isArray(obj['entry_ids'])) {
            obj['entry_ids'] = obj['entry_ids'].map(parseBatchIdItem)
        }
        return obj
    }
    return val
}
