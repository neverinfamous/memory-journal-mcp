import type { ToolHandlerConfig } from '../../../types/index.js'
import { parsePositiveProjectNumber } from '../../../utils/safe-positive-int.js'
import { resolveProjectContext } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../../utils/write-scope.js'
import { DUMMY_ENTRY_CREATION_TOOL_NAMES } from '../../../handlers/tools/core/dummy-healing/alias-catalog.js'
import { isRecord } from '../../../utils/type-guards.js'

const DUMMY_CREATE_SCOPE_SET = new Set<string>(DUMMY_ENTRY_CREATION_TOOL_NAMES)

export { parsePositiveProjectNumber }

/**
 * Resolve omitted `workspace_id` for direct MCP `create_entry` / `batch_create_entries` calls
 * using live server configuration before `inputSchema` (`CreateEntrySchemaMcp`) runs.
 */
function resolveSingleCreateScope(
    toolArgs: Record<string, unknown>,
    resolverConfig: ToolHandlerConfig
): void {
    if (toolArgs['workspace_id'] !== undefined) return
    const parsedProj = parsePositiveProjectNumber(toolArgs['project_number'])
    try {
        const resolved = resolveProjectContext(
            {
                ...(parsedProj !== undefined ? { project_number: parsedProj } : {}),
            },
            resolverConfig
        )
        toolArgs['workspace_id'] = resolved.workspaceId
        if (toolArgs['project_number'] === undefined && resolved.projectNumber !== undefined) {
            toolArgs['project_number'] = resolved.projectNumber
        }
    } catch {
        // Defer validation errors (e.g. ambiguous project_number) to the tool handler.
    }
}

function applyWildcardRootToBatch(entries: unknown[]): void {
    for (const entry of entries) {
        if (!isRecord(entry)) continue
        if (entry['workspace_id'] === undefined) {
            entry['workspace_id'] = '*'
        }
    }
}

function resolveBatchCreateItemScope(
    entry: unknown,
    rawRootWs: string | undefined,
    rootProj: number | undefined,
    registry: ReturnType<typeof activeProjectRegistry>,
    resolverConfig: ToolHandlerConfig
): void {
    if (!isRecord(entry)) return
    const item = entry
    if (item['workspace_id'] !== undefined) {
        return
    }
    const itemProj = parsePositiveProjectNumber(item['project_number'])

    const candidateProj = itemProj ?? rootProj
    if (rawRootWs !== undefined && candidateProj !== undefined) {
        try {
            const paired = pairStoredScope(rawRootWs, candidateProj, registry)
            item['workspace_id'] = paired.workspaceId
            if (item['project_number'] === undefined && paired.projectNumber !== undefined) {
                item['project_number'] = paired.projectNumber
            }
        } catch {
            // Defer validation errors (e.g. mismatched root/item scope) to the handler.
        }
        return
    }

    try {
        const resolved = resolveProjectContext(
            {
                ...(rawRootWs !== undefined ? { workspace_id: rawRootWs } : {}),
                ...(candidateProj !== undefined ? { project_number: candidateProj } : {}),
            },
            resolverConfig
        )
        const paired = pairStoredScope(
            resolved.workspaceId,
            candidateProj ?? resolved.projectNumber,
            registry
        )
        item['workspace_id'] = paired.workspaceId
        if (item['project_number'] === undefined && paired.projectNumber !== undefined) {
            item['project_number'] = paired.projectNumber
        }
    } catch {
        // Do not stamp unvalidated rawRootWs when scope resolution or pairing failed.
    }
}

function resolveBatchCreateScope(
    toolArgs: Record<string, unknown>,
    entries: unknown[],
    resolverConfig: ToolHandlerConfig
): void {
    const rawRootWs =
        typeof toolArgs['workspace_id'] === 'string' && toolArgs['workspace_id'].trim() !== ''
            ? toolArgs['workspace_id'].trim()
            : undefined
    if (toolArgs['workspace_id'] !== undefined && rawRootWs === undefined) {
        return
    }
    if (rawRootWs === '*') {
        applyWildcardRootToBatch(entries)
        return
    }

    const rootProj = parsePositiveProjectNumber(toolArgs['project_number'])
    const registry = activeProjectRegistry(resolverConfig.projectRegistry)
    if (rawRootWs !== undefined && rootProj !== undefined) {
        try {
            pairStoredScope(rawRootWs, rootProj, registry)
        } catch {
            // Defer mismatched root (workspace_id, project_number) error to the handler.
            return
        }
    }

    const effectiveConfig =
        registry !== undefined && resolverConfig.projectRegistry === undefined
            ? { ...resolverConfig, projectRegistry: registry }
            : resolverConfig
    for (const entry of entries) {
        resolveBatchCreateItemScope(entry, rawRootWs, rootProj, registry, effectiveConfig)
    }
}

export function isCreateWorkspaceScopeTool(toolName: string | undefined): boolean {
    return (
        toolName === 'create_entry' ||
        toolName === 'batch_create_entries' ||
        (toolName !== undefined && DUMMY_CREATE_SCOPE_SET.has(toolName))
    )
}

export function resolveMcpCreateWorkspaceScope(
    toolName: string | undefined,
    toolArgs: Record<string, unknown>,
    resolverConfig: ToolHandlerConfig
): void {
    if (typeof toolArgs !== 'object' || toolArgs === null || Array.isArray(toolArgs)) {
        return
    }
    if (toolName === 'create_entry' || (toolName !== undefined && DUMMY_CREATE_SCOPE_SET.has(toolName))) {
        resolveSingleCreateScope(toolArgs, resolverConfig)
        return
    }
    if (toolName === 'batch_create_entries' && Array.isArray(toolArgs['entries'])) {
        resolveBatchCreateScope(toolArgs, toolArgs['entries'], resolverConfig)
    }
}
