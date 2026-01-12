/**
 * Memory Journal MCP Server - Tool Handlers
 * 
 * Exports all MCP tools with annotations following MCP 2025-11-25 spec.
 */

import { z } from 'zod';
import type { SqliteAdapter } from '../../database/SqliteAdapter.js';
import type { ToolFilterConfig } from '../../filtering/ToolFilter.js';
import type { ToolDefinition, EntryType, SignificanceType, RelationshipType } from '../../types/index.js';
import type { VectorSearchManager } from '../../vector/VectorSearchManager.js';
import type { GitHubIntegration } from '../../github/GitHubIntegration.js';

/**
 * Tool execution context
 */
export interface ToolContext {
    db: SqliteAdapter;
    vectorManager?: VectorSearchManager;
    github?: GitHubIntegration;
}

// ============================================================================
// Zod Schemas for Input Validation
// ============================================================================

const CreateEntrySchema = z.object({
    content: z.string().min(1).max(50000),
    entry_type: z.string().optional().default('personal_reflection'),
    tags: z.array(z.string()).optional().default([]),
    is_personal: z.boolean().optional().default(true),
    significance_type: z.string().optional(),
    auto_context: z.boolean().optional().default(true),
    project_number: z.number().optional(),
    project_owner: z.string().optional(),
    issue_number: z.number().optional(),
    issue_url: z.string().optional(),
    pr_number: z.number().optional(),
    pr_url: z.string().optional(),
    pr_status: z.enum(['draft', 'open', 'merged', 'closed']).optional(),
    workflow_run_id: z.number().optional(),
    workflow_name: z.string().optional(),
    workflow_status: z.enum(['queued', 'in_progress', 'completed']).optional(),
    share_with_team: z.boolean().optional().default(false),
});

const GetEntryByIdSchema = z.object({
    entry_id: z.number(),
    include_relationships: z.boolean().optional().default(true),
});

const GetRecentEntriesSchema = z.object({
    limit: z.number().optional().default(5),
    is_personal: z.boolean().optional(),
});

const CreateEntryMinimalSchema = z.object({
    content: z.string().min(1).max(50000),
});

const TestSimpleSchema = z.object({
    message: z.string().optional().default('Hello'),
});

const SearchEntriesSchema = z.object({
    query: z.string().optional(),
    limit: z.number().optional().default(10),
    is_personal: z.boolean().optional(),
    project_number: z.number().optional(),
    issue_number: z.number().optional(),
    pr_number: z.number().optional(),
    pr_status: z.enum(['draft', 'open', 'merged', 'closed']).optional(),
    workflow_run_id: z.number().optional(),
});

const SearchByDateRangeSchema = z.object({
    start_date: z.string(),
    end_date: z.string(),
    entry_type: z.string().optional(),
    tags: z.array(z.string()).optional(),
    is_personal: z.boolean().optional(),
    project_number: z.number().optional(),
    issue_number: z.number().optional(),
    pr_number: z.number().optional(),
    workflow_run_id: z.number().optional(),
});

const SemanticSearchSchema = z.object({
    query: z.string(),
    limit: z.number().optional().default(10),
    similarity_threshold: z.number().optional().default(0.3),
    is_personal: z.boolean().optional(),
});

const GetStatisticsSchema = z.object({
    group_by: z.enum(['day', 'week', 'month']).optional().default('week'),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    project_breakdown: z.boolean().optional().default(false),
});

const LinkEntriesSchema = z.object({
    from_entry_id: z.number(),
    to_entry_id: z.number(),
    relationship_type: z.enum(['evolves_from', 'references', 'implements', 'clarifies', 'response_to']).optional().default('references'),
    description: z.string().optional(),
});

const ExportEntriesSchema = z.object({
    format: z.enum(['json', 'markdown']).optional().default('json'),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    entry_types: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
});

const UpdateEntrySchema = z.object({
    entry_id: z.number(),
    content: z.string().optional(),
    entry_type: z.string().optional(),
    is_personal: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
});

const DeleteEntrySchema = z.object({
    entry_id: z.number(),
    permanent: z.boolean().optional().default(false),
});

// ============================================================================
// Tool Definitions with MCP 2025-11-25 Annotations
// ============================================================================

/**
 * Get all tool definitions
 */
export function getTools(db: SqliteAdapter, filterConfig: ToolFilterConfig | null, vectorManager?: VectorSearchManager, github?: GitHubIntegration): object[] {
    const context: ToolContext = { db, vectorManager, github };
    const allTools = getAllToolDefinitions(context);

    // Filter if config provided
    if (filterConfig) {
        return allTools
            .filter(t => filterConfig.enabledTools.has(t.name))
            .map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
                annotations: t.annotations,
            }));
    }

    return allTools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
    }));
}

/**
 * Call a tool by name
 */
export async function callTool(
    name: string,
    args: Record<string, unknown>,
    db: SqliteAdapter,
    vectorManager?: VectorSearchManager,
    github?: GitHubIntegration
): Promise<unknown> {
    const context: ToolContext = { db, vectorManager, github };
    const tools = getAllToolDefinitions(context);
    const tool = tools.find(t => t.name === name);

    if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
    }

    return tool.handler(args);
}

