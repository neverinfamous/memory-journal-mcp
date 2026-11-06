import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import { sendProgress } from '../../utils/progress-utils.js'
import { ResourceNotFoundError, ValidationError } from '../../types/errors.js'
import { resolveWorkspaceId } from '../../utils/workspace-resolver.js'
import { evaluateAnchorStaleness, resolveGitWorkingDir } from './git-staleness.js'
import { coerceNumber } from '../../utils/query-helpers.js'
import { ErrorFieldsMixin } from './error-fields-mixin.js'
import { relaxedNumber } from './schemas.js'
import {
    RECORD_SEPARATOR,
    FIELD_SEPARATOR,
    buildGitBaseArgs,
    streamGitRecords,
} from '../../vendor/lib-git-history/git-runner.js'
import { parseGitRecord, processBatch } from '../../vendor/lib-git-history/parser.js'
import type { CliArgs } from '../../vendor/lib-git-history/cli.js'
import type { CommitEntry } from '../../vendor/lib-git-history/schema.js'

// --- Schemas ---
export const GitHistoryOptionsSchema = z.object({
    ref: z.string().optional(), path: z.string().optional(), maxCount: z.number().optional(),
    since: z.string().optional(), sortBy: z.enum(['date', 'impact']).optional(),
    scope: z.string().optional(), techDebtAudit: z.boolean().optional(),
    repo: z.string().optional(), workspace_id: z.string().optional(), workspaceId: z.string().optional(),
    project_number: z.number().optional(), cwd: z.string().optional(),
})

export const GitHistoryOptionsSchemaMcp = z.object({
    ref: z.string().optional().describe('Git reference (branch, tag, commit). Default: HEAD'),
    path: z.string().optional().describe('Filter by specific file or directory path'),
    maxCount: relaxedNumber().optional().describe('Maximum number of commits to return. Default: 50'),
    max_count: relaxedNumber().optional(), limit: relaxedNumber().optional(),
    repo: z.string().optional().describe('Target repository or workspace name'),
    workspace_id: z.string().optional(), workspaceId: z.string().optional(),
    project_number: relaxedNumber().optional(), cwd: z.string().optional(),
    since: z.string().optional().describe('Show commits more recent than a specific date'),
    sortBy: z.string().optional().describe('Sort commits by date or impact score'),
    scope: z.string().optional().describe('Filter commits by a specific scope'),
    techDebtAudit: z.boolean().optional().describe('Filter for high impact commits with low trust or missing validation'),
}).transform((d) => ({ ...d, maxCount: d.maxCount ?? d.max_count ?? d.limit }))

export const GitSearchOptionsSchema = z.object({
    query: z.string().min(1), maxCount: z.number().optional(),
    sortBy: z.enum(['date', 'impact']).optional(), scope: z.string().optional(),
    techDebtAudit: z.boolean().optional(), repo: z.string().optional(),
    workspace_id: z.string().optional(), workspaceId: z.string().optional(),
    project_number: z.number().optional(), cwd: z.string().optional(),
})

export const GitSearchOptionsSchemaMcp = z.object({
    query: z.string().optional().describe('Search query to match in commit messages'),
    maxCount: relaxedNumber().optional().describe('Maximum number of commits to return. Default: 50'),
    max_count: relaxedNumber().optional(), limit: relaxedNumber().optional(),
    repo: z.string().optional().describe('Target repository or workspace name'),
    workspace_id: z.string().optional(), workspaceId: z.string().optional(),
    project_number: relaxedNumber().optional(), cwd: z.string().optional(),
    sortBy: z.string().optional().describe('Sort commits by date or impact score'),
    scope: z.string().optional().describe('Filter commits by a specific scope'),
    techDebtAudit: z.boolean().optional().describe('Filter for high impact commits with low trust or missing validation'),
}).transform((d) => ({ ...d, maxCount: d.maxCount ?? d.max_count ?? d.limit }))

export const GitReleaseInfoOptionsSchema = z.object({
    ref: z.string().optional(), repo: z.string().optional(), workspace_id: z.string().optional(), cwd: z.string().optional(),
})

