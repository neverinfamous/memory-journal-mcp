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

    for (const hash of commitHashes) {
        if (!/^[0-9a-fA-F]{7,40}$/.test(hash)) continue
        try {
            const log = await git.log(['-1', hash, '--'])
            const commit = log.latest
            if (!commit) continue

            const fullMessage = `${commit.message}\n\n${commit.body}`
            const rawRefs = parseCommitReferences(fullMessage)

            let resolvedRefs: ResolvedReference[] = rawRefs.map((r) => ({ ...r, type: 'unknown' }))

            if (github && defaultOwner && defaultRepo && rawRefs.length > 0) {
                resolvedRefs = await resolveReferences(rawRefs, github, defaultOwner, defaultRepo)
            }

            enriched.push({
                hash: commit.hash,
                subject: commit.message,
                body: commit.body,
                authorName: commit.author_name,
                date: commit.date,
                references: resolvedRefs,
            })
        } catch (err) {
            logger.warning('Skipping commit enrichment for a single commit', {
                module: 'CommitEnricher',
                hash,
                error: String(err),
            })
        }
    }

    return enriched
}
