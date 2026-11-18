import {
    isAlreadyFencedUntrustedContent,
    isAlreadyInlineFencedUntrustedContent,
    markUntrustedContent,
    markUntrustedContentInline,
} from '../../../utils/security-utils.js'

const SAFE_GH_HANDLE_RE = /^[A-Za-z0-9_.-]{1,64}(?:\[bot\])?$/

/** Undo egress fencing when a cached title is written back into a journal entry. */
export function unwrapFencedRemoteText(value: string): string {
    const stripped = value.replace(/<\/?untrusted_remote_content[^>]*>/gi, '')
    return stripped.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
}

/** Idempotently fence a single-line remote GitHub string. */
export function ensureInlineFenced(value: string): string {
    return isAlreadyInlineFencedUntrustedContent(value)
        ? value
        : markUntrustedContentInline(value)
}

/** Idempotently fence a multi-line remote GitHub body string. */
export function ensureBlockFenced(value: string | null | undefined): string {
    if (value === undefined || value === null || value === '') return ''
    return isAlreadyFencedUntrustedContent(value) ? value : markUntrustedContent(value)
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
