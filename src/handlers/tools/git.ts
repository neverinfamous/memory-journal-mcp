import { z } from 'zod'
import type { ToolDefinition, ToolContext, AnchorStatus } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import { sendProgress } from '../../utils/progress-utils.js'
import { ErrorFieldsMixin } from './error-fields-mixin.js'
import { buildGitBaseArgs, streamGitRecords } from '../../vendor/lib-git-history/git-runner.js'
import { parseGitRecord, processBatch } from '../../vendor/lib-git-history/parser.js'
import type { CliArgs } from '../../vendor/lib-git-history/cli.js'
import type { CommitEntry } from '../../vendor/lib-git-history/schema.js'

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
    changelog: z.any().optional(),
    error: z.string().optional(),
}).extend(ErrorFieldsMixin.shape)

interface FetchCommitsInput {
    maxCount?: number
    path?: string
    since?: string
    query?: string
    ref?: string
}

async function fetchCommits(input: FetchCommitsInput, cwd: string): Promise<CommitEntry[]> {
    const cliArgs: CliArgs = {
        limit: input.maxCount?.toString(),
        path: input.path,
        since: input.since,
        grep: input.query,
    }
    const gitArgs = buildGitBaseArgs(cliArgs, input.ref || 'HEAD')
    
    // Formatting args required by parseGitRecord
    gitArgs.push(
        '--name-status',
        '-z',
        '--format=%x1E<GIT_RECORD_BOUNDARY_TODO>%x1E%H%x1E<GIT_FIELD_BOUNDARY_TODO>%x1E%D%x1E<GIT_FIELD_BOUNDARY_TODO>%x1E%an%x1E<GIT_FIELD_BOUNDARY_TODO>%x1E%ae%x1E<GIT_FIELD_BOUNDARY_TODO>%x1E%aI%x1E<GIT_FIELD_BOUNDARY_TODO>%x1E%cn%x1E<GIT_FIELD_BOUNDARY_TODO>%x1E%ce%x1E<GIT_FIELD_BOUNDARY_TODO>%x1E%cI%x1E<GIT_FIELD_BOUNDARY_TODO>%x1E%s%x1E<GIT_FIELD_BOUNDARY_TODO>%x1E%b%x1E<GIT_FIELD_BOUNDARY_TODO>%x1E%(trailers:unfold,only)%x1E<GIT_FIELD_BOUNDARY_TODO>%x1E%(trailers:unfold)%x1E<GIT_FIELD_BOUNDARY_TODO>%x1E%P'
    )
    // Actually we should just fetch the basic BOUNDARY constants from git-runner
    const { RECORD_SEPARATOR, FIELD_SEPARATOR } = await import('../../vendor/lib-git-history/git-runner.js')
    
    // pop the fake format and push the real one
    gitArgs.pop()
    gitArgs.push(`--format=${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%D${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%cn${FIELD_SEPARATOR}%ce${FIELD_SEPARATOR}%cI${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b${FIELD_SEPARATOR}%(trailers:unfold,only)${FIELD_SEPARATOR}%(trailers:unfold)${FIELD_SEPARATOR}%P`)

    const records = streamGitRecords(gitArgs, cwd)
    const batch = []
    for await (const record of records) {
        const parsed = parseGitRecord(record, cliArgs)
        if (parsed) batch.push(parsed)
    }
    const commits = await processBatch(batch, cliArgs, [])
    return commits
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
                    const cwd = process.cwd()
                    const input = GitHistoryOptionsSchema.parse(params)
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
                    const cwd = process.cwd()
                    const input = GitSearchOptionsSchema.parse(params)
                    await sendProgress(progress, 0, 1, `Searching commits for "${input.query}"...`)
                    const commits = await fetchCommits({ query: input.query, maxCount: input.maxCount }, cwd)
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
                    const cwd = process.cwd()
                    const input = GitReleaseInfoOptionsSchema.parse(params)
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
                    const cwd = process.cwd()
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
                    const cwd = process.cwd()
                    const input = z.object({ maxCount: z.number().optional().default(50) }).parse(params)
                    await sendProgress(progress, 0, 2, 'Fetching commits for analysis...')
                    const commits = await fetchCommits({ maxCount: input.maxCount }, cwd)
                    await sendProgress(progress, 1, 2, 'Analyzing commits...')
                    
                    const analysis = {
                        totalCommits: commits.length,
                        byType: {} as Record<string, number>,
                        byAuthor: {} as Record<string, number>,
                        breakingCount: 0,
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
                entryId: z.number().describe('The ID of the journal entry to check')
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
                    const cwd = process.cwd()
                    const input = z.object({ entryId: z.number() }).parse(params)
                    
                    const entry = db.getEntryByIdIncludeDeleted(input.entryId)
                    if (!entry) throw new Error(`Entry ${input.entryId} not found`)
                    
                    const anchors = db.getAnchorsByEntryId(input.entryId)
                    if (anchors.length === 0) {
                        return { success: true, results: [] }
                    }

                    const fs = await import('node:fs')
                    const path = await import('node:path')
                    const workspaceRoot = process.cwd()

                    const results = []
                    
                    for (const anchor of anchors) {
                        let isDeleted = false
                        let commitsSince = 0
                        let newStatus: AnchorStatus = anchor.status

                        try {
                            const fullPath = path.resolve(workspaceRoot, anchor.anchorPath)
                            if (!fullPath.startsWith(workspaceRoot)) {
                                throw new Error(`Path traversal detected: ${anchor.anchorPath}`)
                            }

                            isDeleted = !fs.existsSync(fullPath)
                            
                            if (isDeleted) {
                                newStatus = 'invalidated'
                            } else {
                                const commits = await fetchCommits({
                                    path: anchor.anchorPath,
                                    since: entry.timestamp
                                }, cwd)
                                commitsSince = commits.length
                                if (commitsSince > 0) {
                                    newStatus = 'stale'
                                } else if (anchor.status === 'pending') {
                                    newStatus = 'valid'
                                }
                            }
                            
                            if (newStatus !== anchor.status) {
                                if (anchor.id !== undefined) {
                                    db.updateAnchorStatus(anchor.id, newStatus)
                                }
                            }

                            results.push({
                                anchorId: anchor.id,
                                path: anchor.anchorPath,
                                oldStatus: anchor.status,
                                newStatus,
                                commitsSince,
                                isDeleted
                            })
                        } catch {
                            results.push({
                                anchorId: anchor.id,
                                path: anchor.anchorPath,
                                oldStatus: anchor.status,
                                newStatus: 'unresolvable',
                                commitsSince: 0,
                                isDeleted: false
                            })
                            if (anchor.status !== 'unresolvable' && anchor.id !== undefined) {
                                db.updateAnchorStatus(anchor.id, 'unresolvable')
                            }
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
