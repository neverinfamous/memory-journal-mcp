/**
 * Memory Journal MCP Server - Resource Shared Types & Helpers
 *
 * Shared types, helpers, and utilities used by all resource group modules.
 */

import type { SqliteAdapter } from '../../database/sqlite-adapter.js'
import type { VectorSearchManager } from '../../vector/vector-search-manager.js'
import type { ToolFilterConfig } from '../../filtering/tool-filter.js'
import type { McpIcon } from '../../types/index.js'
import type { GitHubIntegration } from '../../github/github-integration.js'
import type { Scheduler } from '../../server/scheduler.js'

/**
 * Configuration for the memory://briefing resource.
 * All values have sensible defaults — users opt-in via env vars or CLI flags.
 */
export interface BriefingConfig {
    /** Number of recent journal entries to include (default: 3) */
    entryCount: number
    /** Include team DB entries in briefing preview (default: false) */
    includeTeam: boolean
    /** Number of open issues to list with titles; 0 = count only (default: 0) */
    issueCount: number
    /** Number of PRs to list with titles; 0 = count only (default: 0) */
    prCount: number
    /** Show PR status breakdown (open/merged/closed) instead of simple count (default: false) */
    prStatusBreakdown: boolean
    /** Path to the user's rules file (e.g., .gemini/GEMINI.md) for awareness in briefing */
    rulesFilePath?: string
    /** Path to the user's skills directory for awareness in briefing */
    skillsDirPath?: string
    /** Number of recent workflow runs to list; 0 = latest-only status (default: 0) */
    workflowCount: number
    /** Show workflow run status breakdown (passing/failing/pending) (default: false) */
    workflowStatusBreakdown: boolean
    /** Aggregate Copilot review state across recent PRs in briefing (default: false) */
    copilotReviews: boolean
}

/** Default briefing configuration — preserves pre-existing behavior */
export const DEFAULT_BRIEFING_CONFIG: BriefingConfig = {
    entryCount: 3,
    includeTeam: false,
    issueCount: 0,
    prCount: 0,
    prStatusBreakdown: false,
    workflowCount: 0,
    workflowStatusBreakdown: false,
    copilotReviews: false,
}

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
    briefingConfig?: BriefingConfig
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
