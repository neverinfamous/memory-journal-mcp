# 🔒 Security Guide

The Memory Journal MCP server implements comprehensive security measures to protect your personal journal data.

## 🛡️ **Database Security**

### **sql.js In-Memory Architecture**

The server uses **sql.js** (pure JavaScript SQLite compiled to WebAssembly) which operates on an in-memory database copy with periodic flushing to disk. This differs from native SQLite:

- ✅ **PRAGMA foreign_keys = ON** — enforces referential integrity and `ON DELETE CASCADE`
- ✅ **Parameterized queries** — all user input bound via `?` placeholders
- ✅ **Debounced disk writes** — periodic flushing with immediate flush on critical operations
- ⚠️ WAL mode, mmap, busy_timeout, and other file-level PRAGMAs are **not applicable** to sql.js

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
- ✅ **LIKE pattern sanitization** (escapes `%`, `_`, `\` wildcards)
- ✅ **Date format whitelisting** (prevents strftime injection)

### **Path Traversal Protection**

- ✅ **Backup filenames validated** - rejects `/`, `\`, `..` in paths
- ✅ **Typed security errors** with consistent error codes

## 🌐 **HTTP Transport Security**

When running in HTTP mode (`--transport http`), the following security measures apply:

### **CORS Configuration**

- ✅ **Configurable origin** via `--cors-origin` flag or `MCP_CORS_ORIGIN` environment variable
- ⚠️ **Default: `*`** (allow all origins) for backward compatibility
- 🔒 **Recommended**: Set a specific origin for production deployments

```bash
# Restrict CORS to specific origin
memory-journal-mcp --transport http --cors-origin "http://localhost:3000"

# Or via environment variable
export MCP_CORS_ORIGIN="http://localhost:3000"
```

### **Security Headers**

- ✅ **X-Content-Type-Options: nosniff** — prevents MIME sniffing
- ✅ **X-Frame-Options: DENY** — prevents clickjacking
- ✅ **Content-Security-Policy: default-src 'none'; frame-ancestors 'none'** — prevents XSS and framing
- ✅ **Cache-Control: no-store** — prevents caching of sensitive journal data
- ✅ **Referrer-Policy: no-referrer** — prevents referrer leakage
- ⚠️ **CORS wildcard warning** — server logs a warning when CORS origin is `*`

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
GITHUB_REPO_PATH=/path/to/repo  # For auto-detecting owner/repo
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
- [x] LIKE pattern sanitization (`sanitizeSearchQuery`)
- [x] Date format whitelisting (`validateDateFormatPattern`)
- [x] HTTP body size limit (1MB)
- [x] Configurable CORS origin (with wildcard warning)
- [x] Security headers (CSP, X-Content-Type-Options, X-Frame-Options, Cache-Control, Referrer-Policy)
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
