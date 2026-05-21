# Error Handling & Input Validation Reference

Detailed patterns for error handling infrastructure, input coercion, schema boundaries, existence validation, SQL injection prevention, idempotent operations, and output schema architecture.

> Read this reference when implementing error handling, input validation, or output schemas in an MCP server.

---

## Enriched Error Handling Infrastructure (Standard)

Harmonized across db-mcp, postgres-mcp, mysql-mcp, memory-journal-mcp.

**Files:** `src/utils/errors/base.ts` (abstract base), `src/utils/errors/classes.ts` (subclasses), `src/utils/errors/categories.ts` (enum + interfaces), `src/utils/errors/format.ts` (formatter), `src/utils/errors/error-response-fields.ts` (ErrorFieldsMixin SSoT), `src/utils/errors/suggestions.ts` (fuzzy typo hints).

**Base Class:** `{Server}McpError extends Error` with `category`, `code`, `suggestion`, `details`, `recoverable`, `cause`, and `toResponse(): ErrorResponse`. Replace `{Server}` with prefix: `DbMcpError`, `PostgresMcpError`, etc.

**Error Code Auto-Refinement:** The base class constructor auto-refines generic codes to specific ones. When a `QueryError` (code: `DB_QUERY_FAILED`) has an error message matching a known pattern (like "no such table"), the constructor auto-refines the code to `TABLE_NOT_FOUND`. This ensures consistent, machine-readable codes across all tools without manual mapping in each handler.

The auto-refinement mechanism:
- `ERROR_SUGGESTIONS` entries include an optional `code` field
- Constructor checks if the current code is generic (from a whitelist: `DB_QUERY_FAILED`, `DB_WRITE_FAILED`, `QUERY_ERROR`, `RESOURCE_ERROR`, `UNKNOWN_ERROR`)
- If generic AND a matched suggestion has a specific `code`, the specific code replaces the generic one
- Supported refinements: `TABLE_NOT_FOUND`, `COLUMN_NOT_FOUND`, `VIEW_NOT_FOUND`, `FILE_NOT_FOUND`, `MALFORMED_JSON`, `TRANSACTION_CONFLICT`, `DIMENSION_MISMATCH`, etc.

**Standard Subclasses:**

| Subclass | Code | Category | Recoverable |
|----------|------|----------|-------------|
| `ConnectionError` | `CONNECTION_FAILED` | connection | false |
| `QueryError` | `QUERY_FAILED` | query | true |
| `ValidationError` | `VALIDATION_FAILED` | validation | true |
| `ResourceNotFoundError` | `RESOURCE_NOT_FOUND` | resource | true |
| `ConfigurationError` | `CONFIGURATION_ERROR` | configuration | false |
| `PermissionError` | `PERMISSION_DENIED` | permission | true |

DB servers add: `PoolError`, `TransactionError` (with `ErrorContext` interface for optional `tool`/`table`/`sql` context), `AuthenticationError`, `AuthorizationError`, `ExtensionNotAvailableError` (auto-generates suggestion with extension name).

**Single Formatter:** `formatHandlerError(err, context?)` — handles `{Server}McpError` (`.toResponse()`), `ZodError` (extracts field paths, e.g., `table: Required`), and raw `Error` (matches `ERROR_SUGGESTIONS`). Use in every handler's `catch` block.

**Context-Aware Variant (DB Servers):** For database-backed servers, pass an `ErrorContext` parameter (`{tool, sql?, table?, schema?, target?, objectType?}`) to enable engine-specific error code mapping. The context flows into the engine's error parser for actionable diagnostics.

```typescript
// Context-aware formatter:
return formatHandlerError(error, { tool: 'pg_create_index', table: 'users' });
```

**Engine-Specific Error Parsers:** For DB servers, implement a dedicated `error-parser.ts` in the engine's `tools/core/` directory. This parser maps database-native error codes (e.g., PostgreSQL `42P01` → `TABLE_NOT_FOUND`, MySQL `1146` → `TABLE_NOT_FOUND`) to structured error subclasses. Complementary to `ERROR_SUGGESTIONS` auto-refinement — the parser handles raw database exceptions, while auto-refinement handles error message pattern matching in the base class constructor.

> [!IMPORTANT]
> **Use ONE formatter, not two.** All handler catch blocks must use `return formatHandlerError(error)` or `return formatHandlerError(error, context)` — never re-wrap the result.

