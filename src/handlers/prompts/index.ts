/**
 * Memory Journal MCP Server - Prompt Handlers
 * 
 * Exports all MCP prompts for workflow guidance.
 */

import type { SqliteAdapter } from '../../database/SqliteAdapter.js';

/**
 * Message format for MCP prompts
 */
interface PromptMessage {
    role: string;
    content: {
        type: string;
        text: string;
    };
}

/**
 * Internal prompt definition with db handler
 */
interface InternalPromptDef {
    name: string;
    description: string;
    arguments?: {
        name: string;
        description: string;
        required?: boolean;
    }[];
    handler: (args: Record<string, string>, db: SqliteAdapter) => { messages: PromptMessage[] };
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
 * Get all prompt definitions for MCP list
 */
export function getPrompts(): object[] {
    const prompts = getAllPromptDefinitions();
    return prompts.map(p => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments,
    }));
}

/**
 * Get a prompt by name
 */
export function getPrompt(
    name: string,
    args: Record<string, string>,
    db: SqliteAdapter
): { messages: PromptMessage[] } {
    const prompts = getAllPromptDefinitions();
    const prompt = prompts.find(p => p.name === name);

    if (!prompt) {
        throw new Error(`Unknown prompt: ${name}`);
    }

    return prompt.handler(args, db);
}

/**
 * Get all prompt definitions
 */
function getAllPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'find-related',
            description: 'Discover connected entries via semantic similarity',
            arguments: [
                { name: 'query', description: 'Search query for finding related entries', required: true },
            ],
            handler: (args: Record<string, string>, db: SqliteAdapter) => {
                const query = args['query'] ?? '';
                const entries = db.searchEntries(query, { limit: 5 });

                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Find entries related to: "${query}"\n\nRecent matching entries:\n${entries.map(e => `- [${String(e.id)}] ${e.content.slice(0, 100)}...`).join('\n')}`,
                        },
                    }],
                };
            },
        },
        {
            name: 'prepare-standup',
            description: 'Daily standup summaries',
            arguments: [],
            handler: (_args: Record<string, string>, db: SqliteAdapter) => {
                const today = new Date().toISOString().split('T')[0] ?? '';
                const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0] ?? '';

                const entries = db.searchByDateRange(yesterday, today);

                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Prepare a standup summary based on these recent entries:\n\n${entries.map(e => `[${e.timestamp}] ${e.entryType}: ${e.content}`).join('\n\n')}\n\nFormat as:\n- Yesterday: <summary>\n- Today: <planned work>\n- Blockers: <any blockers>`,
                        },
                    }],
                };
            },
        },
        {
            name: 'prepare-retro',
            description: 'Sprint retrospectives',
            arguments: [
                { name: 'days', description: 'Number of days to include (default: 14)', required: false },
            ],
            handler: (args: Record<string, string>, db: SqliteAdapter) => {
                const days = parseInt(args['days'] ?? '14', 10);
                const endDate = new Date().toISOString().split('T')[0] ?? '';
                const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0] ?? '';

                const entries = db.searchByDateRange(startDate, endDate);

                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Prepare a retrospective for the last ${String(days)} days based on these entries:\n\n${entries.slice(0, 20).map(e => `[${e.timestamp}] ${e.entryType}: ${e.content.slice(0, 200)}`).join('\n\n')}\n\nFormat as:\n- What went well\n- What could improve\n- Action items`,
                        },
                    }],
                };
            },
        },
        {
            name: 'weekly-digest',
            description: 'Day-by-day weekly summaries',
            arguments: [],
            handler: (_args: Record<string, string>, db: SqliteAdapter) => {
                const endDate = new Date().toISOString().split('T')[0] ?? '';
                const startDate = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0] ?? '';

                const entries = db.searchByDateRange(startDate, endDate);

                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Create a weekly digest from these entries:\n\n${entries.map(e => `[${e.timestamp}] ${e.entryType}: ${e.content.slice(0, 150)}`).join('\n\n')}\n\nFormat as day-by-day summary with highlights.`,
                        },
                    }],
                };
            },
        },
        {
            name: 'analyze-period',
            description: 'Deep period analysis with insights',
            arguments: [
                { name: 'start_date', description: 'Start date (YYYY-MM-DD)', required: true },
                { name: 'end_date', description: 'End date (YYYY-MM-DD)', required: true },
            ],
            handler: (args: Record<string, string>, db: SqliteAdapter) => {
                const startDate = args['start_date'] ?? '';
                const endDate = args['end_date'] ?? '';

                const entries = db.searchByDateRange(startDate, endDate);
                const stats = db.getStatistics('day');

                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Analyze the period ${startDate} to ${endDate}:\n\nStatistics: ${JSON.stringify(stats, null, 2)}\n\nEntries (${String(entries.length)} total):\n${entries.slice(0, 15).map(e => `[${e.timestamp}] ${e.entryType}: ${e.content.slice(0, 100)}`).join('\n')}\n\nProvide insights on patterns, productivity, and recommendations.`,
                        },
                    }],
                };
            },
        },
        {
            name: 'goal-tracker',
            description: 'Milestone and achievement tracking',
            arguments: [],
            handler: (_args: Record<string, string>, db: SqliteAdapter) => {
                const entries = execQuery(db, `
                    SELECT * FROM memory_journal 
                    WHERE significance_type IS NOT NULL 
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                    LIMIT 20
                `);

                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Track goals and milestones based on significant entries:\n\n${JSON.stringify(entries, null, 2)}\n\nSummarize progress toward goals and highlight achievements.`,
                        },
                    }],
                };
            },
        },
        {
            name: 'get-context-bundle',
            description: 'Project context with Git/GitHub',
            arguments: [],
            handler: (_args: Record<string, string>, db: SqliteAdapter) => {
                const recent = db.getRecentEntries(10);
                const stats = db.getStatistics('week');

                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Project context bundle:\n\nRecent Entries: ${JSON.stringify(recent.slice(0, 5), null, 2)}\n\nStatistics: ${JSON.stringify(stats, null, 2)}\n\nUse this context to understand the project state.`,
                        },
                    }],
                };
            },
        },
        {
            name: 'get-recent-entries',
            description: 'Formatted recent entries',
            arguments: [
                { name: 'limit', description: 'Number of entries (default: 10)', required: false },
            ],
            handler: (args: Record<string, string>, db: SqliteAdapter) => {
                const limit = parseInt(args['limit'] ?? '10', 10);
                const entries = db.getRecentEntries(limit);

                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Recent ${String(limit)} entries:\n\n${entries.map(e => `## ${e.timestamp} (${e.entryType})\n\n${e.content}\n\nTags: ${e.tags.join(', ') || 'none'}`).join('\n\n---\n\n')}`,
                        },
                    }],
                };
            },
        },
        {
            name: 'project-status-summary',
            description: 'GitHub Project status reports',
            arguments: [
                { name: 'project_number', description: 'GitHub Project number', required: true },
            ],
            handler: (args: Record<string, string>, db: SqliteAdapter) => {
                const projectNumber = parseInt(args['project_number'] ?? '0', 10);
                const entries = execQuery(db, `
                    SELECT * FROM memory_journal 
                    WHERE project_number = ? 
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                    LIMIT 20
                `, [projectNumber]);

                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Generate a status summary for Project #${String(projectNumber)}:\n\nEntries: ${JSON.stringify(entries, null, 2)}\n\nProvide: overview, recent activity, blockers, next steps.`,
                        },
                    }],
                };
            },
        },
        {
            name: 'pr-summary',
            description: 'Pull request journal activity summary',
            arguments: [
                { name: 'pr_number', description: 'Pull request number', required: true },
            ],
            handler: (args: Record<string, string>, db: SqliteAdapter) => {
                const prNumber = parseInt(args['pr_number'] ?? '0', 10);
                const entries = execQuery(db, `
                    SELECT * FROM memory_journal 
                    WHERE pr_number = ? 
                    AND deleted_at IS NULL
                    ORDER BY timestamp ASC
                `, [prNumber]);

                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Summarize PR #${String(prNumber)} activity:\n\nJournal entries: ${JSON.stringify(entries, null, 2)}\n\nProvide: summary of changes, decisions made, testing done.`,
                        },
                    }],
                };
            },
        },
        {
            name: 'code-review-prep',
            description: 'Comprehensive PR review preparation',
            arguments: [
                { name: 'pr_number', description: 'Pull request number', required: true },
            ],
            handler: (args: Record<string, string>, db: SqliteAdapter) => {
                const prNumber = parseInt(args['pr_number'] ?? '0', 10);
                const entries = execQuery(db, `
                    SELECT * FROM memory_journal 
                    WHERE pr_number = ? 
                    AND deleted_at IS NULL
                    ORDER BY timestamp ASC
                `, [prNumber]);

                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Prepare for code review of PR #${String(prNumber)}:\n\nContext entries: ${JSON.stringify(entries, null, 2)}\n\nProvide: review checklist, areas of concern, testing recommendations.`,
                        },
                    }],
                };
            },
        },
        {
            name: 'pr-retrospective',
            description: 'Completed PR analysis with learnings',
            arguments: [
                { name: 'pr_number', description: 'Pull request number', required: true },
            ],
            handler: (args: Record<string, string>, db: SqliteAdapter) => {
                const prNumber = parseInt(args['pr_number'] ?? '0', 10);
                const entries = execQuery(db, `
                    SELECT * FROM memory_journal 
                    WHERE pr_number = ? 
                    AND deleted_at IS NULL
                    ORDER BY timestamp ASC
                `, [prNumber]);

                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Retrospective for PR #${String(prNumber)}:\n\nJournal entries: ${JSON.stringify(entries, null, 2)}\n\nProvide: what went well, challenges, lessons learned.`,
                        },
                    }],
                };
            },
        },
        {
            name: 'actions-failure-digest',
            description: 'CI/CD failure analysis with root cause identification',
            arguments: [],
            handler: (_args: Record<string, string>, db: SqliteAdapter) => {
                const entries = execQuery(db, `
                    SELECT * FROM memory_journal 
                    WHERE workflow_run_id IS NOT NULL 
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                    LIMIT 20
                `);

                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Analyze CI/CD failures from these workflow entries:\n\n${JSON.stringify(entries, null, 2)}\n\nProvide: failure patterns, root causes, remediation steps.`,
                        },
                    }],
                };
            },
        },
        {
            name: 'project-milestone-tracker',
            description: 'Milestone progress tracking',
            arguments: [
                { name: 'project_number', description: 'GitHub Project number', required: true },
            ],
            handler: (args: Record<string, string>, db: SqliteAdapter) => {
                const projectNumber = parseInt(args['project_number'] ?? '0', 10);
                const entries = execQuery(db, `
                    SELECT * FROM memory_journal 
                    WHERE project_number = ? 
                    AND significance_type IS NOT NULL
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                `, [projectNumber]);

                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Track milestones for Project #${String(projectNumber)}:\n\nMilestone entries: ${JSON.stringify(entries, null, 2)}\n\nProvide: progress summary, upcoming milestones, timeline.`,
                        },
                    }],
                };
            },
        },
    ];
}
