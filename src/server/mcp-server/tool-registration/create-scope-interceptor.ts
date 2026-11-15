import type { ToolHandlerConfig } from '../../../types/index.js'
import { resolveProjectContext } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../../utils/write-scope.js'

/**
 * Resolve omitted `workspace_id` for direct MCP `create_entry` / `batch_create_entries` calls
 * using live server configuration before `inputSchema` (`CreateEntrySchemaMcp`) runs.
 */
export function parsePositiveProjectNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return value
    }
    if (typeof value === 'string') {
        const trimmed = value.trim().replace(/^#/, '')
        if (/^[1-9]\d*$/.test(trimmed)) {
            const parsed = Number.parseInt(trimmed, 10)
            if (Number.isInteger(parsed) && parsed > 0) return parsed
        }
    }
    return undefined
}

export function resolveMcpCreateWorkspaceScope(
    toolName: string | undefined,
    toolArgs: Record<string, unknown>,
    resolverConfig: ToolHandlerConfig
): void {
    if (toolName === 'create_entry') {
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
        return
    }
    if (toolName === 'batch_create_entries' && Array.isArray(toolArgs['entries'])) {
        const rawRootWs =
            typeof toolArgs['workspace_id'] === 'string' && toolArgs['workspace_id'].trim() !== ''
                ? toolArgs['workspace_id'].trim()
                : undefined
        if (rawRootWs === '*') {
            for (const entry of toolArgs['entries']) {
                if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
                const item = entry as Record<string, unknown>
                if (item['workspace_id'] === undefined) {
                    item['workspace_id'] = '*'
                }
            }
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
        for (const entry of toolArgs['entries']) {
            if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
            const item = entry as Record<string, unknown>
            const itemWs =
                typeof item['workspace_id'] === 'string' && item['workspace_id'].trim() !== ''
                    ? item['workspace_id'].trim()
                    : undefined
            const itemProj = parsePositiveProjectNumber(item['project_number'])
            if (itemWs !== undefined) {
                if (itemWs !== '*' && itemProj !== undefined) {
                    try {
                        pairStoredScope(itemWs, itemProj, registry)
                    } catch {
                        // Defer mismatched item (workspace_id, project_number) error to the handler.
                    }
                }
                continue
            }
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
                continue
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
    }
}
