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
            arguments: [],
            handler: (args: Record<string, string> | undefined, db: IDatabaseAdapter) => {
                const topic = args?.['topic'] ?? '{topic}'
                const rawDepth = args?.['depth'] ?? 'standard'
                const depth: ReviewDepth = VALID_DEPTHS.has(rawDepth)
                    ? (rawDepth as ReviewDepth)
                    : 'standard'

                // Pre-fetch prior plan drafts related to this topic
                const { entries: priorDrafts } = db.searchEntries(topic, {
                    entryType: 'plan_draft',
                    tags: ['adversarial-planner'],
                    limit: 5,
                })

                // Pre-fetch prior adversarial reviews for recurring findings
                const { entries: priorReviews } = db.searchEntries(topic, {
                    entryType: 'adversarial_review',
                    tags: ['adversarial-planner'],
                    limit: 5,
                })

                // Pre-fetch plan refinements for evolution tracking
                const { entries: priorRefinements } = db.searchEntries(topic, {
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

If the topic is '{topic}', determine it from the user's request. If the user hasn't specified a topic, ask them for it now.

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

Journal: \`create_entry({ content: "<plan>", entry_type: "plan_draft", tags: ["adversarial-planner", "plan-draft"], impact_score: 0.8, trust_score: 0.5, validation_status: "none" })\`

### Phase 2: Adversarial Review (Agent B)

Switch to a skeptical reviewer mindset. Score each dimension 1–5:

${dimensionsTable}

Produce a findings table:

| # | Dimension | Severity | Finding | Remediation |
| --- | --- | --- | --- | --- |

List any **blocking issues** that must be addressed before proceeding.

Journal: \`create_entry({ content: "<critique>", entry_type: "adversarial_review", tags: ["adversarial-planner", "review"], impact_score: 0.8, trust_score: 0.8, validation_status: "passed" })\`

### Phase 3: Refinement (Agent A)

Address every finding with a disposition:

| Disposition | Meaning |
| --- | --- |
| **Accept** | Incorporate the suggestion |
| **Reject** | Explain why it doesn't apply |
| **Modify** | Accept the spirit, implement differently |

Journal: \`create_entry({ content: "<refinement>", entry_type: "plan_refinement", tags: ["adversarial-planner", "refinement"], impact_score: 0.8, trust_score: 0.9, validation_status: "passed" })\`

### Phase 4: External Validation (Copilot)

Run \`gh copilot -- -p "Review the plan at <PATH> for correctness and edge cases. Explore the codebase to verify assumptions. When viewing or reading files, always provide the 'path' parameter correctly. What did we miss?" --allow-all\` in NON-INTERACTIVE mode. You MUST wait for it to finish (it may take 10-20 seconds). **CRITICAL**: Do NOT skip this step. If Copilot fails, you MUST alert the user immediately. Note findings.

### Phase 5: Present to User

Present the refined plan for approval with the final score, all disposition decisions, and Copilot feedback.

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
        {
            name: 'adversarial-audit-code-quality',
            description: 'Multi-pass adversarial code quality audit (linting, technical debt, consistency)',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (args: Record<string, string>, _db: IDatabaseAdapter) => ({
                messages: [{
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `# Adversarial Code Quality Audit
Target: ${args?.['target'] ?? '{target}'}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target file or module, ask them for it now.

1. Scan the target for dead code, duplication, type safety (any/as), magic values, complexity, and boundary validation.
2. Group findings by category and severity (Critical, Moderate, Low).
3. Run \`gh copilot -- -p "Perform an exhaustive code quality audit on <target>. Focus on dead code, duplication, type safety, and magic values." --allow-all\` to get external validation. **CRITICAL**: Do NOT skip this step. Alert the user if it fails.
4. Present a summary table to the user (incorporating Copilot findings) and await approval.
5. After approval, fix critical issues first, run validation gates (Lint -> Build -> Tests), and commit with descriptive messages.
Journal findings with \`entry_type: "audit_finding"\` and tags \`["commander", "code-quality"]\`.`
                    }
                }]
            })
        },
        {
            name: 'adversarial-audit-security',
            description: 'Multi-pass adversarial security audit (threat modeling, attack surfaces)',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (args: Record<string, string>, _db: IDatabaseAdapter) => ({
                messages: [{
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `# Adversarial Security Audit
Target: ${args?.['target'] ?? '{target}'}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target file or module, ask them for it now.

1. Perform a multi-pass security audit looking for injection vectors, auth/authz gaps, data boundary issues.
2. Run \`gh copilot -- -p "Perform a security audit on <target> looking for injection vectors, auth/authz gaps, and data boundary issues." --allow-all\` to get external validation. **CRITICAL**: Do NOT skip this step. Alert the user if it fails.
3. Present findings table (incorporating Copilot findings).
4. Await HITL approval before applying fixes.`
                    }
                }]
            })
        },
        {
            name: 'adversarial-audit-performance',
            description: 'Multi-pass adversarial performance audit (profiling, stress-testing)',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (args: Record<string, string>, _db: IDatabaseAdapter) => ({
                messages: [{
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `# Adversarial Performance Audit
Target: ${args?.['target'] ?? '{target}'}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target file or module, ask them for it now.

1. Perform a multi-pass performance audit looking for N+1 queries, unnecessary allocations, hot-path bottlenecks.
2. Run \`gh copilot -- -p "Perform a performance audit on <target> looking for N+1 queries, unnecessary allocations, and hot-path bottlenecks." --allow-all\` to get external validation. **CRITICAL**: Do NOT skip this step. Alert the user if it fails.
3. Present findings table (incorporating Copilot findings).
4. Await HITL approval before applying fixes.`
                    }
                }]
            })
        },
        {
            name: 'adversarial-audit-seo',
            description: 'Adversarial SEO audit (technical, semantic HTML, ARIA, structured data, Core Web Vitals)',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (args: Record<string, string>, _db: IDatabaseAdapter) => ({
                messages: [{
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `# Adversarial SEO Audit
Target: ${args?.['target'] ?? '{target}'}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target file or module, ask them for it now.

1. Perform a multi-pass audit checking:
   - Technical SEO (meta tags, Open Graph, canonicals, viewport).
   - Semantic HTML and accessibility (ARIA, alt text, structural hierarchy).
   - Core Web Vitals implications (DOM size, layout shifts, LCP elements).
   - Structured data (JSON-LD) and E-E-A-T signals.
2. Run \`gh copilot -- -p "Perform an SEO and Core Web Vitals audit on <target>." --allow-all\` to get external validation. **CRITICAL**: Do NOT skip this step. Alert the user if it fails.
3. Present findings table (incorporating Copilot findings).
4. Await HITL approval before applying fixes.`
                    }
                }]
            })
        },
        {
            name: 'adversarial-audit-skill',
            description: 'Multi-pass adversarial skill audit (evaluate triggers, stress-test)',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (args: Record<string, string>, _db: IDatabaseAdapter) => ({
                messages: [{
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `# Adversarial Skill Audit
Target: ${args?.['target'] ?? '{target}'}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target skill, ask them for it now.

1. Evaluate the agent skill for trigger reliability, safety gates, and markdown frontmatter compliance.
2. Run \`gh copilot -- -p "Evaluate the agent skill <target> for trigger reliability, safety gates, and frontmatter compliance." --allow-all\` to get external validation. **CRITICAL**: Do NOT skip this step. Alert the user if it fails.
3. Present findings table (incorporating Copilot findings).
4. Await HITL approval before applying fixes.`
                    }
                }]
            })
        },
        {
            name: 'adversarial-audit-workflow',
            description: 'Multi-pass adversarial workflow audit (clarity, safety gates, loop prevention)',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (args: Record<string, string>, _db: IDatabaseAdapter) => ({
                messages: [{
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `# Adversarial Workflow Audit
Target: ${args?.['target'] ?? '{target}'}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target workflow, ask them for it now.

1. Evaluate the workflow for sequential clarity, human-in-the-loop safety gates, and infinite loop prevention.
2. Run \`gh copilot -- -p "Evaluate the workflow <target> for sequential clarity, human-in-the-loop safety gates, and infinite loop prevention." --allow-all\` to get external validation. **CRITICAL**: Do NOT skip this step. Alert the user if it fails.
3. Present findings table (incorporating Copilot findings).
4. Await HITL approval before applying fixes.`
                    }
                }]
            })
        },
        {
            name: 'verify-work',
            description: 'Audit a batch of recent journal entries (default 10) to verify accuracy, eliminate hallucinations, and ensure heuristic scores are justified.',
            icons: [ICON_PROMPT],
            arguments: [
                {
                    name: 'lookback',
                    description: 'Number of recent entries to audit (default: 10, max: 50)',
                    required: false
                }
            ],
            handler: (args: Record<string, string> | undefined, db: IDatabaseAdapter) => {
                const lookbackRaw = args?.['lookback']
                let limit = 10
                if (lookbackRaw) {
                    const parsed = parseInt(lookbackRaw, 10)
                    if (!isNaN(parsed) && parsed > 0) {
                        limit = Math.min(parsed, 50)
                    }
                }

                const { entries } = db.getRecentEntries(limit)

                const formattedEntries = entries.map(e => {
                    return `ID: ${e.id} | Type: ${e.entryType} | Tags: ${e.tags.join(', ')}
Trust: ${e.trustScore} | Impact: ${e.impactScore} | Validation: ${e.validationStatus}
Content:
${e.content}
---`
                }).join('\n')

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# Work Verification
You are an adversarial auditor. Your task is to verify the accuracy of the recent Memory Journal entries provided in the context below. For each entry, cross-reference its claims against available telemetry, git logs, or related entries.

## Verification Checklist
For each entry in the batch, systematically verify:
- [ ] **Hallucinations**: Does it claim work that wasn't actually done or doesn't exist in the codebase/commits?
- [ ] **Omissions**: Did it fail to document significant architectural changes or commits?
- [ ] **Heuristics Justification**: Are the \`impact_score\`, \`trust_score\`, and \`validation_status\` accurate and fully justified by the work actually performed?
- [ ] **Context Alignment**: Does the summary accurately reflect the actual work performed?

## Scoring Mutation Protocol
As the auditor, you are responsible for updating confidence scores based on your findings:
- **Verified**: If you successfully verify an entry's claims, you MUST use \`mj_execute_code\` (e.g. \`mj.updateEntry(id, payload)\`) to increase its \`trust_score\` to \`0.9\` or \`1.0\` and set \`validation_status\` to \`"passed"\`.
- **Failed**: If claims are false or hallucinatory, you MUST reduce \`trust_score\` to \`0.1\` and set \`validation_status\` to \`"failed"\`.

## Deliverables
Provide a structured report of your findings. For any entries with severe hallucinations, misaligned heuristics, or omissions, output the corrected payload and use the \`mj_execute_code\` tool to overwrite the corrupted entries (e.g., \`mj.updateEntry(id, payload)\`). Ensure you apply the Scoring Mutation Protocol to verified entries.

## Recent Entries Context
${markUntrustedContent(formattedEntries)}`
                            }
                        }
                    ]
                }
            }
        },
        {
            name: 'flag-dashboard',
            description: 'Dashboard overview of all active flags (blockers, critical, warnings)',
            icons: [ICON_PROMPT],
            arguments: [{ name: 'flag_type', description: 'Filter by flag type (e.g., blocker, critical)', required: false }],
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const flagType = args?.['flag_type']
                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# Flag Dashboard
Generate a dashboard overview of active flags${flagType ? ` for type: ${flagType}` : ''}.

Please read the relevant journal entries or search for the active flags and provide a summary of the current blockers, critical issues, and warnings.`
                            }
                        }
                    ]
                }
            }
        }
    ]
}