**`structuredContent` on Error Responses:** When a tool has an `outputSchema`, the `registerTool()` wrapper must include `structuredContent` on error responses so clients receive machine-readable error payloads:

```typescript
// In registerTool() catch block:
if (toolDef.outputSchema) {
  return {
    content: [{ type: 'text', text: JSON.stringify(errorResult) }],
    structuredContent: errorResult,
    isError: true
  };
}
```

**ErrorFieldsMixin** — merge into every `outputSchema`:

```typescript
export const ErrorFieldsMixin = z.object({
  error: z.string().optional(),
  code: z.string().optional(),
  category: z.string().optional(),
  suggestion: z.string().optional(),
  recoverable: z.boolean().optional(),
  details: z.unknown().optional(),
});

// Usage: z.object({ success: z.boolean(), result: z.string().optional() }).extend(ErrorFieldsMixin.shape);
```

> [!CAUTION]
> **`outputSchema` + `structuredContent` pitfall:** If `formatHandlerError()` returns error fields but the schema has required success-path fields (e.g., `result: z.string()`), Zod validation fails. **All success-path fields must be `.optional()`.**

**Integration:** `OAuthError` and `SecurityError` (with `InvalidDateFormatError`, `PathTraversalError`) both extend the server's base class, inheriting `toResponse()` and structured error semantics.

> [!IMPORTANT]
> **Error classification:** Input validation errors → Tool Execution Errors (`isError: true`), not Protocol Errors. Tool errors enable model self-correction; protocol errors don't.

---

## Input Coercion & Refinement Leak Prevention

The MCP SDK wraps `inputSchema` with `.partial()` before validation. This means Zod refinements (`.min()`, `.max()`, `.regex()`, `z.enum()`) can leak raw `-32602` protocol errors before handler code can intercept them. This is the #1 source of "conversation-killer" errors in agent orchestration.

**Required patterns:**

| Input Type | Registration Schema | Handler Validation |
|------------|--------------------|--------------------|
| Required enum | `z.string().describe("One of: a, b, c")` | Validate against exported `const VALID_VALUES = ['a', 'b', 'c'] as const` in handler |
| Optional enum | `z.preprocess(coerceEnumValues(VALID_VALUES, 'default'), z.enum(VALID_VALUES))` | Or use `z.string().optional()` + handler validation |
| Numeric param | `z.preprocess(coerceNumber, z.number().optional())` **or** `z.coerce.number().optional()` + NaN guard | See tradeoffs below |
| Boolean param | `z.preprocess(coerceBoolean, z.boolean().optional())` | Handle `"true"`, `"false"` string inputs |
| Array param | `z.preprocess(v => Array.isArray(v) ? v : [], z.array(...))` | Coerce non-arrays to empty arrays for `.partial()` compatibility |
| Refinements | Move `.min()`, `.max()`, `.regex()` to handler-level validation | Never put these on the registration schema |

**Numeric coercion — two acceptable approaches:**

| Approach | Pros | Cons | Used By |
|----------|------|------|---------|
| `z.preprocess(coerceNumber, ...)` | Returns `undefined` on bad input (safe default) | More verbose, requires custom helper | db-mcp, mysql-mcp, postgres-mcp (migrating) |
| `z.coerce.number().optional()` | Idiomatic Zod, less boilerplate | Produces `NaN` on `"abc"` — **must guard in handler** | postgres-mcp (legacy, being replaced) |

When using `z.coerce.number()`, always guard against NaN in the handler — ideally via `coerceLimit()` (see below) or an explicit `isNaN()` check before using the value.

**Coercion factories (for `z.preprocess` approach):**

```typescript
export function coerceNumber(val: unknown): unknown {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = Number(val);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

export function coerceBoolean(val: unknown): unknown {
  if (typeof val === 'boolean') return val;
  if (val === 'true') return true;
  if (val === 'false') return false;
  return undefined;
}
```

**Limit Coercion (Standard):** For `limit` parameters (ubiquitous across DB tools), use shared helpers in `utils/query-helpers.ts`:

