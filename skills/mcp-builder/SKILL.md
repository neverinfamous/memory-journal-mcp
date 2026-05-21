---
name: mcp-builder
description: |
  Guide for creating high-quality MCP (Model Context Protocol) servers that
  enable LLMs to interact with external services through well-designed tools.
  Use when building MCP servers, designing tool schemas, implementing error
  handling for agent consumption, adding OAuth or HTTP transport, or when the
  user asks about MCP protocol compliance, tool annotations, output schemas,
  or connecting AI to external APIs using Node/TypeScript (MCP SDK). Also use
  when reviewing existing MCP server code for best practices.
---

# MCP Server Development Guide

Create MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools.

## Quick Reference Checklist

Scannable compliance table — see full sections below for details.

| Area | Required Pattern | Section |
|------|--------------------|---------|
| Error handling | `ErrorCategory` enum (9), `{Server}McpError` base + 6 subclasses, single `formatHandlerError()` | §2.2.2 |
| Error auto-refinement | Constructor auto-refines generic codes → specific codes (e.g., `DB_QUERY_FAILED` → `TABLE_NOT_FOUND`) | §2.2.2 |
| Engine-specific error parser | Dedicated `error-parser.ts` maps DB-native error codes to structured errors (complementary to auto-refinement) | §2.2.2 |
| ErrorFieldsMixin | 6-field Zod mixin (`error`, `code`, `category`, `suggestion`, `recoverable`, `details`) on every `outputSchema` | §2.2.2 |
| `structuredContent` on errors | Error responses set `structuredContent` when tool has `outputSchema` | §2.2.2 |
| Success-path fields | All `.optional()` so error responses pass `outputSchema` validation | §2.2.2 |
| Input coercion | `z.preprocess(coerceNumber, ...)` (preferred) or `z.coerce.number()` + NaN guards for numerics | §2.3.1 |
| Limit coercion | `coerceLimit(raw, default)` + `buildLimitClause()` + `DEFAULT_QUERY_LIMIT` in `utils/query-helpers.ts` | §2.3.1 |
| `.partial().passthrough()` or dual-schema | Dual-schema (`XxxSchema` + `XxxSchemaMcp`) preferred; `.partial().passthrough()` for adapter servers | §2.3.2 |
| Existence validation | Proactive `validateTableExists/Column/Columns()` before DML | §2.3.3 |
| WHERE clause validation | Mandatory `validateWhereClause()` for all SQL interpolation tools | §2.3.4 |
| FTS config validation | `validateFtsConfig()` prevents SQL injection via FTS configuration names | §2.3.4 |
| Idempotent reporting | `alreadyExists: true` flag distinguishing created from no-op | §2.3.5 |
| Resource annotations | Centralized presets (`HIGH_PRIORITY`, `MEDIUM_PRIORITY`, etc.) in `utils/resource-annotations.ts` | §2.3 |
| Payload optimization | Use YAML/key-value instead of JSON for resource text payloads to save 20-30% tokens | §1.1 |
| Progress notifications | `sendProgress(ctx, current, total?, message?)` for long-running tools | §2.3 |
| Tool naming | `snake_case`, 1-128 chars, unique within server | §1.1 |
| Tool annotations | `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` | §2.3 |
| Tool `title` | Human-readable display name on every tool | §2.3 |
| Tool icons | CDN-hosted SVG per tool group, attached at aggregation point | §2.4 |
| `outputSchema` + `structuredContent` | Co-located `schemas.ts` per group (non-adapter) or `schemas/` directory (adapter), `ErrorFieldsMixin.shape` extension | §2.3.6 |
| File naming | Kebab-case for all source files and directories (e.g., `database-adapter.ts`, `tool-filter.ts`) | §2.1 |
| HTTP security headers | 7 headers on every response (CSP, HSTS opt-in, X-Frame-Options, etc.) | §2.2.1 |
| Rate limiting | Built-in `Map<string, {count, resetTime}>`, health endpoint exempt, `.unref()` timers | §2.2.1 |
| Server timeouts | 120s request, 65s keep-alive, 66s headers | §2.2.1 |
| Body size limit | 1 MB default, configurable, 413 on excess | §2.2.1 |
| CORS | Wildcard subdomain matching, `Access-Control-Max-Age: 86400`, production warning | §2.2.1 |
| DNS rebinding | `localhostHostValidation()` middleware from SDK ≥1.24.0 | §2.2.1 |
| 404 handler | `{ error: "Not found" }`, no stack traces | §2.2.1 |
| OAuth 2.1 | `src/auth/` — 11 files, opt-in, see [`oauth-reference.md`](./oauth-reference.md) | §2.2.0 |
| Code Mode | `src/codemode/` — 10 files, for servers with 15+ tools, see [`code-mode-reference.md`](./code-mode-reference.md) | §1.1 |
| Smart tool filtering | `--tool-filter` flag with predefined bundles for 50+ tool servers | §1.1 |
| Help Resources | Pull-based `{prefix}://help` + `{prefix}://help/{group}`, filtered by `--tool-filter` | §1.1 |
| FTS5 search | `content=` sync mode, `porter unicode61`, `bm25()` ranking, LIKE fallback | §1.1 |
| File size limits | ~500-600 lines per source file, split into sub-directories | §2.1 |
| Server extraction | Resources + prompts into `server/registration.ts` when main file >400 lines | §2.1 |
| Build tooling | `tsup` (esbuild) for production, `tsc --noEmit` for type checking | §2.1 |
| SHA-pinned CI | All GitHub Actions by SHA digest, not version tag | §3.1 |
| Dual-protocol HTTP | Streamable HTTP (`/mcp`) + Legacy SSE (`/sse`) on same port | §2.2.1 |
| Testing strategy | 4-layer model: Vitest unit (+ invariants) → Playwright E2E (+ zod sweeps) → Node.js integration → agent-driven | §3.2 |
| Protocol compliance testing | Invariant tests verify annotation coverage, `outputSchema` presence, `openWorldHint` correctness | §3.2 |
| Automated stewardship | Agentic workflows for deps, docs drift, CI health, entity cleanup | Phase 4 |
| Prompt `argsSchema` | Omit for zero-arg or all-optional prompts (SDK parses `undefined` as failure) | §1.4 |
| Briefing system | `{prefix}://briefing` resource for session initialization with modular sections | §1.1 |
| Instruction levels | `--instruction-level` flag (`essential`, `standard`, `full`) for token-constrained environments | §1.1 |
| Team DB / multi-database | Separate database with author attribution, mirrored `team_` prefixed tools, cross-DB merge | §2.2.3 |
| Token efficiency | Inject `_meta.tokenEstimate` (or `metrics.tokenEstimate` in Code Mode) into payload | §1.1 |
| Audit trails & Snapshots | Async-buffered JSONL logger, `AuditInterceptor` scope filtering, CLI/env config, `recent()` tail-read | §2.2.4 |
| Log rotation | Max size configuration (e.g. 10MB) keeping up to 5 historical archives (`.1` through `.5`) | §2.2.4 |
| Progress-path parity | Both cached and progress-token `callTool()` paths must apply identical interceptor wrapping | §2.2.4 |

