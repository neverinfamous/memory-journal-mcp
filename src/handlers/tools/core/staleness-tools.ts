import { z } from 'zod'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { MAX_QUERY_LIMIT, relaxedNumber, StrictProjectNumberSchema } from '../schemas.js'
import { coerceAnchorStatusAlias } from '../schemas/hallucination-healer-fields.js'
import { mcpLogger } from '../../../utils/mcp-logger.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
} from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, alignedProjectFilter } from '../../../utils/write-scope.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'

const execFileAsync = promisify(execFile)
const MAX_AUTO_ANCHORS = 25
const GIT_SHOW_BATCH_CONCURRENCY = 8
const SHA_REGEX = /^[0-9a-f]{7,40}$/i
const COMMIT_MARKER_PREFIX = '__MJ_SHA__:'

type AnchorStatus = 'pending' | 'valid' | 'stale' | 'invalidated' | 'unresolvable'

function extractValidAutoCommitShas(autoContext: string | undefined): string[] {
    if (autoContext === undefined || autoContext === '') return []
    try {
        const parsed: unknown = JSON.parse(autoContext)
        if (parsed === null || typeof parsed !== 'object') return []
        const commitsVal = 'commits' in parsed ? parsed.commits : undefined
        if (!Array.isArray(commitsVal) || commitsVal.length === 0) return []
        return commitsVal
            .filter((s): s is string => typeof s === 'string' && SHA_REGEX.test(s.trim()))
            .map((s) => s.trim())
            .slice(0, 10)
    } catch {
        return []
    }
}

function parseGitShowPerCommitFiles(
    output: string,
    requestedShas: readonly string[]
): Map<string, string[]> {
    const filesByFullSha = new Map<string, string[]>()
    let currentSha: string | undefined
    for (const rawLine of output.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (line.length === 0) continue
        if (line.startsWith(COMMIT_MARKER_PREFIX)) {
            currentSha = line.slice(COMMIT_MARKER_PREFIX.length).trim().toLowerCase()
            if (!filesByFullSha.has(currentSha)) filesByFullSha.set(currentSha, [])
        } else if (currentSha !== undefined) {
            filesByFullSha.get(currentSha)?.push(line)
        }
    }
    const mapped = new Map<string, string[]>()
    for (const sha of requestedShas) {
        const lower = sha.toLowerCase()
        for (const [fullSha, files] of filesByFullSha) {
            if (fullSha === lower || fullSha.startsWith(lower)) {
                mapped.set(lower, files)
                break
            }
        }
    }
    return mapped
}

async function fetchRepoCommitFilesBatch(
    repoPath: string,
    shas: readonly string[]
): Promise<Map<string, string[]>> {
    try {
        const { stdout } = await execFileAsync(
            'git',
            ['show', '--name-only', `--pretty=format:${COMMIT_MARKER_PREFIX}%H`, ...shas],
            { cwd: repoPath, encoding: 'utf-8', timeout: 2500, windowsHide: true, maxBuffer: 1024 * 1024 }
        )
        return parseGitShowPerCommitFiles(stdout, shas)
    } catch {
        const mapped = new Map<string, string[]>()
        for (let i = 0; i < shas.length; i += GIT_SHOW_BATCH_CONCURRENCY) {
            const chunk = shas.slice(i, i + GIT_SHOW_BATCH_CONCURRENCY)
            const outcomes = await Promise.allSettled(
                chunk.map(async (sha) => {
                    const { stdout } = await execFileAsync(
                        'git',
                        ['show', '--name-only', '--pretty=format:', sha],
                        { cwd: repoPath, encoding: 'utf-8', timeout: 2500, windowsHide: true }
                    )
                    return {
                        sha: sha.toLowerCase(),
                        files: stdout
                            .split(/\r?\n/)
                            .map((line) => line.trim())
                            .filter((line) => line.length > 0),
                    }
                })
            )
            for (const outcome of outcomes) {
                if (outcome.status === 'fulfilled') {
                    mapped.set(outcome.value.sha, outcome.value.files)
                }
            }
        }
        return mapped
    }
}

/**
 * Pre-fetch modified file lists per commit SHA grouped by repo path with bounded concurrency (8),
 * eliminating per-entry `git show` spawns during `batch_create_entries`.
 */
