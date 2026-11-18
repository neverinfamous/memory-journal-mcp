/**
 * Memory Journal MCP Server - `adversarial-audit-performance` prompt definition.
 * [INTENT] Extracted from `adversarial.ts` so performance gates and Pass 34+ self-improvement
 * guardrails remain cleanly modular and under the 500-line ceiling.
 */

import type { InternalPromptDef } from './index.js'
import {
    AUDIT_PROMPT_REVISION,
    buildAuditPromptDefinition,
    buildSharedAuditPreamble,
} from './adversarial-audit-factory.js'
import { buildSubagentProtocolGuidance } from './adversarial-helpers.js'

export const PERFORMANCE_PROMPT_REVISION = AUDIT_PROMPT_REVISION

function buildPerformanceAuditBody(
    target: string,
    copilotInstruction: string,
    priorAuditSection: string
): string {
    return `# Adversarial Performance Audit
${buildSharedAuditPreamble(target, 'file or module')}

1. Perform a multi-pass performance audit looking for N+1 queries, unnecessary allocations, query-plan regressions, and hot-path bottlenecks. For large targets or full-repository audits, run parent-owned baseline line/AST scans (\`SCAN_OK\`, \`COMPLEXITY_OK\`), read-only \`EXPLAIN QUERY PLAN\` probes, and pre-change benchmark telemetry (\`pnpm run bench\` or the target's benchmark command) before spawning parallel read-only subagents partitioned by architectural domain (for example Database and Query Plans, Vector and Sandbox Execution, Server Dispatch and Observability, Handlers and Benchmarks). In Cursor use the Task tool with subagent type \`explore\` or \`generalPurpose\`. On any other host use that host's read-only subagent tool.
   ${buildSubagentProtocolGuidance()}
   - **Mandatory Deep-Performance Gates (Always Run)**:
     1. **SQLite Query Plan, Virtual Table Join Order & Bind Bounds Audit**: Inspect SQLite queries (especially FTS5 and vector virtual tables) using \`EXPLAIN QUERY PLAN\` pre- and post-\`ANALYZE\` (\`PRAGMA optimize\` after migrations). Verify virtual tables drive outer loops (\`CROSS JOIN\` when needed), add composite scope+recency covering indexes and prune redundant single-column indexes duplicated as left-prefixes of composite indexes/UNIQUE constraints; enforce early termination and total-vector bounds on scoped KNN \`k\`-widening retries; verify integer/\`BigInt\` primary-key binds on virtual-table deletes; replace uncorrelated \`IN (SELECT id ...)\` subqueries with \`INNER JOIN\`/\`EXISTS\`; flag \`USE TEMP B-TREE FOR DISTINCT\` or \`ORDER BY\`, non-SARGable function wrappers on indexed columns, misaligned \`COLLATE NOCASE\`/CTE binds, and unbucketed \`IN (...)\` binds (\`<= 500\`, \`<= 240\` per side on dual \`OR ... IN\`) with prepared-statement reuse.
     2. **N+1 Query, Transaction & Post-Limit Hydration Audit**: Scan for DB/vector lookups inside loops (\`getEntryById\`, \`calculateImportance\`, \`getRelationships\`, \`getAnchorsByEntryId\`, author/tag hydration). Defer expensive aggregations and multi-signal scoring to post-\`LIMIT\` / post-RRF progressive chunk hydration (hydrating only the next page of fused candidates instead of every vector hit) and lightweight scalar-only queries (\`getImportanceScoresByIds\`) unless sorting by that column; share cross-instance query-embedding LRU + in-flight deduplication (bypassed when custom/mocked generators are injected); and guard nested transactions with \`db.inTransaction\` checks.
     3. **Serialization, Token Estimation, Config Cache & Interceptor Redundancy Audit**: Trace tool, resource, and worker payloads end-to-end. Flag duplicate \`JSON.stringify\`/\`JSON.parse\`, post-cache mutations that silently invalidate \`WeakMap\` serialization caches (order field enrichment before metrics/audit cache hydration or invalidate on mutation, and sentinel-splice late \`_meta\` fields in one pass), uncached \`Buffer.byteLength\`, repeated \`realpathSync\`/config reads lacking \`(mtimeMs, size)\`/\`stat\` validation, and synchronous issue-log writes. Only skip clone round-trips on trusted host paths; keep serialization sanitization across \`worker_threads\` \`postMessage\` egress and elide static metadata/schemas on warm workers (resetting on worker exit/death).
     4. **Sandbox, Proxy, Context & Schema Compilation Audit**: Scan for per-request \`new vm.Script\`, \`new RegExp\`, uncached schema builders (e.g. \`.partial().loose()\`) or schema introspection, uncached \`Proxy\` \`get\`-trap \`.bind()\`, linear dispatch scans, unbounded caches, eager CLI imports, and per-call full tool-registry rebuilds for transient request metadata -- expose \`AsyncLocalStorage\`-backed lazy context getters (\`progress\`, \`auth\`) on cached tool contexts and verify handlers read them inside each invocation rather than destructuring at factory registration time.
     5. **Async Waterfall & I/O Batching Audit**: Flag synchronous child-process calls (\`execFileSync\`) on async handlers/resources and sequential \`await\` loops across independent network/git/filesystem work (\`simple-git\`, GitHub/OAuth JWKS DNS/fetch calls, bulk imports, git anchor SHA resolution) that can batch per-repo SHAs, run independent subprocess/API probes concurrently via bounded \`Promise.allSettled\` / \`Promise.all\`, or use chunked batch vector upserts/deletes.
     6. **Benchmark Suite Realism & Contamination Audit**: Inspect benchmark suites (such as \`tests/**/*.bench.ts\`) to ensure pre-flight assertions reject validation errors before timing, pre-seed both read and write databases to steady-state cardinality, pre-flight warm write managers, seed graph/anchor tables so scoring paths run real SQL, suppress logger noise (\`LOG_LEVEL=error\`), isolate read/write temp DBs in \`os.tmpdir()\` with \`.db\`/\`-wal\`/\`-shm\` cleanup, clear encryption env overrides, and skip cold-start model loads when embeddings are mocked.
   - **Severity Calibration & Intentional Architecture Guardrails**:
     - Require quantified evidence (\`EXPLAIN QUERY PLAN\` output, asymptotic complexity, byte/object allocation math, or reproducible benchmark delta) before classifying any finding **Critical** or **High** (zero Critical/High findings is valid when hot paths hold; classify cold-path/CLI startup/micro-allocations as **Moderate** or **Low**).
     - Respect intentional architecture: never parallelize sequential ONNX model initialization (prevents CPU/RAM thrashing); preserve hoisted Dual-Schema MCP validation (\`*SchemaMcp\` + strict \`.parse()\`, including alias/clamping transforms); preserve dynamic tool filtering/hot-reload hooks; and never weaken raw+decoded symlink checks, \`<untrusted_remote_content>\` pre-fencing, RBAC, or storage scope pair checks.
2. **External Validation (Copilot — Opt-In)**: ${copilotInstruction}
3. Present findings table (incorporating Copilot findings if applicable) grouped by subsystem and severity (Critical, High, Moderate, Low) with quantified latency/allocation impact, plus a **Prompt Self-Improvement Proposals (\`AP1\`–\`APn\`)** table capturing concrete blind spots, false-positive traps, or diagnostic friction observed in this pass.
4. Await approval before applying fixes. Diagnostic scans are part of the audit. Do not edit project files until the user approves the plan.
5. After approval, apply fixes in phased stages, run the target's lint and typecheck, the tests that cover the change, and the benchmark command the target defines. Compare before and after telemetry (query plans + benchmarks).
6. Commit with the target repository's own commit helper when one exists. Discover that helper. Do not invent a script path. Do not add an audit plan file to the repository.
**Rule**: If you don't make changes, do not commit.

${priorAuditSection}`
}

export function getPerformanceAuditPromptDefinition(): InternalPromptDef {
    return buildAuditPromptDefinition({
        name: 'adversarial-audit-performance',
        description:
            'Multi-pass adversarial performance audit (profiling, stress-testing) Optional parameters: target, copilot, workspace_id, project_number',
        tag: 'performance-audit',
        heading: 'Prior performance audits',
        copilotCommand: (t) =>
            `gh copilot -- -p "Perform a performance audit on ${t} looking for N+1 queries, unnecessary allocations, and hot-path bottlenecks." --allow-all`,
        body: ({ target, copilotInstruction, priorAuditSection }) =>
            buildPerformanceAuditBody(target, copilotInstruction, priorAuditSection),
    })
}
