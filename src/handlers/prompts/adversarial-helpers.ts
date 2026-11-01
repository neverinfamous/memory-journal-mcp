/**
 * Memory Journal MCP Server - Adversarial Planning & Audit Helpers
 */

import { z } from 'zod'

export const planReviewArgsSchema = z.object({
    topic: z.string().optional(),
    depth: z.enum(['light', 'standard', 'deep']).optional(),
    copilot: z.enum(['true', 'false']).optional(),
})

export const auditArgsSchema = z.object({
    target: z.string().optional(),
    copilot: z.enum(['true', 'false']).optional(),
})

export const PLAN_REVIEW_ARGUMENTS = [
    { name: 'topic', description: 'Topic or feature to review', required: false },
    {
        name: 'depth',
        description: "Review depth profile ('light' | 'standard' | 'deep', default: 'standard')",
        required: false,
    },
    {
        name: 'copilot',
        description:
            "Opt-in to external GitHub Copilot CLI validation ('true' | 'false', default: 'false')",
        required: false,
    },
]

export const AUDIT_ARGUMENTS = [
    {
        name: 'target',
        description: 'Target file, directory, skill, or workflow to audit',
        required: false,
    },
    {
        name: 'copilot',
        description:
            "Opt-in to external GitHub Copilot CLI validation ('true' | 'false', default: 'false')",
        required: false,
    },
]

/** Review depth profiles controlling which dimensions receive full scrutiny. */
export type ReviewDepth = 'light' | 'standard' | 'deep'

/**
 * Review dimension definitions with weights.
 * Weights reflect relative importance in the scoring rubric.
 */
export const REVIEW_DIMENSIONS = [
    {
        dimension: 'Correctness',
        weight: 3,
        focus: 'Logic errors, edge cases, race conditions, error handling gaps, incorrect assumptions about existing APIs',
    },
    {
        dimension: 'Security',
        weight: 3,
        focus: 'Injection vectors, auth/authz gaps, data boundary validation, secret handling, input sanitization',
    },
    {
        dimension: 'Performance',
        weight: 2,
        focus: 'Algorithmic complexity, unnecessary allocations, N+1 queries, missing caching opportunities, hot-path impact',
    },
    {
        dimension: 'Maintainability',
        weight: 2,
        focus: 'Coupling, cohesion, single-responsibility violations, naming clarity, testability, documentation debt',
    },
    {
        dimension: 'Completeness',
        weight: 1,
        focus: 'Missing tests, missing docs, migration gaps, rollback strategy, monitoring/observability',
    },
] as const

/**
 * Build the dimensions table for the given depth profile.
 */
export function buildDimensionsTable(depth: ReviewDepth): string {
    const dimensionsToInclude =
        depth === 'light'
            ? REVIEW_DIMENSIONS.filter(
                  (d) => d.dimension === 'Correctness' || d.dimension === 'Security'
              )
            : REVIEW_DIMENSIONS

    const header = '| Dimension | Weight | Focus Areas |\n| --- | --- | --- |'
    const rows = dimensionsToInclude
        .map((d) => `| **${d.dimension}** | ${String(d.weight)} | ${d.focus} |`)
        .join('\n')

    const maxScore = dimensionsToInclude.reduce((sum, d) => sum + d.weight * 5, 0)
    const totalWeight = dimensionsToInclude.reduce((sum, d) => sum + d.weight, 0)

    let table = `${header}\n${rows}\n\nMax weighted score: ${String(maxScore)} (${String(totalWeight)} total weight × 5 max)`

    if (depth === 'deep') {
        table +=
            '\n\n**Deep review extensions:** Also evaluate API surface backward compatibility, long-term migration path (will this need to be redone in 6 months?), and cross-project impact.'
    }

    return table
}

/**
 * Format prior planning entries for context injection.
 */
export function formatPriorEntries(
    entries: { id: number; entryType: string; content: string; timestamp: string }[],
    maxCount: number
): string {
    if (entries.length === 0) return '_No prior entries found._'

    return entries
        .slice(0, maxCount)
        .map(
            (e) =>
                `- **#${String(e.id)}** (${e.entryType}, ${e.timestamp}): ${e.content.slice(0, 150)}${e.content.length > 150 ? '...' : ''}`
        )
        .join('\n')
}

export function buildCopilotStep(enabled: boolean, promptCmd: string): string {
    if (enabled) {
        return `Run \`${promptCmd}\` in NON-INTERACTIVE mode. You MUST wait for it to finish (it may take 10-20 seconds). If Copilot fails, alert the user immediately and note findings.`
    }
    return `**Optional (Skip by default)**: External Copilot CLI validation is opt-in (\`copilot: 'true'\`) and skipped by default unless explicitly requested by the user. Only if the user explicitly requests the GitHub Copilot audit, run \`${promptCmd}\` in NON-INTERACTIVE mode and wait for it to finish (it may take 10-20 seconds); if Copilot fails, alert the user immediately and note findings.`
}
