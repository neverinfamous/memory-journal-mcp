import { z } from 'zod'
import type { ErrorResponse } from '../../types/error-types.js'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import { sendProgress } from '../../utils/progress-utils.js'
import { fenceNonCanonicalRefOrKey } from '../../utils/security-utils.js'
import { createNullProtoRecord } from '../../utils/type-guards.js'
import { resolveGitWorkingDir, runCheckEntryStaleness } from './git-staleness.js'
import { ErrorFieldsMixin } from './error-fields-mixin.js'
import { relaxedNumber, StrictProjectNumberSchema } from './schemas.js'
import {
    GitAnalyzePatternsOptionsSchema,
    GitHistoryOptionsSchema,
    GitHistoryOptionsSchemaMcp,
    GitOutputSchema,
    GitReleaseInfoOptionsSchema,
    GitReleaseInfoOptionsSchemaMcp,
    GitSearchOptionsSchema,
    GitSearchOptionsSchemaMcp,
    GitUnreleasedOptionsSchema,
} from './git-schemas.js'
import {
    fetchCommits,
    fenceCommitEntries,
    fenceUnreleasedTag,
    fetchUncommittedWorkingTree,
    getUnreleasedChangelog,
} from './git-commit-helpers.js'

export {
    GitAnalyzePatternsOptionsSchema,
    GitHistoryOptionsSchema,
    GitHistoryOptionsSchemaMcp,
    GitOutputSchema,
    GitReleaseInfoOptionsSchema,
    GitReleaseInfoOptionsSchemaMcp,
    GitSearchOptionsSchema,
    GitSearchOptionsSchemaMcp,
    GitUnreleasedOptionsSchema,
} from './git-schemas.js'

const MaxUnreleasedCountSchema = z.number().int().positive().max(5000)
const MaxPatternCommitsSchema = z.number().int().positive().max(10000)

async function executeGetCommitHistory(
    params: unknown,
    context: ToolContext
): Promise<Record<string, unknown> | ErrorResponse> {
    try {
        const parsedMcp = GitHistoryOptionsSchemaMcp.parse(params)
        const input = GitHistoryOptionsSchema.parse(parsedMcp)
        const cwd = resolveGitWorkingDir(input, context.config)
        if (input.uncommitted === true) {
            await sendProgress(context.progress, 0, 1, 'Fetching working-tree state...')
            const historyRequested =
                parsedMcp.maxCount !== undefined ||
                parsedMcp.ref !== undefined ||
                parsedMcp.since !== undefined ||
                parsedMcp.sortBy !== undefined ||
                parsedMcp.scope !== undefined ||
                parsedMcp.techDebtAudit === true
            if (!historyRequested) {
                const uncommitted = await fetchUncommittedWorkingTree(cwd, input.path)
                return { success: true, commits: [], uncommitted }
            }
            const [uncommittedRes, commitsRes] = await Promise.allSettled([
                fetchUncommittedWorkingTree(cwd, input.path),
                fetchCommits(input, cwd),
            ])
            if (uncommittedRes.status === 'rejected') throw uncommittedRes.reason
            if (commitsRes.status === 'rejected') throw commitsRes.reason
            return {
                success: true,
                commits: fenceCommitEntries(commitsRes.value),
                uncommitted: uncommittedRes.value,
            }
        }
        await sendProgress(context.progress, 0, 1, 'Fetching commit history...')
        const commits = await fetchCommits(input, cwd)
        return { success: true, commits: fenceCommitEntries(commits) }
    } catch (err) {
        return formatHandlerError(err)
    }
}

async function executeSearchCommits(
    params: unknown,
    context: ToolContext
): Promise<Record<string, unknown> | ErrorResponse> {
    try {
        const parsedMcp = GitSearchOptionsSchemaMcp.parse(params)
        const input = GitSearchOptionsSchema.parse(parsedMcp)
        const cwd = resolveGitWorkingDir(input, context.config)
        await sendProgress(context.progress, 0, 1, `Searching commits for "${input.query}"...`)
        const commits = await fetchCommits(input, cwd)
        return { success: true, commits: fenceCommitEntries(commits) }
    } catch (err) {
        return formatHandlerError(err)
    }
}

