import { simpleGit, type SimpleGitOptions } from 'simple-git'
import type { GitHubIntegration } from '../github-integration/index.js'
import { parseCommitReferences } from './parser.js'
import { resolveReferences, type ResolvedReference } from './resolver.js'
import { logger } from '../../utils/logger.js'

export interface EnrichedCommit {
    hash: string
    subject: string
    body: string
    authorName: string
    date: string
    references: ResolvedReference[]
}

const ENRICH_CONCURRENCY = 8

interface RawGitCommit {
    hash: string
    message: string
    body: string
    author_name: string
    date: string
}

async function resolveCommitRefs(
    commit: RawGitCommit,
    github: GitHubIntegration | undefined,
    defaultOwner: string | null,
    defaultRepo: string | null,
    refCache: Map<string, Promise<ResolvedReference[]>>
): Promise<EnrichedCommit> {
    const fullMessage = `${commit.message}\n\n${commit.body}`
    const rawRefs = parseCommitReferences(fullMessage)
    let resolvedRefs: ResolvedReference[]
    if (github && defaultOwner && defaultRepo && rawRefs.length > 0) {
        resolvedRefs = await Promise.all(
            rawRefs.map(async (ref) => {
                const key = `${ref.owner ?? defaultOwner}/${ref.repo ?? defaultRepo}#${String(ref.number)}`
                let pending = refCache.get(key)
                if (pending === undefined) {
                    pending = resolveReferences([ref], github, defaultOwner, defaultRepo)
                    refCache.set(key, pending)
                }
                const [resolved] = await pending
                return resolved
                    ? { ...resolved, ...ref }
                    : { ...ref, type: 'unknown' as const }
            })
        )
    } else {
        resolvedRefs = rawRefs.map((r) => ({ ...r, type: 'unknown' }))
    }
    return {
        hash: commit.hash,
        subject: commit.message,
        body: commit.body,
        authorName: commit.author_name,
        date: commit.date,
        references: resolvedRefs,
    }
}

async function fetchCommitsBatched(
    validHashes: string[],
    git: ReturnType<typeof simpleGit>
): Promise<RawGitCommit[]> {
    if (validHashes.length === 0) return []
    try {
        const log = await git.log(['--no-walk=unsorted', ...validHashes, '--'])
        if (log.all.length > 0) return [...log.all]
    } catch (err) {
        if (validHashes.length <= 1) {
            logger.warning('Skipping commit enrichment for a single commit', {
                module: 'CommitEnricher',
                hash: validHashes[0],
                error: String(err),
            })
            return []
        }
        // One or more hashes may be missing; fall back to bounded per-commit lookups
    }
    const fetched: RawGitCommit[] = []
    const chunks: string[][] = []
    for (let i = 0; i < validHashes.length; i += ENRICH_CONCURRENCY) {
        chunks.push(validHashes.slice(i, i + ENRICH_CONCURRENCY))
    }
    await chunks.reduce<Promise<void>>(
        (chain, chunk) =>
            chain.then(async () => {
                const settled = await Promise.allSettled(
                    chunk.map((hash) => git.log(['-1', hash, '--']))
                )
                for (let j = 0; j < settled.length; j++) {
                    const outcome = settled[j]
                    if (outcome?.status === 'fulfilled' && outcome.value.latest) {
                        fetched.push(outcome.value.latest)
                    } else if (outcome?.status === 'rejected') {
                        logger.warning('Skipping commit enrichment for a single commit', {
                            module: 'CommitEnricher',
                            hash: chunk[j],
                            error: String(outcome.reason),
                        })
                    }
                }
            }),
        Promise.resolve()
    )
    return fetched
}

export async function enrichCommits(
    workingDir: string,
    commitHashes: string[],
    github?: GitHubIntegration
): Promise<EnrichedCommit[]> {
    // simple-git sets windowsHide: true internally; spawnOptions only accepts uid/gid.
    const gitOptions: Partial<SimpleGitOptions> = {
        baseDir: workingDir,
    }
    const git = simpleGit(gitOptions)
    const enriched: EnrichedCommit[] = []

    const validHashes = commitHashes.filter((hash) => /^[0-9a-fA-F]{7,40}$/.test(hash))
    const cachedRepoInfo = github?.getCachedRepoInfo()
    const repoInfoPromise =
        github && cachedRepoInfo === undefined
            ? github.getRepoInfo()
            : Promise.resolve(cachedRepoInfo ?? null)

    const [repoOutcome, commitsOutcome] = await Promise.allSettled([
        repoInfoPromise,
        fetchCommitsBatched(validHashes, git),
    ])

    let defaultOwner: string | null = null
    let defaultRepo: string | null = null
    if (repoOutcome.status === 'fulfilled' && repoOutcome.value !== null) {
        defaultOwner = repoOutcome.value.owner
        defaultRepo = repoOutcome.value.repo
    } else if (repoOutcome.status === 'rejected') {
        logger.warning('GitHub repo info unavailable; commit references stay unresolved', {
            module: 'CommitEnricher',
            error: String(repoOutcome.reason),
        })
    }

    const rawCommits = commitsOutcome.status === 'fulfilled' ? commitsOutcome.value : []
    const refCache = new Map<string, Promise<ResolvedReference[]>>()
    const commitChunks: RawGitCommit[][] = []
    for (let i = 0; i < rawCommits.length; i += ENRICH_CONCURRENCY) {
        commitChunks.push(rawCommits.slice(i, i + ENRICH_CONCURRENCY))
    }
    await commitChunks.reduce<Promise<void>>(
        (chain, chunk) =>
            chain.then(async () => {
                const outcomes = await Promise.all(
                    chunk.map((commit) =>
                        resolveCommitRefs(commit, github, defaultOwner, defaultRepo, refCache)
                    )
                )
                enriched.push(...outcomes)
            }),
        Promise.resolve()
    )

    return enriched
}
