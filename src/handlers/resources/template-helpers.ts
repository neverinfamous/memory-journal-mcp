/**
 * Helpers shared by the project-scoped template resources (templates.ts).
 */

import type { JournalEntry } from '../../types/index.js'
import { parseSessionCommitContext } from '../../types/auto-context.js'
import { loadProjectRegistryFromConfig } from '../../utils/workspace-resolver.js'
import {
    getGitHubIntegration,
    type GitHubIntegration,
} from '../../github/github-integration/index.js'
import type { ResourceContext } from './shared.js'
import { fenceUntrustedInline, resourceWorkspace } from './shared.js'
import { markUntrustedContent } from '../../utils/security-utils.js'
import { ValidationError } from '../../types/errors.js'
import type { enrichCommits } from '../../github/commit-references/index.js'

export type EnrichedCommit = Awaited<ReturnType<typeof enrichCommits>>[number]

export interface IssueGroup {
    number: number
    title?: string
    state?: string
    milestone?: { number: number; title: string }
    commits: { hash: string; subject: string; authorName: string; date: string }[]
}

export interface PrGroup {
    number: number
    title?: string
    state?: string
    commits: { hash: string; subject: string; authorName: string; date: string }[]
}

/**
 * Resolve the workspace and working directory for a project-scoped resource.
 * When a project registry is configured the project must be registered; otherwise the
 * caller should return an empty result with `hint` instead of data from another project.
 */
export function resolveProjectScope(
    context: ResourceContext,
    projectNumber: number
): { workspaceId: string; cwd?: string; repoPath?: string; hasRegistry: boolean; hint?: string } {
    const registry = context.briefingConfig?.projectRegistry ?? loadProjectRegistryFromConfig()
    if (registry !== undefined && Object.keys(registry).length > 0) {
        const matches = Object.entries(registry).filter(
            ([, entry]) => entry.project_number === projectNumber
        )
        if (matches.length > 1) {
            const owners = matches.map(([key]) => key).join(', ')
            throw new ValidationError(
                `Ambiguous project_number ${String(projectNumber)}: registered to multiple projects (${owners}). Pass an explicit repo/workspace selector.`
            )
        }
        const matched = matches[0]
        if (matched !== undefined) {
            const [key, entry] = matched
            const entryPath =
                entry.path !== undefined && entry.path.trim() !== '' ? entry.path : undefined
            return {
                workspaceId: key,
                ...(entryPath !== undefined ? { cwd: entryPath, repoPath: entryPath } : {}),
                hasRegistry: true,
            }
        }
        return {
            workspaceId: resourceWorkspace(context),
            cwd: process.cwd(),
            hasRegistry: true,
            hint: `Project #${String(projectNumber)} is not in the project registry, so no workspace or repository could be resolved for it.`,
        }
    }
    return { workspaceId: resourceWorkspace(context), cwd: process.cwd(), hasRegistry: false }
}

/** Unique commit SHAs referenced by session-summary / commit-narrative entries. */
export function collectUniqueCommits(entries: JournalEntry[]): string[] {
    const commits: string[] = []
    for (const entry of entries) {
        if (entry.tags.includes('session-summary') || entry.tags.includes('commit-narrative')) {
            const ctx = parseSessionCommitContext(entry.autoContext)
            if (ctx && ctx.commits.length > 0) {
                commits.push(...ctx.commits)
            }
        }
    }
    return Array.from(new Set(commits))
}

/** Resolve the GitHub integration scoped to a project registry path (H20). */
export function resolveCommitGithub(
    context: ResourceContext,
    scope: { repoPath?: string; hasRegistry: boolean }
): GitHubIntegration | undefined {
    if (scope.repoPath !== undefined) {
        return getGitHubIntegration(scope.repoPath, context.runtime)
    }
    if (scope.hasRegistry) {
        return undefined
    }
    return context.github ?? undefined
}

function toCommitSummary(commit: EnrichedCommit): {
    hash: string
    subject: string
    authorName: string
    date: string
} {
    return {
        hash: commit.hash,
        subject: fenceUntrustedInline(commit.subject),
        authorName: fenceUntrustedInline(commit.authorName),
        date: commit.date,
    }
}

const MAX_COMMIT_BODY_CHARS = 4000

export function fenceEnrichedCommits(commits: EnrichedCommit[]): EnrichedCommit[] {
    return commits.map((commit) => ({
        ...commit,
        subject: fenceUntrustedInline(commit.subject),
        authorName: fenceUntrustedInline(commit.authorName),
        ...(typeof commit.body === 'string' && commit.body.trim() !== ''
            ? {
                  body: markUntrustedContent(
                      commit.body.length > MAX_COMMIT_BODY_CHARS
                          ? `${commit.body.slice(0, MAX_COMMIT_BODY_CHARS)}... [truncated]`
                          : commit.body
                  ),
              }
            : {}),
        references: commit.references.map((ref) => ({
            ...ref,
            ...(ref.title !== undefined ? { title: fenceUntrustedInline(ref.title) } : {}),
            ...(ref.state !== undefined ? { state: fenceUntrustedInline(ref.state) } : {}),
            ...(ref.milestone !== undefined
                ? {
                      milestone: {
                          ...ref.milestone,
                          title: fenceUntrustedInline(ref.milestone.title),
                      },
                  }
                : {}),
        })),
    }))
}

export function groupCommitsByIssue(enrichedCommits: EnrichedCommit[]): IssueGroup[] {
    const issues = new Map<number, IssueGroup>()
    for (const commit of enrichedCommits) {
        for (const ref of commit.references) {
            if (ref.type !== 'issue') continue
            let group = issues.get(ref.number)
            if (group === undefined) {
                group = {
                    number: ref.number,
                    ...(ref.title !== undefined ? { title: fenceUntrustedInline(ref.title) } : {}),
                    ...(ref.state !== undefined ? { state: fenceUntrustedInline(ref.state) } : {}),
                    ...(ref.milestone !== undefined
                        ? {
                              milestone: {
                                  ...ref.milestone,
                                  title: fenceUntrustedInline(ref.milestone.title),
                              },
                          }
                        : {}),
                    commits: [],
                }
                issues.set(ref.number, group)
            }
            group.commits.push(toCommitSummary(commit))
        }
    }
    return Array.from(issues.values())
}

export function groupCommitsByPr(enrichedCommits: EnrichedCommit[]): PrGroup[] {
    const prs = new Map<number, PrGroup>()
    for (const commit of enrichedCommits) {
        for (const ref of commit.references) {
            if (ref.type !== 'pull_request') continue
            let group = prs.get(ref.number)
            if (group === undefined) {
                group = {
                    number: ref.number,
                    ...(ref.title !== undefined ? { title: fenceUntrustedInline(ref.title) } : {}),
                    ...(ref.state !== undefined ? { state: fenceUntrustedInline(ref.state) } : {}),
                    commits: [],
                }
                prs.set(ref.number, group)
            }
            group.commits.push(toCommitSummary(commit))
        }
    }
    return Array.from(prs.values())
}
