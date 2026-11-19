# 🔒 Security Guide

The Memory Journal MCP server implements comprehensive security measures to protect your personal journal data.

## 🛡️ **Database Security**

### **Native SQLite Architecture**

The server uses the native **better-sqlite3** driver with **sqlite-vec** for vector operations, running directly against the filesystem.

- ✅ **PRAGMA foreign_keys = ON** — enforces referential integrity and `ON DELETE CASCADE`
- ✅ **Parameterized queries** — all user input bound via `?` placeholders
- ✅ **WAL journal mode** — high concurrency with non-blocking reads (`PRAGMA journal_mode = WAL`)
- ✅ **Synchronous Normal** — optimized durability and performance (`PRAGMA synchronous = NORMAL`)

### **SQLCipher Encryption at Rest & Staged Backups**

- ✅ **Environment-Only Encryption Keys** — Optional SQLCipher keys are read exclusively from `MJ_DB_ENCRYPTION_KEY` or `DB_ENCRYPTION_KEY` (`src/database/sqlite-adapter/sqlcipher-key.ts`); `scripts/encrypt-db.ts` omits any CLI `--key` flag so secrets never appear in OS process listings (`ps`).
- ✅ **Key Validation & Error Redaction** — `applySqlCipherKey()` rejects NUL bytes, validates case-insensitive even-hex `x'...'` keys against `HEX_CIPHER_KEY_RE`, normalizes raw hex pragmas, escapes single-quoted passphrases, and throws generic error messages without echoing key material.
- ✅ **Staged Backups & Restore Locking** — Database backups write to staged `.tmp` files serialized under `restore-lock.ts` with pre-swap SQLite integrity verification, `.db` extension checks, and regular-file checks.

### **File Permissions (Docker)**

- ✅ **Data directory**: `700` (full access for owner only) in Docker
- ✅ **Non-root user** (`appuser:appgroup`) owns data directory

## 🔐 **Input Validation**

### **Content & Boundary Limits**

- **Journal entries**: 50,000 characters maximum
- **Tags**: Lowercased and normalized via slug regex (`[^a-z0-9:@]+` → `-`, stripping leading/trailing hyphens and filtering out empty post-normalization tags) and bound via parameterized queries at the SQLite adapter boundary
- **Entry & significance types**: Enforced against strict `ENTRY_TYPES` and `SIGNIFICANCE_TYPES` enum allowlists
- **Timestamps**: Validated and normalized to ISO 8601 (`YYYY-MM-DDTHH:MM:SS.sssZ`) in `validateEntryInput()`
- **Query & batch bounds**: `MAX_QUERY_LIMIT = 500` per query and `MAX_BATCH_SIZE = 50` per bulk operation
- **HTTP request body**: 1MB maximum (prevents memory exhaustion)
- **Tool input elements**: 25,000 array/object elements maximum per tool call (configurable via `MAX_TOOL_INPUT_ELEMENTS` / `--max-tool-input-elements`)

### **Character Handling**

- **Tags**: ASCII alphanumeric, colons, and `@` symbols preserved; all other character sequences collapsed to hyphens and stored via parameterized SQL queries (safe from injection)

### **SQL Injection Prevention**

