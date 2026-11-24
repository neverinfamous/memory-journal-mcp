/**
 * Pure Git Commit Anchor Extraction Helpers
 *
 * Extracted from `staleness-tools.ts` so `cli/commands/entry.ts` and
 * `cli/commands/entry-update-helpers.ts` can resolve commit file anchors
 * without pulling MCP tool schemas, hallucination healers, or filter caches.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ToolContext } from '../../../types/index.js'
import { mcpLogger } from '../../../utils/mcp-logger.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
} from '../../../utils/workspace-resolver.js'

const execFileAsync = promisify(execFile)
const MAX_AUTO_ANCHORS = 25
const GIT_SHOW_BATCH_CONCURRENCY = 8
const SHA_REGEX = /^[0-9a-f]{7,40}$/i
const COMMIT_MARKER_PREFIX = '__MJ_SHA__:'

export type AnchorStatus = 'pending' | 'valid' | 'stale' | 'invalidated' | 'unresolvable'

function extractValidAutoCommitShas(autoContext: string | undefined): string[] {
    if (autoContext === undefined || autoContext === '') return []
    try {
        const parsed: unknown = JSON.parse(autoContext)
        if (parsed === null || typeof parsed !== 'object') return []
        const commitsVal = 'commits' in parsed ? parsed.commits : undefined
        if (!Array.isArray(commitsVal) || commitsVal.length === 0) return []
        const seen = new Set<string>()
        for (const item of commitsVal) {
            if (typeof item !== 'string') continue
            const trimmed = item.trim()
            if (!SHA_REGEX.test(trimmed)) continue
            seen.add(trimmed.toLowerCase())
            if (seen.size >= 10) break
        }
        return Array.from(seen)
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
    for (const rawToken of output.split('\0')) {
        const token = rawToken.replace(/^[\r\n]+|[\r\n]+$/g, '')
        if (token.length === 0) continue
        if (token.startsWith(COMMIT_MARKER_PREFIX)) {
            currentSha = token.slice(COMMIT_MARKER_PREFIX.length).trim().toLowerCase()
            if (!filesByFullSha.has(currentSha)) filesByFullSha.set(currentSha, [])
        } else if (currentSha !== undefined) {
            filesByFullSha.get(currentSha)?.push(token)
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
            ['show', '--name-only', '-z', `--pretty=format:${COMMIT_MARKER_PREFIX}%H%x00`, ...shas],
            { cwd: repoPath, encoding: 'utf-8', timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 }
        )
        return parseGitShowPerCommitFiles(stdout, shas)
    } catch {
        if (shas.length <= 1) return new Map()
        const mapped = new Map<string, string[]>()
        const shaChunks: (readonly string[])[] = []
        for (let i = 0; i < shas.length; i += GIT_SHOW_BATCH_CONCURRENCY) {
            shaChunks.push(shas.slice(i, i + GIT_SHOW_BATCH_CONCURRENCY))
        }
        await shaChunks.reduce(async (prev, chunk) => {
            await prev
            const outcomes = await Promise.allSettled(
                chunk.map(async (sha) => {
                    const { stdout } = await execFileAsync(
                        'git',
                        ['show', '--name-only', '-z', '--pretty=format:', sha],
                        { cwd: repoPath, encoding: 'utf-8', timeout: 5000, windowsHide: true }
                    )
                    return {
                        sha: sha.toLowerCase(),
                        files: stdout
                            .split('\0')
                            .map((line) => line.replace(/^[\r\n]+|[\r\n]+$/g, ''))
                            .filter((line) => line.length > 0),
                    }
                })
            )
            for (const outcome of outcomes) {
                if (outcome.status === 'fulfilled') {
                    mapped.set(outcome.value.sha, outcome.value.files)
                }
            }
        }, Promise.resolve())
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
        const repoPath = Object.hasOwn(registry, canonicalKey) ? registry[canonicalKey]?.path : undefined
        if (repoPath === undefined || repoPath.length === 0) continue
        let set = shasByRepo.get(repoPath)
        if (set === undefined) {
            set = new Set<string>()
            shasByRepo.set(repoPath, set)
        }
        for (const sha of validShas) set.add(sha)
    }

    const repoJobs = Array.from(shasByRepo.entries())
    const repoChunks: [string, Set<string>][][] = []
    for (let i = 0; i < repoJobs.length; i += GIT_SHOW_BATCH_CONCURRENCY) {
        repoChunks.push(repoJobs.slice(i, i + GIT_SHOW_BATCH_CONCURRENCY))
    }
    await repoChunks.reduce(async (prev, chunk) => {
        await prev
        const outcomes = await Promise.allSettled(
            chunk.map(async ([repoPath, shaSet]) => {
                const attemptedShas = Array.from(shaSet)
                return {
                    repoPath,
                    attemptedShas,
                    filesBySha: await fetchRepoCommitFilesBatch(repoPath, attemptedShas),
                }
            })
        )
        for (const outcome of outcomes) {
            if (outcome.status !== 'fulfilled') continue
            for (const shaLower of outcome.value.attemptedShas) {
                result.set(
                    `${outcome.value.repoPath}\0${shaLower}`,
                    outcome.value.filesBySha.get(shaLower) ?? []
                )
            }
        }
    }, Promise.resolve())
    return result
}

function collectPrefetchedAnchors(
    prefetchedRepoFilesBySha: ReadonlyMap<string, string[]>,
    repoPath: string,
    validShas: string[]
): { allHit: boolean; anchors?: { anchorPath: string; anchorType: string }[] | undefined } {
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

/**
 * Resolves explicit anchors or auto-extracts modified file paths from `auto_context.commits`
 * asynchronously so `checkEntryStaleness` has populated `entry_anchors` rows automatically.
 */
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
        const repoPath =
            registry !== undefined && Object.hasOwn(registry, canonicalKey)
                ? registry[canonicalKey]?.path
                : undefined
        if (repoPath === undefined || repoPath.length === 0) return undefined

        if (prefetchedRepoFilesBySha !== undefined) {
            const prefetched = collectPrefetchedAnchors(prefetchedRepoFilesBySha, repoPath, validShas)
            if (prefetched.allHit) return prefetched.anchors
        }

        const filesBySha = await fetchRepoCommitFilesBatch(repoPath, validShas)
        const uniqueFiles = new Set<string>()
        for (const sha of validShas) {
            const files = filesBySha.get(sha.toLowerCase())
            if (files === undefined) continue
            for (const file of files) {
                uniqueFiles.add(file)
                if (uniqueFiles.size >= MAX_AUTO_ANCHORS) break
            }
            if (uniqueFiles.size >= MAX_AUTO_ANCHORS) break
        }

        if (uniqueFiles.size === 0) return undefined
        return Array.from(uniqueFiles).map((anchorPath) => ({ anchorPath, anchorType: 'file' }))
    } catch (err) {
        mcpLogger.warning('git', 'Auto-anchor extraction failed', {
            error: err instanceof Error ? err.message : String(err),
        })
        return undefined
    }
}