/**
 * Get all tool definitions
 */
function getAllToolDefinitions(context: ToolContext): ToolDefinition[] {
    const { db, vectorManager, github } = context;
    return [
        // Core tools
        {
            name: 'create_entry',
            title: 'Create Journal Entry',
            description: 'Create a new journal entry with context and tags (v2.1.0: GitHub Actions support)',
            group: 'core',
            inputSchema: CreateEntrySchema,
            annotations: { readOnlyHint: false, idempotentHint: false },
            handler: (params: unknown) => {
                const input = CreateEntrySchema.parse(params);
                const entry = db.createEntry({
                    content: input.content,
                    entryType: input.entry_type as EntryType,
                    tags: input.tags,
                    isPersonal: input.is_personal,
                    significanceType: input.significance_type as SignificanceType ?? null,
                    projectNumber: input.project_number,
                    projectOwner: input.project_owner,
                    issueNumber: input.issue_number,
                    issueUrl: input.issue_url,
                    prNumber: input.pr_number,
                    prUrl: input.pr_url,
                    prStatus: input.pr_status,
                    workflowRunId: input.workflow_run_id,
                    workflowName: input.workflow_name,
                    workflowStatus: input.workflow_status,
                });
                return Promise.resolve({ success: true, entry });
            },
        },
        {
            name: 'get_entry_by_id',
            title: 'Get Entry by ID',
            description: 'Get a specific journal entry by ID with full details',
            group: 'core',
            inputSchema: GetEntryByIdSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                const { entry_id, include_relationships } = GetEntryByIdSchema.parse(params);
                const entry = db.getEntryById(entry_id);
                if (!entry) {
                    return Promise.resolve({ error: `Entry ${entry_id} not found` });
                }
                const result: Record<string, unknown> = { entry };
                if (include_relationships) {
                    result['relationships'] = db.getRelationships(entry_id);
                }
                return Promise.resolve(result);
            },
        },
        {
            name: 'get_recent_entries',
            title: 'Get Recent Entries',
            description: 'Get recent journal entries',
            group: 'core',
            inputSchema: GetRecentEntriesSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                const { limit, is_personal } = GetRecentEntriesSchema.parse(params);
                const entries = db.getRecentEntries(limit, is_personal);
                return Promise.resolve({ entries, count: entries.length });
            },
        },
        {
            name: 'create_entry_minimal',
            title: 'Create Entry (Minimal)',
            description: 'Minimal entry creation without context or tags',
            group: 'core',
            inputSchema: CreateEntryMinimalSchema,
            annotations: { readOnlyHint: false, idempotentHint: false },
            handler: (params: unknown) => {
                const { content } = CreateEntryMinimalSchema.parse(params);
                const entry = db.createEntry({ content });
                return Promise.resolve({ success: true, entry });
            },
        },
        {
            name: 'test_simple',
            title: 'Test Simple',
            description: 'Simple test tool that just returns a message',
            group: 'core',
            inputSchema: TestSimpleSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                const { message } = TestSimpleSchema.parse(params);
                return Promise.resolve({ message: `Test response: ${message}` });
            },
        },
        // Search tools
        {
            name: 'search_entries',
            title: 'Search Entries',
            description: 'Search journal entries with optional filters for GitHub Projects, Issues, PRs, and Actions',
            group: 'search',
            inputSchema: SearchEntriesSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                const input = SearchEntriesSchema.parse(params);
                if (!input.query) {
                    const entries = db.getRecentEntries(input.limit, input.is_personal);
                    return Promise.resolve({ entries, count: entries.length });
                }
                const entries = db.searchEntries(input.query, {
                    limit: input.limit,
                    isPersonal: input.is_personal,
                    projectNumber: input.project_number,
                    issueNumber: input.issue_number,
                    prNumber: input.pr_number,
                });
                return Promise.resolve({ entries, count: entries.length });
            },
        },
        {
            name: 'search_by_date_range',
            title: 'Search by Date Range',
            description: 'Search journal entries within a date range with optional filters',
            group: 'search',
            inputSchema: SearchByDateRangeSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                const input = SearchByDateRangeSchema.parse(params);
                const entries = db.searchByDateRange(input.start_date, input.end_date, {
                    entryType: input.entry_type as EntryType | undefined,
                    tags: input.tags,
                    isPersonal: input.is_personal,
                    projectNumber: input.project_number,
                });
                return Promise.resolve({ entries, count: entries.length });
            },
        },
        {
            name: 'semantic_search',
            title: 'Semantic Search',
            description: 'Perform semantic/vector search on journal entries using AI embeddings',
            group: 'search',
            inputSchema: SemanticSearchSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: async (params: unknown) => {
                const input = SemanticSearchSchema.parse(params);

                // Check if vector search is available
                if (!vectorManager) {
                    return {
                        error: 'Semantic search not initialized. Vector search manager is not available.',
                        query: input.query,
                        entries: [],
                        count: 0
                    };
                }

                // Perform semantic search
                const results = await vectorManager.search(
                    input.query,
                    input.limit ?? 10,
                    input.similarity_threshold ?? 0.3
                );

                // Fetch full entries for matching IDs
                const entries = results
                    .map(r => {
                        const entry = db.getEntryById(r.entryId);
                        if (!entry) return null;
                        return {
                            ...entry,
                            similarity: Math.round(r.score * 100) / 100
                        };
                    })
                    .filter((e): e is NonNullable<typeof e> => e !== null);

                return {
                    query: input.query,
                    entries,
                    count: entries.length,
                    ...(results.length === 0 ? { hint: 'No entries in vector index. Use rebuild_vector_index to index existing entries.' } : {})
                };
            },
        },
        // Analytics tools
        {
            name: 'get_statistics',
            title: 'Get Statistics',
            description: 'Get journal statistics and analytics (Phase 2: includes project breakdown)',
            group: 'analytics',
            inputSchema: GetStatisticsSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                const { group_by } = GetStatisticsSchema.parse(params);
                return Promise.resolve(db.getStatistics(group_by));
            },
        },
        {
            name: 'get_cross_project_insights',
            title: 'Get Cross-Project Insights',
            description: 'Analyze patterns across all GitHub Projects tracked in journal entries',
            group: 'analytics',
            inputSchema: z.object({
                start_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
                end_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
                min_entries: z.number().optional().default(3).describe('Minimum entries to include project'),
            }),
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                const input = z.object({
                    start_date: z.string().optional(),
                    end_date: z.string().optional(),
                    min_entries: z.number().optional().default(3),
                }).parse(params);

                const rawDb = db.getRawDb();

                // Build WHERE clause
                let where = 'WHERE deleted_at IS NULL AND project_number IS NOT NULL';
                const sqlParams: unknown[] = [];

                if (input.start_date) {
                    where += " AND DATE(timestamp) >= DATE(?)";
                    sqlParams.push(input.start_date);
                }
                if (input.end_date) {
                    where += " AND DATE(timestamp) <= DATE(?)";
                    sqlParams.push(input.end_date);
                }

                // Get active projects with stats
                const projectsResult = rawDb.exec(`
                    SELECT project_number, COUNT(*) as entry_count,
                           MIN(DATE(timestamp)) as first_entry,
                           MAX(DATE(timestamp)) as last_entry,
                           COUNT(DISTINCT DATE(timestamp)) as active_days
                    FROM memory_journal ${where}
                    GROUP BY project_number
                    HAVING entry_count >= ?
                    ORDER BY entry_count DESC
                `, [...sqlParams, input.min_entries]);

                if (!projectsResult[0] || projectsResult[0].values.length === 0) {
                    return Promise.resolve({
                        message: `No projects found with at least ${String(input.min_entries)} entries`,
                        projects: [],
                    });
                }

                const columns = projectsResult[0].columns;
                const projects = projectsResult[0].values.map(row => {
                    const obj: Record<string, unknown> = {};
                    columns.forEach((col, i) => { obj[col] = row[i]; });
                    return obj;
                });

                // Get top tags per project
                const projectTags: Record<number, { name: string; count: number }[]> = {};
                for (const proj of projects) {
                    const projNum = proj['project_number'] as number;
                    const tagsResult = rawDb.exec(`
                        SELECT t.name, COUNT(*) as count
                        FROM tags t
                        JOIN entry_tags et ON t.id = et.tag_id
                        JOIN memory_journal m ON et.entry_id = m.id
                        WHERE m.project_number = ? AND m.deleted_at IS NULL
                        GROUP BY t.name
                        ORDER BY count DESC
                        LIMIT 5
                    `, [projNum]);
                    if (tagsResult[0]) {
                        projectTags[projNum] = tagsResult[0].values.map(row => ({
                            name: row[0] as string,
                            count: row[1] as number,
                        }));
                    }
                }

                // Find inactive projects (last entry > 7 days ago)
                const cutoffDate = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
                const inactiveResult = rawDb.exec(`
                    SELECT project_number, MAX(DATE(timestamp)) as last_entry_date
                    FROM memory_journal
                    WHERE deleted_at IS NULL AND project_number IS NOT NULL
                    GROUP BY project_number
                    HAVING last_entry_date < ?
                `, [cutoffDate]);

                const inactiveProjects = inactiveResult[0]?.values.map(row => ({
                    project_number: row[0] as number,
                    last_entry_date: row[1] as string,
                })) ?? [];

                // Calculate time distribution
                const totalEntries = projects.reduce((sum, p) => sum + (p['entry_count'] as number), 0);
                const distribution = projects.slice(0, 5).map(p => ({
                    project_number: p['project_number'],
                    percentage: (((p['entry_count'] as number) / totalEntries) * 100).toFixed(1),
                }));

                return Promise.resolve({
                    project_count: projects.length,
                    total_entries: totalEntries,
                    projects: projects.map(p => ({
                        ...p,
                        top_tags: projectTags[p['project_number'] as number] ?? [],
                    })),
                    inactive_projects: inactiveProjects,
                    time_distribution: distribution,
                });
            },
        },
        // Relationship tools
        {
            name: 'link_entries',
            title: 'Link Entries',
            description: 'Create a relationship between two journal entries',
            group: 'relationships',
            inputSchema: LinkEntriesSchema,
            annotations: { readOnlyHint: false, idempotentHint: false },
            handler: (params: unknown) => {
                const input = LinkEntriesSchema.parse(params);
                const relationship = db.linkEntries(
                    input.from_entry_id,
                    input.to_entry_id,
                    input.relationship_type as RelationshipType,
                    input.description
                );
                return Promise.resolve({ success: true, relationship });
            },
        },
        {
            name: 'visualize_relationships',
            title: 'Visualize Relationships',
            description: 'Generate a Mermaid diagram visualization of entry relationships',
            group: 'relationships',
            inputSchema: z.object({
                entry_id: z.number().optional().describe('Specific entry ID to visualize (shows connected entries)'),
                tags: z.array(z.string()).optional().describe('Filter entries by tags'),
                depth: z.number().min(1).max(3).optional().default(2).describe('Relationship traversal depth'),
                limit: z.number().optional().default(20).describe('Maximum entries to include'),
            }),
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                const input = z.object({
                    entry_id: z.number().optional(),
                    tags: z.array(z.string()).optional(),
                    depth: z.number().optional().default(2),
                    limit: z.number().optional().default(20),
                }).parse(params);

                const rawDb = db.getRawDb();
                let entriesResult;

                if (input.entry_id !== undefined) {
                    // Use recursive CTE to get connected entries up to depth
                    entriesResult = rawDb.exec(`
                        WITH RECURSIVE connected_entries(id, distance) AS (
                            SELECT id, 0 FROM memory_journal WHERE id = ? AND deleted_at IS NULL
                            UNION
                            SELECT DISTINCT 
                                CASE 
                                    WHEN r.from_entry_id = ce.id THEN r.to_entry_id
                                    ELSE r.from_entry_id
                                END,
                                ce.distance + 1
                            FROM connected_entries ce
                            JOIN relationships r ON r.from_entry_id = ce.id OR r.to_entry_id = ce.id
                            WHERE ce.distance < ?
                        )
                        SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
                        FROM memory_journal mj
                        JOIN connected_entries ce ON mj.id = ce.id
                        WHERE mj.deleted_at IS NULL
                        LIMIT ?
                    `, [input.entry_id, input.depth, input.limit]);
                } else if (input.tags && input.tags.length > 0) {
                    // Filter by tags
                    const placeholders = input.tags.map(() => '?').join(',');
                    entriesResult = rawDb.exec(`
                        SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
                        FROM memory_journal mj
                        WHERE mj.deleted_at IS NULL
                          AND mj.id IN (
                              SELECT et.entry_id FROM entry_tags et
                              JOIN tags t ON et.tag_id = t.id
                              WHERE t.name IN (${placeholders})
                          )
                        LIMIT ?
                    `, [...input.tags, input.limit]);
                } else {
                    // Get recent entries with relationships
                    entriesResult = rawDb.exec(`
                        SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
                        FROM memory_journal mj
                        WHERE mj.deleted_at IS NULL
                          AND mj.id IN (
                              SELECT DISTINCT from_entry_id FROM relationships
                              UNION
                              SELECT DISTINCT to_entry_id FROM relationships
                          )
                        ORDER BY mj.id DESC
                        LIMIT ?
                    `, [input.limit]);
                }

                if (!entriesResult[0] || entriesResult[0].values.length === 0) {
                    return Promise.resolve({
                        message: 'No entries found with relationships matching your criteria',
                        mermaid: null,
                    });
                }

                // Build entries map
                const entries: Record<number, { id: number; entry_type: string; content: string; is_personal: boolean }> = {};
                const cols = entriesResult[0].columns;
                for (const row of entriesResult[0].values) {
                    const id = row[cols.indexOf('id')] as number;
                    entries[id] = {
                        id,
                        entry_type: row[cols.indexOf('entry_type')] as string,
                        content: row[cols.indexOf('content')] as string,
                        is_personal: Boolean(row[cols.indexOf('is_personal')]),
                    };
                }

                const entryIds = Object.keys(entries).map(Number);
                const placeholders = entryIds.map(() => '?').join(',');

                // Get relationships between these entries
                const relsResult = rawDb.exec(`
                    SELECT from_entry_id, to_entry_id, relationship_type
                    FROM relationships
                    WHERE from_entry_id IN (${placeholders})
                      AND to_entry_id IN (${placeholders})
                `, [...entryIds, ...entryIds]);

                const relationships = relsResult[0]?.values ?? [];

                // Generate Mermaid diagram
                let mermaid = '```mermaid\\ngraph TD\\n';

                // Add nodes
                for (const [idStr, entry] of Object.entries(entries)) {
                    let contentPreview = entry.content.slice(0, 40).replace(/\\n/g, ' ');
                    if (entry.content.length > 40) contentPreview += '...';
                    // Escape for Mermaid
                    contentPreview = contentPreview.replace(/"/g, "'").replace(/\\[/g, '(').replace(/\\]/g, ')');
                    const entryTypeShort = entry.entry_type.slice(0, 20);
                    mermaid += `    E${idStr}["#${idStr}: ${contentPreview}<br/>${entryTypeShort}"]\\n`;
                }

                mermaid += '\\n';

                // Add relationships with arrows
                const relSymbols: Record<string, string> = {
                    'references': '-->',
                    'implements': '==>',
                    'clarifies': '-.->',
                    'evolves_from': '-->',
                    'response_to': '<-->',
                };

                for (const rel of relationships) {
                    const fromId = rel[0] as number;
                    const toId = rel[1] as number;
                    const relType = rel[2] as string;
                    const arrow = relSymbols[relType] ?? '-->';
                    mermaid += `    E${String(fromId)} ${arrow}|${relType}| E${String(toId)}\\n`;
                }

                // Add styling
                mermaid += '\\n';
                for (const [idStr, entry] of Object.entries(entries)) {
                    if (entry.is_personal) {
                        mermaid += `    style E${idStr} fill:#E3F2FD\\n`;
                    } else {
                        mermaid += `    style E${idStr} fill:#FFF3E0\\n`;
                    }
                }
                mermaid += '```';

                return Promise.resolve({
                    entry_count: Object.keys(entries).length,
                    relationship_count: relationships.length,
                    root_entry: input.entry_id ?? null,
                    depth: input.depth,
                    mermaid,
                    legend: {
                        blue: 'Personal entries',
                        orange: 'Project entries',
                        arrows: {
                            '-->': 'references / evolves_from',
                            '==>': 'implements',
                            '-.->': 'clarifies',
                            '<-->': 'response_to',
                        },
                    },
                });
            },
        },
        // Export tools
        {
            name: 'export_entries',
            title: 'Export Entries',
            description: 'Export journal entries to JSON or Markdown format',
            group: 'export',
            inputSchema: ExportEntriesSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                const input = ExportEntriesSchema.parse(params);
                const entries = db.getRecentEntries(100);
                if (input.format === 'markdown') {
                    const md = entries.map(e =>
                        `## ${e.timestamp}\n\n**Type:** ${e.entryType}\n\n${e.content}\n\n---`
                    ).join('\n\n');
                    return Promise.resolve({ format: 'markdown', content: md });
                }
                return Promise.resolve({ format: 'json', entries });
            },
        },
        // Admin tools
        {
            name: 'update_entry',
            title: 'Update Entry',
            description: 'Update an existing journal entry',
            group: 'admin',
            inputSchema: UpdateEntrySchema,
            annotations: { readOnlyHint: false, idempotentHint: false },
            handler: (params: unknown) => {
                const input = UpdateEntrySchema.parse(params);
                const entry = db.updateEntry(input.entry_id, {
                    content: input.content,
                    entryType: input.entry_type as EntryType | undefined,
                    isPersonal: input.is_personal,
                    tags: input.tags,
                });
                if (!entry) {
                    return Promise.resolve({ error: `Entry ${input.entry_id} not found` });
                }
                return Promise.resolve({ success: true, entry });
            },
        },
        {
            name: 'delete_entry',
            title: 'Delete Entry',
            description: 'Delete a journal entry (soft delete with timestamp)',
            group: 'admin',
            inputSchema: DeleteEntrySchema,
            annotations: { readOnlyHint: false, destructiveHint: true },
            handler: (params: unknown) => {
                const { entry_id, permanent } = DeleteEntrySchema.parse(params);
                const success = db.deleteEntry(entry_id, permanent);
                return Promise.resolve({ success, entryId: entry_id, permanent });
            },
        },
        // Utility tools
        {
            name: 'list_tags',
            title: 'List Tags',
            description: 'List all available tags',
            group: 'core',
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (_params: unknown) => {
                const tags = db.listTags();
                return Promise.resolve({ tags, count: tags.length });
            },
        },
        // Vector index management tools
        {
            name: 'rebuild_vector_index',
            title: 'Rebuild Vector Index',
            description: 'Rebuild the semantic search vector index from all existing entries',
            group: 'admin',
            inputSchema: z.object({}),
            annotations: { readOnlyHint: false, idempotentHint: false },
            handler: async (_params: unknown) => {
                if (!vectorManager) {
                    return { error: 'Vector search not available' };
                }
                const indexed = await vectorManager.rebuildIndex(db);
                return { success: true, entriesIndexed: indexed };
            },
        },
        {
            name: 'add_to_vector_index',
            title: 'Add Entry to Vector Index',
            description: 'Add a specific entry to the semantic search vector index',
            group: 'admin',
            inputSchema: z.object({ entry_id: z.number() }),
            annotations: { readOnlyHint: false, idempotentHint: true },
            handler: async (params: unknown) => {
                const { entry_id } = z.object({ entry_id: z.number() }).parse(params);
                if (!vectorManager) {
                    return { error: 'Vector search not available' };
                }
                const entry = db.getEntryById(entry_id);
                if (!entry) {
                    return { error: `Entry ${String(entry_id)} not found` };
                }
                const success = await vectorManager.addEntry(entry_id, entry.content);
                return { success, entryId: entry_id };
            },
        },
        {
            name: 'get_vector_index_stats',
            title: 'Get Vector Index Stats',
            description: 'Get statistics about the semantic search vector index',
            group: 'search',
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: async (_params: unknown) => {
                if (!vectorManager) {
                    return { available: false, error: 'Vector search not available' };
                }
                const stats = await vectorManager.getStats();
                return { available: true, ...stats };
            },
        },
        // GitHub integration tools
        {
            name: 'get_github_issues',
            title: 'Get GitHub Issues',
            description: 'List issues from a GitHub repository. IMPORTANT: Do NOT guess owner/repo values - leave them empty to auto-detect from the current git repository.',
            group: 'github',
            inputSchema: z.object({
                owner: z.string().optional().describe('Repository owner - LEAVE EMPTY to auto-detect from git. Only specify if user explicitly provides.'),
                repo: z.string().optional().describe('Repository name - LEAVE EMPTY to auto-detect from git. Only specify if user explicitly provides.'),
                state: z.enum(['open', 'closed', 'all']).optional().default('open'),
                limit: z.number().optional().default(20),
            }),
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                const input = z.object({
                    owner: z.string().optional(),
                    repo: z.string().optional(),
                    state: z.enum(['open', 'closed', 'all']).optional().default('open'),
                    limit: z.number().optional().default(20),
                }).parse(params);

                if (!github) {
                    return { error: 'GitHub integration not available' };
                }

                // Get owner/repo from input or from current repo
                const repoInfo = await github.getRepoInfo();
                const detectedOwner = repoInfo.owner;
                const detectedRepo = repoInfo.repo;

                const owner = input.owner ?? detectedOwner ?? undefined;
                const repo = input.repo ?? detectedRepo ?? undefined;

                if (!owner || !repo) {
                    return {
                        error: 'STOP: Could not auto-detect repository. DO NOT GUESS. You MUST ask the user to provide the GitHub owner and repository name.',
                        requiresUserInput: true,
                        detectedOwner,
                        detectedRepo,
                        instruction: 'Ask the user: "What GitHub repository would you like to query? Please provide the owner and repo name (e.g., owner/repo)."'
                    };
                }

                const issues = await github.getIssues(owner, repo, input.state, input.limit);
                return { owner, repo, detectedOwner, detectedRepo, issues, count: issues.length };
            },
        },
        {
            name: 'get_github_prs',
            title: 'Get GitHub Pull Requests',
            description: 'List pull requests from a GitHub repository. IMPORTANT: Do NOT guess owner/repo values - leave them empty to auto-detect from the current git repository.',
            group: 'github',
            inputSchema: z.object({
                owner: z.string().optional().describe('Repository owner - LEAVE EMPTY to auto-detect from git. Only specify if user explicitly provides.'),
                repo: z.string().optional().describe('Repository name - LEAVE EMPTY to auto-detect from git. Only specify if user explicitly provides.'),
                state: z.enum(['open', 'closed', 'all']).optional().default('open'),
                limit: z.number().optional().default(20),
            }),
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                const input = z.object({
                    owner: z.string().optional(),
                    repo: z.string().optional(),
                    state: z.enum(['open', 'closed', 'all']).optional().default('open'),
                    limit: z.number().optional().default(20),
                }).parse(params);

                if (!github) {
                    return { error: 'GitHub integration not available' };
                }

                const repoInfo = await github.getRepoInfo();
                const detectedOwner = repoInfo.owner;
                const detectedRepo = repoInfo.repo;

                const owner = input.owner ?? detectedOwner ?? undefined;
                const repo = input.repo ?? detectedRepo ?? undefined;

                if (!owner || !repo) {
                    return {
                        error: 'STOP: Could not auto-detect repository. DO NOT GUESS. You MUST ask the user to provide the GitHub owner and repository name.',
                        requiresUserInput: true,
                        detectedOwner,
                        detectedRepo,
                        instruction: 'Ask the user: "What GitHub repository would you like to query? Please provide the owner and repo name (e.g., owner/repo)."'
                    };
                }

                const pullRequests = await github.getPullRequests(owner, repo, input.state, input.limit);
                return { owner, repo, detectedOwner, detectedRepo, pullRequests, count: pullRequests.length };
            },
        },
        {
            name: 'get_github_issue',
            title: 'Get GitHub Issue Details',
            description: 'Get detailed information about a specific GitHub issue. IMPORTANT: Do NOT guess owner/repo values - leave them empty to auto-detect from the current git repository.',
            group: 'github',
            inputSchema: z.object({
                issue_number: z.number(),
                owner: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
                repo: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
            }),
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                const input = z.object({
                    issue_number: z.number(),
                    owner: z.string().optional(),
                    repo: z.string().optional(),
                }).parse(params);

                if (!github) {
                    return { error: 'GitHub integration not available' };
                }

                const repoInfo = await github.getRepoInfo();
                const detectedOwner = repoInfo.owner;
                const detectedRepo = repoInfo.repo;

                const owner = input.owner ?? detectedOwner ?? undefined;
                const repo = input.repo ?? detectedRepo ?? undefined;

                if (!owner || !repo) {
                    return {
                        error: 'STOP: Could not auto-detect repository. DO NOT GUESS. You MUST ask the user to provide the GitHub owner and repository name.',
                        requiresUserInput: true,
                        detectedOwner,
                        detectedRepo,
                        instruction: 'Ask the user: "What GitHub repository is this issue from? Please provide the owner and repo name (e.g., owner/repo)."'
                    };
                }

                const issue = await github.getIssue(owner, repo, input.issue_number);
                if (!issue) {
                    return { error: `Issue #${String(input.issue_number)} not found`, owner, repo, detectedOwner, detectedRepo };
                }
                return { issue, owner, repo, detectedOwner, detectedRepo };
            },
        },
        {
            name: 'get_github_pr',
            title: 'Get GitHub PR Details',
            description: 'Get detailed information about a specific GitHub pull request. IMPORTANT: Do NOT guess owner/repo values - leave them empty to auto-detect from the current git repository.',
            group: 'github',
            inputSchema: z.object({
                pr_number: z.number(),
                owner: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
                repo: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
            }),
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                const input = z.object({
                    pr_number: z.number(),
                    owner: z.string().optional(),
                    repo: z.string().optional(),
                }).parse(params);

                if (!github) {
                    return { error: 'GitHub integration not available' };
                }

                const repoInfo = await github.getRepoInfo();
                const detectedOwner = repoInfo.owner;
                const detectedRepo = repoInfo.repo;

                const owner = input.owner ?? detectedOwner ?? undefined;
                const repo = input.repo ?? detectedRepo ?? undefined;

                if (!owner || !repo) {
                    return {
                        error: 'STOP: Could not auto-detect repository. DO NOT GUESS. You MUST ask the user to provide the GitHub owner and repository name.',
                        requiresUserInput: true,
                        detectedOwner,
                        detectedRepo,
                        instruction: 'Ask the user: "What GitHub repository is this PR from? Please provide the owner and repo name (e.g., owner/repo)."'
                    };
                }

                const pullRequest = await github.getPullRequest(owner, repo, input.pr_number);
                if (!pullRequest) {
                    return { error: `PR #${String(input.pr_number)} not found`, owner, repo, detectedOwner, detectedRepo };
                }
                return { pullRequest, owner, repo, detectedOwner, detectedRepo };
            },
        },
        {
            name: 'get_github_context',
            title: 'Get GitHub Repository Context',
            description: 'Get current repository context including branch, issues, and PRs',
            group: 'github',
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (_params: unknown) => {
                if (!github) {
                    return { error: 'GitHub integration not available' };
                }

                const context = await github.getRepoContext();
                return {
                    repoName: context.repoName,
                    branch: context.branch,
                    commit: context.commit,
                    remoteUrl: context.remoteUrl,
                    issues: context.issues,
                    pullRequests: context.pullRequests,
                    issueCount: context.issues.length,
                    prCount: context.pullRequests.length,
                };
            },
        },
        // Kanban tools (GitHub Projects v2)
        {
            name: 'get_kanban_board',
            title: 'Get Kanban Board',
            description: 'View a GitHub Project v2 as a Kanban board with items grouped by Status column. Returns all columns with their items.',
            group: 'github',
            inputSchema: z.object({
                project_number: z.number().describe('GitHub Project number (from the project URL)'),
                owner: z.string().optional().describe('Repository owner - LEAVE EMPTY to auto-detect from git'),
            }),
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                const input = z.object({
                    project_number: z.number(),
                    owner: z.string().optional(),
                }).parse(params);

                if (!github) {
                    return { error: 'GitHub integration not available' };
                }

                // Get owner from input or from current repo
                const repoInfo = await github.getRepoInfo();
                const detectedOwner = repoInfo.owner;
                const owner = input.owner ?? detectedOwner ?? undefined;

                if (!owner) {
                    return {
                        error: 'STOP: Could not auto-detect repository owner. DO NOT GUESS. You MUST ask the user to provide the GitHub owner.',
                        requiresUserInput: true,
                        detectedOwner,
                        instruction: 'Ask the user: "What GitHub username or organization owns this project?"'
                    };
                }

                const repo = repoInfo.repo ?? undefined;
                const board = await github.getProjectKanban(owner, input.project_number, repo);
                if (!board) {
                    return {
                        error: `Project #${String(input.project_number)} not found or Status field not configured`,
                        owner,
                        repo,
                        hint: 'Ensure the project exists and has a "Status" single-select field. Projects can be at user, repository, or organization level.',
                    };
                }

                return {
                    ...board,
                    owner,
                    detectedOwner,
                    detectedRepo: repo,
                };
            },
        },
        {
            name: 'move_kanban_item',
            title: 'Move Kanban Item',
            description: 'Move a project item to a different Status column. Use get_kanban_board first to get the item_id and available status names.',
            group: 'github',
            inputSchema: z.object({
                project_number: z.number().describe('GitHub Project number'),
                item_id: z.string().describe('Project item node ID (from get_kanban_board)'),
                target_status: z.string().describe('Target status name (e.g., "Done", "In Progress")'),
                owner: z.string().optional().describe('Repository owner - LEAVE EMPTY to auto-detect'),
            }),
            annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
            handler: async (params: unknown) => {
                const input = z.object({
                    project_number: z.number(),
                    item_id: z.string(),
                    target_status: z.string(),
                    owner: z.string().optional(),
                }).parse(params);

                if (!github) {
                    return { error: 'GitHub integration not available' };
                }

                // Get owner from input or from current repo
                const repoInfo = await github.getRepoInfo();
                const detectedOwner = repoInfo.owner;
                const owner = input.owner ?? detectedOwner ?? undefined;

                if (!owner) {
                    return {
                        error: 'STOP: Could not auto-detect repository owner. DO NOT GUESS.',
                        requiresUserInput: true,
                    };
                }

                // First, get the board to find projectId, statusFieldId, and target statusOptionId
                const repo = repoInfo.repo ?? undefined;
                const board = await github.getProjectKanban(owner, input.project_number, repo);
                if (!board) {
                    return {
                        error: `Project #${String(input.project_number)} not found`,
                    };
                }

                // Find the target status option
                const targetOption = board.statusOptions.find(
                    (opt) => opt.name.toLowerCase() === input.target_status.toLowerCase()
                );

                if (!targetOption) {
                    return {
                        error: `Status "${input.target_status}" not found in project`,
                        availableStatuses: board.statusOptions.map((opt) => opt.name),
                        hint: 'Use one of the available status names listed above.',
                    };
                }

                // Move the item
                const result = await github.moveProjectItem(
                    board.projectId,
                    input.item_id,
                    board.statusFieldId,
                    targetOption.id
                );

                if (!result.success) {
                    return {
                        success: false,
                        error: result.error,
                        targetStatus: input.target_status,
                    };
                }

                return {
                    success: true,
                    itemId: input.item_id,
                    newStatus: input.target_status,
                    projectNumber: input.project_number,
                    message: `Item moved to "${input.target_status}"`,
                };
            },
        },
        // Backup tools
        {
            name: 'backup_journal',
            title: 'Backup Journal Database',
            description: 'Create a timestamped backup of the journal database. Backups are stored in the backups/ directory.',
            group: 'backup',
            inputSchema: z.object({
                name: z.string().optional().describe('Custom backup name (optional, defaults to timestamp)'),
            }),
            annotations: { readOnlyHint: false, idempotentHint: true },
            handler: (params: unknown) => {
                const input = z.object({
                    name: z.string().optional(),
                }).parse(params);
                const result = db.exportToFile(input.name);
                return Promise.resolve({
                    success: true,
                    message: `Backup created successfully`,
                    filename: result.filename,
                    path: result.path,
                    sizeBytes: result.sizeBytes,
                });
            },
        },
        {
            name: 'list_backups',
            title: 'List Journal Backups',
            description: 'List all available backup files with their sizes and creation dates',
            group: 'backup',
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (_params: unknown) => {
                const backups = db.listBackups();
                return Promise.resolve({
                    backups,
                    total: backups.length,
                    backupsDirectory: db.getBackupsDir(),
                    hint: backups.length === 0
                        ? 'No backups found. Use backup_journal to create one.'
                        : undefined,
                });
            },
        },
        {
            name: 'restore_backup',
            title: 'Restore Journal from Backup',
            description: 'Restore the journal database from a backup file. WARNING: This replaces all current data. An automatic backup is created before restore.',
            group: 'backup',
            inputSchema: z.object({
                filename: z.string().describe('Backup filename to restore from (e.g., backup_2025-01-01.db)'),
                confirm: z.literal(true).describe('Must be set to true to confirm the restore operation'),
            }),
            annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
            handler: async (params: unknown) => {
                const input = z.object({
                    filename: z.string(),
                    confirm: z.literal(true),
                }).parse(params);

                const result = await db.restoreFromFile(input.filename);
                return {
                    success: true,
                    message: `Database restored from ${input.filename}`,
                    restoredFrom: result.restoredFrom,
                    previousEntryCount: result.previousEntryCount,
                    newEntryCount: result.newEntryCount,
                    warning: 'A pre-restore backup was automatically created.',
                };
            },
        },
    ];
}
