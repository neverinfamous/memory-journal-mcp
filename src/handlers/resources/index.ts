/**
 * Memory Journal MCP Server - Resource Handlers
 * 
 * Exports all MCP resources with annotations following MCP 2025-11-25 spec.
 */

import type { SqliteAdapter } from '../../database/SqliteAdapter.js';
import type { VectorSearchManager } from '../../vector/VectorSearchManager.js';
import type { ToolFilterConfig } from '../../filtering/ToolFilter.js';
import type { Tag } from '../../types/index.js';
import type { GitHubIntegration } from '../../github/GitHubIntegration.js';

/**
 * Resource context for handlers that need extended access
 */
export interface ResourceContext {
    db: SqliteAdapter;
    vectorManager?: VectorSearchManager;
    filterConfig?: ToolFilterConfig | null;
    github?: GitHubIntegration | null;
}

/**
 * Internal resource definition with db handler
 */
interface InternalResourceDef {
    uri: string;
    name: string;
    title: string;
    description: string;
    mimeType: string;
    annotations?: {
        audience?: ('user' | 'assistant')[];
        priority?: number;
    };
    handler: (uri: string, context: ResourceContext) => unknown;
}

/**
 * Get all resource definitions for MCP list
 */
export function getResources(): object[] {
    const resources = getAllResourceDefinitions();
    return resources.map(r => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
        annotations: r.annotations,
    }));
}

/**
 * Read a resource by URI
 */
export function readResource(
    uri: string,
    db: SqliteAdapter,
    vectorManager?: VectorSearchManager,
    filterConfig?: ToolFilterConfig | null,
    github?: GitHubIntegration | null
): Promise<unknown> {
    const resources = getAllResourceDefinitions();
    const context: ResourceContext = { db, vectorManager, filterConfig, github };

    // Check for exact match first
    const exactMatch = resources.find(r => r.uri === uri);
    if (exactMatch) {
        return Promise.resolve(exactMatch.handler(uri, context));
    }

    // Check for template matches
    for (const resource of resources) {
        if (resource.uri.includes('{')) {
            const pattern = resource.uri.replace(/\{[^}]+\}/g, '([^/]+)');
            const regex = new RegExp(`^${pattern}$`);
            if (regex.test(uri)) {
                return Promise.resolve(resource.handler(uri, context));
            }
        }
    }

    throw new Error(`Unknown resource: ${uri}`);
}

/**
 * Execute a raw SQL query on the database
 */
function execQuery(db: SqliteAdapter, sql: string, params: unknown[] = []): Record<string, unknown>[] {
    const rawDb = db.getRawDb();
    const result = rawDb.exec(sql, params);
    if (result.length === 0) return [];

    const columns = result[0]?.columns ?? [];
    return (result[0]?.values ?? []).map((values: unknown[]) => {
        const obj: Record<string, unknown> = {};
        columns.forEach((col: string, i: number) => {
            obj[col] = values[i];
        });
        return obj;
    });
}

/**
 * Get total tool count for health status
 */
function getTotalToolCount(): number {
    // Import dynamically to avoid circular dependency
    return 29; // 24 original + 3 backup + 2 kanban tools
}

/**
 * Get all resource definitions
 */