export const GitReleaseInfoOptionsSchemaMcp = z.object({
    ref: z.string().optional().describe('Git reference (branch, tag, commit). Default: HEAD'),
    repo: z.string().optional().describe('Target repository or workspace name'),
    workspace_id: z.string().optional(), cwd: z.string().optional(),
})

export const GitUnreleasedOptionsSchema = z.object({
    repo: z.string().optional(), workspace_id: z.string().optional(), cwd: z.string().optional(),
})

export const GitAnalyzePatternsOptionsSchema = z.object({
    maxCount: relaxedNumber().optional().default(50), repo: z.string().optional(),
    workspace_id: z.string().optional(), cwd: z.string().optional(),
})

export const GitOutputSchema = z.object({
    success: z.boolean(),
    commits: z.array(z.unknown()).optional(),
    changelog: z.unknown().optional(),
    error: z.string().optional(),
}).extend(ErrorFieldsMixin.shape)

interface FetchCommitsInput {
    maxCount?: number
    path?: string
    since?: string
    query?: string
    ref?: string
    sortBy?: 'date' | 'impact'
    scope?: string
    techDebtAudit?: boolean
}

async function fetchCommits(input: FetchCommitsInput, cwd: string): Promise<CommitEntry[]> {
    const needsPostProcessing = input.sortBy === 'impact' || input.techDebtAudit === true || input.scope !== undefined
    const fetchLimit = needsPostProcessing ? 500 : (input.maxCount ?? 50)

    const cliArgs: CliArgs = {
        limit: fetchLimit,
        path: input.path,
        since: input.since,
        grep: input.query,
    }
    const gitArgs = ['log', ...buildGitBaseArgs(cliArgs, input.ref || 'HEAD')]

    gitArgs.push(
        '--name-status',
        '-z',
        `--format=${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%D${FIELD_SEPARATOR}%aN${FIELD_SEPARATOR}%aE${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%cN${FIELD_SEPARATOR}%cE${FIELD_SEPARATOR}%cI${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b${FIELD_SEPARATOR}%(trailers:unfold,only)${FIELD_SEPARATOR}%(trailers:unfold)${FIELD_SEPARATOR}%P`
    )

    const records = streamGitRecords(gitArgs, cwd)
    const batch = []
    for await (const record of records) {
        const parsed = parseGitRecord(record, cliArgs)
        if (parsed) batch.push(parsed)
    }
    const commits = await processBatch(batch, cliArgs, [])

    let processedCommits = commits

    if (input.scope !== undefined) {
        processedCommits = processedCommits.filter(c => c.scope === input.scope)
    }

    if (input.techDebtAudit === true) {
        processedCommits = processedCommits.filter(c => {
            const meta = c.metadata
            const impact = typeof meta?.impact === 'number' ? meta.impact : parseFloat(meta?.impact ?? '0')
            const trust = typeof meta?.trust === 'number' ? meta.trust : parseFloat(meta?.trust ?? '1')
            return impact >= 0.5 && (trust < 0.8 || meta?.validation === 'none')
        })
    }

    if (input.sortBy === 'impact') {
        processedCommits.sort((a, b) => {
            const impactA = typeof a.metadata?.impact === 'number' ? a.metadata.impact : parseFloat(a.metadata?.impact ?? '0')
            const impactB = typeof b.metadata?.impact === 'number' ? b.metadata.impact : parseFloat(b.metadata?.impact ?? '0')
            return impactB - impactA
        })
    }

    if (needsPostProcessing && input.maxCount !== undefined) {
        processedCommits = processedCommits.slice(0, input.maxCount)
    }

    return processedCommits
}

async function getUnreleasedChangelog(cwd: string): Promise<{ latestTag: string | null; commits: CommitEntry[] }> {
    const { execFileSync } = await import('node:child_process')
    // A simplified version to get latest tag, then get commits since then
    try {
        const latestTag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], { cwd, encoding: 'utf-8', windowsHide: true }).trim()
        const commits = await fetchCommits({ ref: `${latestTag}..HEAD` }, cwd)
        return { latestTag, commits }
    } catch {
        // Fallback if no tags
        const commits = await fetchCommits({ maxCount: 100 }, cwd)
        return { latestTag: null, commits }
    }
}

