import { simpleGit } from 'simple-git'
import type { GitHubIntegration } from '../github-integration/index.js'
import { parseCommitReferences } from './parser.js'
import { resolveReferences, type ResolvedReference } from './resolver.js'

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
    const git = simpleGit(workingDir)
    const enriched: EnrichedCommit[] = []

    let defaultOwner: string | null = null
    let defaultRepo: string | null = null

    if (github) {
        try {
            const repoInfo = github.getCachedRepoInfo() ?? (await github.getRepoInfo())
            defaultOwner = repoInfo.owner
            defaultRepo = repoInfo.repo
        } catch {
            // ignore
        }
    }

    for (const hash of commitHashes) {
        try {
            const log = await git.log(['-1', hash])
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
        } catch {
            // Ignore git errors for single commits
        }
    }

    return enriched
}
