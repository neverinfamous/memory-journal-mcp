/**
 * Shared types and utilities for the Code Mode API module.
 */

import { isRecord } from '../normalizers/shared-utils.js'
import { mcpLogger } from '../../utils/mcp-logger.js'

export type ProjectInfo = Record<string, unknown> & { project_number?: number | null }
export type ProjectArrayItem = ProjectInfo & { name: string; projectNumber?: number | null }

/**
 * Dispatcher function signature for SEC-1.1 Code Mode dispatch gate.
 * When provided, sandbox tool calls are routed through callTool() instead
 * of calling raw tool handlers, ensuring scope/maintenance/audit apply.
 */
export type ToolDispatcher = (name: string, args: unknown) => Promise<unknown>

/** Type alias for group API record */
export type GroupApiRecord = Record<string, (...args: unknown[]) => Promise<unknown>>

/** Supplies the live project registry from server config (ToolContext / ConfigManager). */
export type ProjectRegistryProvider = () => unknown

/**
 * Normalise a registry map (object or JSON string) into an array of `{ name, ...info }`.
 * [BOUNDARY] When `source` is omitted the startup-mirrored PROJECT_REGISTRY env value is used;
 * runtime mutations propagate via config, never via process.env.
 */
export function parseProjectRegistry(source?: unknown): unknown[] | undefined {
    let parsed: unknown = source
    if (source === undefined || typeof source === 'string') {
        const raw = typeof source === 'string' ? source : process.env['PROJECT_REGISTRY']
        if (raw === undefined || raw.trim() === '') return undefined
        try {
            parsed = JSON.parse(raw)
        } catch (err) {
            mcpLogger.warning('codemode', 'Malformed PROJECT_REGISTRY JSON ignored', {
                error: err instanceof Error ? err.message : String(err),
            })
            return undefined
        }
    }
    if (!isRecord(parsed)) return undefined
    const arr: ProjectArrayItem[] = Object.entries(parsed).map(([name, val]) => {
        const info: ProjectInfo = isRecord(val) ? val : {}
        return {
            name,
            ...(info.project_number !== undefined ? { projectNumber: info.project_number } : {}),
            ...info,
        }
    })
    return arr
}
