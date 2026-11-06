/**
 * Helpers shared by the project-scoped template resources (templates.ts).
 */

import type { JournalEntry } from '../../types/index.js'
import { parseSessionCommitContext } from '../../types/auto-context.js'
import type { ResourceContext } from './shared.js'
import { resourceWorkspace } from './shared.js'

/**
 * Resolve the workspace and working directory for a project-scoped resource.
 * When a project registry is configured the project must be registered; otherwise the
 * caller should return an empty result with `hint` instead of data from another project.
 */
export function resolveProjectScope(
    context: ResourceContext,
    projectNumber: number
): { workspaceId: string; cwd: string; hint?: string } {
    const registry = context.briefingConfig?.projectRegistry
    if (registry !== undefined && Object.keys(registry).length > 0) {
        for (const [key, entry] of Object.entries(registry)) {
            if (entry.project_number === projectNumber) {
                return { workspaceId: key, cwd: entry.path ?? process.cwd() }
            }
        }
        return {
            workspaceId: resourceWorkspace(context),
            cwd: process.cwd(),
            hint: `Project #${String(projectNumber)} is not in the project registry, so no workspace or repository could be resolved for it.`,
        }
    }
    return { workspaceId: resourceWorkspace(context), cwd: process.cwd() }
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
