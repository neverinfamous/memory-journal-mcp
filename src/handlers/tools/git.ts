import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import { sendProgress } from '../../utils/progress-utils.js'
import { ResourceNotFoundError, ValidationError } from '../../types/errors.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
    resolveWorkspaceId,
} from '../../utils/workspace-resolver.js'
import {
    evaluateAnchorStaleness,
    readLatestGitTag,
    resolveGitWorkingDir,
    type StalenessCheckRow,
} from './git-staleness.js'
import { coerceNumber } from '../../utils/query-helpers.js'
import { ErrorFieldsMixin } from './error-fields-mixin.js'
import { relaxedNumber } from './schemas.js'
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
import {
    RECORD_SEPARATOR,
    FIELD_SEPARATOR,
    buildGitBaseArgs,
    streamGitRecords,
} from '../../vendor/lib-git-history/git-runner.js'
import { parseGitRecord, processBatch } from '../../vendor/lib-git-history/parser.js'
import type { CliArgs } from '../../vendor/lib-git-history/cli.js'
import type { CommitEntry } from '../../vendor/lib-git-history/schema.js'

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

/** Upper bound on commits returned by get_unreleased_commits. */
const UNRELEASED_MAX_COMMITS = 5000
/** Cap for the no-tag fallback, where "unreleased" is the whole history. */
const NO_TAG_FALLBACK_MAX_COMMITS = 100

async function getUnreleasedChangelog(
    cwd: string
): Promise<{ latestTag: string | null; commits: CommitEntry[]; truncated: boolean }> {
    const latestTag = readLatestGitTag(cwd)
    if (latestTag === null) {
        const commits = await fetchCommits({ maxCount: NO_TAG_FALLBACK_MAX_COMMITS }, cwd)
        return { latestTag: null, commits, truncated: commits.length >= NO_TAG_FALLBACK_MAX_COMMITS }
    }
    const commits = await fetchCommits(
        { ref: `${latestTag}..HEAD`, maxCount: UNRELEASED_MAX_COMMITS },
        cwd
    )
    return { latestTag, commits, truncated: commits.length >= UNRELEASED_MAX_COMMITS }
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
                    isDeleted: z.boolean(),
                    error: z.string().optional(),
                })).optional(),
                skippedWorkspaces: z.array(z.string()).optional(),
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
                    const registry = context.config?.projectRegistry ?? loadProjectRegistryFromConfig()
                    const defaultWs = resolveWorkspaceId(undefined, undefined, context.config)
                    const targetWorkspaces: string[] = []

                        if (rawWs === '*') {
                            if (resolvedEntryId !== undefined) {
                                const entry = db.getEntryByIdIncludeDeleted(resolvedEntryId, '*')
                                if (!entry) throw new ResourceNotFoundError('entry', String(resolvedEntryId))
                                if (typeof rawProj === 'number' && entry.projectNumber !== rawProj) {
                                    throw new ResourceNotFoundError('entry', String(resolvedEntryId))
                                }
                                targetWorkspaces.push(entry.workspaceId ?? defaultWs)
                        } else {
                            const registryKeys = Object.keys(registry ?? {})
                            targetWorkspaces.push(
                                ...(registryKeys.length > 0
                                    ? Array.from(new Set(registryKeys))
                                    : [defaultWs])
                            )
                        }
                    } else {
                        targetWorkspaces.push(resolveWorkspaceId(rawWs, rawProj, context.config))
                    }

                    const results: StalenessCheckRow[] = []
                    const skippedWorkspaces: string[] = []

                    for (const wsId of targetWorkspaces) {
                        const canonicalWs = findCanonicalRegistryKey(wsId, registry) ?? wsId
                        const registryPath = registry?.[canonicalWs]?.path
                        if (registryPath === undefined || registryPath.length === 0) {
                            if (rawWs === '*') {
                                skippedWorkspaces.push(wsId)
                                continue
                            }
                            throw new ValidationError(
                                `No registered repository path for workspace '${wsId}'. Register the project path before checking its anchors.`
                            )
                        }
                        const cwd = registryPath

                        const targets: { id: number; timestamp: string }[] = []
                        if (resolvedEntryId !== undefined) {
                            const entry = db.getEntryByIdIncludeDeleted(resolvedEntryId, rawWs === '*' ? '*' : wsId)
                            if (!entry || (typeof rawProj === 'number' && entry.projectNumber !== rawProj)) {
                                if (rawWs !== '*') throw new ResourceNotFoundError('entry', String(resolvedEntryId))
                                continue
                            }
                            targets.push({ id: entry.id, timestamp: entry.timestamp })
                        } else {
                            const projectNumber = typeof rawProj === 'number' ? rawProj : undefined
                            const { entries: recent } = db.getRecentEntries(20, undefined, undefined, undefined, false, wsId, projectNumber)
                            for (const r of recent) {
                                targets.push({ id: r.id, timestamp: r.timestamp })
                            }
                        }

                        for (const target of targets) {
                            for (const anchor of db.getAnchorsByEntryId(target.id, wsId)) {
                                results.push(
                                    await evaluateAnchorStaleness(
                                        db,
                                        anchor,
                                        target.timestamp,
                                        cwd,
                                        async (anchorPath, since) =>
                                            (await fetchCommits({ path: anchorPath, since }, cwd)).length,
                                        wsId
                                    )
                                )
                            }
                        }
                    }

                    const failureMessages: string[] = []
                    for (const row of results) {
                        if (row.error !== undefined) {
                            failureMessages.push(`${row.path}: ${row.error}`)
                        }
                    }
                    const skipped =
                        skippedWorkspaces.length > 0 ? { skippedWorkspaces } : {}
                    if (failureMessages.length > 0) {
                        return {
                            success: false,
                            results,
                            error: failureMessages.join('; '),
                            ...skipped,
                        }
                    }
                    if (results.length === 0 && skippedWorkspaces.length > 0 && skippedWorkspaces.length === targetWorkspaces.length) {
                        return {
                            success: false,
                            results,
                            error: 'No anchor check ran because no workspace had a registered repository path.',
                            skippedWorkspaces,
                        }
                    }
                    return { success: true, results, ...skipped }
                } catch (err) {
                    return formatHandlerError(err)
                }
            }
        }
    ]
}