---

## Phase 1: Research and Planning

### 1.1 Understand Modern MCP Design

**API Coverage vs. Workflow Tools:** Balance comprehensive API endpoint coverage with specialized workflow tools. When uncertain, prioritize comprehensive API coverage.

> [!TIP]
> LLM tool selection accuracy degrades with excessive tools. For 50+ tool
> servers, always implement `--tool-filter` and/or Code Mode to keep the
> active tool set manageable. Prefer focused, goal-oriented tools over raw
> endpoint wrappers.

**Code Mode (Standard for 15+ tool servers):** Sandboxed JS execution tool (e.g., `mj_execute_code`) exposing all tools as a namespaced API. **Must use true V8 isolates via `worker_threads`** for secure CPU/memory boundaries, not just the `node:vm` module. Enables 70-90% token reduction for multi-step operations. Named `{server_prefix}_execute_code`.

> See [`code-mode-reference.md`](./code-mode-reference.md) for architecture, file structure, security requirements, API bridge strategy, pitfalls, and testing patterns.

**When to implement:** 15+ tools or 3+ tool groups; agents commonly chain 3+ calls; tool definition tokens consume significant context.

**Tool Naming (MCP 2025-11-25):** 1-128 characters, `A-Za-z0-9_-.`, case-sensitive, unique within server. Use consistent `snake_case` prefixes (e.g., `github_create_issue`).