function getAllResourceDefinitions(): InternalResourceDef[] {
    return [
        // Session initialization resource - highest priority, designed for token efficiency
        {
            uri: 'memory://briefing',
            name: 'Initial Briefing',
            title: 'Session Initialization Context',
            description: 'Compact context for AI session start: behaviors, latest entries, GitHub status (~300 tokens)',
            mimeType: 'application/json',
            annotations: {
                audience: ['assistant'],
                priority: 1.0,  // Highest priority - should be read first
            },
            handler: async (_uri: string, context: ResourceContext) => {
                // Get latest 3 entries (compact)
                const recentEntries = context.db.getRecentEntries(3);
                const latestEntries = recentEntries.map((e) => ({
                    id: e.id,
                    timestamp: e.timestamp,
                    type: e.entryType,
                    preview: e.content.slice(0, 80) + (e.content.length > 80 ? '...' : ''),
                }));

                // Get compact GitHub status if available
                let github: {
                    repo: string | null;
                    branch: string | null;
                    ci: 'passing' | 'failing' | 'pending' | 'unknown';
                    openIssues: number;
                    openPRs: number;
                } | null = null;

                if (context.github) {
                    try {
                        const repoInfo = await context.github.getRepoInfo();
                        const owner = repoInfo.owner;
                        const repo = repoInfo.repo;

                        if (owner && repo) {
                            // Get CI status
                            let ciStatus: 'passing' | 'failing' | 'pending' | 'unknown' = 'unknown';
                            try {
                                const runs = await context.github.getWorkflowRuns(owner, repo, 3);
                                if (runs.length > 0) {
                                    const hasFailure = runs.some(r => r.conclusion === 'failure');
                                    const hasPending = runs.some(r => r.status !== 'completed');
                                    if (hasPending) ciStatus = 'pending';
                                    else if (hasFailure) ciStatus = 'failing';
                                    else ciStatus = 'passing';
                                }
                            } catch {
                                // CI status unavailable
                            }

                            // Get issue/PR counts
                            let openIssues = 0;
                            let openPRs = 0;
                            try {
                                const issues = await context.github.getIssues(owner, repo, 'open', 1);
                                openIssues = issues.length > 0 ? issues.length : 0;
                                const prs = await context.github.getPullRequests(owner, repo, 'open', 1);
                                openPRs = prs.length > 0 ? prs.length : 0;
                            } catch {
                                // Counts unavailable
                            }

                            github = {
                                repo: `${owner}/${repo}`,
                                branch: repoInfo.branch ?? null,
                                ci: ciStatus,
                                openIssues,
                                openPRs,
                            };
                        }
                    } catch {
                        // GitHub unavailable
                    }
                }

                // Get entry count for context
                const stats = context.db.getStatistics('week');
                const totalEntries = stats.totalEntries ?? 0;

                return {
                    version: '3.1.6',
                    serverTime: new Date().toISOString(),
                    journal: {
                        totalEntries,
                        latestEntries,
                    },
                    github,
                    behaviors: {
                        create: 'implementations, decisions, bug-fixes, milestones',
                        search: 'before decisions, referencing prior work',
                        link: 'implementation→spec, bugfix→issue',
                    },
                    more: {
                        fullHealth: 'memory://health',
                        allRecent: 'memory://recent',
                        githubStatus: 'memory://github/status',
                        contextBundle: 'get-context-bundle prompt',
                    },
                };
            },
        },
        {
            uri: 'memory://recent',
            name: 'Recent Entries',
            title: 'Recent Journal Entries',
            description: '10 most recent journal entries',
            mimeType: 'application/json',
            annotations: {
                audience: ['assistant'],
                priority: 0.8,
            },
            handler: (_uri: string, context: ResourceContext) => {
                const entries = context.db.getRecentEntries(10);
                return { entries, count: entries.length };
            },
        },
        {
            uri: 'memory://significant',
            name: 'Significant Entries',
            title: 'Significant Milestones',
            description: 'Significant milestones and breakthroughs',
            mimeType: 'application/json',
            annotations: {
                audience: ['assistant'],
                priority: 0.7,
            },
            handler: (_uri: string, context: ResourceContext) => {
                const rows = execQuery(context.db, `
                    SELECT * FROM memory_journal 
                    WHERE significance_type IS NOT NULL 
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                    LIMIT 20
                `);
                return { entries: rows, count: rows.length };
            },
        },
        {
            uri: 'memory://graph/recent',
            name: 'Recent Relationship Graph',
            title: 'Live Mermaid Diagram',
            description: 'Live Mermaid diagram of recent relationships',
            mimeType: 'text/plain',
            annotations: {
                audience: ['user', 'assistant'],
                priority: 0.5,
            },
            handler: (_uri: string, context: ResourceContext) => {
                // Get recent relationships from database
                const relationships = execQuery(context.db, `
                    SELECT 
                        r.id, r.from_entry_id, r.to_entry_id, r.relationship_type, r.description,
                        e1.content as from_content,
                        e2.content as to_content
                    FROM relationships r
                    JOIN memory_journal e1 ON r.from_entry_id = e1.id
                    JOIN memory_journal e2 ON r.to_entry_id = e2.id
                    WHERE e1.deleted_at IS NULL AND e2.deleted_at IS NULL
                    ORDER BY r.created_at DESC
                    LIMIT 20
                `) as {
                    from_entry_id: number;
                    to_entry_id: number;
                    relationship_type: string;
                    from_content: string;
                    to_content: string;
                }[];

                if (relationships.length === 0) {
                    return {
                        format: 'mermaid',
                        diagram: 'graph TD\n  NoData[No relationships found]',
                        message: 'No entry relationships exist yet. Use link_entries tool to create relationships.',
                    };
                }

                // Build Mermaid graph
                const lines: string[] = ['graph TD'];
                const seenNodes = new Set<number>();

                // Relationship type to arrow style mapping
                const arrowStyles: Record<string, string> = {
                    'references': '-->',
                    'implements': '-.->',
                    'evolves_from': '==>',
                    'related_to': '<-->',
                    'depends_on': '-->',
                };

                for (const rel of relationships) {
                    // Add node definitions if not seen
                    if (!seenNodes.has(rel.from_entry_id)) {
                        const label = rel.from_content.slice(0, 30).replace(/[\]"'`[]/g, ' ').trim();
                        lines.push(`  E${String(rel.from_entry_id)}["#${String(rel.from_entry_id)}: ${label}..."]`);
                        seenNodes.add(rel.from_entry_id);
                    }
                    if (!seenNodes.has(rel.to_entry_id)) {
                        const label = rel.to_content.slice(0, 30).replace(/[\]"'`[]/g, ' ').trim();
                        lines.push(`  E${String(rel.to_entry_id)}["#${String(rel.to_entry_id)}: ${label}..."]`);
                        seenNodes.add(rel.to_entry_id);
                    }

                    // Add edge with relationship label
                    const arrow = arrowStyles[rel.relationship_type] ?? '-->';
                    lines.push(`  E${String(rel.from_entry_id)} ${arrow}|${rel.relationship_type}| E${String(rel.to_entry_id)}`);
                }

                return {
                    format: 'mermaid',
                    diagram: lines.join('\n'),
                    relationshipCount: relationships.length,
                    nodeCount: seenNodes.size,
                };
            },
        },
        {
            uri: 'memory://team/recent',
            name: 'Team Entries',
            title: 'Recent Team-Shared Entries',
            description: 'Recent team-shared entries',
            mimeType: 'application/json',
            annotations: {
                audience: ['assistant'],
                priority: 0.6,
            },
            handler: (_uri: string, context: ResourceContext) => {
                const entries = context.db.getRecentEntries(10, false);
                return { entries, count: entries.length };
            },
        },
        {
            uri: 'memory://projects/{number}/timeline',
            name: 'Project Timeline',
            title: 'Project Activity Timeline',
            description: 'Project activity timeline',
            mimeType: 'application/json',
            annotations: {
                audience: ['assistant'],
                priority: 0.6,
            },
            handler: (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/projects\/(\d+)\/timeline/.exec(uri);
                const projectNumber = match?.[1] ? parseInt(match[1], 10) : null;

                if (projectNumber === null) {
                    return { error: 'Invalid project number' };
                }

                const entries = execQuery(context.db, `
                    SELECT * FROM memory_journal 
                    WHERE project_number = ? 
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                    LIMIT 50
                `, [projectNumber]);
                return { projectNumber, entries, count: entries.length };
            },
        },
        {
            uri: 'memory://issues/{issue_number}/entries',
            name: 'Issue Entries',
            title: 'Entries Linked to Issue',
            description: 'All entries linked to a specific issue',
            mimeType: 'application/json',
            annotations: {
                audience: ['assistant'],
                priority: 0.6,
            },
            handler: (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/issues\/(\d+)\/entries/.exec(uri);
                const issueNumber = match?.[1] ? parseInt(match[1], 10) : null;

                if (issueNumber === null) {
                    return { error: 'Invalid issue number' };
                }

                const entries = execQuery(context.db, `
                    SELECT * FROM memory_journal 
                    WHERE issue_number = ? 
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                `, [issueNumber]);
                return { issueNumber, entries, count: entries.length };
            },
        },
        {
            uri: 'memory://prs/{pr_number}/entries',
            name: 'PR Entries',
            title: 'Entries Linked to PR',
            description: 'All entries linked to a specific pull request',
            mimeType: 'application/json',
            annotations: {
                audience: ['assistant'],
                priority: 0.6,
            },
            handler: (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/prs\/(\d+)\/entries/.exec(uri);
                const prNumber = match?.[1] ? parseInt(match[1], 10) : null;

                if (prNumber === null) {
                    return { error: 'Invalid PR number' };
                }

                const entries = execQuery(context.db, `
                    SELECT * FROM memory_journal 
                    WHERE pr_number = ? 
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                `, [prNumber]);
                return { prNumber, entries, count: entries.length };
            },
        },
        {
            uri: 'memory://prs/{pr_number}/timeline',
            name: 'PR Timeline',
            title: 'Combined PR and Journal Timeline',
            description: 'Combined PR + journal timeline',
            mimeType: 'application/json',
            annotations: {
                audience: ['assistant'],
                priority: 0.5,
            },
            handler: (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/prs\/(\d+)\/timeline/.exec(uri);
                const prNumber = match?.[1] ? parseInt(match[1], 10) : null;

                if (prNumber === null) {
                    return { error: 'Invalid PR number' };
                }

                const entries = execQuery(context.db, `
                    SELECT * FROM memory_journal 
                    WHERE pr_number = ? 
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                `, [prNumber]);
                return { prNumber, entries, count: entries.length };
            },
        },
        {
            uri: 'memory://graph/actions',
            name: 'Actions Graph',
            title: 'CI/CD Narrative Graph',
            description: 'CI/CD narrative graph: commits → runs → failures → entries → fixes → deployments',
            mimeType: 'text/plain',
            annotations: {
                audience: ['user', 'assistant'],
                priority: 0.5,
            },
            handler: async (_uri: string, context: ResourceContext) => {
                // Check if GitHub integration is available
                if (!context.github) {
                    return {
                        format: 'mermaid',
                        diagram: 'graph LR\n  NoGitHub[GitHub integration not available]',
                        message: 'GitHub integration not configured. Set GITHUB_TOKEN and GITHUB_REPO_PATH.',
                    };
                }

                // Get repository info and workflow runs
                const repoInfo = await context.github.getRepoInfo();
                if (!repoInfo.owner || !repoInfo.repo) {
                    return {
                        format: 'mermaid',
                        diagram: 'graph LR\n  NoRepo[Repository not detected]',
                        message: 'Could not detect repository. Set GITHUB_REPO_PATH in your config.',
                    };
                }

                const workflowRuns = await context.github.getWorkflowRuns(repoInfo.owner, repoInfo.repo, 10);

                if (workflowRuns.length === 0) {
                    return {
                        format: 'mermaid',
                        diagram: 'graph LR\n  NoRuns[No workflow runs found]',
                        message: 'No GitHub Actions workflow runs found for this repository.',
                    };
                }

                // Build Mermaid graph showing workflow runs
                const lines: string[] = ['graph LR'];

                // Status to styling map
                const statusStyles: Record<string, string> = {
                    'success': ':::success',
                    'failure': ':::failure',
                    'cancelled': ':::cancelled',
                    'skipped': ':::skipped',
                };

                // Add style definitions
                lines.push('  classDef success fill:#28a745,color:#fff');
                lines.push('  classDef failure fill:#dc3545,color:#fff');
                lines.push('  classDef cancelled fill:#6c757d,color:#fff');
                lines.push('  classDef skipped fill:#ffc107,color:#000');

                for (const run of workflowRuns) {
                    const shortSha = run.headSha.slice(0, 7);
                    const nodeId = `R${String(run.id)}`;
                    const commitId = `C${shortSha}`;
                    const style = statusStyles[run.conclusion ?? 'skipped'] ?? '';
                    const statusIcon = run.conclusion === 'success' ? '✓' : run.conclusion === 'failure' ? '✗' : '○';

                    // Add commit and run nodes
                    lines.push(`  ${commitId}["${shortSha}"]`);
                    lines.push(`  ${nodeId}["${statusIcon} ${run.name}"]${style}`);
                    lines.push(`  ${commitId} --> ${nodeId}`);
                }

                return {
                    format: 'mermaid',
                    diagram: lines.join('\n'),
                    workflowRunCount: workflowRuns.length,
                    repository: `${repoInfo.owner}/${repoInfo.repo}`,
                };
            },
        },
        {
            uri: 'memory://actions/recent',
            name: 'Recent Actions',
            title: 'Recent Workflow Runs',
            description: 'Recent workflow runs with CI status',
            mimeType: 'application/json',
            annotations: {
                audience: ['assistant'],
                priority: 0.5,
            },
            handler: (_uri: string, context: ResourceContext) => {
                const entries = execQuery(context.db, `
                    SELECT * FROM memory_journal 
                    WHERE workflow_run_id IS NOT NULL 
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                    LIMIT 10
                `);
                return { entries, count: entries.length };
            },
        },
        {
            uri: 'memory://tags',
            name: 'All Tags',
            title: 'Tag List',
            description: 'All available tags with usage counts',
            mimeType: 'application/json',
            annotations: {
                audience: ['assistant'],
                priority: 0.4,
            },
            handler: (_uri: string, context: ResourceContext) => {
                const tags: Tag[] = context.db.listTags();
                return { tags, count: tags.length };
            },
        },
        {
            uri: 'memory://statistics',
            name: 'Statistics',
            title: 'Journal Statistics',
            description: 'Overall journal statistics',
            mimeType: 'application/json',
            annotations: {
                audience: ['assistant'],
                priority: 0.4,
            },
            handler: (_uri: string, context: ResourceContext) => {
                return context.db.getStatistics('week');
            },
        },
        {
            uri: 'memory://health',
            name: 'Server Health',
            title: 'Server Health & Diagnostics',
            description: 'Server health status including database, backups, vector index, and tool filter status',
            mimeType: 'application/json',
            annotations: {
                audience: ['assistant'],
                priority: 0.9,
            },
            handler: async (_uri: string, context: ResourceContext) => {
                const dbHealth = context.db.getHealthStatus();

                // Get vector index status if available
                let vectorIndex: { available: boolean; indexedEntries: number; modelName: string | null } | null = null;
                if (context.vectorManager) {
                    try {
                        const stats = await context.vectorManager.getStats();
                        vectorIndex = {
                            available: true,
                            indexedEntries: stats.itemCount,
                            modelName: stats.modelName,
                        };
                    } catch {
                        vectorIndex = { available: false, indexedEntries: 0, modelName: null };
                    }
                }

                // Get tool filter status
                const totalTools = getTotalToolCount();
                const toolFilter = {
                    active: context.filterConfig !== null && context.filterConfig !== undefined,
                    enabledCount: context.filterConfig?.enabledTools.size ?? totalTools,
                    totalCount: totalTools,
                    filterString: context.filterConfig?.raw ?? null,
                };

                return {
                    ...dbHealth,
                    vectorIndex,
                    toolFilter,
                    timestamp: new Date().toISOString(),
                };
            },
        },
        // GitHub status resource - compact overview with progressive disclosure
        {
            uri: 'memory://github/status',
            name: 'GitHub Status',
            title: 'GitHub Repository Status',
            description: 'Compact GitHub status: repository, branch, CI, issues, PRs, Kanban summary',
            mimeType: 'application/json',
            annotations: {
                audience: ['assistant'],
                priority: 0.7,
            },
            handler: async (_uri: string, context: ResourceContext) => {
                if (!context.github) {
                    return {
                        error: 'GitHub integration not available',
                        hint: 'Set GITHUB_TOKEN and GITHUB_REPO_PATH environment variables.',
                    };
                }

                const repoInfo = await context.github.getRepoInfo();
                const owner = repoInfo.owner;
                const repo = repoInfo.repo;

                if (!owner || !repo) {
                    return {
                        error: 'Could not detect repository',
                        hint: 'Set GITHUB_REPO_PATH to your git repository.',
                        branch: repoInfo.branch,
                    };
                }

                // Get current commit
                let commit: string | null = null;
                try {
                    const repoContext = await context.github.getRepoContext();
                    commit = repoContext.commit;
                } catch {
                    // Ignore
                }

                // Get open issues (limited for token efficiency)
                const issues = await context.github.getIssues(owner, repo, 'open', 5);
                const openIssues = issues.map(i => ({ number: i.number, title: i.title.slice(0, 50) }));

                // Get open PRs (limited for token efficiency)
                const prs = await context.github.getPullRequests(owner, repo, 'open', 5);
                const openPrs = prs.map(pr => ({ number: pr.number, title: pr.title.slice(0, 50), state: pr.state }));

                // Get CI status from workflow runs
                const workflowRuns = await context.github.getWorkflowRuns(owner, repo, 5);
                let ciStatus: 'passing' | 'failing' | 'pending' | 'unknown' = 'unknown';
                let latestRun: { name: string; conclusion: string | null; headSha: string } | null = null;

                if (workflowRuns.length > 0) {
                    const latest = workflowRuns[0];
                    latestRun = {
                        name: latest?.name ?? 'Unknown',
                        conclusion: latest?.conclusion ?? null,
                        headSha: latest?.headSha?.slice(0, 7) ?? '',
                    };
                    // Compute CI status from recent runs
                    const hasFailure = workflowRuns.some(r => r.conclusion === 'failure');
                    const hasPending = workflowRuns.some(r => r.status !== 'completed');
                    const hasSuccess = workflowRuns.some(r => r.conclusion === 'success');

                    if (hasPending) ciStatus = 'pending';
                    else if (hasFailure) ciStatus = 'failing';
                    else if (hasSuccess) ciStatus = 'passing';
                }

                // Get Kanban summary if project 1 exists (common default)
                let kanbanSummary: Record<string, number> | null = null;
                try {
                    const kanban = await context.github.getProjectKanban(owner, 1, repo);
                    if (kanban) {
                        kanbanSummary = {};
                        for (const col of kanban.columns) {
                            kanbanSummary[col.status] = col.items.length;
                        }
                    }
                } catch {
                    // Kanban not available
                }

                return {
                    repository: `${owner}/${repo}`,
                    branch: repoInfo.branch,
                    commit: commit?.slice(0, 7) ?? null,
                    ci: {
                        status: ciStatus,
                        latestRun,
                    },
                    issues: {
                        openCount: issues.length,
                        items: openIssues,
                    },
                    pullRequests: {
                        openCount: prs.length,
                        items: openPrs,
                    },
                    kanbanSummary,
                };
            },
        },
        // Kanban board resources (GitHub Projects v2)
        {
            uri: 'memory://kanban/{project_number}',
            name: 'Kanban Board',
            title: 'GitHub Project Kanban Board',
            description: 'View a GitHub Project v2 as a Kanban board with items grouped by Status',
            mimeType: 'application/json',
            annotations: {
                audience: ['assistant'],
                priority: 0.6,
            },
            handler: async (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/kanban\/(\d+)/.exec(uri);
                const projectNumber = match?.[1] ? parseInt(match[1], 10) : null;

                if (projectNumber === null) {
                    return { error: 'Invalid project number' };
                }

                if (!context.github) {
                    return {
                        error: 'GitHub integration not available',
                        hint: 'Set GITHUB_TOKEN and GITHUB_REPO_PATH environment variables.',
                    };
                }

                const repoInfo = await context.github.getRepoInfo();
                const owner = repoInfo.owner;
                const repo = repoInfo.repo ?? undefined;

                if (!owner) {
                    return {
                        error: 'Could not detect repository owner',
                        hint: 'Set GITHUB_REPO_PATH to your git repository.',
                    };
                }

                const board = await context.github.getProjectKanban(owner, projectNumber, repo);
                if (!board) {
                    return {
                        error: `Project #${String(projectNumber)} not found or Status field not configured`,
                        projectNumber,
                        owner,
                        hint: 'Projects can be at user, repository, or organization level.',
                    };
                }

                return board;
            },
        },
        {
            uri: 'memory://kanban/{project_number}/diagram',
            name: 'Kanban Diagram',
            title: 'Kanban Board Mermaid Diagram',
            description: 'Mermaid diagram visualization of a GitHub Project Kanban board',
            mimeType: 'text/plain',
            annotations: {
                audience: ['user', 'assistant'],
                priority: 0.5,
            },
            handler: async (uri: string, context: ResourceContext) => {
                const match = /memory:\/\/kanban\/(\d+)\/diagram/.exec(uri);
                const projectNumber = match?.[1] ? parseInt(match[1], 10) : null;

                if (projectNumber === null) {
                    return { error: 'Invalid project number' };
                }

                if (!context.github) {
                    return {
                        format: 'mermaid',
                        diagram: 'graph LR\n  NoGitHub[GitHub integration not available]',
                        message: 'Set GITHUB_TOKEN and GITHUB_REPO_PATH environment variables.',
                    };
                }

                const repoInfo = await context.github.getRepoInfo();
                const owner = repoInfo.owner;
                const repo = repoInfo.repo ?? undefined;

                if (!owner) {
                    return {
                        format: 'mermaid',
                        diagram: 'graph LR\n  NoOwner[Repository owner not detected]',
                        message: 'Set GITHUB_REPO_PATH to your git repository.',
                    };
                }

                const board = await context.github.getProjectKanban(owner, projectNumber, repo);
                if (!board) {
                    return {
                        format: 'mermaid',
                        diagram: `graph LR\n  NotFound[Project #${String(projectNumber)} not found]`,
                        message: 'Ensure the project exists and has a Status field.',
                    };
                }

                // Build Mermaid diagram with subgraphs for each column
                const lines: string[] = ['graph LR'];

                // Add style definitions
                lines.push('  classDef issue fill:#28a745,color:#fff');
                lines.push('  classDef pr fill:#6f42c1,color:#fff');
                lines.push('  classDef draft fill:#6c757d,color:#fff');

                for (const column of board.columns) {
                    const safeStatus = column.status.replace(/["\s]/g, '_');
                    lines.push(`  subgraph ${safeStatus}["${column.status} (${String(column.items.length)})"]`);

                    for (const item of column.items) {
                        const safeId = item.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8);
                        const label = item.title.slice(0, 25).replace(/["[\]]/g, "'");
                        const typeIcon = item.type === 'ISSUE' ? '🔵' : item.type === 'PULL_REQUEST' ? '🟣' : '⚪';
                        const numberStr = item.number !== undefined && item.number !== 0 ? `#${String(item.number)}` : '';
                        lines.push(`    I${safeId}["${typeIcon} ${numberStr} ${label}..."]`);

                        // Add class based on type
                        const typeClass = item.type === 'ISSUE' ? 'issue' : item.type === 'PULL_REQUEST' ? 'pr' : 'draft';
                        lines.push(`    class I${safeId} ${typeClass}`);
                    }

                    lines.push('  end');
                }

                return {
                    format: 'mermaid',
                    diagram: lines.join('\n'),
                    projectNumber,
                    projectTitle: board.projectTitle,
                    columnCount: board.columns.length,
                    totalItems: board.totalItems,
                    legend: {
                        '🔵': 'Issue',
                        '🟣': 'Pull Request',
                        '⚪': 'Draft Issue',
                    },
                };
            },
        },
    ];
}
