/**
 * Shared types and utilities for the Code Mode API module.
 */

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
    if (!process.env['PROJECT_REGISTRY']) return undefined
    const parsed = JSON.parse(process.env['PROJECT_REGISTRY']) as ProjectMap
    const arr: ProjectArrayItem[] = Object.entries(parsed).map(([name, val]) => ({
        name,
        projectNumber: val.project_number,
        ...val,
    }))

    return arr
}
