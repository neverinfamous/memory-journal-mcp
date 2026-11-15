/**
 * Memory Journal MCP Server - Resource Shared Types & Helpers
 *
 * Shared types, helpers, and utilities used by all resource group modules.
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { VectorSearchManager } from '../../vector/vector-search-manager/index.js'
import type { ToolFilterConfig } from '../../filtering/tool-filter.js'
import type { McpIcon, ProjectRegistryEntry } from '../../types/index.js'
import type { GitHubIntegration } from '../../github/github-integration/index.js'
import { getGitHubIntegration } from '../../github/github-integration/index.js'
import type { Scheduler } from '../../server/scheduler.js'
import type { ServerRuntime } from '../../utils/maintenance-lock.js'
import {
    findCanonicalRegistryKey,
    getActiveSessionProject,
    loadProjectRegistryFromConfig,
    resolveProjectNumberFromPath,
} from '../../utils/workspace-resolver.js'
import { uniqueWorkspaceForProject } from '../../utils/write-scope.js'

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

/** Resolve the GitHub integration for an explicit `targetRepo`, or a ResourceResult error. */
function resolveTargetRepoGithub(
    config: BriefingConfig | undefined,
    targetRepo: string,
    runtime: ServerRuntime | undefined,
    lastModified: string
): GitHubIntegration | ResourceResult {
    if (!/^[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+)?$/.test(targetRepo)) {
        return {
            data: { error: 'Invalid repository name format' },
            annotations: { lastModified },
        }
    }
    const registry = config?.projectRegistry ?? loadProjectRegistryFromConfig()

    // Attempt to find exact match, then fallback to just the repo name if owner/repo format was used
    let registryKey: string = targetRepo
    if (registry && !Object.prototype.hasOwnProperty.call(registry, targetRepo)) {
        const parts = targetRepo.split('/')
        const repoPart = parts[1]
        if (parts.length === 2 && repoPart && Object.prototype.hasOwnProperty.call(registry, repoPart)) {
            registryKey = repoPart
        }
    }

    if (registry && Object.prototype.hasOwnProperty.call(registry, registryKey)) {
        const entry = registry[registryKey]
        if (entry && typeof entry.path === 'string' && entry.path.trim() !== '') {
            return getGitHubIntegration(entry.path, runtime)
        }
        return {
            data: {
                error: 'GitHub integration not available',
                hint: `Workspace '${registryKey}' has no local repository path configured.`,
            },
            annotations: { lastModified },
        }
    }
    if (targetRepo.trim().toLowerCase() === 'default') {
        return {
            data: { error: 'GitHub integration not available' },
            annotations: { lastModified },
        }
    }
    return {
        data: { error: `Repository not found in registry: ${targetRepo}` },
        annotations: { lastModified },
    }
}