export function getGitTools(context: ToolContext): ToolDefinition[] {
    const { progress } = context

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
                    const parsedMcp = GitHistoryOptionsSchemaMcp.parse(params)
                    const cwd = resolveGitWorkingDir(parsedMcp, context.config)
                    const input = GitHistoryOptionsSchema.parse(parsedMcp)
                    await sendProgress(progress, 0, 1, 'Fetching commit history...')
                    const commits = await fetchCommits(input, cwd)
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
                    const parsedMcp = GitSearchOptionsSchemaMcp.parse(params)
                    const cwd = resolveGitWorkingDir(parsedMcp, context.config)
                    const input = GitSearchOptionsSchema.parse(parsedMcp)
                    await sendProgress(progress, 0, 1, `Searching commits for "${input.query}"...`)
                    const commits = await fetchCommits(input, cwd)
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
                    const parsedMcp = GitReleaseInfoOptionsSchemaMcp.parse(params)
                    const cwd = resolveGitWorkingDir(parsedMcp, context.config)
                    const input = GitReleaseInfoOptionsSchema.parse(parsedMcp)
                    await sendProgress(progress, 0, 1, 'Fetching release info...')
                    const commits = await fetchCommits({ ref: input.ref, maxCount: 10 }, cwd)
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
            inputSchema: GitUnreleasedOptionsSchema,
            outputSchema: GitOutputSchema,
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
            handler: async (params?: unknown) => {
                try {
                    const input = GitUnreleasedOptionsSchema.parse(params ?? {})
                    const cwd = resolveGitWorkingDir(input, context.config)
                    await sendProgress(progress, 0, 1, 'Fetching unreleased commits...')
                    const changelog = await getUnreleasedChangelog(cwd)
                    return { success: true, changelog }
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
            inputSchema: GitAnalyzePatternsOptionsSchema,
            outputSchema: z.object({
                success: z.boolean(),
                analysis: z.unknown().optional(),
                error: z.string().optional()
            }).extend(ErrorFieldsMixin.shape),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
            handler: async (params: unknown) => {
                try {
                    const input = GitAnalyzePatternsOptionsSchema.parse(params ?? {})
                    const cwd = resolveGitWorkingDir(input, context.config)
                    await sendProgress(progress, 0, 2, 'Fetching commits for analysis...')
                    const max = typeof input.maxCount === 'number' ? input.maxCount : Number(input.maxCount)
                    const commits = await fetchCommits({ maxCount: Number.isNaN(max) ? 50 : max }, cwd)
                    await sendProgress(progress, 1, 2, 'Analyzing commits...')

                    const analysis = {
                        totalCommits: commits.length,
                        byType: {} as Record<string, number>,
                        byAuthor: {} as Record<string, number>,
                        breakingCount: 0,
                        totalInsertions: 0,
                        totalDeletions: 0,
                        totalImpact: 0,
                        byCategory: {} as Record<string, number>
                    }

                    for (const c of commits) {
                        if (c.type) {
                            analysis.byType[c.type] = (analysis.byType[c.type] ?? 0) + 1
                        }
                        if (c.author) {
                            analysis.byAuthor[c.author] = (analysis.byAuthor[c.author] ?? 0) + 1
                        }
                        if (c.isBreaking) {
                            analysis.breakingCount++
                        }

                        analysis.totalInsertions += (c.totalInsertions ?? 0)
                        analysis.totalDeletions += (c.totalDeletions ?? 0)

                        if (c.metadata?.impact !== undefined) {
                            const imp = typeof c.metadata.impact === 'number' ? c.metadata.impact : parseFloat(c.metadata.impact ?? '0')
                            if (!isNaN(imp)) analysis.totalImpact += imp
                        }

                        const categories = c.metadata?.category ?? []
                        for (const cat of categories) {
                            analysis.byCategory[cat] = (analysis.byCategory[cat] ?? 0) + 1
                        }
                    }

                    return { success: true, analysis }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'check_entry_staleness',
            title: 'Check Entry Staleness',
            description: 'Check if a journal entry\'s anchors have been modified or deleted in git since the entry was created.',
            group: 'git',
            inputSchema: z.object({
                entry_id: relaxedNumber()
                    .optional()
                    .describe('The ID of the journal entry to check'),
                entryId: relaxedNumber()
                    .optional()
                    .describe('The ID of the journal entry to check (alias for entry_id)'),
                workspace_id: z.string().optional().describe('Workspace identifier (defaults to current project)'),
                workspaceId: z.string().optional().describe('Workspace identifier alias'),
                project_number: relaxedNumber().optional().describe('Numeric project identifier'),
                projectNumber: relaxedNumber().optional().describe('Numeric project identifier alias'),
            }),
            outputSchema: z.object({
                success: z.boolean(),
                results: z.array(z.object({
                    anchorId: z.number(),
                    path: z.string(),
                    oldStatus: z.string(),
                    newStatus: z.string(),
                    commitsSince: z.number(),
                    isDeleted: z.boolean()
                })).optional(),
                error: z.string().optional()
            }).extend(ErrorFieldsMixin.shape),
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const { db } = context
                    const parsedParams = z
                        .object({
                            entry_id: z.preprocess(coerceNumber, z.number().int().optional()),
                            entryId: z.preprocess(coerceNumber, z.number().int().optional()),
                            workspace_id: z.string().optional(),
                            workspaceId: z.string().optional(),
                            project_number: z.preprocess(coerceNumber, z.number().int().optional()),
                            projectNumber: z.preprocess(coerceNumber, z.number().int().optional()),
                        })
                        .parse(params)
                    const resolvedEntryId = parsedParams.entry_id ?? parsedParams.entryId
                    const rawWs = parsedParams.workspace_id ?? parsedParams.workspaceId
                    const rawProj = parsedParams.project_number ?? parsedParams.projectNumber
                    if (rawWs === '*') {
                        // Anchors are checked against a single repository root; a cross-workspace
                        // sweep would invalidate anchors of other repos against the wrong root.
                        throw new ValidationError(
                            "check_stale_anchors mutates anchor status against one repository root and does not accept workspace_id '*'. Pass a specific workspace_id or project_number."
                        )
                    }
                    const wsId = resolveWorkspaceId(rawWs, rawProj, context.config)
                    const registryPath = context.config?.projectRegistry?.[wsId]?.path
                    const cwd = registryPath !== undefined && registryPath.length > 0 ? registryPath : process.cwd()

                    const targets: { id: number; timestamp: string }[] = []
                    if (resolvedEntryId !== undefined) {
                        const entry = db.getEntryByIdIncludeDeleted(resolvedEntryId, wsId)
                        if (!entry) throw new ResourceNotFoundError('entry', String(resolvedEntryId))
                        targets.push({ id: entry.id, timestamp: entry.timestamp })
                    } else {
                        const { entries: recent } = db.getRecentEntries(20, undefined, undefined, undefined, false, wsId)
                        for (const r of recent) {
                            targets.push({ id: r.id, timestamp: r.timestamp })
                        }
                    }

                    const workspaceRoot = cwd

                    const results: {
                        anchorId: number
                        path: string
                        oldStatus: string
                        newStatus: string
                        commitsSince: number
                        isDeleted: boolean
                    }[] = []

                    for (const target of targets) {
                        for (const anchor of db.getAnchorsByEntryId(target.id)) {
                            results.push(
                                await evaluateAnchorStaleness(
                                    db,
                                    anchor,
                                    target.timestamp,
                                    workspaceRoot,
                                    async (anchorPath, since) =>
                                        (await fetchCommits({ path: anchorPath, since }, workspaceRoot)).length
                                )
                            )
                        }
                    }

                    return { success: true, results }
                } catch (err) {
                    return formatHandlerError(err)
                }
            }
        }
    ]
}
