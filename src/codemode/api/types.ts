/**
 * Shared types and utilities for the Code Mode API module.
 */

import { isRecord } from '../normalizers/shared-utils.js'

export type ProjectInfo = Record<string, unknown> & { project_number?: number | null }
export type ProjectMap = Record<string, ProjectInfo>
export type ProjectArrayItem = ProjectInfo & { name: string; projectNumber?: number | null }

/**
 * Dispatcher function signature for SEC-1.1 Code Mode dispatch gate.
 * When provided, sandbox tool calls are routed through callTool() instead
 * of calling raw tool handlers, ensuring scope/maintenance/audit apply.
 */
export type ToolDispatcher = (name: string, args: Record<string, unknown>) => Promise<unknown>

/** Type alias for group API record */
export type GroupApiRecord = Record<string, (...args: unknown[]) => Promise<unknown>>

export function parseProjectRegistry(): unknown[] | undefined {
    const raw = process.env['PROJECT_REGISTRY']
    if (raw === undefined || raw.trim() === '') return undefined
    try {
        const parsed: unknown = JSON.parse(raw)
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
    } catch {
        return undefined
    }
}
