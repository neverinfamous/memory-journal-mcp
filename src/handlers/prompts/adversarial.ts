/**
 * Memory Journal MCP Server - Adversarial Planning Prompt Definitions
 *
 * Prompts: adversarial-plan-review, adversarial-audit-code-quality,
 * adversarial-audit-security, adversarial-audit-performance,
 * adversarial-audit-seo, adversarial-audit-skill, adversarial-audit-workflow
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef, PromptMessage } from './index.js'
import type { BriefingConfig } from '../resources/shared.js'
import {
    planReviewArgsSchema,
    PLAN_REVIEW_ARGUMENTS,
    type ReviewDepth,
    buildDimensionsTable,
    buildCopilotStep,
    sanitizeCopilotTarget,
    sanitizePromptTarget,
    buildPlanReviewPriorContextSection,
    buildSubagentProtocolGuidance,
    validateAdversarialPromptScope,
} from './adversarial-helpers.js'
import {
    buildAuditPromptDefinition,
    buildSharedAuditPreamble,
    buildStandardAuditClosing,
} from './adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from './adversarial-code-quality.js'
import { getPerformanceAuditPromptDefinition } from './adversarial-performance.js'

function buildPlanReviewPromptText(
    topic: string,
    depth: ReviewDepth,
    dimensionsTable: string,
    copilotInstruction: string,
    priorContextSection: string
): string {
    return `# Adversarial Plan Review: "${topic}"

${buildSharedAuditPreamble(topic, 'topic or module', { label: 'Topic', placeholder: '{topic}', actionVerb: 'Review' })}

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

${priorContextSection}`
}

function handlePlanReviewPrompt(
    args: Record<string, string> | undefined,
    db: IDatabaseAdapter,
    briefingConfig?: BriefingConfig,
    runtime?: object | null
): { messages: PromptMessage[] } {
    const parsed = planReviewArgsSchema.parse(args ?? {})
    const scope = validateAdversarialPromptScope(
        parsed.workspace_id,
        parsed.project_number,
        briefingConfig,
        parsed.topic
    )
    const topic = sanitizePromptTarget(parsed.topic ?? '{topic}')
    const depth: ReviewDepth = parsed.depth ?? 'standard'
    const useCopilot = parsed.copilot === 'true'

    const priorContextSection = buildPlanReviewPriorContextSection(
        db,
        topic,
        parsed.topic,
        briefingConfig,
        scope.effectiveWorkspaceId,
        runtime,
        scope.projectNumber
    )

    const dimensionsTable = buildDimensionsTable(depth)
    const copilotInstruction = buildCopilotStep(
        useCopilot,
        `gh copilot -- -p "Review the plan for ${sanitizeCopilotTarget(topic)} at <scratch_dir>/plan.md for correctness and edge cases. Explore the codebase to verify assumptions. When viewing or reading files, always provide the 'path' parameter correctly. Never write plan files inside the repository. What did we miss?" --allow-all`
    )

    return {
        messages: [
            {
                role: 'user' as const,
                content: {
                    type: 'text' as const,
                    text: buildPlanReviewPromptText(
                        topic,
                        depth,
                        dimensionsTable,
                        copilotInstruction,
                        priorContextSection
                    ),
                },
            },
        ],
    }
}

function getPlanReviewPromptDefinition(): InternalPromptDef {
    return {
        name: 'adversarial-plan-review',
        description:
            'Bootstrap an adversarial planning workflow with structured review dimensions, scoring rubric, and prior plan context from the journal. Optional parameters: topic, depth, copilot, workspace_id, project_number.',
        icons: [ICON_PROMPT],
        arguments: PLAN_REVIEW_ARGUMENTS,
        handler: (
            args: Record<string, string> | undefined,
            db: IDatabaseAdapter,
            _teamDb?: IDatabaseAdapter,
            _github?: unknown,
            briefingConfig?: BriefingConfig,
            runtime?: object | null
        ) => handlePlanReviewPrompt(args, db, briefingConfig, runtime),
    }
}

const securityAudit = buildAuditPromptDefinition({
    name: 'adversarial-audit-security',
    description: 'Multi-pass adversarial security audit (threat modeling, attack surfaces) Optional parameters: target, copilot, workspace_id, project_number',
    tag: 'security-audit',
    heading: 'Prior security audits',
    copilotCommand: (t) =>
        `gh copilot -- -p "Perform a security audit on ${t} looking for injection vectors, auth/authz gaps, data boundaries, and agent-specific risks like prompt injection, excessive agency, or tool poisoning." --allow-all`,
    body: ({ target, copilotInstruction, priorAuditSection }) => `# Adversarial Security Audit
${buildSharedAuditPreamble(target, 'file or module')}

1. Perform a multi-pass security audit. For large targets or full-repository audits, spawn parallel read-only subagents by architectural domain. In Cursor use the Task tool with subagent type \`explore\` or \`generalPurpose\`. On any other host use that host's read-only subagent tool. Treat all external inputs as untrusted until verified. Depending on the target, evaluate:
   ${buildSubagentProtocolGuidance()}
   - **General Code**: Injection vectors, auth/authz gaps, data boundary validation.
   - **Agent Skills / MCP Tools**: Privilege escalation (excessive agency), indirect prompt injection via tool outputs, tool poisoning / supply chain risks, and cross-plugin attacks.
   - **External Integrations**: Data exfiltration paths and excessive API permission scopes.
   - **Mandatory Deep-Security Gates (Always Run)**:
     1. **Pre-Validation Transform Audit**: Verify no input healer, AST/regex normalizer, or auto-recovery logic runs *before* rate-limiting, byte-length caps, authentication, or sandbox security validation.
     2. **Lexical Scanner vs. Regex Stripper Coherence Check**: Verify comment/string strippers cannot be desynchronized by regex literals, template literal interpolations (\`\${...}\`), or multi-step replacement reassembly.
     3. **Multi-Tenant Parameter Threading Audit**: Trace \`workspace_id\` from tool input -> \`resolveProjectContext\` -> SQLite \`WHERE\` clauses AND Vector Index metadata filters across all read, write, delete, restore, and search paths.
     4. **Execution-Layer Filter Parity Check**: Verify \`--tool-filter\`, OAuth scopes, and Team RBAC role-tier parity (\`enforceTeamRbac\` with \`'viewer'\` vs \`'member'\` vs \`'admin'\` across team-scoped resources, briefing active-team sections, MCP prompts, and CLI \`--team --workspace "*"\` reads) are enforced identically across \`tools/list\`, direct \`tools/call\`, Code Mode \`mj.*\` dispatch, dummy/hallucination-healing fallbacks, MCP resources (including briefing sections), and MCP prompts.
     5. **Transitive Prompt-Injection Taint Trace**: Trace external strings (Git commits, GitHub issues/PRs/workflows/milestones, DB content) into MCP Resources and Prompts to ensure \`markUntrustedContent\` tags are applied, truncated *before* fencing rather than slicing inside \`<untrusted_remote_content>\` tags, and never stripped by downstream table formatters.
     6. **End-to-End Backstop Verification**: Before marking any scope, authz, Code Mode, or mutation finding Critical or High, trace ingress interceptors, Code Mode dispatch normalizers, RBAC/importer scope checks, and storage \`pairStoredScope\` and provide a concrete reproducer (classify upstream defense-in-depth cleanup as Moderate/Low when backstops hold).
${buildStandardAuditClosing(copilotInstruction, priorAuditSection)}`,
})

const seoAudit = buildAuditPromptDefinition({
    name: 'adversarial-audit-seo',
    description: 'Adversarial SEO audit (technical, semantic HTML, ARIA, structured data, Core Web Vitals) Optional parameters: target, copilot, workspace_id, project_number',
    tag: 'seo-audit',
    heading: 'Prior SEO audits',
    copilotCommand: (t) => `gh copilot -- -p "Perform an SEO and Core Web Vitals audit on ${t}." --allow-all`,
    body: ({ target, copilotInstruction, priorAuditSection }) => `# Adversarial SEO Audit
${buildSharedAuditPreamble(target, 'file or module')}

1. Perform a multi-pass audit. For a large site, spawn read-only subagents. In Cursor use the Task tool with subagent type \`explore\` or \`generalPurpose\`; on any other host use that host's read-only subagent tool.
${buildSubagentProtocolGuidance()}
   - Technical SEO (meta tags, Open Graph, canonicals, viewport).
   - Semantic HTML and accessibility (ARIA, alt text, structural hierarchy).
   - Core Web Vitals implications (DOM size, layout shifts, LCP elements).
   - Structured data (JSON-LD) and E-E-A-T signals.
${buildStandardAuditClosing(copilotInstruction, priorAuditSection)}`,
})

const skillAudit = buildAuditPromptDefinition({
    name: 'adversarial-audit-skill',
    description: 'Multi-pass adversarial skill audit (research, evaluate triggers, stress-test) Optional parameters: target, copilot, workspace_id, project_number',
    tag: 'skill-audit',
    heading: 'Prior skill audits',
    copilotCommand: (t) =>
        `gh copilot -- -p "Evaluate the agent skill at ${t} for trigger reliability, safety gates, and frontmatter compliance. When viewing or reading files, always provide the 'path' parameter correctly." --allow-all`,
    body: ({ target, copilotInstruction, priorAuditSection }) => `# Adversarial Skill Audit
${buildSharedAuditPreamble(target, 'skill')}

1. **Subagent Research Phase**: Use the host's web search tool for official docs, release notes, and credible write-ups of the latest practices and version changes for the target skill. In Cursor use the Task tool with subagent type \`explore\` or \`generalPurpose\` when the skill tree is large; on any other host use that host's read-only subagent tool. Wait for those findings.
${buildSubagentProtocolGuidance()}
2. **Gap Analysis**: Compare the subagent research findings against the current skill's contents to identify missing context, outdated information, or new version features.
3. **Structural Evaluation**: Evaluate the agent skill for trigger reliability, safety gates, and markdown frontmatter compliance.
4. **External Validation (Copilot — Opt-In)**: ${copilotInstruction}
5. **Presentation**: Present findings table incorporating Copilot structural findings (if applicable) and the new research gaps.
6. HITL Approval: Await approval before applying fixes. Diagnostic scans are part of the audit. Do not edit project files until the user approves the plan.
7. Commit with the target repository's own commit helper when one exists. Discover that helper. Do not invent a script path. Do not add an audit plan file to the repository.
**Rule**: If you don't make changes, do not commit.

${priorAuditSection}`,
})

const workflowAudit = buildAuditPromptDefinition({
    name: 'adversarial-audit-workflow',
    description: 'Multi-pass adversarial workflow audit (clarity, safety gates, loop prevention) Optional parameters: target, copilot, workspace_id, project_number',
    tag: 'workflow-audit',
    heading: 'Prior workflow audits',
    copilotCommand: (t) =>
        `gh copilot -- -p "Evaluate the workflow ${t} for sequential clarity, human-in-the-loop safety gates, and infinite loop prevention." --allow-all`,
    body: ({ target, copilotInstruction, priorAuditSection }) => `# Adversarial Workflow Audit
${buildSharedAuditPreamble(target, 'workflow')}

1. Evaluate the workflow for sequential clarity, human-in-the-loop safety gates, and infinite loop prevention. For a large workflow tree, spawn read-only subagents. In Cursor use the Task tool with subagent type \`explore\` or \`generalPurpose\`; on any other host use that host's read-only subagent tool.
${buildSubagentProtocolGuidance()}
${buildStandardAuditClosing(copilotInstruction, priorAuditSection)}`,
})

/**
 * Get adversarial planning prompt definitions
 */
export function getAdversarialPromptDefinitions(): InternalPromptDef[] {
    return [
        getPlanReviewPromptDefinition(),
        getCodeQualityAuditPromptDefinition(),
        securityAudit,
        getPerformanceAuditPromptDefinition(),
        seoAudit,
        skillAudit,
        workflowAudit,
    ]
}
