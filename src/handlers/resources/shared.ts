/**
 * Memory Journal MCP Server - Resource Shared Types & Helpers
 *
 * Shared types, helpers, and utilities used by all resource group modules.
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { VectorSearchManager } from '../../vector/vector-search-manager.js'
import type { ToolFilterConfig } from '../../filtering/tool-filter.js'
import type { McpIcon, ProjectRegistryEntry } from '../../types/index.js'
import type { GitHubIntegration } from '../../github/github-integration/index.js'
import { getGitHubIntegration } from '../../github/github-integration/index.js'
import type { Scheduler } from '../../server/scheduler.js'
import type { ServerRuntime } from '../../utils/maintenance-lock.js'

// ============================================================================
// GitHub Resource Guard
// ============================================================================

/** Successful result from resolveGitHubRepo */
export interface GitHubRepoResolved {
    owner: string
    repo: string
    branch: string | null
    lastModified: string
    /** Narrowed non-null reference — safe to use without `!` after guard */
    github: GitHubIntegration
}

/**
 * Resolve GitHub owner/repo or return a ResourceResult error.
 *
 * Encapsulates the three-step guard pattern used by all GitHub resource
 * handlers: check github integration → getRepoInfo → validate owner/repo.
 *
 * @param github - The default GitHub integration instance
 * @param config - The briefing configuration containing project registry
 * @param targetRepo - Optional target repository name to dynamically resolve
 * @returns Resolved repo info, or a ResourceResult error to return directly
 */
export async function resolveGitHubRepo(
    github: GitHubIntegration | null | undefined,
    config?: BriefingConfig,
    targetRepo?: string,
    runtime?: ServerRuntime
): Promise<GitHubRepoResolved | ResourceResult> {
    const lastModified = new Date().toISOString()

    let activeGithub = github
    if (targetRepo) {
        if (!/^[a-zA-Z0-9_.-]+$/.test(targetRepo)) {
            return {
                data: { error: 'Invalid repository name format' },
                annotations: { lastModified }
            }
        }
        const registry = config?.projectRegistry
        if (registry && Object.prototype.hasOwnProperty.call(registry, targetRepo)) {
            const entry = registry[targetRepo]
            if (entry) {
                activeGithub = getGitHubIntegration(entry.path, runtime)
            }
        } else {
            return {
                data: { error: `Repository not found in registry: ${targetRepo}` },
                annotations: { lastModified }
            }
        }
    }

    if (!activeGithub) {
        const hasRegistry =
            config?.projectRegistry && Object.keys(config.projectRegistry).length > 0
        return {
            data: {
                error: 'GitHub integration not available',
                hint: hasRegistry
                    ? 'Set GITHUB_TOKEN, or assure the dynamic repo URI correctly matches a registered project.'
                    : 'Set GITHUB_TOKEN securely.',
            },
            annotations: { lastModified },
        }
    }

    const repoInfo = await activeGithub.getRepoInfo()

    const owner = repoInfo.owner
    const repo = repoInfo.repo

    if (!owner || !repo) {
        const hasRegistry =
            config?.projectRegistry && Object.keys(config.projectRegistry).length > 0
        return {
            data: {
                error: 'Could not detect repository',
                hint: hasRegistry
                    ? 'Use a repository-specific URI suffix (e.g., memory://github/status/{repo}) for multi-project setups, or ensure the fallback project is a valid git repository.'
                    : 'Run the MCP server from a valid git repository or configure PROJECT_REGISTRY.',
                ...(repoInfo.branch ? { branch: repoInfo.branch } : {}),
            },
            annotations: { lastModified },
        }
    }

    return { owner, repo, branch: repoInfo.branch ?? null, lastModified, github: activeGithub }
}

/**
 * Type guard: returns true if the result is a ResourceResult error.
 */
export function isResourceError(
    result: GitHubRepoResolved | ResourceResult
): result is ResourceResult {
    return 'data' in result
}

/**
 * Configuration for the memory://briefing resource.
 * All values have sensible defaults — users opt-in via env vars or CLI flags.
 */
export interface BriefingConfig {
    /** Number of recent journal entries to include (default: 3) */
    entryCount: number
    /** Number of recent session summaries to display (default: 1) */
    summaryCount?: number
    /** Include team DB entries in briefing preview (default: false) */
    includeTeam: boolean
    /** Number of open issues to list with titles; 0 = count only (default: 0) */
    issueCount: number
    /** Number of PRs to list with titles; 0 = count only (default: 0) */
    prCount: number
    /** Show PR status breakdown (open/merged/closed) instead of simple count (default: false) */
    prStatusBreakdown: boolean
    /** Number of milestones to list in briefing; 0 = hide (default: 3) */
    milestoneCount?: number
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
    /** Workflow summary string for the memory://workflows resource (env: MEMORY_JOURNAL_WORKFLOW_SUMMARY) */
    workflowSummary?: string
    /** Default GitHub Project number for Kanban resources and issue tools (env: DEFAULT_PROJECT_NUMBER) */
    defaultProjectNumber?: number
    /** Project registry mapping dynamic repo IDs to local paths and kanban boards */
    projectRegistry?: Record<string, ProjectRegistryEntry>
    /** Hush Protocol flag vocabulary passed from CLI/env */
    flagVocabulary?: string[]
    /** Allowlisted directory roots for strict filesystem jailing of agent read access */
    allowedIoRoots?: string[]
}

/** Default briefing configuration — preserves pre-existing behavior */
export const DEFAULT_BRIEFING_CONFIG: BriefingConfig = {
    entryCount: 3,
    summaryCount: 1,
    includeTeam: false,
    issueCount: 0,
    prCount: 0,
    prStatusBreakdown: false,
    milestoneCount: 3,
    workflowCount: 0,
    workflowStatusBreakdown: false,
    copilotReviews: false,
}

/**
 * Resource context for handlers that need extended access
 */
export interface ResourceContext {
    db: IDatabaseAdapter
    teamDb?: IDatabaseAdapter
    vectorManager?: VectorSearchManager
    filterConfig?: ToolFilterConfig | null
    github?: GitHubIntegration | null
    scheduler?: Scheduler | null
    briefingConfig?: BriefingConfig
    runtime?: ServerRuntime
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
    capabilities?: {
        requiresTeamScope?: boolean
        requiresAdminScope?: boolean
    }
    handler: (uri: string, context: ResourceContext) => unknown
}

/**
 * Calculate milestone completion percentage from open/closed issue counts.
 * Shared helper to avoid duplicated logic across resource handlers.
 */
export function milestoneCompletionPct(openIssues: number, closedIssues: number): number {
    const total = openIssues + closedIssues
    return total > 0 ? Math.round((closedIssues / total) * 100) : 0
}