```typescript
export const DEFAULT_QUERY_LIMIT = 100;

/** Coerce raw limit → usable value. 0 = unlimited (null), NaN/undefined → default. */
export function coerceLimit(raw: unknown, defaultLimit = DEFAULT_QUERY_LIMIT): number | null {
  if (raw === undefined) return defaultLimit;
  const num = Number(raw);
  if (isNaN(num)) return defaultLimit;
  if (num === 0) return null;
  return num > 0 ? num : defaultLimit;
}

/** Build SQL LIMIT clause from coerced value. null = no limit. */
export function buildLimitClause(limitVal: number | null): string {
  return limitVal !== null ? ` LIMIT ${String(limitVal)}` : '';
}
```

> [!TIP]
> `coerceLimit()` safely handles both `z.preprocess` and `z.coerce.number()` outputs — it guards NaN, undefined, and zero semantics in one place.

---

## Input Schema Boundary Handling

The SDK wraps `inputSchema` with `.partial()` before validation. Two approaches exist for handling this safely:

**Approach A — Dual-Schema Pattern (Preferred):** Define two schemas per tool — a strict `XxxSchema` for handler-level validation and a relaxed `XxxSchemaMcp` for SDK registration. The `SchemaMcp` variants use coercion factories (e.g., `relaxedNumber()`, `relaxedArray()`) to handle type mismatches from agent inputs.

```typescript
// Strict schema (handler-level validation):
const SearchEntriesSchema = z.object({
  query: z.string().min(1),
  limit: z.number().optional(),
  tags: z.array(z.string()).optional(),
});

// Relaxed schema (SDK registration — coercion, no refinements):
const SearchEntriesSchemaMcp = z.object({
  query: z.string().describe('Search query'),
  limit: relaxedNumber().describe('Max results'),
  tags: relaxedArray(z.string()).describe('Filter by tags'),
});

// Registration uses relaxed schema:
{ name: 'search_entries', inputSchema: SearchEntriesSchemaMcp, ... }

// Handler uses strict schema:
try {
  const parsed = SearchEntriesSchema.parse(params);
  // ... business logic
} catch (error) {
  return formatHandlerError(error);
}
```

**Why this is preferred:** Explicit schema separation prevents `.partial()` from masking required field validation. Coercion is handled at the schema level rather than requiring post-parse handling. The SDK's internal wrapping behavior has changed between versions, making explicit schema separation more robust.

**Coercion factories** (used in `SchemaMcp` variants):

```typescript
/** Relaxed number that accepts string/number/undefined without crashing SDK */
export function relaxedNumber() {
  return z.preprocess(coerceNumber, z.number().optional());
}

/** Relaxed array that accepts non-arrays gracefully */
export function relaxedArray<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(v => Array.isArray(v) ? v : [], z.array(item).optional());
}
```

**Approach B — `.partial().passthrough()` Wrapping:** For adapter-based servers (db-mcp, postgres-mcp) where schemas are generated or engine-specific, wrap `inputSchema` directly.

```typescript
// In registerTool():
const sdkSchema = toolDef.inputSchema.partial().passthrough();

// In handler:
try {
  const resolved = resolveAliases(params); // tableName → table, sql → query
  const parsed = StrictSchema.parse(resolved);
  // ... business logic
} catch (error) {
  return formatHandlerError(error);
}
```

**Two boundaries (both approaches):**
- **SDK boundary:** relaxed schema or `.partial().passthrough()` — accepts any parameter subset
- **Handler boundary:** strict `Schema.parse(params)` inside try/catch → `formatHandlerError()`

**Backward-compatible aliases:** Use `resolveAliases()` preprocess before Zod parsing. Canonical names take precedence when both alias and canonical are supplied.

---

## Proactive Existence Validation

All database tools must validate object existence before executing DML. This prevents raw SQL errors from leaking to the client and ensures consistent, machine-readable error codes across the fleet.

**Validation hierarchy:** TABLE_NOT_FOUND → COLUMN_NOT_FOUND → domain-specific validation.

**Standard validators** (in shared `tools/column-validation.ts`):
- `validateTableExists(adapter, table)` — checks system catalog before proceeding
- `validateColumnExists(adapter, table, column)` — checks table existence *first*, then column via metadata query
- `validateColumnsExist(adapter, table, columns)` — batch version, single metadata query + in-memory membership check (N+1 elimination)
- All return structured `{success: false, code: "TABLE_NOT_FOUND" | "COLUMN_NOT_FOUND"}` errors

**Usage:** Imported by geo, stats, text, FTS, vector, window tool groups.

---

## WHERE Clause Validation (SQL Injection Prevention)

