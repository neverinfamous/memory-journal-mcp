# 🔒 Security Guide

The Memory Journal MCP server implements comprehensive security measures to protect your personal journal data.

## 🛡️ **Database Security**

### **WAL Mode Enabled**
- ✅ **Write-Ahead Logging (WAL)** enabled for better concurrency and crash recovery
- ✅ **Atomic transactions** ensure data consistency
- ✅ **Better performance** with concurrent read/write operations

### **Optimized PRAGMA Settings**
```sql
PRAGMA foreign_keys = ON          -- Enforce referential integrity
PRAGMA journal_mode = WAL         -- Enable WAL mode
PRAGMA synchronous = NORMAL       -- Balance safety and performance
PRAGMA cache_size = -64000        -- 64MB cache for better performance
PRAGMA mmap_size = 268435456      -- 256MB memory-mapped I/O
PRAGMA temp_store = MEMORY        -- Store temp tables in memory
PRAGMA busy_timeout = 30000       -- 30-second timeout for busy database
```

### **File Permissions**
- ✅ **Database files**: `600` (read/write for owner only)
- ✅ **Data directory**: `700` (full access for owner only)
- ✅ **Automatic permission setting** on database creation

## 🔐 **Input Validation**

### **Content Limits**
- **Journal entries**: 50,000 characters maximum
- **Tags**: 100 characters maximum
- **Entry types**: 50 characters maximum
- **Significance types**: 50 characters maximum

### **Character Filtering**
Dangerous characters are blocked in tags:
- `<` `>` `"` `'` `&` `\x00`

### **SQL Injection Prevention**
- ✅ **Parameterized queries** used throughout
- ✅ **Input validation** before database operations
- ✅ **Warning system** for potentially dangerous content patterns

## 🐳 **Docker Security**

### **Non-Root User**
- ✅ **Dedicated user**: `appuser` with minimal privileges
- ✅ **No shell access**: `/bin/false` shell for security
- ✅ **Restricted home directory**: `/app/user`

### **File System Security**
- ✅ **Minimal base image**: `python:3.11-slim`
- ✅ **Restricted data directory**: `700` permissions
- ✅ **Volume mounting**: Data persists outside container

### **Container Isolation**
- ✅ **Process isolation** from host system
- ✅ **Network isolation** (no external network access needed)
- ✅ **Resource limits** can be applied via Docker

## 🔍 **Data Privacy**

### **Local-First Architecture**
- ✅ **No external services**: All processing happens locally
- ✅ **No telemetry**: No data sent to external servers
- ✅ **Full data ownership**: SQLite database stays on your machine

### **Context Bundle Security**
- ✅ **Git context**: Only reads local repository information
- ✅ **No sensitive data**: Doesn't access private keys or credentials
- ✅ **Optional GitHub integration**: Only if explicitly configured

## 🚨 **Security Best Practices**

### **For Users**
1. **Keep Docker updated**: Regularly update Docker and base images
2. **Secure host system**: Ensure your host machine is secure
3. **Regular backups**: Back up your `data/` directory
4. **Monitor logs**: Check container logs for any unusual activity
5. **Limit access**: Don't expose the container to external networks

### **For Developers**
1. **Regular updates**: Keep Python and dependencies updated
2. **Security scanning**: Regularly scan Docker images for vulnerabilities
3. **Code review**: All database operations use parameterized queries
4. **Input validation**: All user inputs are validated before processing

## 🔧 **Security Configuration**

### **Environment Variables**
```bash
# Database location (should be on secure volume)
DB_PATH=/app/data/memory_journal.db

# Python path for module resolution
PYTHONPATH=/app
```

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

## 📋 **Security Checklist**

- [x] WAL mode enabled for database consistency
- [x] Proper file permissions (600/700)
- [x] Input validation and length limits
- [x] Parameterized SQL queries
- [x] Non-root Docker user
- [x] Minimal container attack surface
- [x] Local-first data architecture
- [x] No external network dependencies
- [x] Comprehensive error handling
- [x] Security documentation

## 🚨 **Reporting Security Issues**

If you discover a security vulnerability, please:

1. **Do not** open a public GitHub issue
2. **Contact** the maintainers privately
3. **Provide** detailed information about the vulnerability
4. **Allow** time for the issue to be addressed before public disclosure

## 🔄 **Security Updates**

- **Database maintenance**: Run `ANALYZE` and `PRAGMA optimize` regularly
- **Container updates**: Rebuild Docker images when base images are updated
- **Dependency updates**: Keep Python packages updated
- **Security patches**: Apply host system security updates

### **Recent Security Fixes**

#### **CVE-2025-8869: pip Symbolic Link Vulnerability** (Fixed: October 20, 2025)
- **Issue**: pip missing checks on symbolic link extraction in fallback tar implementation (when Python doesn't implement PEP 706)
- **Severity**: MEDIUM
- **Affected Package**: pip <25.0 (with Python versions without PEP 706 support)
- **Comprehensive Mitigations**:
  - ✅ **Python Version**: Minimum requirement bumped to 3.10.12+ (all versions ≥3.10.12 implement PEP 706)
  - ✅ **pip Upgrade**: Explicitly upgrading to pip>=25.0 in all build processes (CI, Docker, local)
  - ✅ **Docker Base Image**: Using Python 3.14-alpine which fully implements PEP 706
  - ✅ **CI/CD Pipelines**: Updated to test against minimum Python 3.10.12
  - ✅ **pyproject.toml**: Enforced minimum Python version requirement
- **Technical Details**: 
  - PEP 706 provides secure tar extraction with symlink validation
  - When Python implements PEP 706, pip uses the secure implementation
  - Otherwise, pip falls back to its own implementation which had the vulnerability
  - Our fix addresses both the pip version and underlying Python version
- **Verification**: Run `pip --version` to confirm pip>=25.0
- **Impact**: Prevents potential exploitation during package installation via tar extraction
- **Reference**: [CVE-2025-8869](https://nvd.nist.gov/vuln/detail/CVE-2025-8869) | [PEP 706](https://peps.python.org/pep-0706/)

The Memory Journal MCP server is designed with **security-first principles** to protect your personal journal data while maintaining excellent performance and usability.
