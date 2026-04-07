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

### **Content Limits**

- **Journal entries**: 50,000 characters maximum
- **Tags**: 100 characters maximum
- **Entry types**: 50 characters maximum
- **Significance types**: 50 characters maximum
- **HTTP request body**: 1MB maximum (prevents memory exhaustion)

### **Character Handling**

Tags are stored as-is via parameterized queries. Special characters in tags
are safely handled by the database layer and do not pose injection risks.

### **SQL Injection Prevention**

- ✅ **Parameterized queries** used throughout
- ✅ **Input validation** via Zod schemas before database operations
- ✅ **Warning system** for potentially dangerous content patterns
- ✅ **FTS5 / LIKE pattern sanitization** (escapes `%`, `_`, `\` wildcards and handles FTS5 syntax errors gracefully)
- ✅ **Date format whitelisting** (prevents strftime injection)

### **Path Traversal Protection**

- ✅ **Backup filenames validated** - rejects `/`, `\`, `..` in paths
- ✅ **Typed security errors** with consistent error codes

## 🌐 **HTTP Transport Security**

When running in HTTP mode (`--transport http`), the following security measures apply:

### **CORS Configuration**

- ✅ **Configurable multiple origins** via comma-separated `--cors-origin` flag or `MCP_CORS_ORIGIN` environment variable
- ✅ **Exact-match verification** (no wildcard matching for custom domains)
- ⚠️ **Default: `*`** (allow all origins) for backward compatibility
- 🔒 **Recommended**: Set specific origins for production deployments

```bash
# Restrict CORS to specific origins
memory-journal-mcp --transport http --cors-origin "http://localhost:3000,https://my-app.com"

# Or via environment variable
export MCP_CORS_ORIGIN="http://localhost:3000,https://my-app.com"
```

### **Security Headers & Protections**

- ✅ **DNS Rebinding Protection** — `hostHeaderValidation` middleware prevents CVE-2025-66414
- ✅ **Strict-Transport-Security (HSTS)** — max-age=31536000; includeSubDomains (opt-in via `--enable-hsts`)
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
- ✅ **30-minute session timeout** - idle sessions automatically expired
- ✅ **5-minute sweep interval** - periodic cleanup of abandoned sessions
- ✅ **Explicit session termination** via `DELETE /mcp`

### **Request Size Limits**

- ✅ **1MB body limit** on JSON requests (prevents memory exhaustion DoS)

## 🐙 **GitHub Token Security**

### **Token Handling**

- ✅ **Environment variables only** - tokens never stored in config files
- ✅ **Error message scrubbing** - Authorization headers stripped from error logs
- ✅ **Optional integration** - server works fully offline without GitHub token
- ✅ **Minimal scopes** - only requires `repo`, `project`, `read:org`

### **Environment Variables**

```bash
# Required for GitHub features
GITHUB_TOKEN=ghp_...            # GitHub personal access token

# Optional
GITHUB_ORG_TOKEN=ghp_...        # For organization projects
PROJECT_REGISTRY='{"my-repo":{"path":"/path/to/repo","project_number":1}}'  # Multi-project routing
DEFAULT_PROJECT_NUMBER=1         # Default project for issue assignment
MCP_CORS_ORIGIN=*               # CORS origin (default: *)
MCP_HOST=localhost               # Server bind host
AUTO_REBUILD_INDEX=true          # Rebuild vector index on startup
```

## 🐳 **Docker Security**

### **Non-Root User**

- ✅ **Dedicated user**: `appuser` (UID 1001) with minimal privileges
- ✅ **Restricted group**: `appgroup` (GID 1001)
- ✅ **Restricted data directory**: `700` permissions

### **Container Hardening**

- ✅ **Minimal base image**: `node:24-alpine`
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

## 🔍 **Data Privacy**

### **Local-First Architecture**

- ✅ **No external services**: All processing happens locally
- ✅ **No telemetry**: No data sent to external servers
- ✅ **Full data ownership**: SQLite database stays on your machine
- ✅ **Semantic search**: ML model runs locally via `@huggingface/transformers`

### **Context Security**

- ✅ **Git context**: Only reads local repository information
- ✅ **No sensitive data**: Doesn't access private keys or credentials
- ✅ **Optional GitHub integration**: Only if explicitly configured with token

## 🔄 **CI/CD Security**

- ✅ **CodeQL analysis** - automated static analysis on push/PR
- ✅ **Trivy container scanning** - Docker image vulnerability detection
- ✅ **TruffleHog + Gitleaks** - secret scanning on push/PR
- ✅ **npm audit** - dependency vulnerability checking
- ✅ **Dependabot** - automated dependency update PRs

## 🚨 **Security Best Practices**

### **For Users**

1. **Set a CORS origin** when exposing the HTTP transport on a network
2. **Keep Node.js updated**: Use Node.js 24+ (LTS)
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

- [x] Foreign key enforcement (`PRAGMA foreign_keys = ON`)
- [x] Input validation and length limits (Zod schemas)
- [x] Parameterized SQL queries
- [x] SQL injection detection heuristics (defense-in-depth)
- [x] Path traversal protection (`assertNoPathTraversal`)
- [x] FTS5 / LIKE pattern sanitization (`sanitizeSearchQuery`)
- [x] Date format whitelisting (`validateDateFormatPattern`)
- [x] HTTP body size limit (1MB)
- [x] Configurable CORS multi-origin with exact-match enforcement
- [x] HTTP timeouts and built-in rate limiter (100 req/min)
- [x] DNS rebinding protection and strict HSTS
- [x] Security headers (CSP, X-Content-Type-Options, X-Frame-Options, Cache-Control, Referrer-Policy, Permissions-Policy)
- [x] Session timeout (30 minutes)
- [x] Non-root Docker user
- [x] Multi-stage Docker build
- [x] Local-first data architecture
- [x] GitHub token error scrubbing
- [x] CI/CD security pipeline (CodeQL, Trivy, secret scanning)
- [x] Comprehensive security documentation

## 🚨 **Reporting Security Issues**

If you discover a security vulnerability, please:

1. **Do not** open a public GitHub issue
2. **Contact** the maintainers privately
3. **Provide** detailed information about the vulnerability
4. **Allow** time for the issue to be addressed before public disclosure

## 🔄 **Security Updates**

- **Container updates**: Rebuild Docker images when base images are updated
- **Dependency updates**: Keep npm packages updated via `npm audit` and Dependabot
- **Database maintenance**: Run `ANALYZE` and `PRAGMA optimize` regularly
- **Security patches**: Apply host system security updates

The Memory Journal MCP server is designed with **security-first principles** to protect your personal journal data while maintaining excellent performance and usability.
