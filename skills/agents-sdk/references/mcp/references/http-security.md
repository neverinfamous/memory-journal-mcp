# HTTP Transport & Security Reference

Detailed patterns for OAuth 2.1 authentication, HTTP transport hardening, security headers, rate limiting, CORS, and dual-protocol support.

> Read this reference when implementing HTTP/SSE transport or OAuth authentication for an MCP server.

---

## OAuth 2.1 Authentication (Required for production HTTP servers)

All production HTTP servers must implement OAuth 2.1 as opt-in. Fallback chain: OAuth → simple token (`MCP_AUTH_TOKEN`) → no auth. `jose` is a transitive dependency of `@modelcontextprotocol/sdk`.

**Module:** `src/auth/` — 11 files. `OAuthError` extends server's base error class with `httpStatus` + `wwwAuthenticate`. Category auto-inferred (401 → AUTHENTICATION, 403 → AUTHORIZATION). 5 CLI flags with env var fallbacks. `/.well-known/oauth-protected-resource` always registered.

> [!TIP]
> The `src/auth/` module is copy-pasteable between servers. Only `scopes.ts`, `scope-map.ts`, and the `extends` declaration need customization.

> See [`oauth-reference.md`](../oauth-reference.md) for module structure, RFC compliance, scope model, error hierarchy, token validation, middleware patterns, CLI flags, testing (8 test files), and integration checklist.

---

## HTTP Transport Hardening (Required for HTTP/SSE servers)

**Modular Architecture:**

```
src/transports/http/
  server.ts       — HTTP/SSE transport orchestrator (route registration, server lifecycle)
  streamable.ts   — Streamable HTTP transport handler (POST/GET/DELETE /mcp)
  stateless.ts    — Stateless HTTP transport handler (serverless mode)
  legacy-sse.ts   — Legacy SSE transport handler (GET /sse, POST /messages)
  handlers.ts     — Route handlers (health, 404, shared utilities)
  security.ts     — Security headers, rate limiting, CORS, DNS rebinding, body parsing
  types.ts        — Config interfaces, constants, JSON-RPC codes, timeout constants
  index.ts        — Barrel re-export
```

**7 Security Headers** (every response):

