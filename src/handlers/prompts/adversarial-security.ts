/**
 * Memory Journal MCP Server - `adversarial-audit-security` prompt definition.
 * [INTENT] Extracted from `adversarial.ts` so the security audit workflow and
 * Pass 35+ deep-security gates stay cleanly modular under the 500-line ceiling.
 */

import type { InternalPromptDef } from './index.js'
import {
    AUDIT_PROMPT_REVISION,
    buildAuditPromptDefinition,
    buildSharedAuditPreamble,
} from './adversarial-audit-factory.js'
import { buildSubagentProtocolGuidance } from './adversarial-helpers.js'

export const SECURITY_PROMPT_REVISION = AUDIT_PROMPT_REVISION

function buildSecurityAuditBody(
    target: string,
    copilotInstruction: string,
    priorAuditSection: string
): string {
    return `# Adversarial Security Audit
${buildSharedAuditPreamble(target, 'file or module')}

1. Perform a multi-pass security audit. For large targets or full-repository audits, run parent-owned baseline line/AST scans (\`SCAN_OK\`, \`COMPLEXITY_OK\` in a temporary scratch script with \`try/finally\` cleanup), a worker chunk-graph builtin-only probe (\`node:module\` \`builtinModules\`, zero CJS \`__require\` shims), and a deterministic auth-surface probe (\`TOOL_GROUP_SCOPES\`, \`tool-filter.ts\`, \`openWorldHint\`) before spawning parallel read-only subagents partitioned by trust boundary. In Cursor use the Task tool with subagent type \`explore\` or \`generalPurpose\`; on any other host use that host's read-only subagent tool. Treat all external inputs as untrusted until verified.
   ${buildSubagentProtocolGuidance()}
   - **General Code**: Injection vectors, auth/authz gaps, secret redaction (CLI flags, logs, SQLCipher errors), and data boundary validation.
   - **Agent Skills / MCP Tools**: Privilege escalation (excessive agency), indirect prompt injection via tool/resource outputs, tool poisoning / supply chain risks, and cross-plugin attacks.
   - **External Integrations**: SSRF/DNS rebinding paths, redirect smuggling, and excessive API permission scopes.
   - **Security Documentation (\`SECURITY.md\`)**: Check whether the target project has a \`SECURITY.md\` file; verify documented controls and symbol/module references match the codebase, and include any needed \`SECURITY.md\` updates in the remediation plan.
   - **Mandatory Deep-Security Gates (Always Run)**:
     1. **Pre-Validation Transform & DoS Ordering Audit**: Verify no input healer, AST/regex normalizer, JSON/SQL/NL synthesizer, ReDoS-prone regex (enforce single-pass $O(N)$ non-code span lookup, bounded parameter/argument quantifiers, linear quote/paren prepared-statement extraction, pre-scanned tagged-template/quote repair caps \`<= 16\`, & 200-char prefix slices before trailing-punctuation trims), or unbounded element/byte/depth allocation runs *before* HTTP pre-body rate-limiting (including stream error listener detachment before \`destroy()\`), byte-length caps (\`maxRequestBodySize\` on streaming/SSE transports), \`maxToolInputElements\` (active-ancestor cycle tracking so shared-reference DAGs count on every visit, $O(1)$ \`TypedArray\`/\`ArrayBuffer\`/\`Map\`/\`Set\` size checks, worker RPC & \`group-factory\` admission before \`deepCamelToSnake\` \`WeakMap\` memoization), direct resource URI byte caps (\`readResource\`) / prompt arg length caps (\`getPrompt\`), bearer/OAuth authentication (constant-time SHA-256 \`timingSafeEqual\`, whitespace-trimmed placeholder checks, \`GET\`/\`HEAD\`-only public route bypass), or sandbox security validation (including \`estimateSerializedByteBounds\` depth caps and \`context\` recovery byte caps).
     2. **Lexical Scanner, Prototype Escape & Structured-Clone Egress Audit**: Verify comment/string strippers AND code healers/auto-return scanners align regex literals vs \`/\` (\`=>\`, \`}block\`/\`)ctrl\`, \`try/catch/switch\`, statement vs expression \`function\`/\`class\` bodies \`parenFnDecl\`/\`)decl\`, member-property keyword suppression after \`.\` and \`?.\`, prefix/postfix \`++\`/\`--\`), Annex B HTML comments (\`<!--\`/\`-->\`), template interpolations (\`\${...}\`), and Unicode/hex escapes (\`\\\\uXXXX\`/\`\\\\u{...}\`/\`\\\\xXX\`) with identifier-only \`NFKC\` normalization (never normalizing delimiters pre-lexing); verify post-\`transformAutoReturn\` security validation runs before execution; verify \`Object.prototype.__proto__\` accessor deletion, \`%GeneratorPrototype%\`, \`%AsyncGeneratorPrototype%\`, \`%IteratorPrototype%\`, concrete iterator & helper prototypes (\`%ArrayIteratorPrototype%\`, \`%StringIteratorPrototype%\`, \`%MapIteratorPrototype%\`, \`%SetIteratorPrototype%\`, \`%RegExpStringIteratorPrototype%\`, \`%IteratorHelperPrototype%\`, \`%WrapForValidIteratorPrototype%\`), concrete \`%TypedArray%\` (including \`Float16Array\`) / \`Buffer\` / \`AggregateError\` constructors, \`SuppressedError\`, \`DisposableStack\`, \`SharedArrayBuffer\`, \`FinalizationRegistry\`, \`Function\`, \`Reflect\`, frozen filesystem/SQL shims, and destructured prototype helpers are neutered/blocked; verify explicit \`env: {}\` worker isolation, per-execution lexical RPC bridge isolation, fatal worker termination on post-run/timeout errors, \`JSON.parse(JSON.stringify(...))\` structured-clone egress unwrapping, and \`Promise.race\` timeout cleanup.
     3. **Multi-Tenant Parameter Threading, Scoped State & Path Safety Audit**: Trace \`workspace_id\` and \`project_number\` end-to-end across SQLite \`WHERE\` clauses (\`pairStoredScope\`, \`hasActiveProjectRegistry()\` distinguishing explicit empty \`{}\` from unset, atomic snapshot capture/restore across healing/dispatch, unique workspace derivation for \`project_number\`-only nested narrowing & source-project verification on wildcard cross-workspace moves, exact case-sensitive ownership on unregistered workspaces, fail-closed \`project_number\` enforcement across \`team_*\` tools/resources/prompts/CLI & \`alignedProjectFilter\` on \`rebuild_vector_index\`, and rejecting \`*\` / unregistered workspaces on \`memory://graph/{+repo}\` & \`memory://briefing/{+repo}\`) and vector metadata filters; verify scoped tag merges fail closed before creating target tags; verify Windows UNC (\`\\\\host\\share\`, \`//host/share\`) & Win32 device (\`\\\\.\\ \`, \`\\\\?\\ \`) path rejection before \`fs.realpathSync.native\`, symlink/realpath validation on anchor staleness checks & leading-\`-\` git tag rejection, pre-\`open\` \`lstat\` (\`O_NOFOLLOW\`) symlink/non-regular-file rejection, strict \`.db\` regular-file restore targets, chunked \`assertSafeDirectoryPath(realpathSync.native(...))\` pre-write checks, Win32 ADS \`:\` / DOS device rejections, 10,000-entry directory scan caps, entry-list-keyed backup cache invalidation, and restrictive \`0o600\`/\`0o700\` + \`O_EXCL\` (\`wx\`) log/config/metrics/backup file modes.
     4. **Execution-Layer Filter, Namespace & RBAC Parity Check**: Verify \`--tool-filter\` (and hot-reload), URI-rewritten healing shims (\`get_entry_by_id({ uri })\` -> \`read_resource\`), \`codemodeInternalFullAccess\` enforcement on dummy healing / FS fallbacks (removing \`codemodeInternalFullAccess\` bypasses on \`search_entries\` fallbacks) / \`mj.getConfig()\`, OAuth scopes (preserving capability-flagged admin/team prompt names + stateful \`httpSessionProjects\` scope fallback in audit logs, \`SCOPES.ADMIN\` on \`team_rebuild_vector_index\` & \`team_export_markdown\`, and \`SCOPES.AUDIT\` gating on standalone Prometheus \`mcp_user_calls_total\`), \`readonly\`/\`dry_run\` flags, \`mj.team.*\` namespace isolation, and \`enforceTeamRbac\` (running \`normalizeDispatchParams\` & \`validateRpcOverrideBounds\` inside \`runInAdjustedRequestContext\`, pinning \`rpcPinnedProject\` on \`rpcOverrides.projectNumber\`, & \`Promise.allSettled\` primary DB parity in cross-team search) hold identically across \`tools/list\`, \`tools/call\`, Code Mode \`mj.*\` & nested \`executeCode\` dispatch, healing fallbacks, resources, prompts, importers, and CLI paths.
     5. **SSRF, JWKS Fetch & Transitive Prompt-Injection Taint Trace**: Verify remote JWKS/OAuth fetches (including loopback streaming body caps and IPv6 bracket stripping before \`net.isIP\`) and OAuth metadata URL validation use DNS-pinned custom transports blocking redirects, response size limits, case-normalized \`https://\` checks, full IPv4/IPv6 \`uint16[8]\` normalization (covering \`198.18.0.0/15\`, \`224.0.0.0/4\`, \`240.0.0.0/4\`, \`fec0::/10\`, \`2001:2::/48\`, \`100::/64\`, ORCHID, Teredo \`2001:0000::/32\`, NAT64 \`64:ff9b::\`, 6to4 \`2002::\`, SIIT, hex IPv4-mapped), non-whitespace JWT \`sub\`, and verified OIDC claims (\`email_verified === true\`); verify canonical shared \`SENSITIVE_KEY_RE\` & \`sanitizeErrorForLogging\` secret redaction (loggers, worker RPC / Code Mode / GitHub error messages, quoted & unquoted CLI flags including \`--password\`/\`--secret\`/\`--api-key\`/\`--auth-token\`/\`--access-token\`/\`--client-secret\`/\`--encryption-key\`, \`--dump-config\` nested parents, SQLCipher single/double-quoted escaped pragmas), same-repo git host URL parsing & \`GITHUB_TOKEN\` gating, prototype-safe \`Object.create(null)\`/\`Object.hasOwn\`/\`Map\` lookup tables, validated audit YAML egress fields, and C0/C1 stripping + idempotent \`<untrusted_remote_content>\` fencing (including team \`author\` in hybrid search) across Git/GitHub/resource/prompt/audit/team outputs without breaking internal caches/enums.
     6. **End-to-End Backstop Verification & Prompt Evolution**: Trace ingress interceptors, dispatch normalizers, RBAC/importer scope checks, and storage scope pairing with concrete reproducers before classifying Critical/High; include a **Prompt Self-Improvement Proposals (\`AP1\`–\`APn\`)** table for blind spots found, and verify \`AUDIT_PROMPT_REVISION\` and related tests are updated when prompt hardening is applied.
2. **External Validation (Copilot — Opt-In)**: ${copilotInstruction}
3. Present findings table (incorporating Copilot findings if applicable) and the **Prompt Self-Improvement Proposals (\`AP1\`–\`APn\`)** table.
4. Await approval before applying fixes. Diagnostic scans are part of the audit. Do not edit project files until the user approves the plan.
5. After approval, apply fixes, run the target's lint, typecheck, and security regression tests, and if the project has a \`SECURITY.md\` file, update it when audit findings or implemented changes affect documented security controls, threat boundaries, or references.
6. Commit with the target repository's own commit helper when one exists. Discover that helper. Do not invent a script path. Do not add an audit plan file to the repository.
**Rule**: If you don't make changes, do not commit.

${priorAuditSection}`
}

export function getSecurityAuditPromptDefinition(): InternalPromptDef {
    return buildAuditPromptDefinition({
        name: 'adversarial-audit-security',
        description:
            'Multi-pass adversarial security audit (threat modeling, attack surfaces) Optional parameters: target, copilot, workspace_id, project_number',
        tag: 'security-audit',
        heading: 'Prior security audits',
        copilotCommand: (t) =>
            `gh copilot -- -p "Perform a security audit on ${t} looking for injection vectors, auth/authz gaps, data boundaries, and agent-specific risks like prompt injection, excessive agency, or tool poisoning." --allow-all`,
        body: ({ target, copilotInstruction, priorAuditSection }) =>
            buildSecurityAuditBody(target, copilotInstruction, priorAuditSection),
    })
}