**Smart Tool Filtering:** For 50+ tool servers, implement `--tool-filter` flag with predefined bundles. Complementary to Code Mode.

**Error Handling (Standard):** Every tool must return structured `ErrorResponse` — never throw raw exceptions. See §2.2.2 for the full pattern.

```typescript
interface ErrorResponse {
  success: false;
  error: string;        // Human-readable message
  code: string;         // Machine-readable (e.g., 'TABLE_NOT_FOUND')
  category: ErrorCategory;  // 9 categories: validation, connection, query, permission, config, resource, authentication, authorization, internal
  suggestion?: string;  // Actionable fix hint
  recoverable: boolean; // true = user-fixable
  details?: unknown;
}
```

**Observability Resources:** Use MCP `Resources` to expose system state snapshots (health, schemas, connections) — immediate context without tool call tokens.

**Token-Optimized Payloads:** Standard JSON is highly inefficient for LLM context windows because `{`, `}`, `"`, and `,` consume substantial tokens. While the MCP protocol natively transports JSON-RPC over the wire, the actual `text` content returned by resources (or large tool outputs) should be explicitly serialized as **YAML** or concise key-value text. This simple format switch saves 20-30% of tokens compared to `JSON.stringify()`. Additionally, every tool response should include a `_meta.tokenEstimate` field (`metrics.tokenEstimate` in Code Mode) using a ~4 bytes/token heuristic so the agent can monitor its context window usage proactively.

**Pull-Based Help Resources (Standard):** Replace push-based tiered instructions with on-demand help resources. The server sends a slim instructions payload (~680 chars) pointing agents to help resources, instead of a token-consuming dump.

**Three approaches** (dynamic preferred, hybrid as alternative, build-time for custom prose):

**Approach A — Dynamic (Preferred):** Runtime-generated help from live tool definitions. Content stays in sync automatically — no build step, no stale content risk.

| Component | Purpose |
|-----------|---------|
| `handlers/resources/help.ts` | Generates help resources from live `getTools()` output |
| `{prefix}://help` | Root resource — lists all groups with tool counts |
| `{prefix}://help/{group}` | Per-group reference with parameters and annotations |

The help handler introspects Zod schemas at runtime to extract parameter names, types, required/optional status, and descriptions. No separate content files needed.

> [!IMPORTANT]
> **`group` field workaround:** The MCP SDK's `ToolRegistration` type doesn't include a `group` field — it's internal to `ToolDefinition`. Help resources need group info but can't import the internal tool registry (circular dep). Solution: maintain an `inferGroupFromName()` mapper with prefix-based rules (`team_*` → `team`, `mj_*` → `codemode`) and an explicit map for the remaining tools. Keep this map in sync when adding tools — an invariant test can verify coverage.

**Approach B — Hybrid (Single Source + Runtime Generation):** Single markdown source file with a runtime `generateInstructions()` function that produces tiered, filter-aware output. Tool reference is still served dynamically via `{prefix}://help/{group}`. Best for servers with behavioral guidance that varies by instruction level and enabled tool groups.

| Component | Purpose |
|-----------|---------|
| `src/constants/server-instructions.md` | Single source markdown with 6 section markers (`CORE`, `COPILOT`, `CODE_MODE`, `GITHUB`, `HELP_POINTERS`, `SERVER_ACCESS`) |
| `npm run generate:instructions` | Parses `.md` sections → emits composable TS constants + builder functions |
| `src/constants/server-instructions.ts` | `generateInstructions(enabledTools, prompts, latestEntry, level, enabledGroups?)` + `GOTCHAS_CONTENT` + composable builders |
| `handlers/resources/help.ts` | Dynamic help from live tool definitions (same as Approach A) |
| `{prefix}://help/gotchas` | Gotchas resource served from `GOTCHAS_CONTENT` |

