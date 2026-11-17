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
     1. **SQLite Query Plan, Virtual Table Join Order & Bind Bounds Audit**: Inspect SQLite queries (especially FTS5 \`fts_content\` and vector virtual tables like \`sqlite-vec\` \`vec0\`) using \`EXPLAIN QUERY PLAN\`. Verify virtual tables drive outer loops (\`CROSS JOIN\` where needed to prevent planner inversion); enforce early termination and total-vector bounds on scoped KNN \`k\`-widening retry loops (exit immediately on 0 vectors or 0 scoped rows and cap \`k\` by total vector count); verify \`BigInt\` integer primary-key binds on vector \`IN (...)\` deletes; avoid uncorrelated \`IN (SELECT id FROM ...)\` \`LIST SUBQUERY\` + \`BLOOM FILTER\` plans in favor of \`INNER JOIN\` / \`EXISTS\`; check for \`USE TEMP B-TREE FOR DISTINCT\` or \`ORDER BY\`; verify SARGable predicates (no \`DATE(col)\` / \`julianday(col)\` wrappers on indexed columns, and align \`COLLATE NOCASE\` lookups with collated indexes); ensure \`WITH\` CTE seed filters (e.g. \`fts_hits\`, \`ws_entries\`) align positional \`?\` vs named binds; and bucket \`WHERE id IN (...)\` parameters to \`<= 500\` binds (\`<= 240\` per side on dual \`OR ... IN\` queries) with prepared-statement reuse on hot paths.
     2. **N+1 Query, Transaction & Post-Limit Hydration Audit**: Scan for database or vector lookups inside loops (e.g., per-row \`getEntryById\`, \`calculateImportance\`, \`getRelationships\`, \`getAnchorsByEntryId\`, \`getAuthorsForEntries\`, or duplicate tag hydration). Defer expensive aggregations (importance CTEs, relationship counts) to post-\`LIMIT\` batch hydration (\`WHERE id IN (...)\`) or lightweight scalar-only queries (\`getImportanceScoresByIds\`) unless sorting by that computed column, and guard nested transaction helpers with \`db.inTransaction\` checks to avoid redundant SQLite \`SAVEPOINT\` overhead.
     3. **Serialization, Token Estimation, Config Cache & Interceptor Redundancy Audit**: Trace tool, resource, and sandbox worker payloads end-to-end (handler -> metrics/audit interceptors -> token estimator -> transport response -> worker structured-clone egress). Flag duplicate \`JSON.stringify\`, \`JSON.parse\` (only skip \`JSON.parse(JSON.stringify(...))\` round-trips on trusted host in-memory paths when no circular/\`bigint\` mutations occurred; never skip it across \`worker_threads\` \`postMessage\` structured-clone egress where nested userland \`Proxy\`, function, or symbol values must be stripped before cloning, marking \`resultSent\` only after \`postMessage\` succeeds), unnecessary pretty-printing, uncached \`Buffer.byteLength\` passes, per-call synchronous config file reads lacking \`(mtimeMs, size)\` caching, and synchronous issue-log writes or double error logging across retry/catch boundaries.
     4. **Sandbox, Proxy, Schema & RegExp Compilation Audit**: Scan for per-request \`new vm.Script\`, \`new RegExp\`, uncached \`z.object().extend()\` / \`.partial().loose()\`, repeated schema introspection on hot paths, uncached \`Proxy\` \`get\`-trap \`.bind()\` allocations (cache bound methods in a \`WeakMap\` keyed by target + raw function identity so test spies remain transparent), linear scans instead of precomputed \`Map\` / \`ReadonlySet\` dispatch tables, unbounded matrices/caches, and eager CLI subcommand imports that slow \`--help\` startup.
     5. **Async Waterfall & I/O Batching Audit**: Scan for sequential \`await\` calls in loops or independent network/git/filesystem operations (e.g., independent \`simple-git\` / GitHub API calls, repeated \`realpathSync.native\` checks inside chunked writes, sequential file reads during bulk imports, or per-item vector indexing where batch embedding/upserts apply) that can use \`Promise.allSettled\` / \`Promise.all\`, bounded concurrency, chunk-level verification, or short-TTL caching (always prefer \`Promise.allSettled\` when parallelizing subprocesses such as \`simple-git\` so early rejection of one subprocess cannot return while a sibling child still holds a Windows \`cwd\` directory handle and triggers \`EPERM\` on cleanup).
     6. **Benchmark Suite Realism & Contamination Audit**: Inspect benchmark suites (such as \`tests/**/*.bench.ts\`) to verify benchmarks assert valid execution (\`success !== false\` pre-flight checks in \`beforeAll\`) so validation rejections (e.g., missing required parameters when test env vars disable config fallback) never masquerade as fast writes, isolate read/search databases from write-benchmark mutations in \`os.tmpdir()\` (with \`.db\`/\`-wal\`/\`-shm\` cleanup), clear local encryption env overrides during benchmarks, and skip cold-start model initialization when embeddings are mocked.
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
