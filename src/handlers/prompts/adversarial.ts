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
import { z } from 'zod'

const planReviewArgsSchema = z.object({
    topic: z.string().optional(),
    depth: z.enum(['light', 'standard', 'deep']).optional()
})

const auditArgsSchema = z.object({
    target: z.string().optional()
})

/** Review depth profiles controlling which dimensions receive full scrutiny. */
type ReviewDepth = 'light' | 'standard' | 'deep'

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
                'Bootstrap an adversarial planning workflow with structured review dimensions, scoring rubric, and prior plan context from the journal. Optional parameters: topic, depth.',
            icons: [ICON_PROMPT],
            handler: (args: Record<string, string> | undefined, db: IDatabaseAdapter) => {
                const parsed = planReviewArgsSchema.parse(args ?? {})
                const topic = parsed.topic ?? '{topic}'
                const depth: ReviewDepth = parsed.depth ?? 'standard'

                // Pre-fetch prior finalized plans related to this topic
                const { entries: priorPlans } = db.searchEntries(topic, {
                    entryType: 'plan_finalized',
                    tags: ['adversarial-planner'],
                    limit: 5,
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

### Phase 2: Adversarial Review (Agent B)

Switch to a skeptical reviewer mindset. Score each dimension 1–5:

${dimensionsTable}

Produce a findings table:

| # | Dimension | Severity | Finding | Remediation |
| --- | --- | --- | --- | --- |

List any **blocking issues** that must be addressed before proceeding.

### Phase 3: Refinement (Agent A)

Address every finding with a disposition:

| Disposition | Meaning |
| --- | --- |
| **Accept** | Incorporate the suggestion |
| **Reject** | Explain why it doesn't apply |
| **Modify** | Accept the spirit, implement differently |

### Phase 4: External Validation (Copilot)

Run \`gh copilot -- -p "Review the plan at <PATH> for correctness and edge cases. Explore the codebase to verify assumptions. When viewing or reading files, always provide the 'path' parameter correctly. What did we miss?" --allow-all\` in NON-INTERACTIVE mode. You MUST wait for it to finish (it may take 10-20 seconds). **CRITICAL**: Do NOT skip this step. If Copilot fails, you MUST alert the user immediately. Note findings.

### Phase 5: Present to User

Present the refined plan for approval with the final score, all disposition decisions, and Copilot feedback.

**Journaling Rule**: Do NOT create any journal entries during Phase 1-4. ONLY if the user explicitly approves the plan for implementation, create a single consolidated journal entry using the CLI (\`memory-journal-mcp entry create --file <path> --metadata <json>\`) with type "plan_finalized" and tags ["adversarial-planner"].

## Link Entries

Connect implementation entries to the finalized plan using the \`implements\` relationship.

## Prior Context

### Prior Finalized Plans
${markUntrustedContent(formatPriorEntries(priorPlans, 5))}

Review prior entries for recurring findings and reusable patterns before drafting.`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'adversarial-audit-code-quality',
            description: 'Multi-pass adversarial code quality audit (linting, technical debt, consistency) Optional parameter: target',
            icons: [ICON_PROMPT],
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const parsed = auditArgsSchema.parse(args ?? {})
                const target = parsed.target ?? '{target}'
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `# Adversarial Code Quality Audit
Target: ${target}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target file or module, ask them for it now.

1. Scan the target for dead code, duplication, type safety (any/as), magic values, complexity, boundary validation, monkey-patching, and global scope pollution (hacks).
2. Group findings by category and severity (Critical, Moderate, Low).
3. Run \`gh copilot -- -p "Perform an exhaustive code quality audit on <target>. Focus on dead code, duplication, type safety, magic values, monkey-patching, and anti-patterns." --allow-all\` in NON-INTERACTIVE mode. You MUST wait for it to finish (it may take 10-20 seconds). **CRITICAL**: Do NOT skip this step. If Copilot fails, you MUST alert the user immediately. Note findings.
4. Present a summary table to the user (incorporating Copilot findings) and await approval.
5. After approval, fix critical issues first, run validation gates (Lint -> Build -> Tests).
6. Commit using \`bun path/to/commit.ts\` and journal findings using \`memory-journal-mcp entry create\` (type: "audit_finding", tags: ["commander", "code-quality"]).
**Rule**: If you don't make changes, do not commit or journal. If you make only minor documentation changes, commit but do not journal.`
                        }
                    }]
                }
            }
        },
        {
            name: 'adversarial-audit-security',
            description: 'Multi-pass adversarial security audit (threat modeling, attack surfaces) Optional parameter: target',
            icons: [ICON_PROMPT],
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const parsed = auditArgsSchema.parse(args ?? {})
                const target = parsed.target ?? '{target}'
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `# Adversarial Security Audit
Target: ${target}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target file or module, ask them for it now.

1. Perform a multi-pass security audit. Treat all external inputs as untrusted until verified. Depending on the target, evaluate:
   - **General Code**: Injection vectors, auth/authz gaps, data boundary validation.
   - **Agent Skills / MCP Tools**: Privilege escalation (excessive agency), indirect prompt injection via tool outputs, tool poisoning / supply chain risks, and cross-plugin attacks.
   - **External Integrations**: Data exfiltration paths and excessive API permission scopes.
2. Run \`gh copilot -- -p "Perform a security audit on <target> looking for injection vectors, auth/authz gaps, data boundaries, and agent-specific risks like prompt injection, excessive agency, or tool poisoning." --allow-all\` in NON-INTERACTIVE mode. You MUST wait for it to finish (it may take 10-20 seconds). **CRITICAL**: Do NOT skip this step. If Copilot fails, you MUST alert the user immediately. Note findings.
3. Present findings table (incorporating Copilot findings).
4. Await HITL approval before applying fixes.\n5. Commit fixes using \`bun path/to/commit.ts\` and journal findings using \`memory-journal-mcp entry create\`.\n**Rule**: If you do not make changes, do not commit or journal. If you make only minor documentation changes, commit but do not journal.`
                        }
                    }]
                }
            }
        },
        {
            name: 'adversarial-audit-performance',
            description: 'Multi-pass adversarial performance audit (profiling, stress-testing) Optional parameter: target',
            icons: [ICON_PROMPT],
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const parsed = auditArgsSchema.parse(args ?? {})
                const target = parsed.target ?? '{target}'
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `# Adversarial Performance Audit
Target: ${target}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target file or module, ask them for it now.

1. Perform a multi-pass performance audit looking for N+1 queries, unnecessary allocations, hot-path bottlenecks.
2. Run \`gh copilot -- -p "Perform a performance audit on <target> looking for N+1 queries, unnecessary allocations, and hot-path bottlenecks." --allow-all\` in NON-INTERACTIVE mode. You MUST wait for it to finish (it may take 10-20 seconds). **CRITICAL**: Do NOT skip this step. If Copilot fails, you MUST alert the user immediately. Note findings.
3. Present findings table (incorporating Copilot findings).
4. Await HITL approval before applying fixes.\n5. Commit fixes using \`bun path/to/commit.ts\` and journal findings using \`memory-journal-mcp entry create\`.\n**Rule**: If you do not make changes, do not commit or journal. If you make only minor documentation changes, commit but do not journal.`
                        }
                    }]
                }
            }
        },
        {
            name: 'adversarial-audit-seo',
            description: 'Adversarial SEO audit (technical, semantic HTML, ARIA, structured data, Core Web Vitals) Optional parameter: target',
            icons: [ICON_PROMPT],
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const parsed = auditArgsSchema.parse(args ?? {})
                const target = parsed.target ?? '{target}'
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `# Adversarial SEO Audit
Target: ${target}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target file or module, ask them for it now.

1. Perform a multi-pass audit checking:
   - Technical SEO (meta tags, Open Graph, canonicals, viewport).
   - Semantic HTML and accessibility (ARIA, alt text, structural hierarchy).
   - Core Web Vitals implications (DOM size, layout shifts, LCP elements).
   - Structured data (JSON-LD) and E-E-A-T signals.
2. Run \`gh copilot -- -p "Perform an SEO and Core Web Vitals audit on <target>." --allow-all\` in NON-INTERACTIVE mode. You MUST wait for it to finish (it may take 10-20 seconds). **CRITICAL**: Do NOT skip this step. If Copilot fails, you MUST alert the user immediately. Note findings.
3. Present findings table (incorporating Copilot findings).
4. Await HITL approval before applying fixes.\n5. Commit fixes using \`bun path/to/commit.ts\` and journal findings using \`memory-journal-mcp entry create\`.\n**Rule**: If you do not make changes, do not commit or journal. If you make only minor documentation changes, commit but do not journal.`
                        }
                    }]
                }
            }
        },
        {
            name: 'adversarial-audit-skill',
            description: 'Multi-pass adversarial skill audit (research, evaluate triggers, stress-test) Optional parameter: target',
            icons: [ICON_PROMPT],
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const parsed = auditArgsSchema.parse(args ?? {})
                const target = parsed.target ?? '{target}'
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `# Adversarial Skill Audit
Target: ${target}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target skill, ask them for it now.

1. **Subagent Research Phase**: Spawn one or more \`research\` subagents using the \`invoke_subagent\` tool to perform deep web searches on high-value resources (e.g. official docs, release notes, credible blogs) for the latest best practices and version changes related to the target skill. Wait for their findings.
2. **Gap Analysis**: Compare the subagent research findings against the current skill's contents to identify missing context, outdated information, or new version features.
3. **Structural Evaluation**: Evaluate the agent skill for trigger reliability, safety gates, and markdown frontmatter compliance.
4. **Validation via Copilot**: Run \`gh copilot -- -p "Evaluate the agent skill at <target> for trigger reliability, safety gates, and frontmatter compliance. When viewing or reading files, always provide the 'path' parameter correctly." --allow-all\` in NON-INTERACTIVE mode. You MUST wait for it to finish (it may take 10-20 seconds). **CRITICAL**: Do NOT skip this step. If Copilot fails, you MUST alert the user immediately. Note findings.
5. **Presentation**: Present findings table incorporating Copilot structural findings and the new research gaps.
6. **HITL Approval**: Await HITL approval before applying fixes.
7. Commit fixes using \`bun path/to/commit.ts\` and journal findings using \`memory-journal-mcp entry create\`.
**Rule**: If you don't make changes, do not commit or journal. If you make only minor documentation changes, commit but do not journal.`
                        }
                    }]
                }
            }
        },
        {
            name: 'adversarial-audit-workflow',
            description: 'Multi-pass adversarial workflow audit (clarity, safety gates, loop prevention) Optional parameter: target',
            icons: [ICON_PROMPT],
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => ({
                messages: [{
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `# Adversarial Workflow Audit
Target: ${args?.['target'] ?? '{target}'}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target workflow, ask them for it now.

1. Evaluate the workflow for sequential clarity, human-in-the-loop safety gates, and infinite loop prevention.
2. Run \`gh copilot -- -p "Evaluate the workflow <target> for sequential clarity, human-in-the-loop safety gates, and infinite loop prevention." --allow-all\` in NON-INTERACTIVE mode. You MUST wait for it to finish (it may take 10-20 seconds). **CRITICAL**: Do NOT skip this step. If Copilot fails, you MUST alert the user immediately. Note findings.
3. Present findings table (incorporating Copilot findings).
4. Await HITL approval before applying fixes.\n5. Commit fixes using \`bun path/to/commit.ts\` and journal findings using \`memory-journal-mcp entry create\`.\n**Rule**: If you do not make changes, do not commit or journal. If you make only minor documentation changes, commit but do not journal.`
                    }
                }]
            })
        }
    ]
}