The `generateInstructions()` function accepts an optional `enabledGroups?: Set<ToolGroup>` parameter (derived from `getEnabledGroups(enabledTools)` if omitted, for backward compat) and conditionally includes sections:
- **Code Mode section + namespace table** — only when `codemode` group is enabled; namespace table rows filtered to enabled groups only
- **Copilot Review Patterns** — only when `github` group is enabled
- **GitHub Integration** (standard+ level) — only when `github` group is enabled
- **Quick Access `semantic_search` row** — only when `search` group is enabled

This avoids sending agents instructions for tools they can't use. Callers in `mcp-server.ts` and the `{prefix}://instructions` resource handler compute `enabledGroups` from the filter config and pass it through.

**Approach C — Build-Time:** For servers needing custom prose per group (e.g., detailed usage guides beyond auto-generated parameter lists).

| Component | Purpose |
|-----------|---------|
| `src/constants/server-instructions/` | Per-group `.md` source files (human-readable) |
| `npm run generate:instructions` | Builds `HELP_CONTENT` map from source `.md` files |
| `server-instructions.ts` | Exported slim `INSTRUCTIONS` constant + `HELP_CONTENT` map |
| `{prefix}://help` | Root resource — lists all available groups |
| `{prefix}://help/{group}` | Per-group reference (e.g., `sqlite://help/json`) |

**Key behaviors (all approaches):**
- Help resources are **filtered by `--tool-filter`** — only enabled groups get help resources registered
- The `instructions` field in the server capability contains a slim pointer, not the full content
- Agents discover capabilities on-demand via resources, not via upfront token dump
- Include a `{prefix}://help/gotchas` resource for common pitfalls and critical usage patterns

**MCP `instructions` field:** Pass the slim generated string to the server's `instructions` capability so clients receive it during `initialize`.

**FTS5 Full-Text Search (Database Servers):** Use SQLite FTS5 instead of `LIKE '%query%'`:
- `content=` sync mode with INSERT/UPDATE/DELETE triggers
- `porter unicode61` tokenizer, `bm25()` ranking
- Phrase queries, prefix matching, boolean operators
- Try/catch with LIKE fallback on syntax errors
- Auto-populate on first migration via `rebuild` command

**Briefing System (Standard for stateful servers):** Implement a `{prefix}://briefing` resource for session initialization. The briefing assembles modular sections (journal context, GitHub context, user message) into a structured snapshot (~300 tokens) that agents read at session start.

**Architecture:**

| Component | Purpose |
|-----------|---------|
| `handlers/resources/core/briefing/index.ts` | Assembles all sections, respects instruction level |
| `handlers/resources/core/briefing/context-section.ts` | Domain-specific context (entry count, recent data) |
| `handlers/resources/core/briefing/github-section.ts` | External integration status (repo, CI, issues, PRs) |
| `handlers/resources/core/briefing/user-message.ts` | User-facing message (rules file, skills awareness) |

**Key behaviors:**
- Returns structured `data` object + human-readable `userMessage` (formatted as a bullet list of key facts)
- Respects instruction levels to control depth: `essential` (~100 tokens), `standard` (~300), `full` (~500)
- Each section is a separate file for maintainability — add sections without modifying existing ones
- Agent should read `{prefix}://briefing` before processing any user request

**Briefing Configuration:** Expose env vars / CLI flags for fine-grained briefing control. Each flag has a corresponding `{PREFIX}_*` environment variable. Store as a `BriefingConfig` interface and pass through context:

| Flag / Env Var | Default | Purpose |
|---|---|---|
| `--briefing-entries` / `BRIEFING_ENTRY_COUNT` | 3 | Journal entries included in briefing |
| `BRIEFING_INCLUDE_TEAM` | `false` | Include team DB entries |
| `BRIEFING_ISSUE_COUNT` | 0 | Issues to list (`0` = count only) |
| `BRIEFING_PR_COUNT` | 0 | PRs to list (`0` = count only) |
| `BRIEFING_PR_STATUS` | `false` | Show PR status breakdown |
| `BRIEFING_WORKFLOW_COUNT` | 0 | Workflow runs to list |
| `BRIEFING_WORKFLOW_STATUS` | `false` | Show workflow status breakdown |
| `BRIEFING_COPILOT_REVIEWS` | `false` | Aggregate Copilot review state |
| `--rules-file` / `RULES_FILE_PATH` | — | Path to user rules file for agent awareness |
| `--skills-dir` / `SKILLS_DIR_PATH` | — | Path to skills directory for agent awareness |
| `--workflow-summary` / `MEMORY_JOURNAL_WORKFLOW_SUMMARY` | — | Free-text workflow summary |
| `--instruction-level` / `INSTRUCTION_LEVEL` | `standard` | Briefing depth tier |

