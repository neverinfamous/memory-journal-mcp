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
import type { BriefingConfig } from '../resources/shared.js'
import {
    planReviewArgsSchema,
    auditArgsSchema,
    PLAN_REVIEW_ARGUMENTS,
    AUDIT_ARGUMENTS,
    type ReviewDepth,
    buildDimensionsTable,
    buildCopilotStep,
    sanitizeCopilotTarget,
    sanitizePromptTarget,
    buildPlanReviewPriorContextSection,
    buildPriorAuditSection,
    buildSubagentProtocolGuidance,
} from './adversarial-helpers.js'

/**
 * Get adversarial planning prompt definitions
 */
export function getAdversarialPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'adversarial-plan-review',
            description:
                'Bootstrap an adversarial planning workflow with structured review dimensions, scoring rubric, and prior plan context from the journal. Optional parameters: topic, depth, copilot, workspace_id.',
            icons: [ICON_PROMPT],
            arguments: PLAN_REVIEW_ARGUMENTS,
            handler: (args: Record<string, string> | undefined, db: IDatabaseAdapter, _teamDb?: IDatabaseAdapter, _github?: unknown, briefingConfig?: BriefingConfig, runtime?: object | null) => {
                const parsed = planReviewArgsSchema.parse(args ?? {})
                const topic = sanitizePromptTarget(parsed.topic ?? '{topic}')
                const depth: ReviewDepth = parsed.depth ?? 'standard'
                const useCopilot = parsed.copilot === 'true'

                const priorContextSection = buildPlanReviewPriorContextSection(
                    db,
                    topic,
                    parsed.topic,
                    briefingConfig,
                    parsed.workspace_id,
                    runtime
                )

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

${priorContextSection}`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'adversarial-audit-code-quality',
            description: 'Multi-pass adversarial code quality audit (dead code, type safety, silent failures, workspace isolation, complexity, file size). Optional parameters: target, copilot, workspace_id',
            icons: [ICON_PROMPT],
            arguments: AUDIT_ARGUMENTS,
            handler: (args: Record<string, string> | undefined, db: IDatabaseAdapter, _teamDb?: IDatabaseAdapter, _github?: unknown, briefingConfig?: BriefingConfig, runtime?: object | null) => {
                const parsed = auditArgsSchema.parse(args ?? {})
                const target = sanitizePromptTarget(parsed.target ?? '{target}')
                const copilotTarget = sanitizeCopilotTarget(target)
                const copilotInstruction = buildCopilotStep(
                    parsed.copilot === 'true',
                    `gh copilot -- -p "Perform an exhaustive code quality audit on ${copilotTarget}. Focus on dead code, duplication, type safety, magic values, monkey-patching, and anti-patterns." --allow-all`
                )
                const priorAuditSection = buildPriorAuditSection(
                    db,
                    'code-quality-audit',
                    'Prior code-quality audits',
                    briefingConfig,
                    parsed.workspace_id,
                    parsed.target,
                    runtime
                )
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `# Adversarial Code Quality Audit
Prompt revision: 2026-11-11-audit-pass12.
Target: ${target}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target file or module, ask them for it now.

This prompt is shared by every project. Audit the repository the user named. Do not assume that repository is memory-journal-mcp, and do not copy this server's directory layout, commit script, or parameter-normalizer filenames onto a different codebase. Discover those in the target.

If \`memory://briefing/{repo}\` cannot be read, continue the audit. Resolve \`workspace_id\` and \`project_number\` with \`mj.core.getProject\` or \`mj.core.listProjects\`, and record the resource failure for later.

1. Scan the target for dead code, duplication, type safety, magic values, complexity, boundary validation, monkey-patching, unused variables/exports, unhandled promises, and global scope pollution:
   - **Evidence & Low-Severity Rules**: File dead code, duplication, magic values, unused exports, and floating promises only when you quote them, and count those as **Low**.
   - **Subagent Orchestration**: For a large or full-repository audit, run step 2 first and pass the \`SCAN_OK\` result to parallel read-only subagents partitioned by subsystem (assigning each directory to one subagent). In Cursor use the Task tool (\`explore\` or \`generalPurpose\`); on any other host use that host's read-only subagent tool. Put the parent conversation id in every subagent prompt. Instruct every subagent to read full function bodies (not only grep hits), treat a grep-only detector as \`not run\`, skip repeating step 2 file-size scans, and return one coverage line per detector (\`run\`, \`not run\`, or \`nothing found\`) plus findings (path, line number, raw one-line quote, severity, one-sentence fix). The parent runs any detector a subagent skipped before reporting it clean. Each subagent returns at most 8 Moderate and 5 Low findings, already ranked. The parent merges parallel copies of one pattern into one finding that cites both sites.
   - **Severity Calibration**: Cross-workspace mutation is **Critical**; wrong-tool dispatch, false success, dropped isolation field, or a file over 500 lines is **High**; function length (>80 lines), deep nesting (>4), or a primary-key update that already rejects a workspace mismatch is **Moderate**. An explicit \`'*'\` that drives a mutation against a single repository root (e.g. \`process.cwd()\`) is **High**, whereas explicit \`'*'\` on multi-workspace DB queries/admin operations is an intentional admin override. A database-wide maintenance function with no scope parameter (or optional workspace kept database-wide on purpose) is a product note, not an automatic Critical.
   - **Parent Verification & Caps**: The parent dedupes a handler that drops a field and the callee branch it reaches into one finding with both lines, re-reads every Critical/High citation (and any cross-workspace, authz, or false-success citation marked Moderate), strips one wrapping backtick pair, and drops any citation whose quote is not on that line. Cap Moderate at 8 and Low at 5 per subsystem (parent table max: 12 Moderate, 8 Low; never cap Critical or High). Record which directories were opened and which detectors found nothing.
   - **Mandatory Deep-Quality Detectors (Always Run)**:
     1. **Silent Catch Block Detector**: Find every \`catch\` in production source, including \`catch (e)\` and multiline catches. A catch is silent when its body does not log, rethrow, or return a structured error. Quote the body. Keep intentional best-effort fallbacks out of the table. Do not flag a catch that returns the project's structured handler error.
     2. **Cross-Platform Path Separator Assumption Detector**: Flag filesystem prefix checks (\`startsWith\` / \`endsWith\` on a resolved path without a separator boundary) and hardcoded \`'\\\\'\` or \`'/'\` used to test real filesystem paths. Prefer \`path.relative()\` and \`path.sep\`. Ignore URL, route, glob, and SQL slashes. Case-fold only on Windows.
     3. **Cognitive Complexity & Nesting Hotspot Scan**: Flag functions over 80 lines or control-flow nesting deeper than 4. Measure function length and nesting with a script (for example the TypeScript compiler API via \`createRequire(path.join(process.cwd(), 'package.json'))('typescript')\` and \`path.join(process.cwd(), 'src')\`, skipping \`vendor\` and \`third_party\` directories, so execution proxies that rewrite inline \`bun -e\` scripts to a temp directory still resolve the target repo), not by eye, and report the measured line count. Do not file a split for a declarative registration factory whose body is a table of tool, prompt, resource, route, or schema definitions. Measure the inner handlers and real helpers. A file over 500 lines is still High when it is mostly declarations.
     4. **Schema-to-Handler Parameter Drift Check**: Every input-schema property is consumed by the handler or rewritten by that project's own parameter-normalization layer. Do not assume a file named \`param-normalizer.ts\` exists. Quote the schema field and the handler or normalizer read. Ignore fields that are forwarded as a whole parsed object.
     5. **Uncleaned Timer / EventListener Detector**: Flag \`setInterval\`, retained \`setTimeout\` handles, \`fs.watch\`, and \`process\` / server / filesystem / worker \`.on(\` registrations that lack \`unref()\`, \`clear*\`, or \`close()\` / \`finally\` cleanup. An awaited one-shot delay is not a leak.
     6. **Type-safety Detector**: Flag \`any\`, \`as any\`, \`z.any()\` in Zod schemas (unless explicitly documented for arbitrary untrusted JSON passthrough), TypeScript postfix non-null assertions (\`value!\`), definite assignment (\`!:\`), and a double assertion (\`as unknown as\`) that reads a property the source type does not declare. Ignore GraphQL \`Type!\`, \`!=\`, and \`!condition\`. Leave SDK boundary casts, such as simple-git options, alone. Do not file every \`as\` on a database row.
     7. **Fuzzy method dispatch**: Flag \`includes\`, \`startsWith\`, or \`endsWith\` on a method or tool name used to choose a handler. Quote the token and the name that would take the wrong branch, such as \`listDeletedEntries\` matching \`delete\`. Exact \`Map\` lookup is not fuzzy.
     8. **Accepted-but-ignored parameters**: A schema field is ignored when the handler passes a literal \`undefined\` in its place, or copies the field into a bag that no callee reads. Quote both sites. A whole parsed object that is forwarded counts as consumed.
     9. **False success**: Flag a \`success: true\` result, or a resolved promise of one, on a path that did not perform the requested operation. Leave out a documented discovery response, including a \`_healing_note\` that says the operation did not run. A success that silently drops a requested side effect (for example a relationship link or a vector write that failed inside an empty \`catch\`) without a warning field is a false success. A success with no such note, a failed result whose array methods return an empty collection, and a filesystem shim that returns true from a substring stay in scope.
    10. **Sentinel scope**: Flag an omitted workspace that selects every row, and a supplied workspace or project number that is replaced or dropped (including \`resolveWorkspaceId\` callers that discard \`projectNumber\` or hot-reload listeners that fail to propagate \`projectRegistry\` updates to background schedulers or interceptors). An omission that becomes the server's configured default is a product note. Explicit \`'*'\` on multi-workspace DB queries is an intentional admin override; flag \`'*'\` when a fallback manufactures it after a miss or when it is passed to a single-root filesystem mutation.
    11. **Safety gate**: Flag a \`catch\` that logs and then continues a destructive operation, such as a failed backup followed by a prune.
2. **Scan for files exceeding 500 lines using two redundant methods.** Run both from the target repository root. Scope them to \`src\` and \`scripts\` when those directories exist. Skip test files and vendored or synced third-party trees in every detector, not only this count. Common vendored or build names are \`vendor\`, \`src/vendor\`, \`third_party\`, \`node_modules\`, \`dist\`, \`coverage\`, \`build\`, \`.next\`, and \`out\`. If \`scripts\` is absent, scan \`src\` only. Skip those directories by name before descending. Both methods must print \`SCAN_OK scanned=<n> over500=<n>\`. A scan that does not print that line failed. Do not treat that as zero files over 500 lines.
   - **Method 1 (Native PowerShell)**:
     \`\`\`powershell
     $skip = @('vendor','third_party','node_modules','dist','coverage','build','.next','out')
     $n = 0
     $over = 0
     function Walk($dir) {
       if (-not (Test-Path -LiteralPath $dir)) { return }
       foreach ($item in (Get-ChildItem -LiteralPath $dir -Force)) {
         if ($skip -contains $item.Name) { continue }
         if ($item.PSIsContainer) { Walk $item.FullName; continue }
         if ($item.Name -cmatch '\\.(ts|tsx|js|mjs|cjs)$' -and $item.Name -cnotmatch '\\.(test|spec)\\.') {
           $script:n++
           $parts = [System.IO.File]::ReadAllText($item.FullName) -split '\\r?\\n'
           $lines = $parts.Length
           if ($lines -gt 0 -and $parts[$lines - 1] -eq '') { $lines-- }
           if ($lines -gt 500) { $script:over++; Write-Output ($lines.ToString() + ' ' + $item.FullName) }
         }
       }
     }
     Walk 'src'
     Walk 'scripts'
     Write-Output ('SCAN_OK scanned=' + $n + ' over500=' + $over)
     \`\`\`
   - **Method 2 (PowerShell \`bun -e\` only)**: Do not pass this script to \`node\`. The walk can take more than 60 seconds. Both methods count lines by splitting on \`\\r?\\n\` and dropping one trailing empty segment, and both match extensions case-sensitively. Both methods must print the same \`scanned\` and \`over500\` counts. If \`bun\` is unavailable, stop and report that method 2 did not run.
     \`\`\`powershell
     bun -e @'
import {readdirSync as r,statSync as s,readFileSync as f} from 'fs';import {join as j} from 'path';const skip=new Set(['vendor','third_party','node_modules','dist','coverage','build','.next','out']);let n=0,over=0;function w(d){if(!s(d,{throwIfNoEntry:false}))return;for(const x of r(d)){if(skip.has(x))continue;const p=j(d,x);if(s(p).isDirectory())w(p);else if(/\\.(ts|tsx|js|mjs|cjs)$/.test(x)&&!/\\.(test|spec)\\./.test(x)){n++;const parts=f(p,'utf8').split(/\\r?\\n/);const l=parts.length>0&&parts[parts.length-1]===''?parts.length-1:parts.length;if(l>500){over++;console.log(l,p)}}}}w('src');w('scripts');console.log('SCAN_OK scanned='+n+' over500='+over);
'@
     \`\`\`

> [!IMPORTANT]
> **High Priority — File Size**: Any file exceeding 500 lines is a high-priority finding. Flag all such files in the findings table with severity **High**. A function over 80 lines, or nesting deeper than 4, is **Moderate** unless that nesting hides one of the defects above. Do not mark function length by itself as High. Do NOT begin refactoring automatically — present them to the user for approval.

3. Group findings by category and severity (**Critical**, **High**, **Moderate**, **Low**). File-size findings are **High**.
4. **External Validation (Copilot — Opt-In)**: ${copilotInstruction}
5. Present a summary table to the user (incorporating Copilot findings if applicable) and await approval. Diagnostic scans in step 2, and read-only lint or typecheck when the target defines them, are part of the audit. **CRITICAL**: Do not edit project files, apply fixes, or commit until the user explicitly approves the implementation plan. Present the plan as markdown in the chat. Do not add an audit plan file to the repository. The plan must be readable in Cursor and in Antigravity.
6. After approval, fix critical issues first, then run the target's lint and typecheck and the tests that cover the change.
7. Commit with the target repository's own commit helper when one exists. Discover that helper. Do not invent a script path. Do not add an audit plan file to the repository.
**Rule**: If you don't make changes, do not commit.

${priorAuditSection}`
                        }
                    }]
                }
            }
        },
        {
            name: 'adversarial-audit-security',
            description: 'Multi-pass adversarial security audit (threat modeling, attack surfaces) Optional parameters: target, copilot, workspace_id',
            icons: [ICON_PROMPT],
            arguments: AUDIT_ARGUMENTS,
            handler: (args: Record<string, string> | undefined, db: IDatabaseAdapter, _teamDb?: IDatabaseAdapter, _github?: unknown, briefingConfig?: BriefingConfig, runtime?: object | null) => {
                const parsed = auditArgsSchema.parse(args ?? {})
                const target = sanitizePromptTarget(parsed.target ?? '{target}')
                const copilotTarget = sanitizeCopilotTarget(target)
                const copilotInstruction = buildCopilotStep(
                    parsed.copilot === 'true',
                    `gh copilot -- -p "Perform a security audit on ${copilotTarget} looking for injection vectors, auth/authz gaps, data boundaries, and agent-specific risks like prompt injection, excessive agency, or tool poisoning." --allow-all`
                )
                const priorAuditSection = buildPriorAuditSection(
                    db,
                    'security-audit',
                    'Prior security audits',
                    briefingConfig,
                    parsed.workspace_id,
                    parsed.target,
                    runtime
                )
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `# Adversarial Security Audit
Target: ${target}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target file or module, ask them for it now.

1. Perform a multi-pass security audit. For large targets or full-repository audits, spawn parallel read-only subagents by architectural domain. In Cursor use the Task tool with subagent type \`explore\` or \`generalPurpose\`. On any other host use that host's read-only subagent tool. Treat all external inputs as untrusted until verified. Depending on the target, evaluate:
   ${buildSubagentProtocolGuidance()}
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
4. Await approval before applying fixes. Diagnostic scans are part of the audit. Do not edit project files until the user approves the plan.
5. Commit with the target repository's own commit helper when one exists. Discover that helper. Do not invent a script path. Do not add an audit plan file to the repository.
**Rule**: If you don't make changes, do not commit.

${priorAuditSection}`
                        }
                    }]
                }
            }
        },
        {
            name: 'adversarial-audit-performance',
            description: 'Multi-pass adversarial performance audit (profiling, stress-testing) Optional parameters: target, copilot, workspace_id',
            icons: [ICON_PROMPT],
            arguments: AUDIT_ARGUMENTS,
            handler: (args: Record<string, string> | undefined, db: IDatabaseAdapter, _teamDb?: IDatabaseAdapter, _github?: unknown, briefingConfig?: BriefingConfig, runtime?: object | null) => {
                const parsed = auditArgsSchema.parse(args ?? {})
                const target = sanitizePromptTarget(parsed.target ?? '{target}')
                const copilotTarget = sanitizeCopilotTarget(target)
                const copilotInstruction = buildCopilotStep(
                    parsed.copilot === 'true',
                    `gh copilot -- -p "Perform a performance audit on ${copilotTarget} looking for N+1 queries, unnecessary allocations, and hot-path bottlenecks." --allow-all`
                )
                const priorAuditSection = buildPriorAuditSection(
                    db,
                    'performance-audit',
                    'Prior performance audits',
                    briefingConfig,
                    parsed.workspace_id,
                    parsed.target,
                    runtime
                )
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `# Adversarial Performance Audit
Target: ${target}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target file or module, ask them for it now.

1. Perform a multi-pass performance audit looking for N+1 queries, unnecessary allocations, and hot-path bottlenecks. For large targets or full-repository audits, spawn parallel read-only subagents by architectural domain (for example Database and Query Plans, Vector and Sandbox Execution, Server Dispatch and Observability). In Cursor use the Task tool with subagent type \`explore\` or \`generalPurpose\`. On any other host use that host's read-only subagent tool.
   ${buildSubagentProtocolGuidance()}
   - **Mandatory Deep-Performance Gates (Always Run)**:
     1. **SQLite Query Plan & Virtual Table Join Order Audit**: Inspect SQLite queries (especially FTS5 \`fts_content\` and \`sqlite-vec\` \`vec0\` joins) using \`EXPLAIN QUERY PLAN\`. Verify virtual tables are driven as the outer loop (\`CROSS JOIN\` when necessary to prevent planner inversion), check for \`USE TEMP B-TREE FOR DISTINCT\` or \`ORDER BY\`, verify SARGable \`WHERE\` clauses (no \`DATE(col)\` wrappers on indexed columns), and confirm prepared statement caching or reuse on hot paths.
     2. **N+1 Query & Post-Limit Hydration Audit**: Scan for database or vector lookups inside loops (e.g., per-row \`getEntryById\`, \`calculateImportance\`, \`getRelationships\`, \`getAuthorsForEntries\`, or tag hydration). Ensure expensive aggregations (like importance CTEs) are deferred to post-\`LIMIT\` batch hydration (\`WHERE id IN (...)\`) unless explicitly sorting by that computed column.
     3. **Serialization, Token Estimation & Interceptor Redundancy Audit**: Trace tool and resource payloads through handler -> metrics interceptor -> audit interceptor -> token estimator -> MCP transport response. Flag duplicate \`JSON.stringify\`, \`JSON.parse\`, or \`Buffer.byteLength\` calls on the same payload across layers.
     4. **Sandbox, Schema & RegExp Compilation Audit**: Scan for per-request \`new vm.Script\`, \`new RegExp\`, \`z.object().extend()\` / \`.partial().passthrough()\`, or schema-to-TypeScript string generation on hot paths that can be hoisted to module scope or memoized via \`WeakMap\`.
     5. **Async Waterfall & I/O Batching Audit**: Scan for sequential \`await\` calls in loops or independent network/git/filesystem operations (e.g., GitHub API fetches, \`realpathSync.native\` in chunked file writes) that can be parallelized with \`Promise.all\` / \`Promise.allSettled\` or cached with TTL.
     6. **Benchmark Suite Realism & Contamination Audit**: Inspect \`tests/**/*.bench.ts\` to verify benchmarks do not silently benchmark validation errors (e.g., missing required parameters under \`VITEST=true\`), do not contaminate read/search benchmarks with thousands of prior write-benchmark rows or orphan vectors, and do not pay cold-start model loading costs when embeddings are mocked.
2. **External Validation (Copilot — Opt-In)**: ${copilotInstruction}
3. Present findings table (incorporating Copilot findings if applicable) grouped by subsystem and severity (Critical, High, Moderate, Low) with quantified latency/allocation impact.
4. Await approval before applying fixes. Diagnostic scans are part of the audit. Do not edit project files until the user approves the plan.
5. After approval, apply fixes in phased stages, run the target's lint and typecheck, the tests that cover the change, and the benchmark command the target defines. Compare before and after telemetry.
6. Commit with the target repository's own commit helper when one exists. Discover that helper. Do not invent a script path. Do not add an audit plan file to the repository.
**Rule**: If you don't make changes, do not commit.

${priorAuditSection}`
                        }
                    }]
                }
            }
        },
        {
            name: 'adversarial-audit-seo',
            description: 'Adversarial SEO audit (technical, semantic HTML, ARIA, structured data, Core Web Vitals) Optional parameters: target, copilot, workspace_id',
            icons: [ICON_PROMPT],
            arguments: AUDIT_ARGUMENTS,
            handler: (args: Record<string, string> | undefined, db: IDatabaseAdapter, _teamDb?: IDatabaseAdapter, _github?: unknown, briefingConfig?: BriefingConfig, runtime?: object | null) => {
                const parsed = auditArgsSchema.parse(args ?? {})
                const target = sanitizePromptTarget(parsed.target ?? '{target}')
                const copilotTarget = sanitizeCopilotTarget(target)
                const copilotInstruction = buildCopilotStep(
                    parsed.copilot === 'true',
                    `gh copilot -- -p "Perform an SEO and Core Web Vitals audit on ${copilotTarget}." --allow-all`
                )
                const priorAuditSection = buildPriorAuditSection(
                    db,
                    'seo-audit',
                    'Prior SEO audits',
                    briefingConfig,
                    parsed.workspace_id,
                    parsed.target,
                    runtime
                )
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `# Adversarial SEO Audit
Target: ${target}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target file or module, ask them for it now.

1. Perform a multi-pass audit. For a large site, spawn read-only subagents. In Cursor use the Task tool with subagent type \`explore\` or \`generalPurpose\`. Check:
   - Technical SEO (meta tags, Open Graph, canonicals, viewport).
   - Semantic HTML and accessibility (ARIA, alt text, structural hierarchy).
   - Core Web Vitals implications (DOM size, layout shifts, LCP elements).
   - Structured data (JSON-LD) and E-E-A-T signals.
2. **External Validation (Copilot — Opt-In)**: ${copilotInstruction}
3. Present findings table (incorporating Copilot findings if applicable).
4. Await approval before applying fixes. Diagnostic scans are part of the audit. Do not edit project files until the user approves the plan.
5. Commit with the target repository's own commit helper when one exists. Discover that helper. Do not invent a script path. Do not add an audit plan file to the repository.
**Rule**: If you don't make changes, do not commit.

${priorAuditSection}`
                        }
                    }]
                }
            }
        },
        {
            name: 'adversarial-audit-skill',
            description: 'Multi-pass adversarial skill audit (research, evaluate triggers, stress-test) Optional parameters: target, copilot, workspace_id',
            icons: [ICON_PROMPT],
            arguments: AUDIT_ARGUMENTS,
            handler: (args: Record<string, string> | undefined, db: IDatabaseAdapter, _teamDb?: IDatabaseAdapter, _github?: unknown, briefingConfig?: BriefingConfig, runtime?: object | null) => {
                const parsed = auditArgsSchema.parse(args ?? {})
                const target = sanitizePromptTarget(parsed.target ?? '{target}')
                const copilotTarget = sanitizeCopilotTarget(target)
                const copilotInstruction = buildCopilotStep(
                    parsed.copilot === 'true',
                    `gh copilot -- -p "Evaluate the agent skill at ${copilotTarget} for trigger reliability, safety gates, and frontmatter compliance. When viewing or reading files, always provide the 'path' parameter correctly." --allow-all`
                )
                const priorAuditSection = buildPriorAuditSection(
                    db,
                    'skill-audit',
                    'Prior skill audits',
                    briefingConfig,
                    parsed.workspace_id,
                    parsed.target,
                    runtime
                )
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `# Adversarial Skill Audit
Target: ${target}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target skill, ask them for it now.

1. **Subagent Research Phase**: Use the host's web search tool for official docs, release notes, and credible write-ups of the latest practices and version changes for the target skill. In Cursor use the Task tool with subagent type \`explore\` or \`generalPurpose\` when the skill tree is large. Wait for those findings.
2. **Gap Analysis**: Compare the subagent research findings against the current skill's contents to identify missing context, outdated information, or new version features.
3. **Structural Evaluation**: Evaluate the agent skill for trigger reliability, safety gates, and markdown frontmatter compliance.
4. **External Validation (Copilot — Opt-In)**: ${copilotInstruction}
5. **Presentation**: Present findings table incorporating Copilot structural findings (if applicable) and the new research gaps.
6. HITL Approval: Await approval before applying fixes. Diagnostic scans are part of the audit. Do not edit project files until the user approves the plan.
7. Commit with the target repository's own commit helper when one exists. Discover that helper. Do not invent a script path. Do not add an audit plan file to the repository.
**Rule**: If you don't make changes, do not commit.

${priorAuditSection}`
                        }
                    }]
                }
            }
        },
        {
            name: 'adversarial-audit-workflow',
            description: 'Multi-pass adversarial workflow audit (clarity, safety gates, loop prevention) Optional parameters: target, copilot, workspace_id',
            icons: [ICON_PROMPT],
            arguments: AUDIT_ARGUMENTS,
            handler: (args: Record<string, string> | undefined, db: IDatabaseAdapter, _teamDb?: IDatabaseAdapter, _github?: unknown, briefingConfig?: BriefingConfig, runtime?: object | null) => {
                const parsed = auditArgsSchema.parse(args ?? {})
                const target = sanitizePromptTarget(parsed.target ?? '{target}')
                const copilotTarget = sanitizeCopilotTarget(target)
                const copilotInstruction = buildCopilotStep(
                    parsed.copilot === 'true',
                    `gh copilot -- -p "Evaluate the workflow ${copilotTarget} for sequential clarity, human-in-the-loop safety gates, and infinite loop prevention." --allow-all`
                )
                const priorAuditSection = buildPriorAuditSection(
                    db,
                    'workflow-audit',
                    'Prior workflow audits',
                    briefingConfig,
                    parsed.workspace_id,
                    parsed.target,
                    runtime
                )
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `# Adversarial Workflow Audit
Target: ${target}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target workflow, ask them for it now.

1. Evaluate the workflow for sequential clarity, human-in-the-loop safety gates, and infinite loop prevention. For a large workflow tree, spawn read-only subagents. In Cursor use the Task tool with subagent type \`explore\` or \`generalPurpose\`.
2. **External Validation (Copilot — Opt-In)**: ${copilotInstruction}
3. Present findings table (incorporating Copilot findings if applicable).
4. Await approval before applying fixes. Diagnostic scans are part of the audit. Do not edit project files until the user approves the plan.
5. Commit with the target repository's own commit helper when one exists. Discover that helper. Do not invent a script path. Do not add an audit plan file to the repository.
**Rule**: If you don't make changes, do not commit.

${priorAuditSection}`
                        }
                    }]
                }
            }
        }
    ]
}
