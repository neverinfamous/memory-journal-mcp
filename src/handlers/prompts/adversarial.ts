/**
 * Memory Journal MCP Server - Adversarial Planning Prompt Definitions
 *
 * Prompts: adversarial-plan-review, adversarial-audit-code-quality,
 * adversarial-audit-security, adversarial-audit-performance,
 * adversarial-audit-seo, adversarial-audit-skill, adversarial-audit-workflow
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'
import { markUntrustedContent } from '../../utils/security-utils.js'
import {
    planReviewArgsSchema,
    auditArgsSchema,
    PLAN_REVIEW_ARGUMENTS,
    AUDIT_ARGUMENTS,
    type ReviewDepth,
    buildDimensionsTable,
    formatPriorEntries,
    buildCopilotStep,
} from './adversarial-helpers.js'

/**
 * Get adversarial planning prompt definitions
 */
export function getAdversarialPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'adversarial-plan-review',
            description:
                'Bootstrap an adversarial planning workflow with structured review dimensions, scoring rubric, and prior plan context from the journal. Optional parameters: topic, depth, copilot.',
            icons: [ICON_PROMPT],
            arguments: PLAN_REVIEW_ARGUMENTS,
            handler: (args: Record<string, string> | undefined, db: IDatabaseAdapter) => {
                const parsed = planReviewArgsSchema.parse(args ?? {})
                const topic = parsed.topic ?? '{topic}'
                const depth: ReviewDepth = parsed.depth ?? 'standard'
                const useCopilot = parsed.copilot === 'true'

                // Pre-fetch prior finalized plans related to this topic
                const { entries: priorPlans } = db.searchEntries(topic, {
                    entryType: 'plan_finalized',
                    tags: ['adversarial-planner'],
                    limit: 5,
                })

                const dimensionsTable = buildDimensionsTable(depth)
                const copilotInstruction = buildCopilotStep(
                    useCopilot,
                    'gh copilot -- -p "Review the plan at <PATH> for correctness and edge cases. Explore the codebase to verify assumptions. When viewing or reading files, always provide the \'path\' parameter correctly. What did we miss?" --allow-all'
                )

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

### Phase 4: External Validation (Copilot — Opt-In)

${copilotInstruction}

### Phase 5: Present to User

Present the refined plan for approval with the final score, all disposition decisions, and Copilot feedback (if enabled).

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
            description: 'Multi-pass adversarial code quality audit (linting, technical debt, consistency) Optional parameters: target, copilot',
            icons: [ICON_PROMPT],
            arguments: AUDIT_ARGUMENTS,
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const parsed = auditArgsSchema.parse(args ?? {})
                const target = parsed.target ?? '{target}'
                const copilotInstruction = buildCopilotStep(
                    parsed.copilot === 'true',
                    'gh copilot -- -p "Perform an exhaustive code quality audit on <target>. Focus on dead code, duplication, type safety, magic values, monkey-patching, and anti-patterns." --allow-all'
                )
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `# Adversarial Code Quality Audit
Target: ${target}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target file or module, ask them for it now.

1. Scan the target for dead code, duplication, type safety (any/as, implicit any), magic values, complexity, boundary validation, monkey-patching, unused variables/exports, unhandled promises, and global scope pollution (hacks). For large targets or full-repository audits, spawn parallel \`research\` subagents by subsystem using \`invoke_subagent\` so each subsystem is audited thoroughly without context truncation.
   - **Mandatory Deep-Quality Detectors (Always Run)**:
     1. **Silent Catch Block Detector**: Scan for \`catch {\` or \`catch (err) {\` blocks in \`src/\` that neither log nor rethrow nor return a structured error object (distinguishing intentional best-effort fallbacks from swallowed security/IO failures).
     2. **Cross-Platform Path Separator Assumption Detector**: Scan for \`.startsWith(\` on \`path.resolve\` / \`realpath\` outputs or hardcoded \`'\\\\'\` / \`'/'\` instead of \`path.relative()\` or \`path.sep\`.
     3. **Cognitive Complexity & Nesting Hotspot Scan**: Flag functions exceeding 80 lines or nesting depth > 4, and modules with excessive circular/cross-layer imports.
     4. **Schema-to-Handler Parameter Drift Check**: Verify that every property defined in a tool's \`inputSchema\` is either consumed by the handler or normalized in \`param-normalizer.ts\`, and no handler reads undocumented parameters.
     5. **Uncleaned Timer / EventListener Detector**: Scan for \`setInterval\`, \`setTimeout\`, \`fs.watch\`, and \`.on(\` registrations lacking corresponding \`.unref()\` or cleanup in \`close()\` / \`finally\`.
2. **Scan for files exceeding 500 lines using two redundant methods** (to ensure no files are missed, scoped to \`src\` and \`scripts\` while excluding \`vendor\` and test files):
   - **Method 1 (Native PowerShell)**:
     \`\`\`powershell
     Get-ChildItem -Path src,scripts -Recurse -File -Include *.ts,*.tsx,*.js,*.mjs,*.cjs | Where-Object { $_.FullName -notmatch '[\\\\/]vendor[\\\\/]' -and $_.Name -notmatch '\\.(test|spec)\\.' } | ForEach-Object { $lines = [System.IO.File]::ReadAllLines($_.FullName).Count; if ($lines -gt 500) { [PSCustomObject]@{ Lines = $lines; Path = $_.FullName } } } | Sort-Object Lines -Descending
     \`\`\`
   - **Method 2 (Bun Native)**:
     \`\`\`powershell
     bun -e "import {readdirSync as r,statSync as s,readFileSync as f} from 'fs';import {join as j} from 'path';function w(d){if(!s(d,{throwIfNoEntry:false}))return;for(const x of r(d)){const p=j(d,x);if(/vendor|node_modules|dist/.test(p))continue;if(s(p).isDirectory())w(p);else if(/\\.(ts|tsx|js|mjs|cjs)$/.test(x)&&!/\\.(test|spec)\\./.test(x)){const l=f(p,'utf8').split(/\\r?\\n/).length;if(l>500)console.log(l,p)}}}w('src');w('scripts');"
     \`\`\`

> [!IMPORTANT]
> **High Priority — File Size**: Any file exceeding 500 lines is a high-priority finding. Flag all such files in the findings table with severity **High**. Do NOT begin refactoring automatically — present them to the user for approval.

3. Group findings by category and severity (Critical, Moderate, Low).
4. **External Validation (Copilot — Opt-In)**: ${copilotInstruction}
5. Present a summary table to the user (incorporating Copilot findings if applicable) and await approval. **CRITICAL**: You are strictly forbidden from modifying any project files or running any scripts until the user explicitly approves the implementation plan. Only create the markdown artifact and stop.
6. After approval, fix critical issues first, run validation gates (Lint -> Build -> Tests).
7. Commit using \`bun path/to/commit.ts\`.
**Rule**: If you don't make changes, do not commit. If you make only minor documentation changes, commit.`
                        }
                    }]
                }
            }
        },
        {
            name: 'adversarial-audit-security',
            description: 'Multi-pass adversarial security audit (threat modeling, attack surfaces) Optional parameters: target, copilot',
            icons: [ICON_PROMPT],
            arguments: AUDIT_ARGUMENTS,
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const parsed = auditArgsSchema.parse(args ?? {})
                const target = parsed.target ?? '{target}'
                const copilotInstruction = buildCopilotStep(
                    parsed.copilot === 'true',
                    'gh copilot -- -p "Perform a security audit on <target> looking for injection vectors, auth/authz gaps, data boundaries, and agent-specific risks like prompt injection, excessive agency, or tool poisoning." --allow-all'
                )
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `# Adversarial Security Audit
Target: ${target}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target file or module, ask them for it now.

1. Perform a multi-pass security audit. For large targets or full-repository audits, spawn parallel \`research\` subagents by architectural domain using \`invoke_subagent\`. Treat all external inputs as untrusted until verified. Depending on the target, evaluate:
   - **General Code**: Injection vectors, auth/authz gaps, data boundary validation.
   - **Agent Skills / MCP Tools**: Privilege escalation (excessive agency), indirect prompt injection via tool outputs, tool poisoning / supply chain risks, and cross-plugin attacks.
   - **External Integrations**: Data exfiltration paths and excessive API permission scopes.
   - **Mandatory Deep-Security Gates (Always Run)**:
     1. **Pre-Validation Transform Audit**: Verify no input healer, AST/regex normalizer, or auto-recovery logic runs *before* rate-limiting, byte-length caps, authentication, or sandbox security validation.
     2. **Lexical Scanner vs. Regex Stripper Coherence Check**: Verify comment/string strippers cannot be desynchronized by regex literals, template literal interpolations (\`\${...}\`), or multi-step replacement reassembly.
     3. **Multi-Tenant Parameter Threading Audit**: Trace \`workspace_id\` from tool input -> \`resolveProjectContext\` -> SQLite \`WHERE\` clauses AND Vector Index metadata filters across all read, write, delete, restore, and search paths.
     4. **Execution-Layer Filter Parity Check**: Verify \`--tool-filter\` and OAuth scopes are enforced identically across \`tools/list\`, direct \`tools/call\`, Code Mode \`mj.*\` dispatch, and dummy/hallucination-healing fallbacks.
     5. **Transitive Prompt-Injection Taint Trace**: Trace external strings (Git commits, GitHub issues/PRs/workflows/milestones, DB content) into MCP Resources and Prompts to ensure \`markUntrustedContent\` tags are applied and never stripped by downstream table formatters.
2. **External Validation (Copilot — Opt-In)**: ${copilotInstruction}
3. Present findings table (incorporating Copilot findings if applicable).
4. Await HITL approval before applying fixes. **CRITICAL**: You are strictly forbidden from modifying any project files or running any scripts until the user explicitly approves the implementation plan. Only create the markdown artifact and stop.
5. Commit fixes using \`bun path/to/commit.ts\`
**Rule**: If you do not make changes, do not commit. If you make only minor documentation changes, commit.`
                        }
                    }]
                }
            }
        },
        {
            name: 'adversarial-audit-performance',
            description: 'Multi-pass adversarial performance audit (profiling, stress-testing) Optional parameters: target, copilot',
            icons: [ICON_PROMPT],
            arguments: AUDIT_ARGUMENTS,
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const parsed = auditArgsSchema.parse(args ?? {})
                const target = parsed.target ?? '{target}'
                const copilotInstruction = buildCopilotStep(
                    parsed.copilot === 'true',
                    'gh copilot -- -p "Perform a performance audit on <target> looking for N+1 queries, unnecessary allocations, and hot-path bottlenecks." --allow-all'
                )
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `# Adversarial Performance Audit
Target: ${target}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target file or module, ask them for it now.

1. Perform a multi-pass performance audit looking for N+1 queries, unnecessary allocations, and hot-path bottlenecks. For large targets or full-repository audits, spawn parallel \`research\` subagents by architectural domain (e.g., Database & Query Plans, Vector & Sandbox Execution, Server Dispatch & Observability) using \`invoke_subagent\` so each subsystem is profiled thoroughly without context truncation.
   - **Mandatory Deep-Performance Gates (Always Run)**:
     1. **SQLite Query Plan & Virtual Table Join Order Audit**: Inspect SQLite queries (especially FTS5 \`fts_content\` and \`sqlite-vec\` \`vec0\` joins) using \`EXPLAIN QUERY PLAN\`. Verify virtual tables are driven as the outer loop (\`CROSS JOIN\` when necessary to prevent planner inversion), check for \`USE TEMP B-TREE FOR DISTINCT\` or \`ORDER BY\`, verify SARGable \`WHERE\` clauses (no \`DATE(col)\` wrappers on indexed columns), and confirm prepared statement caching or reuse on hot paths.
     2. **N+1 Query & Post-Limit Hydration Audit**: Scan for database or vector lookups inside loops (e.g., per-row \`getEntryById\`, \`calculateImportance\`, \`getRelationships\`, \`getAuthorsForEntries\`, or tag hydration). Ensure expensive aggregations (like importance CTEs) are deferred to post-\`LIMIT\` batch hydration (\`WHERE id IN (...)\`) unless explicitly sorting by that computed column.
     3. **Serialization, Token Estimation & Interceptor Redundancy Audit**: Trace tool and resource payloads through handler -> metrics interceptor -> audit interceptor -> token estimator -> MCP transport response. Flag duplicate \`JSON.stringify\`, \`JSON.parse\`, or \`Buffer.byteLength\` calls on the same payload across layers.
     4. **Sandbox, Schema & RegExp Compilation Audit**: Scan for per-request \`new vm.Script\`, \`new RegExp\`, \`z.object().extend()\` / \`.partial().passthrough()\`, or schema-to-TypeScript string generation on hot paths that can be hoisted to module scope or memoized via \`WeakMap\`.
     5. **Async Waterfall & I/O Batching Audit**: Scan for sequential \`await\` calls in loops or independent network/git/filesystem operations (e.g., GitHub API fetches, \`realpathSync.native\` in chunked file writes) that can be parallelized with \`Promise.all\` / \`Promise.allSettled\` or cached with TTL.
     6. **Benchmark Suite Realism & Contamination Audit**: Inspect \`tests/**/*.bench.ts\` to verify benchmarks do not silently benchmark validation errors (e.g., missing required parameters under \`VITEST=true\`), do not contaminate read/search benchmarks with thousands of prior write-benchmark rows or orphan vectors, and do not pay cold-start model loading costs when embeddings are mocked.
2. **External Validation (Copilot — Opt-In)**: ${copilotInstruction}
3. Present findings table (incorporating Copilot findings if applicable) grouped by subsystem and severity (Critical, High, Medium, Low) with quantified latency/allocation impact.
4. Await HITL approval before applying fixes. **CRITICAL**: You are strictly forbidden from modifying any project files or running any scripts until the user explicitly approves the implementation plan. Only create the markdown artifact and stop.
5. After approval, apply fixes in phased stages, run validation gates (\`bun run lint\`, \`bun run typecheck\`, targeted unit tests, and \`pnpm run bench\`), and compare before/after benchmark telemetry.
6. Commit fixes using \`bun path/to/commit.ts\`.
**Rule**: If you do not make changes, do not commit. If you make only minor documentation changes, commit.`
                        }
                    }]
                }
            }
        },
        {
            name: 'adversarial-audit-seo',
            description: 'Adversarial SEO audit (technical, semantic HTML, ARIA, structured data, Core Web Vitals) Optional parameters: target, copilot',
            icons: [ICON_PROMPT],
            arguments: AUDIT_ARGUMENTS,
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const parsed = auditArgsSchema.parse(args ?? {})
                const target = parsed.target ?? '{target}'
                const copilotInstruction = buildCopilotStep(
                    parsed.copilot === 'true',
                    'gh copilot -- -p "Perform an SEO and Core Web Vitals audit on <target>." --allow-all'
                )
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
2. **External Validation (Copilot — Opt-In)**: ${copilotInstruction}
3. Present findings table (incorporating Copilot findings if applicable).
4. Await HITL approval before applying fixes. **CRITICAL**: You are strictly forbidden from modifying any project files or running any scripts until the user explicitly approves the implementation plan. Only create the markdown artifact and stop.\n5. Commit fixes using \`bun path/to/commit.ts\`.\n**Rule**: If you do not make changes, do not commit. If you make only minor documentation changes, commit.`
                        }
                    }]
                }
            }
        },
        {
            name: 'adversarial-audit-skill',
            description: 'Multi-pass adversarial skill audit (research, evaluate triggers, stress-test) Optional parameters: target, copilot',
            icons: [ICON_PROMPT],
            arguments: AUDIT_ARGUMENTS,
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const parsed = auditArgsSchema.parse(args ?? {})
                const target = parsed.target ?? '{target}'
                const copilotInstruction = buildCopilotStep(
                    parsed.copilot === 'true',
                    'gh copilot -- -p "Evaluate the agent skill at <target> for trigger reliability, safety gates, and frontmatter compliance. When viewing or reading files, always provide the \'path\' parameter correctly." --allow-all'
                )
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
4. **External Validation (Copilot — Opt-In)**: ${copilotInstruction}
5. **Presentation**: Present findings table incorporating Copilot structural findings (if applicable) and the new research gaps.
6. HITL Approval: Await HITL approval before applying fixes. **CRITICAL**: You are strictly forbidden from modifying any project files or running any scripts until the user explicitly approves the implementation plan. Only create the markdown artifact and stop.
7. Commit fixes using \`bun path/to/commit.ts\`.
**Rule**: If you don't make changes, do not commit. If you make only minor documentation changes, commit.`
                        }
                    }]
                }
            }
        },
        {
            name: 'adversarial-audit-workflow',
            description: 'Multi-pass adversarial workflow audit (clarity, safety gates, loop prevention) Optional parameters: target, copilot',
            icons: [ICON_PROMPT],
            arguments: AUDIT_ARGUMENTS,
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const parsed = auditArgsSchema.parse(args ?? {})
                const target = parsed.target ?? '{target}'
                const copilotInstruction = buildCopilotStep(
                    parsed.copilot === 'true',
                    'gh copilot -- -p "Evaluate the workflow <target> for sequential clarity, human-in-the-loop safety gates, and infinite loop prevention." --allow-all'
                )
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `# Adversarial Workflow Audit
Target: ${target}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target workflow, ask them for it now.

1. Evaluate the workflow for sequential clarity, human-in-the-loop safety gates, and infinite loop prevention.
2. **External Validation (Copilot — Opt-In)**: ${copilotInstruction}
3. Present findings table (incorporating Copilot findings if applicable).
4. Await HITL approval before applying fixes. **CRITICAL**: You are strictly forbidden from modifying any project files or running any scripts until the user explicitly approves the implementation plan. Only create the markdown artifact and stop.\n5. Commit fixes using \`bun path/to/commit.ts\`.\n**Rule**: If you do not make changes, do not commit. If you make only minor documentation changes, commit.`
                        }
                    }]
                }
            }
        }
    ]
}
