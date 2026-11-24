import type { ToolContext } from '../../../types/index.js'
import {
    findCanonicalRegistryKey,
    resolveWorkspaceFromFilePath,
    resolveWorkspaceId,
} from '../../../utils/workspace-resolver.js'
import { parsePositiveProjectNumber } from '../../../utils/safe-positive-int.js'
import { normalizeProjectFields } from '../schemas/hallucination-healer-scope.js'

const WORKSPACE_SCOPE_KEYS = [
    'workspace_id',
    'workspaceId',
    'workspace',
    'repo',
    'repo_name',
    'repoName',
    'repository',
] as const

const PROJECT_SCOPE_KEYS = [
    'project_number',
    'projectNumber',
    'project_id',
    'projectId',
    'project',
] as const

const NESTED_CONTAINER_KEYS = ['filters', 'filter', 'entry', 'metadata', 'context'] as const
const BATCH_LIST_KEYS = ['updates', 'entries', 'items'] as const
const REPO_ALIAS_KEYS = new Set(['repo', 'repo_name', 'repoName', 'repository'])

function isPlainRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function cloneAndNormalizeContainer(
    container: Record<string, unknown>,
    config: ToolContext['config']
): Record<string, unknown> {
    const cloned: Record<string, unknown> = { ...container }
    normalizeProjectFields(cloned, config?.projectRegistry)
    return cloned
}

function collectScopeContainers(
    params: unknown,
    config: ToolContext['config']
): Record<string, unknown>[] {
    if (!isPlainRecord(params)) return []
    const containers: Record<string, unknown>[] = [cloneAndNormalizeContainer(params, config)]
    for (const nestedKey of NESTED_CONTAINER_KEYS) {
        const nested = params[nestedKey]
        if (isPlainRecord(nested)) {
            containers.push(cloneAndNormalizeContainer(nested, config))
        }
    }
    return containers
}

function readFirstScopeProp(
    containers: Record<string, unknown>[],
    keys: readonly string[]
): { key: string; value: unknown } | undefined {
    for (const container of containers) {
        for (const key of keys) {
            const val = container[key]
            if (val !== undefined && val !== null) return { key, value: val }
        }
    }
    return undefined
}

function normalizeRepoOrWorkspaceRaw(
    rawWs: string,
    key: string,
    config: ToolContext['config']
): string {
    const trimmed = rawWs.trim()
    if (trimmed === '*' || !REPO_ALIAS_KEYS.has(key)) return trimmed
    const registry = config?.projectRegistry
    const directKey = findCanonicalRegistryKey(trimmed, registry)
    if (directKey !== undefined) return directKey
    if (trimmed.includes('/') || trimmed.includes('\\')) {
        const leaf = trimmed.split(/[/\\]/).filter(Boolean).pop()?.trim()
        if (leaf !== undefined && leaf !== '') {
            return findCanonicalRegistryKey(leaf, registry) ?? leaf
        }
    }
    return trimmed
}

function resolveWorkspaceFromContainers(
    containers: Record<string, unknown>[],
    config: ToolContext['config']
): string | undefined {
    if (containers.length === 0) {
        return resolveWorkspaceId(undefined, undefined, config)
    }
    const wsHit = readFirstScopeProp(containers, WORKSPACE_SCOPE_KEYS)
    const rawWs =
        wsHit !== undefined && typeof wsHit.value === 'string'
            ? normalizeRepoOrWorkspaceRaw(wsHit.value, wsHit.key, config)
            : undefined
    if (rawWs === '*') {
        return '*'
    }
    const projHit = readFirstScopeProp(containers, PROJECT_SCOPE_KEYS)
    const numProj = parsePositiveProjectNumber(projHit?.value)
    if ((rawWs === undefined || rawWs === '') && numProj === undefined) {
        const pathHit = readFirstScopeProp(containers, [
            'source_dir',
            'sourceDir',
            'output_dir',
            'outputDir',
        ])
        if (pathHit !== undefined && typeof pathHit.value === 'string' && pathHit.value.trim() !== '') {
            const pathCtx = resolveWorkspaceFromFilePath(pathHit.value.trim(), config)
            if (pathCtx !== undefined && pathCtx.workspaceId !== '') {
                return pathCtx.workspaceId
            }
        }
    }
    try {
        return resolveWorkspaceId(rawWs !== '' ? rawWs : undefined, numProj, config)
    } catch {
        return rawWs !== undefined && rawWs !== '' ? rawWs : undefined
    }
}

