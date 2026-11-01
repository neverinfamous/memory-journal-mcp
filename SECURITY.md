# 🔒 Security Guide

The Memory Journal MCP server implements comprehensive security measures to protect your personal journal data.

## 🛡️ **Database Security**

### **Native SQLite Architecture**

The server uses the native **better-sqlite3** driver with **sqlite-vec** for vector operations, running directly against the filesystem.

- ✅ **PRAGMA foreign_keys = ON** — enforces referential integrity and `ON DELETE CASCADE`
- ✅ **Parameterized queries** — all user input bound via `?` placeholders
- ✅ **WAL journal mode** — high concurrency with non-blocking reads (`PRAGMA journal_mode = WAL`)
- ✅ **Synchronous Normal** — optimized durability and performance (`PRAGMA synchronous = NORMAL`)

### **File Permissions (Docker)**

- ✅ **Data directory**: `700` (full access for owner only) in Docker
- ✅ **Non-root user** (`appuser:appgroup`) owns data directory

## 🔐 **Input Validation**

### **Content & Boundary Limits**

- **Journal entries**: 50,000 characters maximum
- **Tags**: Normalized via slug regex (`[^a-z0-9:@]+` -> `-`) and bound via parameterized queries at the SQLite adapter boundary (100 characters maximum)
- **Entry & significance types**: Enforced against strict `ENTRY_TYPES` and `SIGNIFICANCE_TYPES` enum allowlists (50 characters maximum)
- **Timestamps**: Validated and normalized to ISO 8601 (`YYYY-MM-DDTHH:MM:SS.sssZ`) in `validateEntryInput()`
- **Query & batch bounds**: `MAX_QUERY_LIMIT = 500` per query and `MAX_BATCH_SIZE = 50` per bulk operation
- **HTTP request body**: 1MB maximum (prevents memory exhaustion)
- **Tool input elements**: 25,000 array/object elements maximum per tool call (configurable via `MAX_TOOL_INPUT_ELEMENTS` / `--max-tool-input-elements`)

### **Character Handling**

Tags are lowercased, normalized via slug regex (`[^a-z0-9:@]+` -> `-`, with leading/trailing hyphens stripped), and bound via parameterized queries at the database layer so special characters never pose injection risks.

### **SQL Injection Prevention**