**Instruction Levels:** Implement `--instruction-level` flag (or `{PREFIX}_INSTRUCTION_LEVEL` env var) with three tiers:
- **`essential`** — Minimal context, lowest token cost. Suitable for fast single-turn queries
- **`standard`** (default) — Balanced context with key stats, GitHub status, and recent activity
- **`full`** — Complete information dump including detailed breakdowns and extended history

**Instructions Generation:** Three approaches:

| Approach | Pros | Cons |
|---|---|---|
| **Per-group `.md` source files** + build step | Human-editable, git-diffable | Requires `npm run generate:instructions` |
| **Single-source `.md`** + `generateInstructions()` (Hybrid) | Tiered + filter-aware output, gotchas export, composable sections | Requires build step to regenerate `.ts` from `.md` |
| **Dynamic only** (no source files) | Zero maintenance, always in sync | No custom prose, parameter-list only |

### 1.4 Plan Your Implementation

**Understand the API:** Review the service's API documentation. Use web search and WebFetch as needed.

**Tool Selection:** Prioritize comprehensive API coverage. List endpoints to implement, starting with the most common operations.

**AI-Powered Prompts:** Plan guided, step-by-step prompt workflows for complex tasks (migrations, performance tuning).

**Prompt `argsSchema` Gotcha:** `z.object({focus: z.string().optional()}).parse(undefined)` fails with `MCP error -32602`. Fix:

```typescript
// Zero args or ALL-optional → omit argsSchema entirely (SDK uses no-args callback)
server.registerPrompt('health_check', { description: '...' }, async () => handler({}, context));

// Has required args → set argsSchema
server.registerPrompt('query_builder', {
  description: '...',
  argsSchema: { tables: z.string(), operation: z.string() },
}, async (args) => handler(args, context));
```

> [!CAUTION]
> Omitting `argsSchema` means `prompts/list` won't include argument metadata. Document optional parameters in the prompt `description` instead.

---

## Phase 2: Implementation

### 2.1 Set Up Project Structure

**TypeScript SDK:** Fetch from https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md. MCP spec: https://modelcontextprotocol.io/sitemap.xml (append `.md` for markdown).

**File Naming Convention:** All source files and directories use **kebab-case** (lowercase with dashes). Tests follow the same convention.

| Type | Example | Anti-pattern |
|------|---------|------------|
| Source | `database-adapter.ts`, `tool-filter.ts` | `DatabaseAdapter.ts`, `toolFilter.ts` |
| Test | `database-adapter.test.ts`, `tool-filter.test.ts` | `DatabaseAdapter.test.ts` |
| Directory | `json-operations/`, `sqlite-native/` | `jsonOperations/`, `SQLiteNative/` |

**File Modularity:** ~500-600 line soft limit. Proactively split into sub-directories with `index.ts` barrels. Group by functional cohesion.

**Server File Extraction:** When `mcp-server.ts` exceeds ~400 lines, extract resource and prompt registration into `server/registration.ts`.

**Build Tooling — tsup:** Replace `tsc` with `tsup` for production (tree-shaking, ~50% faster). Keep `tsc --noEmit` for type checking. Configure: `entry`, `format: ['esm']`, `target: 'node20'`, `clean: true`.

### 2.2 Implement Core Infrastructure

- **API Client:** Secure auth, never hardcode secrets, prevent token passthrough.
- **Error Handling:** See §2.2.2 below.
- **Performance:** Connection pooling with health checks, metadata caching with configurable TTLs.
- **External API Caching:** Bounded TTL-aware LRU cache (max 100, 5-min TTL) for external APIs.
- **Access Control:** See §2.2.0 below.

#### 2.2.3 Team DB / Multi-Database Pattern (Optional)

For servers that support collaboration, implement a separate team database with shared state. The team DB uses the same schema as the personal DB but with author attribution.

