import { markUntrustedContent, markUntrustedContentInline } from '../../../utils/security-utils.js'

const ALREADY_FENCED_RE =
    /^<untrusted_remote_content>(?:\n[\s\S]*\n|[^\n]*)<\/untrusted_remote_content>$/
const SAFE_GH_HANDLE_RE = /^[A-Za-z0-9_.-]{1,64}(?:\[bot\])?$/

/** Idempotently fence a single-line remote GitHub string. */
export function ensureInlineFenced(value: string): string {
    return ALREADY_FENCED_RE.test(value) ? value : markUntrustedContentInline(value)
}

/** Idempotently fence a multi-line remote GitHub body string. */
export function ensureBlockFenced(value: string | null | undefined): string {
    if (value === undefined || value === null || value === '') return ''
    return ALREADY_FENCED_RE.test(value) ? value : markUntrustedContent(value)
}

/** Keep plain GitHub handles intact while fencing injected or non-canonical login strings. */
export function fenceUntrustedHandle(handle: string): string {
    return SAFE_GH_HANDLE_RE.test(handle) ? handle : ensureInlineFenced(handle)
}

/** Fence remote ref/path/label strings without altering cached GitHub integration structs. */
export function fenceGitHubPullRequestSummary<
    T extends { title: string; headRef?: string | undefined },
>(pr: T): T {
    return {
        ...pr,
        title: ensureInlineFenced(pr.title),
        ...(pr.headRef !== undefined ? { headRef: ensureInlineFenced(pr.headRef) } : {}),
    }
}

/** Fence remote fields on full pull request detail payloads (body is truncated before call). */
export function fenceGitHubPullRequestDetails<
    T extends {
        title: string
        headBranch: string
        baseBranch: string
        author: string
        headRef?: string | undefined
    },
>(pr: T): T {
    return {
        ...pr,
        title: ensureInlineFenced(pr.title),
        headBranch: ensureInlineFenced(pr.headBranch),
        baseBranch: ensureInlineFenced(pr.baseBranch),
        author: fenceUntrustedHandle(pr.author),
        ...(pr.headRef !== undefined ? { headRef: ensureInlineFenced(pr.headRef) } : {}),
    }
}

/** Fence untrusted labels/assignees/milestone on full GitHub issue details. */
export function fenceGitHubIssueDetailsFields<
    T extends {
        title: string
        labels?: string[] | undefined
        assignees?: string[] | undefined
        milestone?: { number: number; title: string } | null | undefined
    },
>(issue: T): T {
    return {
        ...issue,
        title: ensureInlineFenced(issue.title),
        ...(issue.labels !== undefined ? { labels: issue.labels.map(ensureInlineFenced) } : {}),
        ...(issue.assignees !== undefined
            ? { assignees: issue.assignees.map(fenceUntrustedHandle) }
            : {}),
        ...(issue.milestone !== undefined && issue.milestone !== null
            ? {
                  milestone: {
                      ...issue.milestone,
                      title: ensureInlineFenced(issue.milestone.title),
                  },
              }
            : {}),
    }
}