Every tool that interpolates a user-provided `whereClause` into SQL must call `validateWhereClause()` before SQL construction. This is non-negotiable for multi-agent orchestration where WHERE clauses may originate from untrusted agent chains.

**Blocked patterns:**
- Semicolon-chained keywords: `; SELECT`, `; DROP`, `; INSERT`, `; UPDATE`, `; DELETE`, `; ALTER`, `; CREATE`
- Comment injection: `--`, `/* */`
- String-literal stripping: test blocked patterns against SQL with string literals removed (prevents false positives on quoted values)
- Semicolon-chained blocking requires the semicolon prefix (allows legitimate `IN (SELECT ...)`)

**Implementation:** `src/utils/where-clause.ts` — shared utility imported by all tools with `whereClause` parameters.

**FTS Configuration Validation (DB Servers):** For servers with full-text search, validate FTS configuration names (e.g., `'english'`, `'my_custom_config'`) against database identifier rules via `validateFtsConfig()` in `utils/fts-config.ts`. This prevents SQL injection through the FTS config parameter — a vector that `validateWhereClause()` doesn't cover since config names are interpolated outside WHERE clauses.

---

## Idempotent Operation Reporting

Tools that create or drop objects must distinguish between "action taken" and "no-op" responses. This is critical for idempotent workflow design in agent orchestration.

**Pattern:**
- Pre-check existence before `CREATE ... IF NOT EXISTS` or `DROP ... IF EXISTS`
- Return `alreadyExists: true` or `alreadyDropped: true` flag in response
- Return descriptive message: `"Index 'idx_name' already exists (no changes made)"`
- Prevents misleading success messages that don't reflect actual state changes

```typescript
// Before CREATE INDEX IF NOT EXISTS:
const exists = await checkIndexExists(adapter, indexName);
if (exists) {
  return { success: true, alreadyExists: true, message: `Index '${indexName}' already exists (no changes made)` };
}
await adapter.execute(`CREATE INDEX ${indexName} ...`);
return { success: true, alreadyExists: false, message: `Index '${indexName}' created` };
```

---

## Output Schema Architecture

Output schemas must **never be inline** in handler files. Two organizational patterns exist depending on server type:

**Pattern A — Co-located `schemas.ts` (Non-adapter servers):** Output schemas live in `schemas.ts` files alongside their handler groups. Input schemas may be co-located in handler files when using the dual-schema pattern.

```
handlers/tools/
  schemas.ts              — Shared output schemas (core, search, admin, etc.)
  error-fields-mixin.ts   — Re-export stub → utils/errors/error-response-fields.ts
  github/
    schemas.ts            — GitHub-specific output schemas (16 tools)
  team/
    schemas.ts            — Team-specific output schemas (20 tools)
```

This pattern works well when schemas are tightly coupled to their handler groups and the server uses the dual-schema input pattern. Output schemas are centralized per group; input schemas stay with handlers for locality.

**Pattern B — Top-level `schemas/` directory (Adapter-based servers):** For servers with engine-specific schemas (db-mcp, postgres-mcp, mysql-mcp), output schemas live in a centralized directory.

```
schemas/                         # (or output-schemas/)
  error-response-fields.ts — ErrorFieldsMixin (6 optional error fields, SSoT)
  core-exports.ts          — Core schema barrel exports
  extension-exports.ts     — Extension schema barrel exports
  core/                    — Core group schemas (input + output per file)
  jsonb/                   — JSONB group schemas
  stats/                   — Stats group schemas (base, input, output, preprocessing)
  vector/                  — Vector group schemas (input, output)
  postgis/                 — PostGIS group schemas
  extensions/              — Extension schemas (citext, ltree, pgcrypto, kcache, shared)
  {group}/                 — One subdirectory per additional tool group
  index.ts                 — Barrel re-export
```

**Rules (both patterns):**
- Zero inline output schema `z.object()` definitions in handler files — import from dedicated `schemas.ts` or `schemas/` directory
- All output schemas extend `ErrorFieldsMixin.shape` — domain fields are `.optional()` so error responses pass validation
- Every group gets its own file (no stuffing unrelated schemas into `common.ts`)
- Bespoke schemas over generic: `ListViewsOutputSchema` not reusing `ListTablesOutputSchema` ("Shared Template Fatigue" prevention)
- Orphan schema detection: no schemas should exist without corresponding tools