**Architecture:**
- Separate SQLite file configured via `TEAM_DB_PATH` env var
- Mirrored tools with `team_` prefix (e.g., `team_create_entry`, `team_search`)
- `teamDb` and `teamVectorManager` passed through `ToolContext` alongside personal `db`/`vectorManager`
- Cross-DB merge with content-prefix deduplication when both DBs are queried
- Author resolution via `resolveAuthor()` utility (reads env vars or Git config)
- Graceful degradation — all `team_*` tools return structured `TEAM_DB_NOT_CONFIGURED` error when `TEAM_DB_PATH` is unset
- Team tools split into `handlers/tools/team/` subdirectory mirroring personal tool groups

#### 2.2.0 OAuth 2.1 + HTTP Transport Hardening

> See [`references/http-security.md`](references/http-security.md) for OAuth 2.1 authentication, HTTP transport hardening (7 security headers, rate limiting, CORS, DNS rebinding, dual-protocol), server timeouts, and CVE-2026-25536 mitigation.
>
> See [`oauth-reference.md`](./oauth-reference.md) for the full OAuth module structure, RFC compliance, scope model, and 8-file test suite.

#### 2.2.2 Enriched Error Handling Infrastructure

> See [`references/error-handling.md`](references/error-handling.md) for the full error handling infrastructure: `{Server}McpError` base class with auto-refinement, 6 standard subclasses, `formatHandlerError()` formatter, `ErrorFieldsMixin`, `structuredContent` on errors, and `outputSchema` pitfalls.
>
> **Key rule:** Every handler catch block uses `return formatHandlerError(error)` — never re-wrap the result. Input validation errors are Tool Execution Errors (`isError: true`), not Protocol Errors.

#### 2.2.4 Audit Logging and Snapshots

For database and infrastructure servers, implement an enterprise-grade audit subsystem:

**Architecture:**
- **Async-Buffered JSONL Logger**: Use a buffered writer (e.g., 50-entry high-water mark, 100ms auto-flush interval) to avoid blocking the tool execution path. The logger should be non-throwing — audit failures log to stderr but never propagate to callers.
- **AuditConfig Type**: Define a typed config (`enabled`, `logPath`, `redact`, `auditReads`, `maxSizeBytes`) constructed from CLI flags + env vars at startup.
- **AuditInterceptor**: Scope-based filter that wraps tool execution. Write/admin tools are audited by default; read tools are opt-in via `--audit-reads`. Each entry captures: tool name, scope, category, args (unless redacted), duration, token estimate, success/error status, user, and scopes.
- **Lifecycle**: The logger must support graceful `close()` that flushes the remaining buffer before process exit.

**CLI / Environment Integration:**

| Flag | Env Var | Default | Purpose |
|------|---------|---------|---------|
| `--audit-log <path>` | `AUDIT_LOG_PATH` | — | Enable audit logging; `stderr` for container mode |
| `--audit-redact` | `AUDIT_REDACT` | `false` | Omit tool arguments from log entries |
| `--audit-reads` | `AUDIT_READS` | `false` | Include read-scope tool calls |
| `--audit-log-max-size` | `AUDIT_LOG_MAX_SIZE` | `10485760` | Max file size before rotation (bytes) |

**Log Rotation:** Max size configurable (e.g., 10MB), keep 5 historical archives (`.1` through `.5`). Rotation triggered on flush when size threshold exceeded.

**Resource Tail-Read:** Implement a `recent(n)` method using a 64KB reverse-seek window for O(1) access to the last N entries, instead of reading the entire JSONL file.

**Audit Resource:** Expose `{prefix}://audit` returning the last 50 entries + session summary (total tokens, error count, total duration). Use `ASSISTANT_FOCUSED` annotation.

> [!WARNING]
> **Progress-Path Bypass:** If your `callTool()` has a separate code path for progress-token calls that rebuilds handlers from `getAllToolDefinitions()`, those fresh handlers bypass the cached instrumented handlers. Both the cached path AND the progress path must apply identical metrics + audit interceptor wrapping. This is a critical integration bug that causes silent data loss — the audit system appears configured but no entries are written.