async function executeGetReleaseInfo(
    params: unknown,
    context: ToolContext
): Promise<Record<string, unknown> | ErrorResponse> {
    try {
        const parsedMcp = GitReleaseInfoOptionsSchemaMcp.parse(params)
        const input = GitReleaseInfoOptionsSchema.parse(parsedMcp)
        const cwd = resolveGitWorkingDir(input, context.config)
        await sendProgress(context.progress, 0, 1, 'Fetching release info...')
        const commits = await fetchCommits({ ref: input.ref, maxCount: 10 }, cwd)
        return { success: true, commits: fenceCommitEntries(commits) }
    } catch (err) {
        return formatHandlerError(err)
    }
}

async function executeGetUnreleasedCommits(
    params: unknown,
    context: ToolContext
): Promise<Record<string, unknown> | ErrorResponse> {
    try {
        const parsedMcp = GitUnreleasedOptionsSchema.parse(params ?? {})
        const maxCount =
            parsedMcp.maxCount !== undefined
                ? MaxUnreleasedCountSchema.parse(parsedMcp.maxCount)
                : undefined
        const projectNumber = StrictProjectNumberSchema.optional().parse(parsedMcp.project_number)
        const input = { ...parsedMcp, maxCount, project_number: projectNumber }
        const cwd = resolveGitWorkingDir(input, context.config)
        await sendProgress(context.progress, 0, 1, 'Fetching unreleased commits...')
        const rawChangelog = await getUnreleasedChangelog(cwd, {
            ...(input.maxCount !== undefined ? { maxCount: input.maxCount } : {}),
            ...(input.summary === true ? { summary: true } : {}),
        })
        return {
            success: true,
            changelog: {
                ...rawChangelog,
                latestTag: fenceUnreleasedTag(rawChangelog.latestTag),
                commits: fenceCommitEntries(rawChangelog.commits),
            },
        }
    } catch (err) {
        return formatHandlerError(err)
    }
}

async function executeAnalyzeCommitPatterns(
    params: unknown,
    context: ToolContext
): Promise<Record<string, unknown> | ErrorResponse> {
    try {
        const parsedMcp = GitAnalyzePatternsOptionsSchema.parse(params ?? {})
        const max = MaxPatternCommitsSchema.parse(parsedMcp.maxCount)
        const projectNumber = StrictProjectNumberSchema.optional().parse(parsedMcp.project_number)
        const input = { ...parsedMcp, maxCount: max, project_number: projectNumber }
        const cwd = resolveGitWorkingDir(input, context.config)
        const progress = context.progress
        await sendProgress(progress, 0, 2, 'Fetching commits for analysis...')
        const commits = await fetchCommits({ maxCount: max }, cwd)
        await sendProgress(progress, 1, 2, 'Analyzing commits...')

        const analysis = {
            totalCommits: commits.length,
            byType: createNullProtoRecord<number>(),
            byAuthor: createNullProtoRecord<number>(),
            breakingCount: 0,
            totalInsertions: 0,
            totalDeletions: 0,
            totalImpact: 0,
            byCategory: createNullProtoRecord<number>(),
        }

        for (const c of commits) {
            if (c.type) {
                const typeKey = fenceNonCanonicalRefOrKey(c.type, true)
                analysis.byType[typeKey] = (analysis.byType[typeKey] ?? 0) + 1
            }
            if (c.author) {
                const authorKey = fenceNonCanonicalRefOrKey(c.author, true)
                analysis.byAuthor[authorKey] = (analysis.byAuthor[authorKey] ?? 0) + 1
            }
            if (c.isBreaking) {
                analysis.breakingCount++
            }

            analysis.totalInsertions += c.totalInsertions ?? 0
            analysis.totalDeletions += c.totalDeletions ?? 0

            if (c.metadata?.impact !== undefined) {
                const imp =
                    typeof c.metadata.impact === 'number'
                        ? c.metadata.impact
                        : parseFloat(c.metadata.impact ?? '0')
                if (!isNaN(imp)) analysis.totalImpact += imp
            }

            const categories = c.metadata?.category ?? []
            for (const cat of categories) {
                const catKey = fenceNonCanonicalRefOrKey(cat, true)
                analysis.byCategory[catKey] = (analysis.byCategory[catKey] ?? 0) + 1
            }
        }

        return { success: true, analysis }
    } catch (err) {
        return formatHandlerError(err)
    }
}

