import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import { sendProgress } from '../../utils/progress-utils.js'
import { CommitAnalyzer } from '../../git/index.js'
import { ErrorFieldsMixin } from './error-fields-mixin.js'

// --- Schemas ---
export const GitHistoryOptionsSchema = z.object({
    ref: z.string().optional(),
    path: z.string().optional(),
    maxCount: z.number().optional(),
    since: z.string().optional(),
})

export const GitHistoryOptionsSchemaMcp = z.object({
    ref: z.string().optional().describe('Git reference (branch, tag, commit). Default: HEAD'),
    path: z.string().optional().describe('Filter by specific file or directory path'),
    maxCount: z.number().optional().describe('Maximum number of commits to return. Default: 50'),
    since: z.string().optional().describe('Show commits more recent than a specific date (e.g. "2023-01-01")'),
})

export const GitSearchOptionsSchema = z.object({
    query: z.string(),
    maxCount: z.number().optional(),
})

export const GitSearchOptionsSchemaMcp = z.object({
    query: z.string().describe('Search query to match in commit messages'),
    maxCount: z.number().optional().describe('Maximum number of commits to return. Default: 50'),
})

export const GitReleaseInfoOptionsSchema = z.object({
    ref: z.string().optional(),
})

export const GitReleaseInfoOptionsSchemaMcp = z.object({
    ref: z.string().optional().describe('Git reference (branch, tag, commit). Default: HEAD'),
})

export const GitOutputSchema = z.object({
    success: z.boolean(),
    commits: z.array(z.any()).optional(),
    error: z.string().optional(),
}).extend(ErrorFieldsMixin.shape)

export function getGitTools(context: ToolContext): ToolDefinition[] {
    const { gitClient, progress } = context

    return [
        {
            name: 'get_commit_history',
            title: 'Get Commit History',
            description: 'Retrieve commit history for the current repository',
            group: 'git',
            inputSchema: GitHistoryOptionsSchemaMcp,
            outputSchema: GitOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    if (!gitClient) throw new Error('Git client not available')
                    const input = GitHistoryOptionsSchema.parse(params)
                    await sendProgress(progress, 0, 1, 'Fetching commit history...')
                    const commits = await gitClient.getCommitHistory(input)
                    return { success: true, commits }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'search_commits',
            title: 'Search Commits',
            description: 'Search commit history by query',
            group: 'git',
            inputSchema: GitSearchOptionsSchemaMcp,
            outputSchema: GitOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    if (!gitClient) throw new Error('Git client not available')
                    const input = GitSearchOptionsSchema.parse(params)
                    await sendProgress(progress, 0, 1, `Searching commits for "${input.query}"...`)
                    const commits = await gitClient.searchCommits(input.query, input)
                    return { success: true, commits }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'get_release_info',
            title: 'Get Release Info',
            description: 'Get latest release commits',
            group: 'git',
            inputSchema: GitReleaseInfoOptionsSchemaMcp,
            outputSchema: GitOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    if (!gitClient) throw new Error('Git client not available')
                    const input = GitReleaseInfoOptionsSchema.parse(params)
                    await sendProgress(progress, 0, 1, 'Fetching release info...')
                    const commits = await gitClient.getReleaseInfo(input)
                    return { success: true, commits }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'get_unreleased_commits',
            title: 'Get Unreleased Commits',
            description: 'Get commits since the last tag/release',
            group: 'git',
            inputSchema: z.object({}),
            outputSchema: GitOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async () => {
                try {
                    if (!gitClient) throw new Error('Git client not available')
                    await sendProgress(progress, 0, 1, 'Fetching unreleased commits...')
                    // Simulate getUnreleasedCommits by getting recent history
                    const commits = await gitClient.getCommitHistory({ maxCount: 50 })
                    return { success: true, commits }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'analyze_commit_patterns',
            title: 'Analyze Commit Patterns',
            description: 'Analyze patterns in a list of commits or recent history',
            group: 'git',
            inputSchema: z.object({
                maxCount: z.number().optional().describe('Maximum number of commits to analyze. Default: 50')
            }),
            outputSchema: z.object({
                success: z.boolean(),
                analysis: z.any().optional(),
                error: z.string().optional()
            }).extend(ErrorFieldsMixin.shape),
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    if (!gitClient) throw new Error('Git client not available')
                    const input = z.object({ maxCount: z.number().optional().default(50) }).parse(params)
                    await sendProgress(progress, 0, 2, 'Fetching commits for analysis...')
                    const commits = await gitClient.getCommitHistory({ maxCount: input.maxCount })
                    await sendProgress(progress, 1, 2, 'Analyzing commits...')
                    const analyzer = new CommitAnalyzer()
                    const analysis = analyzer.analyze(commits)
                    return { success: true, analysis }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        }
    ]
}