**Pre-Mutation Snapshots** (database servers only): Before executing destructive or administrative mutations (caught via the `AuditInterceptor`), capture `.tar.gz` compressed DDL snapshots. Include metadata, schema DDL, and optionally row samples, tracking the snapshot generation latency.

### 2.3 Implement Tools

**Tool Definition Fields (MCP 2025-11-25):** `name`, `title` (human-readable), `description`, `icons` (§2.4), `inputSchema` (JSON Schema 2020-12), `outputSchema`, `annotations`, `execution` (optional `taskSupport`).

**Input Schema:** Zod with constraints and descriptions. For no-param tools: `{ "type": "object", "additionalProperties": false }`. `inputSchema` must not be `null`.

**Output Schema:** Define where possible, use `structuredContent`. Return both text and structured data. Never echo secrets.

**Implementation:** Async/await, batch parallel queries, `formatHandlerError()` in every catch, pagination support. Sanitize all inputs against injection. Enforce least privilege.

**Annotations:** `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`.

**`openWorldHint` semantics:**
- `false` — tool only accesses local resources (database, filesystem, in-memory state)
- `true` — tool makes external API calls (GitHub, Cloudflare, third-party services)
- Every tool must have an explicit `openWorldHint` value — verify 0 missing via `tools/list`

**Privacy & Security Annotations (MCP 2025-11-25):**

| Annotation | Values | When to Use |
|---|---|---|
| `privateHint` | `boolean` | Tool accesses internal/private data (not necessarily sensitive) |
| `sensitiveHint` | `'low'` \| `'medium'` \| `'high'` | Data sensitivity level — clients should show warnings or require confirmation |
| `maliciousActivityHint` | `boolean` | Tool detected suspicious patterns in input/output |
| `attribution` | `Source[]` | Data provenance — list sources for responses containing third-party content |

> [!IMPORTANT]
> Servers are responsible for emitting privacy/security annotations — they have
> the most accurate context about their data. Clients must propagate and enforce them.

**Resource Annotations:** Use centralized annotation presets in `utils/resource-annotations.ts`:
- `HIGH_PRIORITY` (`priority: 0.9`, audience: `['user', 'assistant']`) — critical state (health, schema, activity)
- `MEDIUM_PRIORITY` (`priority: 0.6`) — analysis/monitoring (performance, stats, indexes)
- `LOW_PRIORITY` (`priority: 0.4`) — supplementary (extension status, pool stats)
- `ASSISTANT_FOCUSED` (`priority: 0.5`, audience: `['assistant']`) — agent-only (capabilities, settings)
- Helpers: `withPriority(n, base?)`, `withTimestamp(base?)` for custom variants

**Progress Notifications:** For long-running tools, use `sendProgress()` from `utils/progress-utils.ts`. Build context via `buildProgressContext(requestContext)` — silently no-ops when the client doesn't request progress.

```typescript
const progress = buildProgressContext(ctx);
for (let i = 0; i < tables.length; i++) {
  await sendProgress(progress, i + 1, tables.length, `Processing ${tables[i]}`);
  // ... work
}
```

#### 2.3.1–2.3.6 Input Validation & Schema Patterns

> See [`references/error-handling.md`](references/error-handling.md) for all input validation patterns:
> - §Input Coercion — `z.preprocess` vs `z.coerce.number()`, coercion factories, `coerceLimit()`
> - §Schema Boundary — Dual-schema pattern (preferred) vs `.partial().passthrough()`
> - §Existence Validation — `validateTableExists/Column/Columns()` before DML
> - §WHERE Clause — SQL injection prevention via `validateWhereClause()`
> - §Idempotent Reporting — `alreadyExists` flag for create/drop operations
> - §Output Schema Architecture — Co-located `schemas.ts` vs top-level `schemas/` directory

### Common Tool Design Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| **Kitchen-sink server** | 100+ tools overwhelm agent selection — accuracy drops | Use `--tool-filter` bundles, Code Mode, or split into focused servers |
| **Missing `openWorldHint`** | Agents can't assess security implications | Verify via invariant test: 0 tools with missing `openWorldHint` |
| **`readOnlyHint: true` on writes** | Agents bypass confirmation for destructive ops | Audit annotations match actual behavior |
| **Inline output schemas** | Schemas drift from handler reality, no reuse | Co-located `schemas.ts` or `schemas/` directory |
| **Swallowing errors** | Agent retries blindly, no diagnostic info | `formatHandlerError()` in every catch, structured error codes |
| **Echoing secrets** | API keys/tokens leak to conversation history | Never include credentials in tool output |
| **Generic error codes** | All errors return `INTERNAL` — agent can't triage | Use 9-category `ErrorCategory` with specific codes |