export async function prefetchBatchCommitFiles(
    items: readonly { autoContext: string | undefined; workspaceId: string }[],
    context: ToolContext
): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>()
    const registry = context.config?.projectRegistry ?? loadProjectRegistryFromConfig()
    if (registry === undefined) return result

    const shasByRepo = new Map<string, Set<string>>()
    for (const item of items) {
        const validShas = extractValidAutoCommitShas(item.autoContext)
        if (validShas.length === 0) continue
        const canonicalKey = findCanonicalRegistryKey(item.workspaceId, registry) ?? item.workspaceId
        const repoPath = registry[canonicalKey]?.path
        if (repoPath === undefined || repoPath.length === 0) continue
        let set = shasByRepo.get(repoPath)
        if (set === undefined) {
            set = new Set<string>()
            shasByRepo.set(repoPath, set)
        }
        for (const sha of validShas) set.add(sha)
    }

    const repoJobs = Array.from(shasByRepo.entries())
    for (let i = 0; i < repoJobs.length; i += GIT_SHOW_BATCH_CONCURRENCY) {
        const chunk = repoJobs.slice(i, i + GIT_SHOW_BATCH_CONCURRENCY)
        const outcomes = await Promise.allSettled(
            chunk.map(async ([repoPath, shaSet]) => ({
                repoPath,
                filesBySha: await fetchRepoCommitFilesBatch(repoPath, Array.from(shaSet)),
            }))
        )
        for (const outcome of outcomes) {
            if (outcome.status !== 'fulfilled') continue
            for (const [shaLower, files] of outcome.value.filesBySha) {
                result.set(`${outcome.value.repoPath}\0${shaLower}`, files)
            }
        }
    }
    return result
}

/**
 * Resolves explicit anchors or auto-extracts modified file paths from `auto_context.commits`
 * asynchronously so `checkEntryStaleness` has populated `entry_anchors` rows automatically.
 */
function collectPrefetchedAnchors(
    prefetchedRepoFilesBySha: ReadonlyMap<string, string[]>,
    repoPath: string,
    validShas: string[]
): { allHit: boolean; anchors?: { anchorPath: string; anchorType: string }[] } {
    const prefetchedSet = new Set<string>()
    for (const sha of validShas) {
        const hit = prefetchedRepoFilesBySha.get(`${repoPath}\0${sha.toLowerCase()}`)
        if (hit === undefined) return { allHit: false }
        for (const file of hit) {
            prefetchedSet.add(file)
            if (prefetchedSet.size >= MAX_AUTO_ANCHORS) break
        }
        if (prefetchedSet.size >= MAX_AUTO_ANCHORS) break
    }
    return {
        allHit: true,
        anchors:
            prefetchedSet.size === 0
                ? undefined
                : Array.from(prefetchedSet).map((anchorPath) => ({ anchorPath, anchorType: 'file' })),
    }
}

export async function resolveEntryAnchors(
    explicitAnchors:
        | { anchor_path: string; anchor_type: string; status?: AnchorStatus }[]
        | undefined,
    autoContext: string | undefined,
    workspaceId: string,
    context: ToolContext,
    prefetchedRepoFilesBySha?: ReadonlyMap<string, string[]>
): Promise<{ anchorPath: string; anchorType: string; status?: AnchorStatus }[] | undefined> {
    if (explicitAnchors !== undefined && explicitAnchors.length > 0) {
        return explicitAnchors.map((a) => ({
            anchorPath: a.anchor_path,
            anchorType: a.anchor_type,
            ...(a.status !== undefined ? { status: a.status } : {}),
        }))
    }
    const validShas = extractValidAutoCommitShas(autoContext)
    if (validShas.length === 0) return undefined

    try {
        const registry = context.config?.projectRegistry ?? loadProjectRegistryFromConfig()
        const canonicalKey = findCanonicalRegistryKey(workspaceId, registry) ?? workspaceId
        const repoPath = registry !== undefined ? registry[canonicalKey]?.path : undefined
        if (repoPath === undefined || repoPath.length === 0) return undefined

        if (prefetchedRepoFilesBySha !== undefined) {
            const prefetched = collectPrefetchedAnchors(prefetchedRepoFilesBySha, repoPath, validShas)
            if (prefetched.allHit) return prefetched.anchors
        }

        const { stdout: output } = await execFileAsync(
            'git',
            ['show', '--name-only', '--pretty=format:', ...validShas],
            {
                cwd: repoPath,
                encoding: 'utf-8',
                timeout: 2500,
                windowsHide: true,
            }
        )
        const uniqueFiles = Array.from(
            new Set(
                output
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0)
            )
        ).slice(0, MAX_AUTO_ANCHORS)

        if (uniqueFiles.length === 0) return undefined
        return uniqueFiles.map((anchorPath) => ({ anchorPath, anchorType: 'file' }))
    } catch (err) {
        mcpLogger.warning('git', 'Auto-anchor extraction failed', {
            error: err instanceof Error ? err.message : String(err),
        })
        return undefined
    }
}