- ✅ **Raw SQL Restrictions** — Standard handlers must strictly use parameterized methods defined by `IDatabaseAdapter`.
- ✅ **Parameterized queries** used throughout
- ✅ **Input validation** via Zod schemas before database operations
- ✅ **Warning system** for potentially dangerous content patterns
- ✅ **FTS5 / LIKE pattern sanitization** — `sanitizeFtsQuery` (`src/database/sqlite-adapter/entries/search/fts-sanitizer.ts`) escapes `%`, `_`, `\` wildcards and neutralizes FTS5 boolean, column, and prefix operators (`AND`, `OR`, `NOT*`, `NEAR*`).
- ✅ **Date format whitelisting** (prevents strftime injection)

### **Path Traversal & Filesystem Boundaries**

- ✅ **Explicit Filesystem Boundaries** — Filesystem access MUST be explicitly granted via `ALLOWED_IO_ROOTS`. The server operates in a **fail-closed** mode (`ALLOWED_IO_ROOTS=[]`) by default if not explicitly configured, preventing all filesystem interaction.
- ✅ **URL-Encoded, Null-Byte, Win32 & Symlink Rejection** — `assertSafeDirectoryPath` and `assertSafeFilePath` (`src/utils/path-safety.ts`) reject URL-encoded traversal sequences (`%2e`, `%2f`, `%5c`, `%00`), raw/decoded NUL bytes, Windows Alternate Data Streams (`:`), and Windows reserved DOS device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`); resolve ancestor symlinks iteratively via `fs.realpathSync.native()`, reject dangling symlinks via `fs.lstatSync()`, and validate containment via `path.relative()` on **both raw and percent-decoded paths**; reject file-level symlinks via `fs.lstatSync(filePath).isSymbolicLink()`; and verify post-`mkdir`, pre-chunk, and post-chunk `assertSafeDirectoryPath(realpathSync.native(...))` during Markdown exports (`src/markdown/exporter.ts`) to prevent TOCTOU swaps.
- ✅ **Implicit Authority Disabled** — The server no longer derives ambient filesystem authority from the location of database files.
- ✅ **Backup & Restore Boundaries** — `backup_journal` and `restore_backup` enforce `path.relative()` containment against the backup directory, require a `.db` extension and regular-file stat, and reject symlinks or traversal characters (`/`, `\`, `..`).
- ✅ **Agent-Healing Filesystem Fallbacks** — When `--no-agent-healing` is not set, read-only fallback tools (`view_file`, `list_dir`, `grep_search`) enforce `--tool-filter` / `codemodeInternalFullAccess` and `ALLOWED_IO_ROOTS` (fail-closed `[]` when unconfigured; `list_dir` defaults its target directory argument to `process.cwd()`), reject symlink file targets (`view_file`, single-file `grep_search`), resolve directory realpaths (`list_dir`, directory `grep_search`), skip symbolic links during recursive `grep_search` traversal, cap file reads at 2MB, and require `admin` scope under OAuth 2.1.
- ✅ **Typed security errors** with consistent error codes

### **Multi-Tenant Workspace Isolation (`workspace_id`)**

- ✅ **End-to-End Tenant Scoping** — All personal and team entry reads, updates, soft-deletes, restores, FTS5 searches, and vector semantic searches (`semantic_search`, `team_semantic_search`) enforce `workspace_id` and `project_number` isolation. Unregistered workspace updates enforce exact case-sensitive `workspace_id` ownership (`src/database/sqlite-adapter/entries/crud-update.ts`), writes require positive-integer `project_number` (while non-positive/non-integer read filters fail closed with zero matches), and scoped `merge_tags` verifies source-tag existence in the target workspace before creating a target tag (`src/database/sqlite-adapter/tags.ts`).
- ✅ **Wildcard workspace guards** — `create_entry` ignores `workspace_id: "*"` and stores a resolved workspace; `update_entry` accepts `workspace_id: "*"` with an explicit `target_workspace_id` move target but rejects `target_workspace_id: "*"`; and `delete_entry`, `restore_entry`, and batch deletes accept `workspace_id: "*"` for explicit ID-based matching.
- ✅ **`--tool-filter` & Code Mode namespace isolation** — `--tool-filter` acts as an allow-list on registration, `tools/list`, `tools/call`, and Code Mode (`filterToolsForSandbox` / `disabledToolStub` across tool groups, `mj.getConfig()` routing through `list_projects`, and `mj.team.*` namespace isolation in `worker-api-proxy.ts` and `api-proxy-trap.ts` so personal `mj.core.*` or unprefixed root `mj.*` calls never silently route to `team_*` tools). `readonly` drops non-read-only tools and blocks mutating `mj.*` calls/aliases. `update_configuration` and `mj_execute_code` stay registered; `--codemode-internal-full-access` is required for unrestricted dummy shims and full help group visibility and cannot be enabled via config hot-reload.

### **Prompt-Injection Defense (`<untrusted_remote_content>`)**

- ✅ **Untrusted Boundary Tagging** — External inputs surfaced across MCP Tools, Resources, Resource Templates, Server Instructions, and Workflow Prompts (Git commit subjects/bodies/authors/unreleased tags via `git-commit-helpers.ts` and `git-staleness.ts`, GitHub issue/PR/milestone titles/bodies/branches/refs/labels/handles & Copilot review comments via `fencing-helpers.ts` and `copilot-tools.ts`, team member/alias/cross-team author fields, journal entry previews/tags, and non-canonical audit log fields/arguments/errors via `sanitizeAuditEntryForEgress` in `src/audit/audit-resource.ts`) strip C0/C1 control characters and are truncated via `sliceUntrustedInline` before idempotent `<untrusted_remote_content>` wrapping (`&`, `<`, `>` entity-escaped), while keeping internal domain structs, entry content, canonical `memory://` URIs, and Kanban status enums raw.

## 🌐 **HTTP Transport Security**

When running in HTTP mode (`--transport http`), the following security measures apply:

### **CORS Configuration**

- ✅ **Configurable multiple origins** via comma-separated `--cors-origin` flag or `CORS_ORIGIN` (fallback: `MCP_CORS_ORIGIN`) environment variable
- ✅ **Exact-match verification** (no wildcard matching for custom domains)
- 🔒 **Default: None** (no external origins allowed by default). You MUST explicitly configure CORS for browsers.
- 🔒 **Required**: Set specific origins for production deployments, or wildcard (`*`) will only be accepted if HTTP Authentication is enabled.

```bash
# Restrict CORS to specific origins
memory-journal-mcp --transport http --allowed-io-roots /path/to/projects --cors-origin "http://localhost:3000,https://my-app.com"

# Or via environment variable
export CORS_ORIGIN="http://localhost:3000,https://my-app.com"
```

### **Security Headers & Protections**

- ✅ **DNS Rebinding Protection** — `hostHeaderValidation` middleware prevents CVE-2025-66414
- ✅ **Strict-Transport-Security (HSTS)** — max-age=31536000; includeSubDomains (opt-in via `--enable-hsts`). Note: Only effective when deployed behind a reverse proxy handling HTTPS.
- ✅ **X-Content-Type-Options: nosniff** — prevents MIME sniffing
- ✅ **X-Frame-Options: DENY** — prevents clickjacking
- ✅ **Content-Security-Policy: default-src 'none'; frame-ancestors 'none'** — prevents XSS and framing
- ✅ **Cache-Control: no-store, no-cache, must-revalidate** — prevents caching of sensitive journal data
- ✅ **Referrer-Policy: no-referrer** — prevents referrer leakage
- ⚠️ **CORS wildcard warning** — server logs a warning when CORS origin is `*`

### **Rate Limiting & Timeouts**

- **Rate limiting**: 100 requests per 60-second fixed window (`Retry-After`, 10,000-key LRU eviction). The key is the SHA-256 of the Bearer token when one is present, otherwise the SHA-256 of the client IP. The limiter runs before authentication and does not read JWT claims.
- ✅ **HTTP Timeouts** — Request timeout (120s), keep-alive timeout (65s), headers timeout (66s)

### **Session Management (Stateful Mode)**

- ✅ **UUID-based session IDs** (cryptographically random)
- ✅ **Principal-bound sessions** — Authenticated sessions bind `mcp-session-id` to the caller's principal (OAuth `sub`/`email`/`client_id` or SHA-256 hash of static Bearer token + client IP); cross-principal session reuse is rejected with `403 Forbidden`, and unknown or uninitialized `sessionId` / `mcp-session-id` requests return `400 Bad Request` (`Session not found`)
- ✅ **Active session cap** — Enforces a hard limit of `100` concurrent active sessions (`503 Service Unavailable` when full) and rejects duplicate SSE stream attachments on the same session (`409 Conflict`)
- ✅ **Idle timeout** — Sessions inactive for 30 minutes are automatically expired
- ✅ **1-minute sweep interval** — periodic cleanup of expired sessions and subscription listeners
- ✅ **Explicit session termination** via `DELETE /mcp`

### **Request Size Limits & Metrics Isolation**

- ✅ **Pre-Body Auth & 1MB Limits** — Rate limiting and Bearer/OAuth authentication execute *before* JSON body parsing (`src/transports/http/server/http-transport.ts`), while JSON parsing and protocol route handlers (`src/transports/http/server/protocol-route-handlers.ts`) enforce `1MB` / `maxRequestBodySize` limits to prevent memory-exhaustion DoS.
- ✅ **Health & Metrics Endpoint Protection** — Only `GET` and `HEAD` requests to `/health` (and `GET`/`HEAD` requests to OAuth `.well-known` discovery endpoints) bypass authentication (`src/auth/middleware.ts`, `src/transports/http/handlers.ts`); `/metrics` on the HTTP transport requires authentication under **both** OAuth 2.1 and static Bearer auth. The standalone Prometheus server (`src/observability/metrics-server.ts`, default `127.0.0.1:9465`) rejects whitespace-only `authToken` values on non-loopback binds and validates Bearer tokens via constant-time SHA-256 `crypto.timingSafeEqual`.
- ✅ **Outbound Webhook SSRF Protection** — Scheduled digest webhooks (`--report-webhook-url` / `REPORT_WEBHOOK_URL`) require `https:` (unless `ALLOW_INSECURE_WEBHOOK_HTTP=true` is explicitly set for local testing), resolve DNS prior to dispatch, block loopback/private/link-local/cloud-metadata IP ranges, and disable HTTP redirects (`redirect: 'error'`)

## 🔐 **OAuth 2.1 Authentication**

For production HTTP deployments, Memory Journal supports **OAuth 2.1 authentication** (opt-in):

| Component                   | Status | Description                                                                 |
| --------------------------- | ------ | --------------------------------------------------------------------------- |
| Protected Resource Metadata | ✅     | RFC 9728 `/.well-known/oauth-protected-resource` (`GET`/`HEAD` only)       |
| Auth Server Discovery       | ✅     | RFC 8414 metadata discovery with SSRF guards and caching                    |
| Token Validation            | ✅     | JWT validation with DNS-pinned JWKS fetching (`jose` + `createPinnedJwksFetch`) |
| Scope Enforcement           | ✅     | Granular `read`, `write`, `team`, `audit`, `admin`, `full` scopes           |
| HTTP Middleware             | ✅     | Constant-time Bearer validation (`GET`/`HEAD`-only public route bypass)     |

### **Supported Scopes**

| Scope   | Tool Groups                                                                | Description                            |
| ------- | -------------------------------------------------------------------------- | -------------------------------------- |
| `read`  | `core (read-only), search, analytics, relationships (visualize_relationships), io (export_entries), git`                 | Read-only operations                   |
| `write` | `github (+ all read groups and create_entry / create_entry_minimal / link_entries / mark_anchors_stale / import_external / import_markdown / export_markdown)` | Read + write operations                |
| `team`  | `team (dedicated team collaboration scope)`                                                                | Team database operations               |
| `audit` | `memory://audit resource access (included in admin/full; search_audit_log requires admin or full)`         | Operational telemetry resource access  |
| `admin` | `admin, backup, codemode (+ all read/write/team/audit groups)`             | Full administrative access             |
| `full`  | `Unrestricted access to all operations`                                    | Unrestricted access to all tool groups |

### **Enabling OAuth**

```bash
# CLI flags
memory-journal-mcp --transport http --port 3000 \
  --allowed-io-roots /path/to/projects \
  --oauth-enabled \
  --oauth-issuer https://auth.example.com/realms/mcp \
  --oauth-audience memory-journal-mcp \
  --oauth-jwks-uri https://auth.example.com/realms/mcp/protocol/openid-connect/certs

# Or via environment variables
export OAUTH_ENABLED=true
export OAUTH_ISSUER=https://auth.example.com/realms/mcp
export OAUTH_AUDIENCE=memory-journal-mcp
export OAUTH_JWKS_URI=https://auth.example.com/realms/mcp/protocol/openid-connect/certs
```

### **How It Works & SSRF Guards**

1. Client sends `Authorization: Bearer <token>` header (`POST`/`DELETE` to public discovery/`/health` routes are denied)
2. Server fetches JWKS via DNS-pinned `createPinnedJwksFetch()` (`src/auth/jwks-custom-fetch.ts` wired into `[jose.customFetch]` and `preload()`), enforcing case-normalized `https:` URLs (loopback HTTP allowed only via `--oauth-allow-plaintext-loopback`), `https.request` socket DNS pinning (`lookup`), `redirect: 'error'` / non-200 rejection, a `1MB` response cap, and full special-use IPv4/IPv6 CIDR blocking (`src/utils/network-safety.ts`: RFC 1918, `100.64.0.0/10`, `198.18.0.0/15`, `169.254.0.0/16`, NAT64 `64:ff9b::`, SIIT, 6to4 `2002::`, and dotted/hex IPv4-mapped addresses)
3. Server validates JWT signature (`alg` allowlist), `iss`, `aud`, required `exp`, and non-empty `sub` claims
4. Server extracts scopes from token and enforces tool/resource scopes (`resolveAuthenticatedAuthor()` in `src/utils/security-utils.ts` restricts OIDC email author fallbacks strictly to `email_verified === true`)
5. Invalid/missing tokens receive `401` with `WWW-Authenticate` header

### **Fallback Behavior**

When OAuth is **not enabled**, authentication falls back to:

1. **Simple token auth** — if `MCP_AUTH_TOKEN` env var (or `--auth-token`) is set (rejecting empty, whitespace-only, and placeholder tokens), requests must include `Authorization: Bearer <token>`, verified via SHA-256 `crypto.timingSafeEqual`, with granted scopes controlled by `MCP_AUTH_SCOPES` (default: `read`; set `export MCP_AUTH_SCOPES="full"` for unrestricted access)
2. **No auth (loopback only)** — if no auth mechanism is configured and the server is bound to localhost without wildcard CORS, requests are accepted for local development. Binding to non-localhost interfaces (e.g., `0.0.0.0`) or enabling wildcard CORS without authentication throws a fatal startup error.

## 🐙 **GitHub Token Security**

### **Token Handling**

- ✅ **Environment variables only** — tokens never stored in config files (`ConfigManager` tracks baseline provenance via `config-manager-baselines.ts` and `config-manager-persist.ts` so CLI/env secrets never persist to disk)
- ✅ **Recursive secret scrubbing** — Authorization headers, tokens, secret CLI flags, and sensitive argument keys are redacted across logger output (`src/utils/logger.ts`), audit egress (`sanitizeAuditEntryForEgress`), and batched `logs/agent-issues.jsonl` (`sanitizeIssueInput` in `src/utils/issue-logger.ts`)
- ✅ **Optional integration** — server works fully offline without GitHub token
- ✅ **Minimal scopes** — only requires `repo`, `project`, `read:org`

### **Environment Variables**

```bash
# Required for Authentication (Must not be the placeholder token)
MCP_AUTH_TOKEN="your-secure-token-here"
MCP_AUTH_SCOPES="full"          # Granted scopes for static Bearer auth (default: read)

# Required for Filesystem Tools (Export, Backup)
ALLOWED_IO_ROOTS="/path/to/allow1,/path/to/allow2"

# Required for GitHub features
GITHUB_TOKEN=ghp_...            # GitHub personal access token

# Optional
PROJECT_REGISTRY='{"my-repo":{"path":"/path/to/repo","project_number":1}}'  # Client override. `project create` writes projectRegistry to memory-journal.config.json (default ~/.gemini/config/memory-journal.config.json, or MEMORY_JOURNAL_CONFIG) and does not edit this variable. Leave it unset to load that file.
DEFAULT_PROJECT_NUMBER=1         # Default project for issue assignment
CORS_ORIGIN=                     # CORS origin (default: none)
MCP_HOST=localhost               # Server bind host
AUTO_REBUILD_INDEX=true          # Rebuild vector index on startup
```

## 🐳 **Docker Security**

### **Non-Root User**

- ✅ **Dedicated user**: `appuser` (UID 1001) with minimal privileges
- ✅ **Restricted group**: `appgroup` (GID 1001)
- ✅ **Restricted data directory**: `700` permissions

### **Container Hardening**

- ✅ **Minimal base image**: minimal Alpine Node.js production stage
- ✅ **Multi-stage build**: Build dependencies not in production image
- ✅ **Process isolation** from host system
- ✅ **No shell access needed** for production

### **Volume Mounting Security**

```bash
# Secure volume mounting
docker run -v ./data:/app/data:rw,noexec,nosuid,nodev writenotenow/memory-journal-mcp
```

### **Resource Limits**

```bash
# Apply resource limits
docker run --memory=1g --cpus=1 writenotenow/memory-journal-mcp
```

## ⛓️ **Supply Chain Security**

### **SHA-Pinned Images**

**Recommended (highest security):**

```bash
# Use SHA-256 digest for immutable reference
docker pull writenotenow/memory-journal-mcp@sha256:abc123...

# Find SHA digests at:
# https://hub.docker.com/r/writenotenow/memory-journal-mcp/tags
```

**Benefits:**

- Immutable image reference
- Protection against tag hijacking
- Reproducible deployments
- Supply chain verification

**Tag-based (convenience):**

```bash
docker pull writenotenow/memory-journal-mcp:latest
```

## 🔒 **Code Mode Sandbox Security**

Code Mode (`mj_execute_code`) executes user-provided JavaScript in a hardened `worker_threads` + `vm.createContext` sandbox, enforcing fleet-standard restrictions:

### **Engine-Level Restrictions**

- ✅ **V8 code generation disabled** — `codeGeneration: { strings: false, wasm: false }` prevents `eval()` and `Function()` construction from strings at the V8 engine level
- ✅ **Separate V8 isolate** — each worker thread runs in its own V8 instance with enforced heap limits (`maxOldGenerationSizeMb`, `maxYoungGenerationSizeMb`)
- ✅ **Frozen prototypes & cross-realm constructor lockdown** — all built-in prototypes (`Object`, `Function`, `Array`, `Error`, `Map`, `Set`, `Promise`, `%GeneratorPrototype%`, `%AsyncGeneratorPrototype%`, `%IteratorPrototype%`, `%AsyncIteratorPrototype%`, `%TypedArray%`, and `Iterator` in `src/codemode/worker/prototype-hardening.ts`) are frozen, and `.constructor` on `Object`, `Function`, `AsyncFunction`, `GeneratorFunction`, and `AsyncGeneratorFunction` prototypes is neutered in both the inner `vm` context and outer worker realm to prevent cross-realm dynamic constructor chain escapes
- ✅ **Proxy & Reflect isolation** — `Proxy: undefined` and `Reflect` / destructured prototype helpers (`src/codemode/worker/sandbox-globals.ts`) are blocked in the sandbox context to prevent meta-object protocol abuse
- ✅ **Frozen API surfaces & worker tables** — injected API objects (`mj.*`, group namespaces, console shim, `context`, neutralized `process` stub), `path` shims (`node-shims.ts`), `ADAPTER_ITEMS` (`mj-shim-domains.ts`), and `JOURNAL_TABLES` (`schema-help.ts`) are `Object.freeze()`'d to prevent prototype pollution across the API bridge

### **Static Code Validation**

- ✅ **Pre-validation ordering & input bounds** — Code Mode enablement checks, client rate-limiting, the 50KB code cap, non-`context` string/object field bounds (`dispatch-rpc-bounds.ts`, `src/handlers/tools/codemode/handler.ts`), and the `5MB` `context` cap execute *before* any code healer or SQL auto-recovery pass. SQL-shaped payloads are rewritten into `mj.*` calls with regular expressions before sandbox execution without using `node:vm`.
- ✅ **Single-pass lexical & escape scanner** — `stripCommentsAndStrings` (`src/codemode/security-stripper.ts`) and `auto-return.ts` handle regex literals vs `/` or postfix `++`/`--`, Annex B HTML comments (`<!--`/`-->`), `${...}` template interpolations, and `\uXXXX` / `\u{...}` / `\xXX` escapes (`decodeUnicodeEscape`) while preserving quoted `'constructor'`/`'__proto__'`/`'prototype'` literals so obfuscation cannot hide forbidden tokens
- ✅ **Comprehensive blocked patterns** — regex rules blocking `require()`, `import()`, `process.*`, `global.*`, `eval()`, `Function()`, `__proto__`, `constructor.constructor`, `['constructor']`, `Object.getPrototypeOf`, `Object.setPrototypeOf`, `Object.defineProperty`, `Reflect.*`, bare `Reflect`, `Symbol.*`, `new Proxy()`, `child_process`, `fs.*`, `net.*`, `http.*`, `https.*`
- ✅ **50KB code size limit** — prevents payload-based resource exhaustion

### **Runtime Protection**

- ✅ **Prototype-safe RPC allowlist & namespace isolation** — host-side `Object.hasOwn()` validation, strict request-shape checks, `disabledToolStub` (`journal-api-aliases.ts`), and strict `mj.team.*` isolation (`worker-api-proxy.ts`, `api-proxy-trap.ts`) prevent workers from invoking unauthorized, filtered, or cross-namespace (`core` -> `team_*`) methods
- ✅ **Host process isolation** — `process.exit()` calls inside the sandbox are safely neutralized in-place (`{ exited: true, exitCode }`) and can never terminate the worker or host MCP server
- ✅ **Rate limiting** — 60 executions per minute per client
- ✅ **Hard timeouts & nested bounds** — configurable `Promise.race` wall-clock timeout guards with timer cleanup, forced worker termination, and nested `maxResultSize` clamping (`nested-exec-payload.ts`, `worker-script.ts`)
- ✅ **Structured-clone egress boundary** — `result-compactor.ts` performs unconditional `JSON.parse(JSON.stringify(...))` unwrapping to strip nested userland `Proxy`, function, and symbol values before `parentPort.postMessage` (setting `resultSent = true` strictly after `postMessage` succeeds), paired with `compactOversizedResult` up to configurable size caps (default 100KB)
- ✅ **Readonly Proxy traps** — when `readonly: true` is passed to `mj_execute_code`, calling a stripped mutation method resolves to a structured `{ success: false, error: "🛠️ AUTONOMOUS HEALING: Operation '<key>' is blocked in readonly mode. Read operations only.", code: "VALIDATION_ERROR" }` object rather than throwing an exception
- ✅ **Schema Introspection Scope** — `.schema()` properties are strictly bound to the permitted methods in the RPC allowlist, preventing unintended internal structure leakage
- ✅ **Audit logging** — all executions logged with code preview, metrics, and readonly mode
- ✅ **Pre-warmed worker pool** — Worker threads are pre-warmed on startup to eliminate cold-start latency, with idle recycling and age-based recycling for memory hygiene

## 🔍 **Data Privacy**

### **Architecture Characteristics**

- ✅ **Full data ownership**: SQLite database stays on your machine
- ✅ **No telemetry**: No data sent to external telemetry endpoints
- ⚠️ **External Services**: If configured, communicates with GitHub API and fetches OAuth discovery (JWKS) endpoints.
- ⚠️ **Semantic search**: ML models are executed locally via `@huggingface/transformers`, but the model weights are downloaded from the Hugging Face registry on first run if not cached locally.

### **Context Security**

- ✅ **Git context**: Only reads local repository information
- ✅ **No sensitive data**: Doesn't access private keys or credentials
- ✅ **Optional GitHub integration**: Only if explicitly configured with token

## 🗑️ **Soft Delete Security**

### **Recoverable Deletes**

```javascript
// Soft delete (default)
delete_entry({ entry_id: 42, permanent: false })
// Sets deleted_at timestamp, entry remains in DB

// Permanent delete (explicit)
delete_entry({ entry_id: 42, permanent: true })
// Removes from database completely
```

**Benefits:**

- Accidental deletion recovery
- Audit trail
- No data loss

**Soft-deleted entries:**

- Excluded from searches
- Not visible in lists
- Still in database (for recovery)

## 🔑 **Access Control**

### **MCP Client Authentication**

Security handled at multiple levels:

- **OAuth 2.1** (HTTP transport, opt-in) - RFC-compliant JWT validation with scope enforcement
- **Simple token auth** (HTTP transport, via `MCP_AUTH_TOKEN`) - Basic Bearer token verification
- **MCP client** (stdio transport) - Desktop app security (Cursor IDE, Claude Desktop)
- User controls which servers run

### **File System Permissions**

**npm installation:**

```bash
# Database created with user permissions
chmod 600 ./memory_journal.db  # or your configured DB_PATH
```

**Docker installation:**

```bash
# A bind mount replaces the image's /app/data (mode 700, UID 1001).
# The host directory must be writable by UID 1001.
```

### **Team Database Security & RBAC**

If using team collaboration, the `TEAM_DB_PATH` dictates where the shared database is located, alongside optional `additionalTeamDbs` in config:

- ✅ **3-Tier Team RBAC** — Team operations enforce `viewer`, `member`, and `admin` role checks identically across MCP tools (`src/handlers/tools/team/rbac.ts`), MCP resources (`enforceTeamResourceRbac`), Markdown/YAML importers, and CLI commands (`enforceCliTeamRbac`).
- ✅ **Scoped Author Alias Canonicalization & Admin Deletes** — `canonicalizeTeamAuthor()` resolves author aliases strictly against a concrete target `workspace_id` (never wildcard `'*'` alias bleed), `permanent: true` team deletes require `SCOPES.ADMIN`, and cross-team search (`src/handlers/tools/search/cross-team.ts`) runs `Promise.allSettled` per-DB RBAC enforcement across `additionalTeamDbs` so an unavailable primary team DB never downgrades secondary DB checks.

**Security Warning:** Because `TEAM_DB_PATH` is accessed by multiple users or processes, it must be placed on a secure shared volume with strict access controls to prevent unauthorized data access or modification.

```bash
# Set secure permissions on the team database directory
chmod 700 /shared/team-data
```

## ⚙️ **Secure Configuration**

### **Environment Variables**

**Docker environment variables:**

```json
{
  "args": [
    "-e",
    "DB_PATH=/app/data/custom.db"
    // NO sensitive data in env vars
    // NO API keys
    // NO credentials
  ]
}
```

### **Secrets Management**

**Core local (`stdio`) operation requires no secrets:**

- No API keys, passwords, or tokens required for local journaling
- Optional features use `GITHUB_TOKEN` (GitHub API integration; or `gh auth`), `MCP_AUTH_TOKEN` (HTTP Bearer auth), and `MJ_DB_ENCRYPTION_KEY` / `DB_ENCRYPTION_KEY` (SQLCipher at-rest encryption; read via env vars only, including in `scripts/encrypt-db.ts`)
- CLI secret flags, auth headers, and sensitive keys are redacted across logger output (`src/utils/logger.ts`), audit egress (`scrubAuditArgs`, `sanitizeAuditEntryForEgress`), and batched `logs/agent-issues.jsonl` (`sanitizeIssueInput` in `src/utils/issue-logger.ts`), while `ConfigManager` baseline provenance (`config-manager-baselines.ts`, `config-manager-persist.ts`) prevents CLI/env secrets from persisting to config files

## 🔄 **CI/CD Security**

- ✅ **CodeQL analysis** - automated static analysis on push/PR
- ✅ **Trivy container scanning** - Docker image vulnerability detection
- ✅ **TruffleHog** - secret scanning on push/PR
- ✅ **pnpm audit** - dependency vulnerability checking

## 🚨 **Security Best Practices**

### **For Users**

1. **Set a CORS origin** when exposing the HTTP transport on a network
2. **Keep Node.js updated**: Use Node.js 24+ (current LTS recommended)
3. **Secure host system**: Ensure your host machine is secure
4. **Regular backups**: Use the `backup_journal` tool or back up your `.db` file
5. **Limit network access**: Don't expose the HTTP transport to untrusted networks
6. **Use resource limits**: Apply Docker `--memory` and `--cpus` limits

### **For Developers**

1. **Regular updates**: Keep Node.js and npm dependencies updated
2. **Security scanning**: Regularly scan Docker images for vulnerabilities
3. **Code review**: All database operations use parameterized queries
4. **Input validation**: All tool inputs validated via Zod schemas

## 📋 **Security Checklist**

- [x] Foreign key enforcement (`PRAGMA foreign_keys = ON`, initialized in `src/database/sqlite-adapter/native-connection.ts`)
- [x] SQLCipher environment-only key loading, case-insensitive even-hex validation, & error redaction (`sqlcipher-key.ts`, `scripts/encrypt-db.ts`)
- [x] Input validation and length limits (Zod schemas, prompt arg / resource URI bounds, `.max(100)` member bounds)
- [x] Parameterized SQL queries & scoped workspace/project isolation (`crud-update.ts`, `tags.ts`, positive-int SQLite bounds, `query-helpers.ts`)
- [x] SQL injection detection heuristics (defense-in-depth)
- [x] Path traversal, dangling symlink (`lstatSync`), Win32 ADS/DOS, `.db` regular-file restore, & TOCTOU export protection (`src/utils/path-safety.ts`, `backup-helpers.ts`, `exporter.ts`)
- [x] Explicit Filesystem Boundaries (`ALLOWED_IO_ROOTS`, `--tool-filter` & `codemodeInternalFullAccess` enforcement)
- [x] Restrictive `0o600`/`0o700` permissions on persisted configs, audit logs, agent issue logs, and metrics snapshots
- [x] Constant-time SHA-256 Bearer verification, unconditional placeholder rejection, trimmed `sub`, `GET`/`HEAD`-only `/health` & `.well-known` bypass, OIDC discovery SSRF/HTTPS validation, and `email_verified === true` check
- [x] DNS-pinned JWKS & discovery SSRF protection (`jwks-ssrf-guard.ts`, `jwks-custom-fetch.ts`, `network-safety.ts` IPv6 `uint16[8]`/Teredo/multicast filtering)
- [x] `/metrics` `audit` OAuth scope, conditional `mcp_user_calls_total` PII gating, and `no-store`/`nosniff` metrics headers
- [x] FTS5 / LIKE pattern & operator sanitization (`sanitizeFtsQuery` in `src/database/sqlite-adapter/entries/search/fts-sanitizer.ts`)
- [x] Date format whitelisting (`validateDateFormatPattern`)
- [x] HTTP pre-body rate limit/auth ordering, 1MB body limit, `415` unparsed non-JSON rejection, and `maxRequestBodySize` enforcement
- [x] Tool input element count limit (`MAX_TOOL_INPUT_ELEMENTS`, default 25,000) and Code Mode non-`context` / `50KB` `context` recovery / depth-bounded byte estimation caps
- [x] Configurable CORS multi-origin with exact-match enforcement
- [x] HTTP timeouts and built-in rate limiter (100 req/min)
- [x] DNS rebinding protection (`new URL` Host parsing on `metrics-server.ts`) and opt-in HSTS (`--enable-hsts` / `MCP_ENABLE_HSTS`)
- [x] Security headers (CSP, X-Content-Type-Options, X-Frame-Options, Cache-Control, Referrer-Policy, Permissions-Policy)
- [x] Session idle timeout (30 minutes), active session cap (100), principal binding, and 1-minute sweep interval
- [x] Non-root Docker user
- [x] Multi-stage Docker build
- [x] Local-first data architecture
- [x] Secret/token & CLI flag scrubbing across logs, `Error` objects, `--dump-config`, audit egress, `agent-issues.jsonl`, and `ConfigManager` baselines
- [x] Idempotent `<untrusted_remote_content>` C0/C1 control-char stripping & egress fencing across Git (`--name-status`/`-z` before `--`), GitHub (`github.com` host/slug checks), team authors/aliases, metrics, audit logs, templates, instructions, resources, and prompts
- [x] 3-tier Team RBAC parity (`viewer`/`member`/`admin`) & `Promise.allSettled` cross-team DB isolation (`cross-team.ts`)
- [x] Code Mode sandbox isolation (worker_threads V8 isolate, per-execution lexical RPC bridge, fatal worker termination, and `vm.createContext`)
- [x] Code Mode V8 codeGeneration restrictions (eval/Function disabled at engine level)
- [x] Code Mode frozen built-in prototypes & iterators (`%GeneratorPrototype%`, `%AsyncGeneratorPrototype%`, `%IteratorPrototype%`, concrete `%TypedArray%`, `Buffer`, `AggregateError`)
- [x] Code Mode lexical/Annex-B/regex-state/Unicode stripper, healer, & `auto-return` scanners + blocked patterns (including bare `Reflect` & destructured helpers)
- [x] Code Mode `Proxy` constructor nullified & unconditional `JSON.parse` structured-clone egress unwrapping (`result-compactor.ts`)
- [x] Code Mode `Promise.race` wall-clock timeouts, explicit empty `{}` `projectRegistry` isolation, & strict `mj.team.*` namespace / `mj.getConfig()` isolation
- [x] Code Mode RPC allowlist validation & readonly Proxy traps
- [x] CI/CD security pipeline (CodeQL, Trivy, secret scanning)
- [x] Code Mode frozen API surfaces (`Object.freeze` on `mj.*`, console, context, `fs`/`sql`/`path` shims, `ADAPTER_ITEMS`, `JOURNAL_TABLES`)
- [x] Code Mode pre-warmed worker pool with lifecycle management
- [x] Comprehensive security documentation

## 🎯 **Threat Model**

### **In Scope**

**Protected against:**

- SQL injection
- Resource exhaustion (size limits)
- Accidental data loss (soft delete)
- Database integrity (transactions)
- Container escape (non-root, no privileges)

### **Out of Scope**

**Not protected against:**

- Malicious MCP client
- Compromised host system
- Physical access to database file
- User deleting database file

**Why:**

- Local-first design trusts the host
- User has full control
- Desktop application security model

## 📜 **Compliance**

### **Data Protection**

**GDPR-friendly:**

- The server does not send product analytics to a vendor. Journal text, team author names, and optional OAuth identity claims stay in your database. GitHub and Hugging Face are contacted only when those features are configured.
- Local storage only
- User controls all data
- Easy data export/deletion

## 📦 **Supported Versions**

| Version / Component | Supported          | Notes                                                                 |
| ------------------- | ------------------ | --------------------------------------------------------------------- |
| `Latest Release`    | :white_check_mark: | Current major release series receiving active security updates.       |
| `Older Releases`    | :x:                | Legacy releases; please upgrade to `Latest Release`.                  |
| Node.js             | 24.x+ (current LTS)| Minimum Node 24+. Current Node.js LTS recommended for isolation features. |
| MCP Protocol        | 2025-11-25 / 2025-03-26 (backward-compatible with 2024-11-05) | Full compatibility with the official Model Context Protocol.          |
| Docker Base         | current Node.js Alpine LTS | Alpine-based images receive regular vulnerability patches.    |

## 🚨 **Reporting Security Issues**

If you discover a security vulnerability, please:

1. **Do not** open a public GitHub issue
2. **Report** via the [GitHub Security Advisories](https://github.com/neverinfamous/memory-journal-mcp/security/advisories/new) private reporting feature.
3. **Provide** detailed information about the vulnerability
4. **Allow** time for the issue to be addressed before public disclosure

## 🔄 **Security Updates**

- **Container updates**: Rebuild Docker images when base images are updated
- **Dependency updates**: Keep npm packages updated via manual update workflows
- **Database maintenance**: Run `ANALYZE` and `PRAGMA optimize` regularly
- **Security patches**: Apply host system security updates

The Memory Journal MCP server is designed with **security-first principles** to protect your personal journal data while maintaining excellent performance and usability.