| Header                      | Value                                        | Purpose                      |
| --------------------------- | -------------------------------------------- | ---------------------------- |
| `X-Content-Type-Options`    | `nosniff`                                    | Prevent MIME sniffing        |
| `X-Frame-Options`           | `DENY`                                       | Prevent clickjacking         |
| `Content-Security-Policy`   | `default-src 'none'; frame-ancestors 'none'` | Strict CSP                   |
| `Cache-Control`             | `no-store, no-cache, must-revalidate`        | Prevent data caching         |
| `Referrer-Policy`           | `no-referrer`                                | Prevent referrer leakage     |
| `Permissions-Policy`        | `camera=(), microphone=(), geolocation=()`   | Restrict browser APIs        |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`        | HSTS (**opt-in** via config) |

> [!IMPORTANT]
> HSTS must be **opt-in** (e.g., `--enable-hsts`), not auto-detected from `X-Forwarded-Proto`.

**Built-in Rate Limiting** (zero dependencies): Sliding window `Map<string, {count, resetTime}>`, 100 req/min per IP (configurable). `429` + `Retry-After`. Health endpoint exempt. `setInterval().unref()` cleanup.

**Server Timeouts:** Request 120s, keep-alive 65s, headers 66s.

**CORS:** Default `[]` (deny-all), multi-origin via `--cors-origin`, wildcard subdomain support, `Access-Control-Max-Age: 86400`, `Vary: Origin`. Startup warning on wildcard `*`. Explicit configuration required for cross-origin access.

**Additional Hardening:**

- **Body size limit:** 1 MB default, `413` on excess
- **Trust proxy:** Opt-in for `X-Forwarded-For` extraction
- **Cross-protocol guard:** SSE IDs rejected on `/mcp` and vice versa
- **404 handler:** `{ error: "Not found" }` — never expose stack traces
- **Health endpoint:** `GET /health` always responds regardless of auth/rate limit
- **DNS rebinding:** SDK ≥1.24.0 provides `localhostHostValidation()` middleware. Implementations may use the SDK utility directly or a custom `validateHostHeader()` function in `security.ts` — both are valid. Apply to all custom Express configs
- **Constant-time token comparison:** Use `crypto.timingSafeEqual` for simple bearer token validation — never raw `===`. Both values must be `Buffer.from()`-wrapped with length pre-check (short-circuit on different lengths is acceptable since length is not the secret)
- **JWT claims sanitization:** Filter prototype-polluting keys (`__proto__`, `constructor`, `prototype`) from JWT payload before spreading into `TokenClaims`. Prevents prototype pollution via crafted tokens
- **Bearer auth scope limitation:** Simple bearer auth (`--auth-token`) authenticates but does NOT enforce per-tool scopes. Emit a startup warning when bearer auth is configured: `"Simple token auth does not enforce per-tool scopes. Use OAuth 2.1 for granular access control."`
- **Fail-closed scope default:** `getRequiredScope()` returns `'admin'` for unmapped tools (`toolScopeMap.get(toolName) ?? 'admin'`), not `'read'`. Unknown tools require maximum privilege
- **Path traversal validation:** `validateSameDirPath()` or `assertNoPathTraversal()` in `utils/validate-path.ts` for tools that write files (backup, dump, restore, attach). Resolves canonical path and rejects `..` traversal

> [!CAUTION]
> **CVE-2026-25536 — Cross-client data leakage (SDK 1.10.0–1.25.3):** Reusing a single `McpServer` instance across multiple transports can route responses to wrong clients. **Fix:** upgrade to SDK ≥1.26.0, or create separate instances per connection.

---

## Tool Poisoning Defense (MCP-Specific)

Tool poisoning is a form of indirect prompt injection where malicious instructions are hidden in tool descriptions, annotations, or schema metadata. These instructions are invisible to human users but interpreted by AI models. OWASP Top 10 for LLM Applications 2025 ranks Prompt Injection #1 and Supply Chain #3 — tool description injection is the MCP-specific variant of both threats combined.

### Attack Vectors

| Vector                        | Description                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| **Description injection**     | Malicious prompts embedded in tool `description` fields — agent follows them as instructions |
| **Schema metadata injection** | Hidden instructions in parameter `description` fields within `inputSchema` or `outputSchema` |
| **Rug pull**                  | Tool definitions are legitimate initially, then silently modified after installation         |
| **Cross-tool poisoning**      | One poisoned tool's output influences how the agent uses other tools                         |

### Mitigation

- **Tool pinning:** Pin MCP server versions (npm lockfile, Docker image digest). Never float on `latest` in production
- **Schema integrity:** Consider digitally signing tool schemas. Verify signatures before accepting tool definitions from third-party servers
- **Description review:** Treat tool descriptions as code — review changes in PRs. Automated scanners can flag linguistic patterns common in prompt injection
- **Minimal privilege:** Each tool must have accurate `annotations`. Don't mark tools as `readOnlyHint: true` when they perform writes
- **HITL for sensitive ops:** Tools that access secrets, modify auth, or perform destructive operations should prompt for user confirmation
- **Audit logging:** Log all tool invocations with parameters for forensic analysis

---

## Code Mode Security Hardening

Additional security requirements for servers implementing Code Mode (`{prefix}_execute_code`):

**Frozen Built-In Prototypes:** Inside the `vm` context, freeze all built-in prototypes to prevent constructor chain escapes (e.g., `'con'+'structor'` string concatenation bypasses static blocked pattern scanning):

```typescript
// In sandbox.ts / worker-script.ts — before executing user code:
const FROZEN_BUILTINS = [
  Object,
  Function,
  Error,
  Array,
  Promise,
  String,
  Number,
  Boolean,
  RegExp,
  Map,
  Set,
  WeakMap,
  WeakSet,
  ArrayBuffer,
  SharedArrayBuffer,
  DataView,
  Int8Array,
  Uint8Array,
  Float64Array /* ... all typed arrays */,
]
for (const builtin of FROZEN_BUILTINS) {
  Object.freeze(builtin.prototype)
}
```

**Additional Blocked Patterns** (in `security.ts`):

| Pattern     | Why Blocked                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `Reflect.`  | Reflection API enables prototype traversal                                                               |
| `Symbol.`   | Symbol access can bypass property enumeration guards                                                     |
| `new Proxy` | Proxy traps can intercept and redirect any operation                                                     |
| `(SELECT`   | WHERE clause subquery injection (blind data exfiltration via `CASE WHEN (SELECT ...) THEN ... ELSE ...`) |

**Filesystem Boundary Enforcement:** For servers with file I/O tools (backup, restore, import, export), implement `ALLOWED_IO_ROOTS` — a fail-closed allowlist of directories. Validate every file path argument against these roots before execution:

```typescript
const ALLOWED_IO_ROOTS = [config.dataDir, config.backupDir].filter(Boolean)

function assertWithinBoundary(filePath: string): void {
  const resolved = path.resolve(filePath)
  if (!ALLOWED_IO_ROOTS.some((root) => resolved.startsWith(root))) {
    throw new SecurityError(`Path '${filePath}' is outside allowed directories`)
  }
}
```

---

## Key Security Resources

- **OWASP Top 10 for LLM Applications 2025:** https://owasp.org/www-project-top-10-for-large-language-model-applications/
- **MCP Security Best Practices:** https://modelcontextprotocol.io/specification/draft/best-practices.md
- **RFC 9700 — OAuth 2.0 Security BCP (Jan 2025):** https://datatracker.ietf.org/doc/rfc9700/