function preprocessMarkAnchorsStale(val: unknown): unknown {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) return val
    const obj = { ...(val as Record<string, unknown>) }
    if (obj['updates'] === undefined && Array.isArray(obj['anchors'])) {
        obj['updates'] = obj['anchors']
        delete obj['anchors']
    }
    if (Array.isArray(obj['updates'])) {
        obj['updates'] = obj['updates'].map((rawItem: unknown) => {
            if (typeof rawItem !== 'object' || rawItem === null || Array.isArray(rawItem)) {
                return rawItem
            }
            const item = { ...(rawItem as Record<string, unknown>) }
            // [INVARIANT] M2: only anchor-ID aliases map to entry_anchors.id. entry_id/entryId are
            // journal entry IDs and are left unmapped so the schema rejects them (missing `id`).
            const rawId = item['id'] ?? item['anchor_id'] ?? item['anchorId']
            if (rawId !== undefined) {
                const numId = typeof rawId === 'string' ? Number(rawId.trim()) : rawId
                if (typeof numId === 'number' && !Number.isNaN(numId)) {
                    item['id'] = numId
                }
            }
            delete item['anchor_id']
            delete item['anchorId']
            const mappedStatus = coerceAnchorStatusAlias(item['status'])
            if (mappedStatus !== undefined) {
                item['status'] = mappedStatus
            }
            return item
        })
    }
    return obj
}

export const MarkAnchorsStaleSchema = z.preprocess(
    preprocessMarkAnchorsStale,
    z
        .object({
            updates: z
                .array(
                    z.object({
                        id: z.number(),
                        status: z.enum(['pending', 'valid', 'stale', 'invalidated', 'unresolvable']),
                    })
                )
                .min(1)
                .max(MAX_QUERY_LIMIT),
            workspace_id: z.string().optional(),
            project_number: StrictProjectNumberSchema.optional(),
        })
        .strict()
)

export const MarkAnchorsStaleSchemaMcp = z.preprocess(
    preprocessMarkAnchorsStale,
    z.object({
        updates: z
            .array(
                z.object({
                    id: relaxedNumber(),
                    status: z.string(),
                })
            )
            .optional(),
        workspace_id: z.string().optional(),
        project_number: relaxedNumber().optional(),
    })
)

const MarkAnchorsStaleOutputSchema = z
    .object({
        success: z.boolean().optional(),
        updated_count: z.number().optional(),
        not_found_ids: z.array(z.number()).optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export function getStalenessTools(context: ToolContext): ToolDefinition[] {
    const { db } = context

    return [
        {
            name: 'mark_anchors_stale',
            title: 'Mark Anchors Stale',
            description:
                'Update the status of multiple anchors (e.g. to stale or invalidated) based on validation rules or git history checks.',
            group: 'core',
            inputSchema: MarkAnchorsStaleSchemaMcp,
            outputSchema: MarkAnchorsStaleOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const input = MarkAnchorsStaleSchema.parse(params)
                    const wsId = resolveWriteWorkspaceId(
                        input.workspace_id,
                        input.project_number,
                        context.config
                    )
                    const scopedProject = alignedProjectFilter(
                        wsId,
                        input.project_number,
                        activeProjectRegistry(context.config?.projectRegistry)
                    )

                    let updatedCount = 0
                    const missingIds: number[] = []
                    db.executeInTransaction(() => {
                        for (const update of input.updates) {
                            if (db.updateAnchorStatus(update.id, update.status, wsId, scopedProject)) {
                                updatedCount++
                            } else {
                                missingIds.push(update.id)
                            }
                        }
                    })

                    if (updatedCount === 0) {
                        return {
                            success: false,
                            error: 'No anchors were updated',
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            recoverable: true,
                            updated_count: 0,
                            ...(missingIds.length > 0 ? { not_found_ids: missingIds } : {}),
                        }
                    }
                    return {
                        success: true,
                        updated_count: updatedCount,
                        ...(missingIds.length > 0 ? { not_found_ids: missingIds } : {}),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        }
    ]
}