### 2.4 Icons & Tool Registration (MCP 2025-11-25)

Tools, resources, prompts, and the server can include `icons: Icon[]` with `src` (URL/data URI), `mimeType`, `sizes`, `theme`.

**Pattern:** Central `icons.ts` mapping tool groups to CDN SVGs (e.g., jsDelivr + `@mdi/svg`). Attach at aggregation point, not in each tool file.

**`ToolDefinition` vs `ToolRegistration`:** Distinguish between internal and external tool types:

| Type | Contains | Used By |
|---|---|---|
| `ToolDefinition` | `name`, `title`, `description`, `group`, `handler`, `inputSchema`, `outputSchema`, `annotations` | Internal tool modules, `callTool()` dispatch |
| `ToolRegistration` | `name`, `title`, `description`, `inputSchema`, `outputSchema`, `annotations`, `icons` | External `getTools()` output, MCP `tools/list` |

Icons are attached in the `mapTool()` function that converts `ToolDefinition` → `ToolRegistration`. Handler files never import icon utilities — this keeps tool implementation decoupled from presentation.

```typescript
// In getTools() — mapTool attaches icons and strips internal fields
const mapTool = (t: ToolDefinition): ToolRegistration => ({
  name: t.name,
  title: t.title,
  description: t.description,
  inputSchema: t.inputSchema,
  ...(t.outputSchema !== undefined ? { outputSchema: t.outputSchema } : {}),
  annotations: t.annotations,
  icons: getToolIcon(t.group),  // Icon lookup by group, not per-tool
});
```

**SDK workaround** (type doesn't include `icons`):
```typescript
const opts: Record<string, unknown> = { description: '...', icons: MY_ICONS };
server.registerTool('my_tool', opts as { description?: string }, handler);
```

### 2.5 Tasks API (MCP 2025-11-25 — Experimental)

Durable state machines for long-running operations (>30s). Tools declare `execution.taskSupport`: `"forbidden"` (default), `"optional"`, or `"required"`. Both server and client must declare `tasks` capability. Lifecycle: `running` → `completed` | `failed` | `cancelled`. Clients poll via `tasks/get` and `tasks/result`.

---

## Phase 3: Review and Test

> See [`references/testing-reference.md`](references/testing-reference.md) for the full 4-layer testing model (unit → E2E → integration → agent-driven), invariant tests, canonical E2E spec inventory, integration script conventions, and code quality patterns.

**Testing cadence per group:** invariant (vitest) → zod sweep (E2E) → payload correctness (E2E) → error paths (E2E).

**Key rules:**
- SHA-pinned CI Actions (by digest, not version tag)
- Version SSoT via `src/version.ts` (reads `package.json` at runtime)
- `JSON.stringify(result)` for tool responses (no pretty-print)
- Target ≥90% line coverage

---

## Phase 4: Automated Stewardship

For mature servers, set up agentic workflows via GitHub Copilot Coding Agent:

| Workflow | Trigger | Purpose |
|----------|---------|----|
| Dependency maintenance | Weekly | npm + Docker dep updates, patch bump, PR |
| Docs drift detector | PR | Documentation accuracy audit |
| CI health monitor | Weekly | CI deprecation and action version checks |
| Entity cleanup | Daily | Expired/stale entity cleanup |

Document in `.github/workflows/README.md` with workflow map diagram.

---

## Reference Architecture

> See [`references/architecture-reference.md`](references/architecture-reference.md) for the canonical directory layout and structural rules (barrel exports, error hierarchy patterns, logger patterns, codemode API bridge patterns).

---

## Key Resources

- **MCP Specification:** https://modelcontextprotocol.io/sitemap.xml (append `.md` to any page URL for markdown)
- **TypeScript SDK:** https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md
- **MCP Best Practices:** https://modelcontextprotocol.io/specification/draft/best-practices.md