function createCheckEntryStalenessTool(context: ToolContext): ToolDefinition {
    return {
        name: 'check_entry_staleness',
        title: 'Check Entry Staleness',
        description:
            "Check if a journal entry's anchors have been modified or deleted in git since the entry was created.",
        group: 'git',
        inputSchema: z.object({
            entry_id: relaxedNumber().optional().describe('The ID of the journal entry to check'),
            entryId: relaxedNumber()
                .optional()
                .describe('The ID of the journal entry to check (alias for entry_id)'),
            workspace_id: z
                .string()
                .optional()
                .describe('Workspace identifier (defaults to current project)'),
            workspaceId: z.string().optional().describe('Workspace identifier alias'),
            project_number: relaxedNumber().optional().describe('Numeric project identifier'),
            projectNumber: relaxedNumber().optional().describe('Numeric project identifier alias'),
            session_id: z
                .string()
                .optional()
                .describe(
                    'Optional session filter (when explicitly passed without entry_id, limits recent-entry staleness scan to that session; not auto-inherited from top-level mj_execute_code session_id).'
                ),
        }),
        outputSchema: z
            .object({
                success: z.boolean().optional(),
                results: z
                    .array(
                        z.object({
                            anchorId: z.number(),
                            path: z.string(),
                            oldStatus: z.string(),
                            newStatus: z.string(),
                            commitsSince: z.number(),
                            isDeleted: z.boolean(),
                            error: z.string().optional(),
                        })
                    )
                    .optional(),
                skippedWorkspaces: z.array(z.string()).optional(),
                error: z.string().optional(),
            })
            .extend(ErrorFieldsMixin.shape),
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
        handler: (params: unknown) =>
            runCheckEntryStaleness(
                params,
                context,
                (anchorPath, since, cwd, maxCount) =>
                    fetchCommits({ path: anchorPath, since, maxCount, summary: true }, cwd).then(
                        (c) => c.length
                    ),
                (since, cwd, maxCount) => fetchCommits({ since, maxCount }, cwd)
            ),
    }
}

function createAnalyzeCommitPatternsTool(context: ToolContext): ToolDefinition {
    return {
        name: 'analyze_commit_patterns',
        title: 'Analyze Commit Patterns',
        description: 'Analyze patterns in a list of commits or recent history',
        group: 'git',
        inputSchema: GitAnalyzePatternsOptionsSchema,
        outputSchema: z
            .object({
                success: z.boolean().optional(),
                analysis: z.unknown().optional(),
                error: z.string().optional(),
            })
            .extend(ErrorFieldsMixin.shape),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
        handler: (params: unknown) => executeAnalyzeCommitPatterns(params, context),
    }
}

export function getGitTools(context: ToolContext): ToolDefinition[] {
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
            handler: (params: unknown) => executeGetCommitHistory(params, context),
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
            handler: (params: unknown) => executeSearchCommits(params, context),
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
            handler: (params: unknown) => executeGetReleaseInfo(params, context),
        },
        {
            name: 'get_unreleased_commits',
            title: 'Get Unreleased Commits',
            description: 'Get commits since the last tag/release',
            group: 'git',
            inputSchema: GitUnreleasedOptionsSchema,
            outputSchema: GitOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params?: unknown) => executeGetUnreleasedCommits(params, context),
        },
        createAnalyzeCommitPatternsTool(context),
        createCheckEntryStalenessTool(context),
    ]
}