/** Fall back to the first registered project that is a valid git repo (default project first). */
async function resolveFallbackRegistryRepo(
    config: BriefingConfig | undefined,
    runtime: ServerRuntime | undefined,
    lastModified: string
): Promise<GitHubRepoResolved | undefined> {
    const registry = config?.projectRegistry ?? loadProjectRegistryFromConfig()
    if (!registry) return undefined
    let fallbackKeys = Object.keys(registry)

    if (config?.defaultProjectNumber !== undefined) {
        const defaultKey = fallbackKeys.find(
            (key) => registry[key]?.project_number === config.defaultProjectNumber
        )
        if (defaultKey) {
            fallbackKeys = [defaultKey, ...fallbackKeys.filter((k) => k !== defaultKey)]
        }
    }

    for (const key of fallbackKeys) {
        const project = registry[key]
        if (project && typeof project.path === 'string' && project.path.trim() !== '') {
            const fallbackGithub = getGitHubIntegration(project.path, runtime)
            const fallbackRepoInfo = await fallbackGithub.getRepoInfo()
            if (fallbackRepoInfo.owner && fallbackRepoInfo.repo) {
                return {
                    owner: fallbackRepoInfo.owner,
                    repo: fallbackRepoInfo.repo,
                    branch: fallbackRepoInfo.branch ?? null,
                    lastModified,
                    github: fallbackGithub,
                }
            }
        }
    }
    return undefined
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
        const target = resolveTargetRepoGithub(config, targetRepo, runtime, lastModified)
        if ('data' in target) return target
        activeGithub = target
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
        const registry = config?.projectRegistry
        const hasRegistry = registry && Object.keys(registry).length > 0

        // Fallback to the first VALID registered project if no targetRepo was specified
        if (!targetRepo && hasRegistry) {
            const fallback = await resolveFallbackRegistryRepo(config, runtime, lastModified)
            if (fallback) return fallback
        }

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
 * [INVARIANT] Resource-scoped wrapper around `resolveGitHubRepo` (H21):
 * when `targetRepo` is omitted in multi-project setups or when `defaultWorkspaceId: 'default'`
 * has no registered path, resolve via `resourceWorkspace(context)` instead of leaking
 * the server process CWD's `context.github`.
 */
export async function resolveScopedGitHubRepo(
    context: ResourceContext,
    targetRepo?: string
): Promise<GitHubRepoResolved | ResourceResult> {
    const lastModified = new Date().toISOString()
    if (targetRepo !== undefined && targetRepo !== '') {
        return resolveGitHubRepo(context.github, context.briefingConfig, targetRepo, context.runtime)
    }
    const ws = resourceWorkspace(context)
    const reg = context.briefingConfig?.projectRegistry ?? loadProjectRegistryFromConfig()
    const hasRegistry = reg !== undefined && Object.keys(reg).length > 0
    const canonicalWs = ws !== 'default' ? findCanonicalRegistryKey(ws, reg) : undefined
    const defaultHasPath = reg?.['default']?.path !== undefined && reg['default'].path.trim() !== ''
    const effectiveTarget =
        canonicalWs ?? (ws === 'default' && defaultHasPath ? 'default' : undefined)

    if (effectiveTarget !== undefined) {
        const entryPath = reg?.[effectiveTarget]?.path
        if (entryPath !== undefined && entryPath.trim() !== '') {
            return resolveGitHubRepo(
                context.github,
                context.briefingConfig,
                effectiveTarget,
                context.runtime
            )
        }
        return {
            data: {
                error: 'GitHub integration not available',
                hint: `Workspace '${effectiveTarget}' does not have a registered repository path.`,
            },
            annotations: { lastModified },
        }
    }
    const configuredDefault =
        context.briefingConfig?.defaultWorkspaceId?.trim().toLowerCase() === 'default'
    if (hasRegistry || configuredDefault || (ws !== 'default' && ws !== '*')) {
        return {
            data: {
                error: 'GitHub integration not available',
                hint: `Workspace '${ws}' does not have a registered repository path.`,
            },
            annotations: { lastModified },
        }
    }
    return resolveGitHubRepo(context.github, context.briefingConfig, undefined, context.runtime)
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
    /** Number of recent commits to include in git history (default: 3) */
    commitCount: number
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
    /** Default workspace ID for isolating journal entries */
    defaultWorkspaceId?: string
    /** Project registry mapping dynamic repo IDs to local paths and kanban boards */
    projectRegistry?: Record<string, ProjectRegistryEntry>

    /** Allowlisted directory roots for strict filesystem jailing of agent read access */
    allowedIoRoots?: string[]
    /** Minimum significance score for entries to be included in the briefing (default: 0.3) */
    briefingImportanceThreshold?: number
}

/** Default briefing configuration — preserves pre-existing behavior */
export const DEFAULT_BRIEFING_CONFIG: BriefingConfig = {
    commitCount: 3,
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
    briefingImportanceThreshold: 0.3,
}

/**
 * Resolve the workspace a resource/prompt read should scope to.
 * Priority: configured non-`default` workspace > configured project number (unless the
 * configured workspace is `default`) > session workspace > session project > registered cwd
 * > `default`.
 * [INVARIANT] A configured `defaultWorkspaceId: 'default'` must not short-circuit session
 * context (H1); session is consulted before cwd.
 */
export function resourceWorkspace(context: {
    briefingConfig?: Partial<BriefingConfig>
    runtime?: ServerRuntime | object | null
}): string {
    const cfg = context.briefingConfig
    const id = cfg?.defaultWorkspaceId
    if (id !== undefined && id.length > 0 && id.toLowerCase() !== 'default') {
        return id
    }
    // [INTENT] A configured `default` is never rewritten from the configured project or cwd,
    // but an active session still wins over it.
    const configuredDefault = id?.toLowerCase() === 'default'
    const sessionCtx = getActiveSessionProject(context.runtime)
    const registry = cfg?.projectRegistry ?? loadProjectRegistryFromConfig()
    const uniqueFor = (projNum: number | undefined): string | undefined =>
        projNum !== undefined && registry !== undefined
            ? uniqueWorkspaceForProject(projNum, registry)
            : undefined

    const byConfiguredProject = configuredDefault ? undefined : uniqueFor(cfg?.defaultProjectNumber)
    if (byConfiguredProject !== undefined) return byConfiguredProject
    if (sessionCtx.workspaceId !== undefined && sessionCtx.workspaceId.length > 0) {
        return sessionCtx.workspaceId
    }
    const bySessionProject = uniqueFor(sessionCtx.projectNumber)
    if (bySessionProject !== undefined) return bySessionProject
    if (
        !configuredDefault &&
        registry !== undefined &&
        process.env['NODE_ENV'] !== 'test' &&
        process.env['VITEST'] !== 'true'
    ) {
        const byCwd = uniqueFor(resolveProjectNumberFromPath(process.cwd(), registry))
        if (byCwd !== undefined) return byCwd
    }
    return 'default'
}

export interface ResourceContext {
    db: IDatabaseAdapter
    teamDb?: IDatabaseAdapter
    vectorManager?: VectorSearchManager
    filterConfig?: ToolFilterConfig | null
    github?: GitHubIntegration | null
    scheduler?: Scheduler | null
    briefingConfig?: BriefingConfig
    runtime?: ServerRuntime
    resourceCount?: number
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
        requiresAuditScope?: boolean
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

/**
 * Extract base URI without query parameters or fragments for matching.
 */
export function getBaseUri(uri: string): string {
    // Handle memory:// URIs specially since URL parser treats the path as host
    if (uri.startsWith('memory://')) {
        const withoutScheme = uri.slice('memory://'.length)
        const queryIndex = withoutScheme.indexOf('?')
        const hashIndex = withoutScheme.indexOf('#')

        // Find first delimiter (query or hash)
        let endIndex = withoutScheme.length
        if (queryIndex !== -1 && queryIndex < endIndex) endIndex = queryIndex
        if (hashIndex !== -1 && hashIndex < endIndex) endIndex = hashIndex

        return 'memory://' + withoutScheme.slice(0, endIndex)
    }

    // Fallback for other URI schemes
    try {
        const url = new URL(uri)
        return `${url.protocol}//${url.host}${url.pathname}`
    } catch {
        // Invalid URL, return original
        return uri
    }
}
