/**
 * Memory Journal MCP Server - Adversarial Planning Prompt Definitions
 *
 * Prompts: adversarial-plan-review
 *
 * Bootstraps the adversarial planning workflow by pre-fetching prior plan
 * drafts and review findings from the journal, then composing the structured
 * review dimensions and scoring rubric into a single prompt message.
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'
import { markUntrustedContent } from '../../utils/security-utils.js'

/** Review depth profiles controlling which dimensions receive full scrutiny. */
type ReviewDepth = 'light' | 'standard' | 'deep'

/** Valid review depths for input validation. */
const VALID_DEPTHS: ReadonlySet<string> = new Set(['light', 'standard', 'deep'])

/**
 * Review dimension definitions with weights.
 * Weights reflect relative importance in the scoring rubric.
 */
const REVIEW_DIMENSIONS = [
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
function buildDimensionsTable(depth: ReviewDepth): string {
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
function formatPriorEntries(
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

/**
 * Get adversarial planning prompt definitions
 */
export function getAdversarialPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'adversarial-plan-review',
            description:
                'Bootstrap an adversarial planning workflow with structured review dimensions, scoring rubric, and prior plan context from the journal',
            icons: [ICON_PROMPT],
            arguments: [
                {
                    name: 'topic',
                    description:
                        'The feature, change, or system being planned (used to search for prior plans)',
                    required: true,
                },
                {
                    name: 'depth',
                    description:
                        'Review depth: "light" (correctness + security only), "standard" (all 5 dimensions), or "deep" (extended analysis). Default: standard',
                    required: false,
                },
            ],
            handler: (args: Record<string, string>, db: IDatabaseAdapter) => {
                const topic = args['topic'] ?? ''
                const rawDepth = args['depth'] ?? 'standard'
                const depth: ReviewDepth = VALID_DEPTHS.has(rawDepth)
                    ? (rawDepth as ReviewDepth)
                    : 'standard'

                // Pre-fetch prior plan drafts related to this topic
                const priorDrafts = db.searchEntries(topic, {
                    entryType: 'plan_draft',
                    tags: ['adversarial-planner'],
                    limit: 5,
                })

                // Pre-fetch prior adversarial reviews for recurring findings
                const priorReviews = db.searchEntries(topic, {
                    entryType: 'adversarial_review',
                    tags: ['adversarial-planner'],
                    limit: 5,
                })

                // Pre-fetch plan refinements for evolution tracking
                const priorRefinements = db.searchEntries(topic, {
                    entryType: 'plan_refinement',
                    tags: ['adversarial-planner'],
                    limit: 3,
                })

                const dimensionsTable = buildDimensionsTable(depth)

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# Adversarial Plan Review: "${topic}"

**Depth**: ${depth}

## Protocol

Execute a multi-pass adversarial planning workflow for this topic. You will alternate between two roles:

1. **Agent A (Planner)** — Draft a structured plan, then refine it based on critique
2. **Agent B (Reviewer)** — Critically review the plan, scoring each dimension and finding weaknesses

### Phase 1: Draft Plan (Agent A)

Produce a plan with these sections:
- **Scope**: What is included and explicitly excluded
- **Context**: Background, motivation, dependencies on existing systems
- **Proposed Changes**: Grouped by component, with file-level detail
- **Task Ordering**: Numbered sequence with dependencies and parallelization
- **Risk Assessment**: Table with Risk, Likelihood, Impact, Mitigation
- **Open Questions**: Anything requiring user input

Journal: \`create_entry({ content: "<plan>", entry_type: "plan_draft", tags: ["adversarial-planner", "plan-draft"] })\`

### Phase 2: Adversarial Review (Agent B)

Switch to a skeptical reviewer mindset. Score each dimension 1–5:

${dimensionsTable}

Produce a findings table:

| # | Dimension | Severity | Finding | Remediation |
| --- | --- | --- | --- | --- |

List any **blocking issues** that must be addressed before proceeding.

Journal: \`create_entry({ content: "<critique>", entry_type: "adversarial_review", tags: ["adversarial-planner", "review"] })\`

### Phase 3: Refinement (Agent A)

Address every finding with a disposition:

| Disposition | Meaning |
| --- | --- |
| **Accept** | Incorporate the suggestion |
| **Reject** | Explain why it doesn't apply |
| **Modify** | Accept the spirit, implement differently |

Journal: \`create_entry({ content: "<refinement>", entry_type: "plan_refinement", tags: ["adversarial-planner", "refinement"] })\`

### Phase 4: Present to User

Present the refined plan for approval with the final score and all disposition decisions.

## Link Entries

Connect planning entries using relationships:
- Review → Draft: \`references\`
- Refinement → Review: \`evolves_from\`
- Implementation → Refinement: \`implements\`

## Prior Context

### Prior Plan Drafts
${markUntrustedContent(formatPriorEntries(priorDrafts, 5))}

### Prior Adversarial Reviews
${markUntrustedContent(formatPriorEntries(priorReviews, 5))}

### Prior Refinements
${markUntrustedContent(formatPriorEntries(priorRefinements, 3))}

Review prior entries for recurring findings and reusable patterns before drafting.`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}
