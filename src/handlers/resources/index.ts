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
import { generateInstructions, type InstructionLevel } from '../../constants/ServerInstructions.js';
import { getPrompts } from '../prompts/index.js';

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
 * Resource handler result with optional annotations for MCP 2025-11-25
 */
export interface ResourceResult {
    data: unknown;
    annotations?: {
        lastModified?: string;  // ISO 8601 timestamp
    };
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
        lastModified?: string;  // ISO 8601 timestamp - can be static or dynamic
        autoRead?: boolean;     // Hint: clients should auto-fetch this resource at session start
        sessionInit?: boolean;  // Hint: this resource provides session initialization context
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
 * Check if a result is a ResourceResult with annotations
 */
function isResourceResult(result: unknown): result is ResourceResult {
    return (
        result !== null &&
        typeof result === 'object' &&
        'data' in result &&
        (result as Record<string, unknown>)['data'] !== undefined
    );
}

/**
 * Extract base URI without query parameters for matching
 */
function getBaseUri(uri: string): string {
    // Handle memory:// URIs specially since URL parser treats the path as host
    if (uri.startsWith('memory://')) {
        const withoutScheme = uri.slice('memory://'.length);
        const queryIndex = withoutScheme.indexOf('?');
        const hashIndex = withoutScheme.indexOf('#');

        // Find first delimiter (query or hash)
        let endIndex = withoutScheme.length;
        if (queryIndex !== -1 && queryIndex < endIndex) endIndex = queryIndex;
        if (hashIndex !== -1 && hashIndex < endIndex) endIndex = hashIndex;

        return 'memory://' + withoutScheme.slice(0, endIndex);
    }

    // Fallback for other URI schemes
    try {
        const url = new URL(uri);
        return `${url.protocol}//${url.host}${url.pathname}`;
    } catch {
        // Invalid URL, return original
        return uri;
    }
}

/**
 * Read a resource by URI - returns data and optional annotations
 */
export async function readResource(
    uri: string,
    db: SqliteAdapter,
    vectorManager?: VectorSearchManager,
    filterConfig?: ToolFilterConfig | null,
    github?: GitHubIntegration | null
): Promise<{ data: unknown; annotations?: { lastModified?: string } }> {
    const resources = getAllResourceDefinitions();
    const context: ResourceContext = { db, vectorManager, filterConfig, github };

    // Strip query parameters for matching, but pass full URI to handler
    const baseUri = getBaseUri(uri);

    // Check for exact match first (using base URI without query params)
    const exactMatch = resources.find(r => r.uri === baseUri);
    if (exactMatch) {
        // Pass full URI (with query params) to handler so it can parse them
        const result = await Promise.resolve(exactMatch.handler(uri, context));
        if (isResourceResult(result)) {
            return { data: result.data, annotations: result.annotations };
        }
        return { data: result };
    }

    // Check for template matches (also use base URI)
    for (const resource of resources) {
        if (resource.uri.includes('{')) {
            const pattern = resource.uri.replace(/\{[^}]+\}/g, '([^/]+)');
            const regex = new RegExp(`^${pattern}$`);
            if (regex.test(baseUri)) {
                const result = await Promise.resolve(resource.handler(uri, context));
                if (isResourceResult(result)) {
                    return { data: result.data, annotations: result.annotations };
                }
                return { data: result };
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
    return 31; // 6 core + 4 search + 2 analytics + 2 relationships + 1 export + 4 admin + 9 github + 3 backup
}

/**
 * Transform snake_case SQL row to camelCase entry object
 * Ensures consistency with SqliteAdapter.getRecentEntries() output
 */
function transformEntryRow(row: Record<string, unknown>): Record<string, unknown> {
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
    };
}

/**
 * Get all resource definitions
 */
function getAllResourceDefinitions(): InternalResourceDef[] {
    return [
        // Session initialization resource - highest priority, auto-subscribe hint for session start
        {
            uri: 'memory://briefing',
            name: 'Initial Briefing',
            title: 'Session Initialization Context',
            description: 'AUTO-READ AT SESSION START: Project context for AI agents (~300 tokens). Contains userMessage to show user.',
            mimeType: 'application/json',
            annotations: {
                audience: ['assistant'],
                priority: 1.0,  // Highest priority - should be read first
                // Custom hints for clients that support auto-subscribe behavior
                autoRead: true,  // Hint: automatically fetch this resource at session start
                sessionInit: true,  // Hint: this resource is specifically for session initialization
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
                            // Get CI status (based on latest run only)
                            let ciStatus: 'passing' | 'failing' | 'pending' | 'unknown' = 'unknown';
                            try {
                                const runs = await context.github.getWorkflowRuns(owner, repo, 1);
                                if (runs.length > 0) {
                                    const latestRun = runs[0];
                                    if (!latestRun) {
                                        ciStatus = 'unknown';
                                    } else if (latestRun.status !== 'completed') {
                                        ciStatus = 'pending';
                                    } else if (latestRun.conclusion === 'failure') {
                                        ciStatus = 'failing';
                                    } else if (latestRun.conclusion === 'success') {
                                        ciStatus = 'passing';
                                    }
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

                // Determine lastModified from most recent entry or current time
                const lastModified = recentEntries[0]?.timestamp ?? new Date().toISOString();

                // Build acknowledgment message for user
                const repoName = github?.repo ?? 'local';
                const branchName = github?.branch ?? 'unknown';
                const ciStatus = github?.ci ?? 'unknown';
                const latestPreview = latestEntries[0]
                    ? `#${latestEntries[0].id} (${latestEntries[0].type}): ${latestEntries[0].preview}`
                    : 'No entries yet';

                return {
                    data: {
                        version: '3.1.5',
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
                        templateResources: [
                            'memory://projects/{number}/timeline',
                            'memory://issues/{issue_number}/entries',
                            'memory://prs/{pr_number}/entries',
                            'memory://prs/{pr_number}/timeline',
                            'memory://kanban/{project_number}',
                            'memory://kanban/{project_number}/diagram',
                        ],
                        more: {
                            fullHealth: 'memory://health',
                            allRecent: 'memory://recent',
                            githubStatus: 'memory://github/status',
                            contextBundle: 'get-context-bundle prompt',
                        },
                        // IMPORTANT: Agent should relay this message to the user
                        userMessage: `📋 **Session Context Loaded**
| Context | Value |
|---------|-------|
| **Project** | ${repoName} |
| **Branch** | ${branchName} |
| **CI Status** | ${ciStatus} |
| **Journal** | ${totalEntries} entries |
| **Latest** | ${latestPreview} |

I have project memory access and will create entries for significant work.`,
                        // Note for clients that don't auto-inject ServerInstructions
                        clientNote: 'If prompts unavailable or Dynamic Context Management behaviors missing, read memory://instructions for full guidance.',
                    },
                    annotations: { lastModified },
                } satisfies ResourceResult;
            },
        },
        // Server instructions resource - for clients that don't auto-inject ServerInstructions
        {
            uri: 'memory://instructions',
            name: 'Server Instructions',
            title: 'Full Server Behavioral Guidance',
            description: 'Full server instructions for AI agents. Append ?level=essential|standard|full to control detail level.',
            mimeType: 'text/markdown',
            annotations: {
                audience: ['assistant'],
                priority: 0.95,  // High priority, but below briefing
            },
            handler: (uri: string, context: ResourceContext): ResourceResult => {
                // Parse level from query string (default: standard)
                let level: InstructionLevel = 'standard';
                try {
                    // Parse query params from memory:// URI
                    const queryIndex = uri.indexOf('?');
                    if (queryIndex !== -1) {
                        const queryString = uri.slice(queryIndex + 1);
                        const params = new URLSearchParams(queryString);
                        const levelParam = params.get('level');
                        if (levelParam === 'essential' || levelParam === 'standard' || levelParam === 'full') {
                            level = levelParam;
                        }
                    }
                } catch {
                    // Invalid URL, use default level
                }

                // Get enabled tools from filter config or all tools
                const enabledTools = context.filterConfig?.enabledTools ?? new Set<string>();

                // Get prompts for instruction generation
                const prompts = getPrompts().map(p => {
                    const prompt = p as { name: string; description?: string };
                    return { name: prompt.name, description: prompt.description };
                });

                // Get resources for instruction generation (simplified)
                const resources = getResources().map(r => {
                    const res = r as { uri: string; name: string; description?: string };
                    return { uri: res.uri, name: res.name, description: res.description };
                });

                // Generate instructions at requested level
                const instructions = generateInstructions(
                    enabledTools.size > 0 ? enabledTools : new Set(['create_entry', 'search_entries', 'get_recent_entries']),
                    resources,
                    prompts,
                    undefined,  // No latest entry needed for instructions
                    level
                );

                return {
                    data: instructions,
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
            handler: (_uri: string, context: ResourceContext): ResourceResult => {
                const entries = context.db.getRecentEntries(10);
                const lastModified = entries[0]?.timestamp ?? new Date().toISOString();
                return {
                    data: { entries, count: entries.length },
                    annotations: { lastModified },
                };
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
                const entries = rows.map(transformEntryRow);
                return { entries, count: entries.length };
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

                const rows = execQuery(context.db, `
                    SELECT * FROM memory_journal 
                    WHERE project_number = ? 
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                    LIMIT 50
                `, [projectNumber]);
                const entries = rows.map(transformEntryRow);
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

                const rows = execQuery(context.db, `
                    SELECT * FROM memory_journal 
                    WHERE issue_number = ? 
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                `, [issueNumber]);
                const entries = rows.map(transformEntryRow);
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

                const rows = execQuery(context.db, `
                    SELECT * FROM memory_journal 
                    WHERE pr_number = ? 
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                `, [prNumber]);
                const entries = rows.map(transformEntryRow);
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

                const rows = execQuery(context.db, `
                    SELECT * FROM memory_journal 
                    WHERE pr_number = ? 
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                `, [prNumber]);
                const entries = rows.map(transformEntryRow);
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
            handler: async (_uri: string, context: ResourceContext) => {
                // If GitHub integration is available, synthesize entries from recent workflow runs
                if (context.github) {
                    try {
                        const repoInfo = await context.github.getRepoInfo();
                        if (repoInfo.owner && repoInfo.repo) {
                            const runs = await context.github.getWorkflowRuns(repoInfo.owner, repoInfo.repo, 10);

                            // Return virtual entries synthesized from workflow runs
                            const entries = runs.map(run => ({
                                id: -1 * run.id, // Virtual ID (negative to distinguish from DB)
                                entryType: 'tool_output',
                                content: `Workflow: ${run.name}\nStatus: ${run.status}\nConclusion: ${run.conclusion || 'pending'}\nBranch: ${run.headBranch}\nURL: ${run.url}`,
                                timestamp: run.createdAt,
                                isPersonal: false,
                                significanceType: null,
                                workflowRunId: run.id,
                                workflowName: run.name,
                                workflowStatus: run.conclusion || run.status,
                            }));

                            return { entries, count: entries.length, source: 'github_api' };
                        }
                    } catch {
                        // Fallback to DB if GitHub fails
                    }
                }

                const rows = execQuery(context.db, `
                    SELECT * FROM memory_journal 
                    WHERE workflow_run_id IS NOT NULL 
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                    LIMIT 10
                `);
                const entries = rows.map(transformEntryRow);
                return { entries, count: entries.length, source: 'database' };
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
            handler: async (_uri: string, context: ResourceContext): Promise<ResourceResult> => {
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

                const lastModified = new Date().toISOString();

                return {
                    data: {
                        ...dbHealth,
                        vectorIndex,
                        toolFilter,
                        timestamp: lastModified,
                    },
                    annotations: { lastModified },
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
            handler: async (_uri: string, context: ResourceContext): Promise<ResourceResult> => {
                const lastModified = new Date().toISOString();

                if (!context.github) {
                    return {
                        data: {
                            error: 'GitHub integration not available',
                            hint: 'Set GITHUB_TOKEN and GITHUB_REPO_PATH environment variables.',
                        },
                        annotations: { lastModified },
                    };
                }

                const repoInfo = await context.github.getRepoInfo();
                const owner = repoInfo.owner;
                const repo = repoInfo.repo;

                if (!owner || !repo) {
                    return {
                        data: {
                            error: 'Could not detect repository',
                            hint: 'Set GITHUB_REPO_PATH to your git repository.',
                            branch: repoInfo.branch,
                        },
                        annotations: { lastModified },
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
                // Get CI status from latest workflow run (matches briefing logic)
                const workflowRuns = await context.github.getWorkflowRuns(owner, repo, 5);
                let ciStatus: 'passing' | 'failing' | 'pending' | 'unknown' = 'unknown';
                let latestRun: { name: string; conclusion: string | null; headSha: string } | null = null;

                if (workflowRuns.length > 0) {
                    // Find the latest completed run for accurate CI status
                    const latestCompleted = workflowRuns.find(r => r.status === 'completed');
                    const latest = workflowRuns[0];

                    latestRun = {
                        name: latest?.name ?? 'Unknown',
                        conclusion: latest?.conclusion ?? null,
                        headSha: latest?.headSha?.slice(0, 7) ?? '',
                    };

                    // CI status based on latest completed run (consistent with briefing)
                    if (latestCompleted) {
                        if (latestCompleted.conclusion === 'failure') ciStatus = 'failing';
                        else if (latestCompleted.conclusion === 'success') ciStatus = 'passing';
                    } else if (workflowRuns.some(r => r.status !== 'completed')) {
                        ciStatus = 'pending';
                    }
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
                    data: {
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
                    },
                    annotations: { lastModified },
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