- ✅ **Raw SQL Restrictions** — Standard handlers must strictly use parameterized methods defined by `IDatabaseAdapter`.
- ✅ **Parameterized queries** used throughout
- ✅ **Input validation** via Zod schemas before database operations
- ✅ **Warning system** for potentially dangerous content patterns
- ✅ **FTS5 / LIKE pattern sanitization** (escapes `%`, `_`, `\` wildcards and handles FTS5 syntax errors gracefully)
- ✅ **Date format whitelisting** (prevents strftime injection)

### **Path Traversal & Filesystem Boundaries**

- ✅ **Explicit Filesystem Boundaries** — Filesystem access MUST be explicitly granted via `ALLOWED_IO_ROOTS`. The server operates in a **fail-closed** mode (`ALLOWED_IO_ROOTS=[]`) by default if not explicitly configured, preventing all filesystem interaction.
- ✅ **URL-Encoded & Null-Byte Rejection** — `assertSafeDirectoryPath` rejects URL-encoded traversal sequences (`%2e`, `%2f`, `%5c`, `%00`) and raw null bytes before decoding, resolves ancestor symlinks iteratively via `fs.realpathSync()`, and validates containment using `path.relative()`.
- ✅ **Implicit Authority Disabled** — The server no longer derives ambient filesystem authority from the location of database files.
- ✅ **Backup & Restore Boundaries** — `backup_journal` and `restore_backup` enforce `path.relative()` containment against the backup directory and reject symlinks or traversal characters (`/`, `\`, `..`).
- ✅ **Agent-Healing Filesystem Fallbacks** — When `--no-agent-healing` is not set, read-only fallback tools (`view_file`, `list_dir`, `grep_search`) enforce `ALLOWED_IO_ROOTS`, skip symbolic links during recursive directory traversal, cap file reads at 2MB, and require `admin` scope over HTTP.
- ✅ **Typed security errors** with consistent error codes

### **Multi-Tenant Workspace Isolation (`workspace_id`)**

- ✅ **End-to-End Tenant Scoping** — All personal and team entry reads, updates, soft-deletes, restores, FTS5 searches, and vector semantic searches (`semantic_search`, `team_semantic_search`) enforce `workspace_id` isolation.
- ✅ **External Wildcard Rejection** — The cross-workspace sentinel (`workspace_id: '*'`) is reserved strictly for internal maintenance/read workflows; external tool callers passing `workspace_id: '*'` on write or mutation paths are rejected or automatically scoped to their resolved workspace.
- ✅ **Execution-Layer `--tool-filter` Parity** — `--tool-filter` (including `readonly`, `-group`, and `-tool`) is enforced at execution time across `tools/call`, Code Mode (`mj.*`), and agent-healing fallbacks unless `--codemode-internal-full-access` was explicitly granted at server startup (which cannot be escalated via config file hot-reload).

### **Prompt-Injection Defense (`<untrusted_remote_content>`)**

- ✅ **Untrusted Boundary Tagging** — External inputs surfaced in MCP Resources and Workflow Prompts (Git commit subjects, GitHub issue/PR/milestone titles, workflow run names, and journal entry content) are wrapped in `<untrusted_remote_content>` tags with `&`, `<`, and `>` entity-escaped to prevent tag-breakout and indirect prompt injection.

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

- ✅ **Built-in Rate Limiting** — 100 requests/minute per IP (sliding window with `Retry-After` header)
- ✅ **HTTP Timeouts** — Request timeout (120s), keep-alive timeout (65s), headers timeout (66s)

### **Session Management (Stateful Mode)**

- ✅ **UUID-based session IDs** (cryptographically random)
- ✅ **Principal-bound sessions** — Authenticated sessions bind `mcp-session-id` to the caller's principal (`sub` or Bearer token hash); cross-principal session reuse is rejected with `403 Forbidden`, and unknown or uninitialized `sessionId` / `mcp-session-id` requests return `400 Bad Request` (`Session not found`)
- ✅ **Active session cap** — Enforces a hard limit of `100` concurrent active sessions (`503 Service Unavailable` when full) and rejects duplicate SSE stream attachments on the same session (`409 Conflict`)
- ✅ **Idle timeout** — Sessions inactive for 30 minutes are automatically expired
- ✅ **1-minute sweep interval** — periodic cleanup of expired sessions and subscription listeners
- ✅ **Explicit session termination** via `DELETE /mcp`

### **Request Size Limits & Metrics Isolation**

- ✅ **1MB body limit** on JSON and chunked stream requests (prevents memory exhaustion DoS)
- ✅ **Health & Metrics endpoint protection** — `/health` is unauthenticated; `/metrics` is protected under OAuth 2.1, unauthenticated under static Bearer auth, or isolated on `127.0.0.1` via `MJ_METRICS_PORT`
- ✅ **Outbound Webhook SSRF Protection** — Scheduled digest webhooks (`--report-webhook-url` / `REPORT_WEBHOOK_URL`) require `https:`, resolve DNS prior to dispatch, block loopback/private/link-local/cloud-metadata IP ranges, and disable HTTP redirects (`redirect: 'error'`)

## 🔐 **OAuth 2.1 Authentication**

For production HTTP deployments, Memory Journal supports **OAuth 2.1 authentication** (opt-in):

| Component                   | Status | Description                                      |
| --------------------------- | ------ | ------------------------------------------------ |
| Protected Resource Metadata | ✅     | RFC 9728 `/.well-known/oauth-protected-resource` |
| Auth Server Discovery       | ✅     | RFC 8414 metadata discovery with caching         |
| Token Validation            | ✅     | JWT validation with JWKS support (via `jose`)    |
| Scope Enforcement           | ✅     | Granular `read`, `write`, `team`, `audit`, `admin`, `full` scopes |
| HTTP Middleware             | ✅     | Bearer token extraction and validation           |

### **Supported Scopes**

| Scope   | Tool Groups                                                                | Description                            |
| ------- | -------------------------------------------------------------------------- | -------------------------------------- |
| `read`  | `core, search, analytics, relationships, io, git`                          | Read-only operations                   |
| `write` | `github (+ all read groups and create_entry / create_entry_minimal / link_entries / mark_anchors_stale / import_external / import_markdown / export_markdown)` | Read + write operations                |
| `team`  | `team (dedicated team collaboration scope)`                                | Team database operations               |
| `audit` | `audit log access`                                                         | Audit log queries and inspection       |
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

### **How It Works**

1. Client sends `Authorization: Bearer <token>` header
2. Server validates JWT signature against JWKS endpoint
3. Server checks issuer, audience, and expiration claims
4. Server extracts scopes from token and enforces tool-level access
5. Invalid/missing tokens receive `401` with `WWW-Authenticate` header

### **Fallback Behavior**

When OAuth is **not enabled**, authentication falls back to:

1. **Simple token auth** — if `MCP_AUTH_TOKEN` env var is set, requests must include `Authorization: Bearer <token>` matching the configured value
2. **No auth (loopback only)** — if no auth mechanism is configured and the server is bound to localhost without wildcard CORS, requests are accepted for local development. Binding to non-localhost interfaces (e.g., `0.0.0.0`) or enabling wildcard CORS without authentication throws a fatal startup error.

## 🐙 **GitHub Token Security**

### **Token Handling**

- ✅ **Environment variables only** - tokens never stored in config files
- ✅ **Error message scrubbing** - Authorization headers stripped from error logs
- ✅ **Optional integration** - server works fully offline without GitHub token
- ✅ **Minimal scopes** - only requires `repo`, `project`, `read:org`

### **Environment Variables**

```bash
# Required for Authentication (Must not be the placeholder token)
MCP_AUTH_TOKEN="your-secure-token-here"

# Required for Filesystem Tools (Export, Backup)
ALLOWED_IO_ROOTS="/path/to/allow1,/path/to/allow2"

# Required for GitHub features
GITHUB_TOKEN=ghp_...            # GitHub personal access token

# Optional
PROJECT_REGISTRY='{"my-repo":{"path":"/path/to/repo","project_number":1}}'  # Multi-project routing (Tip: Use `npx memory-journal-mcp project create <name> --path <path>`)
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
docker run -v ./data:/app/data:rw,noexec,nosuid,nodev memory-journal-mcp
```

### **Resource Limits**

```bash
# Apply resource limits
docker run --memory=1g --cpus=1 memory-journal-mcp
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
- ✅ **Frozen prototypes & cross-realm constructor lockdown** — all built-in prototypes (Object, Function, Array, Error, Map, Set, Promise, etc.) are frozen, and `.constructor` on `Function`, `AsyncFunction`, `GeneratorFunction`, and `AsyncGeneratorFunction` prototypes is neutered in both the inner `vm` context and outer worker realm to prevent cross-realm dynamic constructor chain escapes
- ✅ **Proxy constructor nullified** — `Proxy: undefined` in the sandbox context prevents meta-object protocol abuse
- ✅ **Frozen API surfaces** — All injected API objects (mj.*, group namespaces, console shim, context, and neutralized `process` stub) are Object.freeze()'d to prevent prototype pollution on the API bridge

### **Static Code Validation**

- ✅ **Pre-validation ordering** — Code Mode enablement checks, client rate-limiting, and the 50KB byte-size cap execute *before* any code healer or SQL auto-recovery pass, and SQL recovery uses a linear `O(N)` state-machine parser (zero `node:vm` execution on the host thread)
- ✅ **Single-pass lexical scanner** — `stripCommentsAndStrings` uses a single-pass character state machine that preserves `${...}` template literal interpolation expressions and `'constructor'`/`'__proto__'`/`'prototype'` strings so regex/comment interleaving cannot hide forbidden tokens
- ✅ **Comprehensive blocked patterns** — regex rules blocking `require()`, `import()`, `process.*`, `global.*`, `eval()`, `Function()`, `__proto__`, `constructor`, `Object.getPrototypeOf`, `Object.setPrototypeOf`, `Object.defineProperty`, `Reflect.*`, `Symbol.*`, `new Proxy()`, `child_process`, `fs.*`, `net.*`, `http.*`, `https.*`
- ✅ **50KB code size limit** — prevents payload-based resource exhaustion

### **Runtime Protection**

- ✅ **Prototype-safe RPC allowlist** — host-side `Object.hasOwn()` validation and strict request-shape checks prevent workers from invoking unauthorized or prototype-chain API methods (`__proto__`, `constructor`)
- ✅ **Host process isolation** — `process.exit()` calls inside the sandbox are safely neutralized in-place (`{ exited: true, exitCode }`) and can never terminate the worker or host MCP server
- ✅ **Rate limiting** — 60 executions per minute per client
- ✅ **Hard timeouts** — configurable execution limit (default 30s) with forced worker termination
- ✅ **Egress boundary enforcement** — result serialization capped at configurable limit (default 100KB) with automatic collection compaction (`compactOversizedResult`) for large object/array payloads to prevent OOM via oversized payloads
- ✅ **Readonly Proxy traps** — when `readonly: true`, stripped mutation methods throw clear error messages listing available methods
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
# Volume mount with appropriate permissions
mkdir -m 755 data
```

### **Team Database Security**

If using team collaboration, the `TEAM_DB_PATH` dictates where the shared database is located.

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
- Optional features use `GITHUB_TOKEN` (GitHub API integration; or `gh auth`), `MCP_AUTH_TOKEN` (HTTP Bearer auth), and `DB_ENCRYPTION_KEY` (SQLCipher at-rest encryption)

## 🔄 **CI/CD Security**

- ✅ **CodeQL analysis** - automated static analysis on push/PR
- ✅ **Trivy container scanning** - Docker image vulnerability detection
- ✅ **TruffleHog** - secret scanning on push/PR
- ✅ **pnpm audit** - dependency vulnerability checking

## 🚨 **Security Best Practices**

### **For Users**

1. **Set a CORS origin** when exposing the HTTP transport on a network
2. **Keep Node.js updated**: Use Node.js 24+ (Node.js 26.x LTS recommended)
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
- [x] Input validation and length limits (Zod schemas, centralized in `src/handlers/tools/schemas/constants-and-primitives.ts`)
- [x] Parameterized SQL queries
- [x] SQL injection detection heuristics (defense-in-depth)
- [x] Path traversal protection (`assertNoPathTraversal`)
- [x] Explicit Filesystem Boundaries (`ALLOWED_IO_ROOTS` enforcement)
- [x] Strict Authentication Tokens (Placeholder rejection)
- [x] FTS5 / LIKE pattern sanitization (`sanitizeSearchQuery`)
- [x] Date format whitelisting (`validateDateFormatPattern`)
- [x] HTTP body size limit (1MB)
- [x] Tool input element count limit (`MAX_TOOL_INPUT_ELEMENTS`, default 25,000)
- [x] Configurable CORS multi-origin with exact-match enforcement
- [x] HTTP timeouts and built-in rate limiter (100 req/min)
- [x] DNS rebinding protection and strict HSTS
- [x] Security headers (CSP, X-Content-Type-Options, X-Frame-Options, Cache-Control, Referrer-Policy, Permissions-Policy)
- [x] Session idle timeout (30 minutes), active session cap (100), principal binding, and 1-minute sweep interval
- [x] Non-root Docker user
- [x] Multi-stage Docker build
- [x] Local-first data architecture
- [x] GitHub token error scrubbing
- [x] Code Mode sandbox isolation (worker_threads V8 isolate + vm.createContext)
- [x] Code Mode V8 codeGeneration restrictions (eval/Function disabled at engine level)
- [x] Code Mode frozen built-in prototypes (constructor chain escape prevention)
- [x] Code Mode blocked patterns (Multiple static regex rules)
- [x] Code Mode Proxy constructor nullified in sandbox context
- [x] Code Mode RPC allowlist validation (host-side method authorization)
- [x] Code Mode readonly Proxy traps (structured errors for stripped methods)
- [x] CI/CD security pipeline (CodeQL, Trivy, secret scanning)
- [x] Code Mode frozen API surfaces (Object.freeze on mj.*, console, context)
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

- No data collection
- No data transmission
- Local storage only
- User controls all data
- Easy data export/deletion

**No PII collection:**

- No names
- No email addresses
- No tracking
- No analytics

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
