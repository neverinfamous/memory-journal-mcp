import type { GitHubIntegration } from '../github-integration/index.js'
import type { CommitReference } from './parser.js'

export type ReferenceType = 'issue' | 'pull_request' | 'unknown'

export interface ResolvedReference extends CommitReference {
    type: ReferenceType
    title?: string
    state?: string
    milestone?: {
        number: number
        title: string
    }
}

export async function resolveReferences(
    refs: CommitReference[],
    github: GitHubIntegration,
    defaultOwner: string,
    defaultRepo: string
): Promise<ResolvedReference[]> {
    if (!github.isApiAvailable()) {
        return refs.map((ref) => ({ ...ref, type: 'unknown' }))
    }

    const promises = refs.map(async (ref): Promise<ResolvedReference> => {
        const owner = ref.owner ?? defaultOwner
        const repo = ref.repo ?? defaultRepo

        try {
            const issueDetails = await github.getIssue(owner, repo, ref.number)
            if (issueDetails) {
                return {
                    ...ref,
                    type: 'issue',
                    title: issueDetails.title,
                    state: issueDetails.state,
                    milestone: issueDetails.milestone ?? undefined,
                }
            }

            const prDetails = await github.getPullRequest(owner, repo, ref.number)
            if (prDetails) {
                return {
                    ...ref,
                    type: 'pull_request',
                    title: prDetails.title,
                    state: prDetails.state,
                }
            }

            return { ...ref, type: 'unknown' }
        } catch {
            return { ...ref, type: 'unknown' }
        }
    })

    return Promise.all(promises)
}