function collectUnmergedAliasWorkspaces(
    containers: Record<string, unknown>[],
    config: ToolContext['config'],
    addCandidate: (ws: string | undefined) => void
): void {
    const registry = config?.projectRegistry
    for (const container of containers) {
        const destRaw = container['target_workspace_id'] ?? container['targetWorkspaceId']
        if (typeof destRaw === 'string' && destRaw.trim() !== '') {
            addCandidate(destRaw.trim())
        }
        for (const aliasKey of ['project_name', 'projectName', 'project'] as const) {
            const aliasVal = container[aliasKey]
            if (typeof aliasVal === 'string' && aliasVal.trim() !== '') {
                const matched = findCanonicalRegistryKey(aliasVal.trim(), registry)
                if (matched !== undefined) addCandidate(matched)
            }
        }
    }
}

function appendArrayItemWorkspaces(
    items: readonly unknown[],
    config: ToolContext['config'],
    addCandidate: (ws: string | undefined) => void
): void {
    for (const item of items) {
        if (!isPlainRecord(item)) continue
        const itemContainers = collectScopeContainers(item, config)
        addCandidate(resolveWorkspaceFromContainers(itemContainers, config))
        for (const nestedItem of itemContainers.slice(1)) {
            addCandidate(resolveWorkspaceFromContainers([nestedItem], config))
        }
        collectUnmergedAliasWorkspaces(itemContainers, config, addCandidate)
    }
}

/**
 * Extracts the primary target workspace ID for RBAC evaluation across shallow-cloned
 * and project-normalized root and nested containers (`filters`, `filter`, `entry`, `metadata`, `context`).
 */
function appendExtraWorkspaces(
    params: Record<string, unknown>,
    rootContainers: Record<string, unknown>[],
    seen: Set<string>,
    out: (string | undefined)[],
    config: ToolContext['config']
): void {
    const addCandidate = (ws: string | undefined): void => {
        if (ws === undefined || ws === '') return
        const lower = ws.toLowerCase()
        if (!seen.has(lower)) {
            seen.add(lower)
            out.push(ws)
        }
    }
    for (const nestedContainer of rootContainers.slice(1)) {
        addCandidate(resolveWorkspaceFromContainers([nestedContainer], config))
    }
    collectUnmergedAliasWorkspaces(rootContainers, config, addCandidate)

    for (const listKey of BATCH_LIST_KEYS) {
        const list = params[listKey]
        if (!Array.isArray(list)) continue
        appendArrayItemWorkspaces(list, config, addCandidate)
    }
}

/**
 * Extracts all distinct target workspace IDs (`[primaryWs, ...extraTargetWorkspaces]`)
 * in a single `collectScopeContainers` pass for RBAC enforcement.
 */
export function collectAllTargetWorkspaces(
    params: unknown,
    config: ToolContext['config']
): (string | undefined)[] {
    const rootContainers = collectScopeContainers(params, config)
    const primaryWs = resolveWorkspaceFromContainers(rootContainers, config)
    const seen = new Set<string>(primaryWs !== undefined && primaryWs !== '' ? [primaryWs.toLowerCase()] : [])
    const workspaces: (string | undefined)[] = [primaryWs]
    if (Array.isArray(params)) {
        appendArrayItemWorkspaces(params, config, (ws) => {
            if (ws === undefined || ws === '') return
            const lower = ws.toLowerCase()
            if (!seen.has(lower)) {
                seen.add(lower)
                workspaces.push(ws)
            }
        })
        return workspaces
    }
    if (!isPlainRecord(params)) return workspaces
    appendExtraWorkspaces(params, rootContainers, seen, workspaces, config)
    return workspaces
}

/**
 * Extracts the primary target workspace ID for RBAC evaluation across shallow-cloned
 * and project-normalized root and nested containers (`filters`, `filter`, `entry`, `metadata`, `context`).
 */
export function extractTargetWorkspaceId(
    params: unknown,
    config: ToolContext['config']
): string | undefined {
    const containers = collectScopeContainers(params, config)
    return resolveWorkspaceFromContainers(containers, config)
}

/**
 * Collects additional destination, nested-container, conflicting alias, or batch-item
 * workspace IDs so `enforceTeamRbac` checks every workspace referenced in a payload.
 */
export function collectExtraTargetWorkspaces(
    params: unknown,
    primaryWs: string | undefined,
    config: ToolContext['config']
): string[] {
    const seen = new Set<string>(primaryWs !== undefined ? [primaryWs.toLowerCase()] : [])
    const collected: (string | undefined)[] = []
    if (Array.isArray(params)) {
        appendArrayItemWorkspaces(params, config, (ws) => {
            if (ws === undefined || ws === '') return
            const lower = ws.toLowerCase()
            if (!seen.has(lower)) {
                seen.add(lower)
                collected.push(ws)
            }
        })
        return collected.filter((ws): ws is string => ws !== undefined)
    }
    if (!isPlainRecord(params)) return []
    const rootContainers = collectScopeContainers(params, config)
    appendExtraWorkspaces(params, rootContainers, seen, collected, config)
    return collected.filter((ws): ws is string => ws !== undefined)
}
