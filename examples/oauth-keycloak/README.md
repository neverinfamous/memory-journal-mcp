# Keycloak OAuth 2.1 Local Development Guide

Run `memory-journal-mcp` over HTTP/SSE with full OAuth 2.1 JWT/JWKS validation backed by **Keycloak 26.4.7**.

> [!WARNING]
> This setup is for **local development only** (`start-dev`, plaintext loopback issuer, and a sample dev client secret). See the production hardening checklist at the bottom before exposing over a network.

---

## Included Files

- [`docker-compose.yml`](./docker-compose.yml) — Launches Keycloak 26.4.7 (`:8080`) with realm auto-import and `memory-journal-mcp` (`:3000`) sharing its loopback network namespace.
- [`realm-export.json`](./realm-export.json) — Pre-configured `mcp` realm defining all 6 canonical scopes (`read`, `write`, `team`, `audit`, `admin`, `full`), the confidential `memory-journal-client` service-account client, and an OIDC Audience Mapper setting `aud: "memory-journal-mcp"`.

---

## Option A: Docker Compose Quick Start (Recommended)

```bash
docker compose -f examples/oauth-keycloak/docker-compose.yml up -d
```

Wait until both `mj-keycloak-dev` (`9000/health/ready`) and `mj-mcp-oauth-dev` (`3000/health`) report `healthy`.

## Option B: Local Keycloak Binary + Host `memory-journal-mcp`

If you already run Keycloak 26.4.7 locally on the host:

```bash
# Terminal 1: Start Keycloak in dev mode importing realm-export.json
./bin/kc.sh start-dev --import-realm   # (or kc.bat start-dev --import-realm on Windows)

# Terminal 2: Start memory-journal-mcp on localhost with OAuth 2.1 enabled
ALLOWED_IO_ROOTS=/path/to/data \
OAUTH_ENABLED=true \
OAUTH_ISSUER=http://localhost:8080/realms/mcp \
OAUTH_AUDIENCE=memory-journal-mcp \
OAUTH_JWKS_URI=http://localhost:8080/realms/mcp/protocol/openid-connect/certs \
OAUTH_ALLOW_PLAINTEXT_LOOPBACK=true \
memory-journal-mcp --transport http --port 3000 --metrics-export prometheus
```

---

## Verify OAuth 2.1 Flows (`curl`)

### 1. Inspect RFC 9728 Protected Resource Metadata

```bash
curl -s http://localhost:3000/.well-known/oauth-protected-resource | jq .
```

Expected fields include `resource: "http://localhost:3000"`, `authorization_servers: ["http://localhost:8080/realms/mcp"]`, and `scopes_supported: ["read", "write", "admin", "full", "team", "audit"]`.

### 2. Fetch Scoped Access Tokens (`client_credentials`)

```bash
# Minimal read-only token (default client scope)
READ_TOKEN=$(curl -s -X POST http://localhost:8080/realms/mcp/protocol/openid-connect/token \
  -d 'grant_type=client_credentials' \
  -d 'client_id=memory-journal-client' \
  -d 'client_secret=dev-local-client-secret-replace-me' \
  -d 'scope=read' | jq -r '.access_token')

# Full administrative + audit + team token
FULL_TOKEN=$(curl -s -X POST http://localhost:8080/realms/mcp/protocol/openid-connect/token \
  -d 'grant_type=client_credentials' \
  -d 'client_id=memory-journal-client' \
  -d 'client_secret=dev-local-client-secret-replace-me' \
  -d 'scope=full' | jq -r '.access_token')
```

### 3. Call MCP Streamable HTTP (`POST /mcp`)

```bash
# Unauthenticated requests fail closed (401 + WWW-Authenticate)
curl -i http://localhost:3000/mcp

# Initialize session with OAuth Bearer token
SESSION_ID=$(curl -si -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $FULL_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl-oauth-test","version":"1.0"}}}' \
  | awk -F': ' 'tolower($1)=="mcp-session-id"{print $2}' | tr -d '\r')

# List tools inside the authenticated session
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $FULL_TOKEN" \
  -H "mcp-session-id: $SESSION_ID" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | jq '.result.tools | length'
```

### 4. Verify Fail-Closed Scope Enforcement on `/metrics`

When OAuth 2.1 is enabled without a static `MCP_AUTH_TOKEN`, `memory-journal-mcp` skips the standalone metrics port (`:9465`) fail-closed and serves Prometheus telemetry exclusively on the OAuth-protected `GET /metrics` route (requires `audit`, `admin`, or `full` scope):

```bash
# Fails closed with 403 Forbidden (read scope lacks audit)
curl -i -H "Authorization: Bearer $READ_TOKEN" http://localhost:3000/metrics

# Succeeds with 200 OK (full/audit scope accepted)
curl -s -H "Authorization: Bearer $FULL_TOKEN" http://localhost:3000/metrics | head -n 20
```

---

## Production Hardening Checklist

Before deploying outside localhost:

1. **Terminate TLS** in front of both Keycloak (`https://auth.example.com`) and `memory-journal-mcp` (`PUBLIC_ORIGIN=https://mcp.example.com`), and enable `MCP_ENABLE_HSTS=true` / `TRUST_PROXY=true`.
2. **Remove development loopback flags**: omit `--oauth-allow-plaintext-loopback` and `OAUTH_ALLOW_PLAINTEXT_LOOPBACK=true`. `TokenValidator` enforces HTTPS and origin equality between `OAUTH_ISSUER` and `OAUTH_JWKS_URI`.
3. **Run Keycloak in production mode** (`kc.sh start` backed by PostgreSQL) instead of `start-dev`.
4. **Rotate all credentials**: regenerate the `memory-journal-client` secret in Keycloak, change bootstrap admin credentials, and inject secrets via your secret manager.
5. **Least-privilege scopes**: issue client tokens with only the required scopes (`read`, `write`, `team`, `audit`) rather than `full`.
