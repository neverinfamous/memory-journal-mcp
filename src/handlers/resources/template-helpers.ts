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
import { resourceWorkspace } from './shared.js'
import { ValidationError } from '../../types/errors.js'

/**
 * Resolve the workspace and working directory for a project-scoped resource.
 * When a project registry is configured the project must be registered; otherwise the
 * caller should return an empty result with `hint` instead of data from another project.
 */
export function resolveProjectScope(
    context: ResourceContext,
    projectNumber: number
): { workspaceId: string; cwd: string; repoPath?: string; hasRegistry: boolean; hint?: string } {
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
                cwd: entryPath ?? process.cwd(),
                ...(entryPath !== undefined ? { repoPath: entryPath } : {}),
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
