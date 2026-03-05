/**
 * Memory Journal MCP Server - Resource Shared Types & Helpers
 *
 * Shared types, helpers, and utilities used by all resource group modules.
 */

import type { SqliteAdapter } from '../../database/SqliteAdapter.js'
import type { VectorSearchManager } from '../../vector/VectorSearchManager.js'
import type { ToolFilterConfig } from '../../filtering/ToolFilter.js'
import type { McpIcon } from '../../types/index.js'
import type { GitHubIntegration } from '../../github/GitHubIntegration.js'
import type { Scheduler } from '../../server/Scheduler.js'

/**
 * Resource context for handlers that need extended access
 */
export interface ResourceContext {
    db: SqliteAdapter
    teamDb?: SqliteAdapter
    vectorManager?: VectorSearchManager
    filterConfig?: ToolFilterConfig | null
    github?: GitHubIntegration | null
    scheduler?: Scheduler | null
}

/**
 * Resource handler result with optional annotations for MCP 2025-11-25
 */
export interface ResourceResult {
    data: unknown
    annotations?: {
        lastModified?: string // ISO 8601 timestamp
    }
}

/**
 * Internal resource definition with db handler
 */
export interface InternalResourceDef {
    uri: string
    name: string
    title: string
    description: string
    mimeType: string
    icons?: McpIcon[] // MCP 2025-11-25 icons
    annotations?: {
        audience?: ('user' | 'assistant')[]
        priority?: number
        lastModified?: string
        autoRead?: boolean
        sessionInit?: boolean
    }
    handler: (uri: string, context: ResourceContext) => unknown
}

/**
 * Execute a raw SQL query on the database
 */
export function execQuery(
    db: SqliteAdapter,
    sql: string,
    params: unknown[] = []
): Record<string, unknown>[] {
    const rawDb = db.getRawDb()
    const result = rawDb.exec(sql, params)
    if (result.length === 0) return []

    const columns = result[0]?.columns ?? []
    return (result[0]?.values ?? []).map((values: unknown[]) => {
        const obj: Record<string, unknown> = {}
        columns.forEach((col: string, i: number) => {
            obj[col] = values[i]
        })
        return obj
    })
}

/**
 * Transform snake_case SQL row to camelCase entry object
 * Ensures consistency with SqliteAdapter.getRecentEntries() output
 */
export function transformEntryRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
        id: row['id'],
        entryType: row['entry_type'],
        content: row['content'],
        timestamp: row['timestamp'],
        isPersonal: row['is_personal'] === 1 || row['is_personal'] === true,
        significanceType: row['significance_type'] ?? null,
        autoContext: row['auto_context'] ?? null,
        deletedAt: row['deleted_at'] ?? null,
        projectNumber: row['project_number'] ?? null,
        projectOwner: row['project_owner'] ?? null,
        issueNumber: row['issue_number'] ?? null,
        issueUrl: row['issue_url'] ?? null,
        prNumber: row['pr_number'] ?? null,
        prUrl: row['pr_url'] ?? null,
        prStatus: row['pr_status'] ?? null,
        workflowRunId: row['workflow_run_id'] ?? null,
        workflowName: row['workflow_name'] ?? null,
        workflowStatus: row['workflow_status'] ?? null,
    }
}
