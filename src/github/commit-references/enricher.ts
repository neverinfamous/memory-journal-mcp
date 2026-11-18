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

async function enrichSingleCommit(
    hash: string,
    git: ReturnType<typeof simpleGit>,
    github: GitHubIntegration | undefined,
    defaultOwner: string | null,
    defaultRepo: string | null
): Promise<EnrichedCommit | null> {
    try {
        const log = await git.log(['-1', hash, '--'])
        const commit = log.latest
        if (!commit) return null

        const fullMessage = `${commit.message}\n\n${commit.body}`
        const rawRefs = parseCommitReferences(fullMessage)
        const resolvedRefs: ResolvedReference[] =
            github && defaultOwner && defaultRepo && rawRefs.length > 0
                ? await resolveReferences(rawRefs, github, defaultOwner, defaultRepo)
                : rawRefs.map((r) => ({ ...r, type: 'unknown' }))

        return {
            hash: commit.hash,
            subject: commit.message,
            body: commit.body,
            authorName: commit.author_name,
            date: commit.date,
            references: resolvedRefs,
        }
    } catch (err) {
        logger.warning('Skipping commit enrichment for a single commit', {
            module: 'CommitEnricher',
            hash,
            error: String(err),
        })
        return null
    }
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

    let defaultOwner: string | null = null
    let defaultRepo: string | null = null

    if (github) {
        try {
            const repoInfo = github.getCachedRepoInfo() ?? (await github.getRepoInfo())
            defaultOwner = repoInfo.owner
            defaultRepo = repoInfo.repo
        } catch (err) {
            logger.warning('GitHub repo info unavailable; commit references stay unresolved', {
                module: 'CommitEnricher',
                error: String(err),
            })
        }
    }

    const validHashes = commitHashes.filter((hash) => /^[0-9a-fA-F]{7,40}$/.test(hash))
    for (let i = 0; i < validHashes.length; i += ENRICH_CONCURRENCY) {
        const chunk = validHashes.slice(i, i + ENRICH_CONCURRENCY)
        const outcomes = await Promise.all(
            chunk.map((hash) => enrichSingleCommit(hash, git, github, defaultOwner, defaultRepo))
        )
        for (const item of outcomes) {
            if (item !== null) enriched.push(item)
        }
    }

    return enriched
}
