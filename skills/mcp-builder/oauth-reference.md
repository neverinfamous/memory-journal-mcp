# OAuth 2.1 Reference — MCP Builder Skill

> Production-tested OAuth 2.1 implementation pattern for MCP servers. Standardized across db-mcp, mysql-mcp, postgres-mcp, and memory-journal-mcp (March 2026).

## When to Implement

Add OAuth when the MCP server:
- Exposes an **HTTP transport** accessible over a network
- Needs **multi-tenant access control** (different clients get different permissions)
- Requires **production-grade security** beyond simple shared token auth

OAuth is **opt-in** — servers always support a fallback chain: OAuth → simple token (`MCP_AUTH_TOKEN`) → no auth.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    HTTP Request Pipeline                      │
│                                                              │
│  Request ──► Security Headers ──► Rate Limiter               │
│       │                                                      │
│       ▼                                                      │
│  Public Path? ──(yes)──► /.well-known/* ──► RFC 9728 metadata│
│       │                  /health        ──► Health check     │
│       │(no)                                                  │
│       ▼                                                      │
│  Extract Bearer Token (Authorization header)                 │
│       │                                                      │
│  ┌────┴────┐                                                 │
│  │ OAuth?  │──(yes)──► JWT Validation (JWKS/jose)            │
│  └────┬────┘           ├─ Signature verification             │
│       │(no)            ├─ Issuer/audience/expiry checks      │
│       │                └─ Scope extraction → req.auth        │
│       ▼                                                      │
│  Token Auth? ──(MCP_AUTH_TOKEN set)──► Simple comparison     │
│       │(no)                                                  │
│       ▼                                                      │
│  No Auth ──► Allow all requests                              │
│                                                              │
│  Route Handler ──► Scope Enforcement (tool group → scope)    │
└──────────────────────────────────────────────────────────────┘
```

## Module Structure (`src/auth/` — 11 files)

| File | Purpose | Lines |
|------|---------|-------|
| `types.ts` | RFC 9728/8414/7591 type definitions, config interfaces | ~250 |
| `errors.ts` | OAuth error hierarchy (`OAuthError` extends server base class + `httpStatus`, `wwwAuthenticate`, `AUTH_` prefixed codes) | ~200 |
| `scopes.ts` | Scope definitions, hierarchy, tool group → scope mapping, utilities | ~200 |
| `token-validator.ts` | JWT validation via `jose`, JWKS caching, claim extraction | ~275 |
| `oauth-resource-server.ts` | RFC 9728 Protected Resource Metadata endpoint | ~170 |
| `authorization-server-discovery.ts` | RFC 8414 metadata discovery with TTL caching | ~260 |
| `scope-map.ts` | O(1) reverse lookup: tool name → required scope | ~50 |
| `auth-context.ts` | `AsyncLocalStorage` per-request auth context | ~50 |
| `middleware.ts` | Express middleware for token extraction & scope enforcement | ~520 |
| `transport-agnostic.ts` | Transport-agnostic auth utilities (`createAuthenticatedContext`, `validateAuth`, `formatOAuthError`) | ~100 |
| `index.ts` | Barrel re-exports | ~40 |

## RFC Compliance

| RFC | Component | What It Does |
|-----|-----------|--------------|
| **RFC 9728** | `oauth-resource-server.ts` | Serves `GET /.well-known/oauth-protected-resource` — tells clients which auth servers to use and what scopes are supported |
| **RFC 8414** | `authorization-server-discovery.ts` | Fetches `GET {issuer}/.well-known/oauth-authorization-server` — discovers token/JWKS endpoints |
| **RFC 7591** | `types.ts` | Type definitions for dynamic client registration (optional) |
| **RFC 8707** | Token validation | Resource Indicators — binds tokens to specific MCP server URIs |

### Client ID Metadata Documents (CIMDs) — MCP 2025-11-25

The **preferred** client registration mechanism. Clients use HTTPS URLs as `client_id`, pointing to a JSON metadata document. This addresses the common MCP scenario where servers and clients have no pre-existing relationship.

**Client requirements:**
- Host metadata at an HTTPS URL with a path component (e.g., `https://app.example.com/client.json`)
- Document MUST include: `client_id`, `client_name`, `redirect_uris`
- `client_id` value must match the document URL exactly

**Server requirements:**
- Fetch metadata when encountering URL-formatted `client_id`
- Validate `client_id` matches URL exactly
- Cache metadata respecting HTTP cache headers
- Validate redirect URIs against the metadata document

```json
{
  "client_id": "https://app.example.com/oauth/client-metadata.json",
  "client_name": "Example MCP Client",
  "redirect_uris": ["http://127.0.0.1:3000/callback"],
  "grant_types": ["authorization_code"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

### Resource Indicators (RFC 8707) — MCP 2025-11-25

MCP clients MUST include the `resource` parameter in both authorization and token requests to bind tokens to a specific MCP server:

- Use the canonical URI of the target MCP server
- Prevents token replay across different servers
- Authorization servers validate the `resource` parameter matches expected values

### Incremental Scope Consent — MCP 2025-11-25

Support step-up authorization for runtime scope escalation:

**Server-side (403 response):**
```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope",
                         scope="files:read files:write",
                         resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"
```

**Scope inclusion strategies:**
| Strategy | What to include |
|----------|----------------|
| Minimum | Only newly-required scopes + existing required scopes |
| Recommended | Existing + newly required scopes (prevents losing permissions) |
| Extended | Existing + new + commonly related scopes |

**Client-side (step-up flow):**
1. Parse error info from `WWW-Authenticate` header
2. Determine required scopes from `scope` parameter or fallback to `scopes_supported`
3. Re-authorize with expanded scope set
4. Retry original request (with retry limit to avoid loops)

## Scope Model

### Three-Tier Hierarchy

```
full (superscope — grants everything)
  └── admin
        └── write
              └── read
```

Each scope **inherits** all scopes below it: `admin` grants `write` + `read`.

### Tool Group → Scope Mapping

Map each tool group to a single scope. The mapping is server-specific but follows this pattern:

| Scope | Typical Tool Groups | Rationale |
|-------|--------------------|-----------|
| `read` | core, search, analytics, relationships, export, introspection | Read-only operations |
| `write` | github, team, migration | Mutations to external systems |
| `admin` | admin, backup, codemode | Destructive, administrative, or elevated operations |

**Implementation pattern** (`scopes.ts`):

```typescript
export const TOOL_GROUP_SCOPES: Record<string, string> = {
  core: 'read',
  search: 'read',
  analytics: 'read',
  admin: 'admin',
  backup: 'admin',
  codemode: 'admin',
  // ... server-specific groups
};
```

### Reverse Lookup (`scope-map.ts`)

Build an O(1) map from individual tool names → required scope at startup:

```typescript
const toolScopeMap = new Map<string, string>();
for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
  const scope = TOOL_GROUP_SCOPES[group] ?? 'read';
  for (const toolName of tools) {
    toolScopeMap.set(toolName, scope);
  }
}

export function getRequiredScope(toolName: string): string {
  return toolScopeMap.get(toolName) ?? 'read';
}
```

## Error Hierarchy

All OAuth errors extend the server's base error class (e.g., `OAuthError extends DbMcpError`) with `httpStatus` and `wwwAuthenticate`:

```typescript
{Server}McpError (base — code, category, suggestion, recoverable, toResponse())
  └── OAuthError (adds httpStatus, wwwAuthenticate; category auto-inferred from status)
        ├── TokenMissingError        → 401, AUTH_TOKEN_MISSING, category: authentication
        ├── InvalidTokenError        → 401, AUTH_TOKEN_INVALID, category: authentication
        ├── TokenExpiredError        → 401, AUTH_TOKEN_EXPIRED, category: authentication
        ├── InvalidSignatureError    → 401, AUTH_SIGNATURE_INVALID, category: authentication
        ├── InsufficientScopeError   → 403, AUTH_SCOPE_DENIED, category: authorization
        ├── AuthServerDiscoveryError → 503, AUTH_DISCOVERY_FAILED, category: internal
        ├── JwksFetchError           → 503, AUTH_JWKS_FETCH_FAILED, category: internal
        └── ClientRegistrationError  → 500, AUTH_REGISTRATION_FAILED, category: internal
```

**Key changes from March 2026 harmonization:**
- All error codes prefixed with `AUTH_` (e.g., `TOKEN_MISSING` → `AUTH_TOKEN_MISSING`)
- Category auto-inferred: 401 → `AUTHENTICATION`, 403 → `AUTHORIZATION`, 5xx → `INTERNAL`
- `toResponse()` inherited from base class returns full `ErrorResponse` with code, category, suggestion, recoverable
- Deprecated standalone `getWWWAuthenticateHeader()` utility — removed from barrel export

> [!TIP]
> OAuthError extends the server's typed base class. The only server-specific customization is the `extends` declaration (e.g., `extends DbMcpError` vs `extends PostgresMcpError`). All other OAuth error logic is portable.

## Token Validation (`token-validator.ts`)

Uses `jose` (transitive dependency via `@modelcontextprotocol/sdk`) — no extra install needed.

Key behaviors:
- Creates `createRemoteJWKSet()` once with TTL-based caching
- Validates with `jwtVerify(token, jwks, { issuer, audience, clockTolerance })`
- Extracts scopes from `scope` claim (space-delimited string) or `scopes` claim (array)
- Maps `jose` error classes → typed OAuth errors:
  - `JWTExpired` → `TokenExpiredError`
  - `JWSSignatureVerificationFailed` → `InvalidTokenError`
  - `JWTClaimValidationFailed` → `InvalidTokenError`

## Middleware Pattern (`middleware.ts`)

The middleware file exports both **Express-specific** and **transport-agnostic** utilities:

### Express Middleware

```typescript
// Main auth middleware — extracts + validates Bearer token
createAuthMiddleware(config) → RequestHandler

// Scope enforcement
requireScope(scope)      → RequestHandler  // Single scope check
requireAnyScope(scopes)  → RequestHandler  // Any of multiple scopes
requireToolScope(tool)   → RequestHandler  // Tool-specific scope via scope-map

// Error handler (add after routes)
oauthErrorHandler → ErrorRequestHandler
```

### Transport-Agnostic Utilities

```typescript
// For any transport (stdio, HTTP, WebSocket, etc.)
extractBearerToken(authHeader) → string | null
createAuthenticatedContext(authHeader, validator) → AuthenticatedContext
validateAuth(authHeader, validator, options) → AuthenticatedContext  // throws
formatOAuthError(error) → { status, body }
```

### Public Path Exemption

```typescript
// Well-known paths are ALWAYS public (RFC requirement)
if (path.startsWith('/.well-known/')) return true;
// Health endpoint is always public
if (path === '/health') return true;
```

## CLI Flags & Environment Variables

| CLI Flag | Env Variable | Default | Description |
|----------|-------------|---------|-------------|
| `--oauth-enabled` | `OAUTH_ENABLED` | `false` | Enable OAuth 2.1 |
| `--oauth-issuer <url>` | `OAUTH_ISSUER` | — | Issuer URL |
| `--oauth-audience <aud>` | `OAUTH_AUDIENCE` | — | Expected audience |
| `--oauth-jwks-uri <url>` | `OAUTH_JWKS_URI` | — | JWKS endpoint |
| `--oauth-clock-tolerance <s>` | `OAUTH_CLOCK_TOLERANCE` | `30` | Clock skew tolerance |

**Wiring in `cli.ts`:**

```typescript
.option('--oauth-enabled', 'Enable OAuth 2.1', false)
.option('--oauth-issuer <url>', 'OAuth issuer URL', process.env.OAUTH_ISSUER)
.option('--oauth-audience <aud>', 'JWT audience', process.env.OAUTH_AUDIENCE)
// ... pass these through ServerOptions → HttpTransportConfig
```

## Server Integration Pattern

In `server.ts` (the HTTP transport), conditionally wire OAuth:

```typescript
// 1. Always register the RFC 9728 metadata endpoint
app.get('/.well-known/oauth-protected-resource', resourceServer.getMetadataHandler());

// 2. Conditionally apply OAuth middleware
if (config.oauthEnabled) {
  const tokenValidator = new TokenValidator({ issuer, audience, jwksUri, clockTolerance });
  const authMiddleware = createAuthMiddleware({ tokenValidator, resourceServer });
  app.use(authMiddleware);
} else if (config.authToken) {
  // Simple token auth fallback
  app.use(basicTokenMiddleware(config.authToken));
}
```

## Testing Patterns (`src/auth/__tests__/` — 8 files)

| Test File | What It Covers |
|-----------|---------------|
| `errors.test.ts` | Error hierarchy, HTTP status codes, WWW-Authenticate headers, type guards |
| `scopes.test.ts` | Scope hierarchy, parsing, validation, tool group mapping, accessible tools |
| `scope-map.test.ts` | O(1) reverse lookup, full coverage of all tool groups |
| `token-validator.test.ts` | JWT validation (mocked `jose`), scope parsing, error mapping, JWKS cache |
| `auth-context.test.ts` | AsyncLocalStorage context, isolation between requests |
| `oauth-resource-server.test.ts` | RFC 9728 metadata, caching, scope support, accessors |
| `authorization-server-discovery.test.ts` | RFC 8414 discovery (mocked `fetch`), caching, validation |
| `middleware.test.ts` | Token extraction, scope enforcement, error handler, transport-agnostic utils |

**Mocking strategy:**
- Mock `jose` module for token validation tests (avoid real JWKS)
- Mock `globalThis.fetch` for discovery tests (avoid real network)
- Use `as never` casts for Express req/res in middleware tests

## Integration Checklist

When adding OAuth to a new MCP server:

- [ ] Create `src/auth/` directory with all 11 files
- [ ] Add `jose` to dependencies (or verify it's a transitive dep of `@modelcontextprotocol/sdk`)
- [ ] Define server-specific `TOOL_GROUP_SCOPES` in `scopes.ts`
- [ ] Build `scope-map.ts` from your server's `TOOL_GROUPS`
- [ ] Add 5 OAuth CLI flags to `cli.ts` with env var fallbacks
- [ ] Add OAuth fields to `HttpTransportConfig` and `ServerOptions`
- [ ] Wire OAuth middleware into `server.ts` with conditional enablement
- [ ] Register `/.well-known/oauth-protected-resource` endpoint
- [ ] Write 8 test files in `src/auth/__tests__/`
- [ ] Update README, DOCKER_README, wiki (Security + HTTP-Transport)
- [ ] Add CHANGELOG entry

## Documentation Updates

When adding OAuth, update these documentation sections:

| Doc | Updates Needed |
|-----|---------------|
| **README.md** | Add OAuth well-known to endpoint table, OAuth to security features, OAuth env vars, dedicated OAuth 2.1 section (compliance table + scopes + quick start) |
| **DOCKER_README.md** | Same endpoint table, security features, env vars, Docker run example with `-e OAUTH_*` |
| **Wiki/Security.md** | Full OAuth section (enabling, how it works, fallback), update access control levels, add to self-audit checklist |
| **Wiki/HTTP-Transport.md** | OAuth endpoint in table, 5 OAuth CLI flags in configuration reference |
| **CHANGELOG.md** | OAuth 2.1 module entry under `[Unreleased]` |
