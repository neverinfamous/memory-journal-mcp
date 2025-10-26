# Memory Journal MCP v1.2.2 - Security Patch

*Released: October 26, 2025*

## 🔒 Security Fixes

### URL Parsing Vulnerability Fixed (CodeQL #110, #111)
Resolved incomplete URL substring sanitization in GitHub remote URL parsing that could allow URL spoofing attacks.

**What was fixed:**
- **Improper URL validation** - Replaced unsafe substring checks (`'github.com' in url`) with proper `urllib.parse.urlparse()` validation
- **Hostname verification** - Implemented exact hostname matching (`parsed.hostname == 'github.com'`) to prevent bypasses
- **SSH URL validation** - Added explicit prefix validation for SSH format (`git@github.com:`)

**Security impact:**
- ✅ Prevents URL spoofing attacks like `http://evil.com/github.com/fake/repo`
- ✅ Blocks subdomain bypasses like `http://github.com.evil.com/fake/repo`
- ✅ Ensures only legitimate GitHub URLs are processed
- ✅ Maintains full backward compatibility with existing functionality

**Vulnerability details:**
- **CWE-20:** Improper Input Validation
- **Severity:** Medium (limited to Git remote URL parsing in local repositories)
- **Attack vector:** Would require attacker to manipulate Git config files
- **CodeQL Rule:** `py/incomplete-url-substring-sanitization`

---

## 🛡️ What Changed

### Before (Vulnerable)
```python
if 'github.com' in remote_url:  # ❌ Unsafe substring check
    if remote_url.startswith('git@github.com:'):
        parts = remote_url.replace('git@github.com:', '').replace('.git', '').split('/')
    elif 'github.com/' in remote_url:  # ❌ Also unsafe
        parts = remote_url.split('github.com/')[1].replace('.git', '').split('/')
```

### After (Secure)
```python
# SSH format with explicit prefix validation
if remote_url.startswith('git@github.com:'):  # ✅ Explicit prefix check
    path_part = remote_url.split('git@github.com:', 1)[1]
    path_part = path_part.replace('.git', '').strip('/')
    # ... secure parsing ...

# HTTPS format with proper URL parsing
parsed = urlparse(remote_url)
if parsed.hostname == 'github.com':  # ✅ Exact hostname match
    path = parsed.path.strip('/').replace('.git', '')
    # ... secure parsing ...
```

---

## 📦 Installation

This is a security patch that maintains full compatibility with v1.2.x. Upgrade is seamless:

**PyPI:**
```bash
pip install --upgrade memory-journal-mcp
```

**Docker:**
```bash
docker pull writenotenow/memory-journal-mcp:latest
# Or specific version
docker pull writenotenow/memory-journal-mcp:v1.2.2
```

---

## 🔄 Upgrading from v1.2.0 / v1.2.1

No breaking changes! Simply:
1. Update the package
2. Restart your MCP client
3. URL parsing is now secure

---

## 📝 Technical Details

**Root Cause:**
The code used unsafe substring checks to validate GitHub hostnames in Git remote URLs. This pattern is vulnerable to URL spoofing where malicious URLs can embed the trusted hostname in unexpected locations.

**Solution:**
- Import `urllib.parse.urlparse` for proper URL parsing
- Validate SSH URLs with explicit `startswith()` check
- Validate HTTPS/HTTP URLs with `urlparse()` and exact `hostname` comparison
- Return `None` for any non-GitHub URLs (defense in depth)

**Testing:**
- Verified parsing of legitimate SSH URLs: `git@github.com:user/repo.git`
- Verified parsing of legitimate HTTPS URLs: `https://github.com/user/repo.git`
- Confirmed malicious URLs are rejected: `http://evil.com/github.com/fake`
- All 16 MCP tools tested and operational

**References:**
- [OWASP: SSRF](https://owasp.org/www-community/attacks/Server_Side_Request_Forgery)
- [CWE-20: Improper Input Validation](https://cwe.mitre.org/data/definitions/20.html)
- [CodeQL Rule Documentation](https://codeql.github.com/codeql-query-help/python/py-incomplete-url-substring-sanitization/)

---

## 🔗 Full v1.2.x Feature Set

This security patch maintains all v1.2.x features:

### Phase 3: Organization Support (v1.2.0)
- Organization-level GitHub Projects integration
- Automatic user vs org detection
- Dual token support for org permissions
- Cross-org project analytics

### Phase 2: Advanced Analytics (v1.2.0)
- Cross-project insights
- Project status summaries
- Milestone tracking
- Smart API caching (80%+ reduction)

### Phase 1: GitHub Projects (v1.2.0)
- Entry-project linking
- Project filtering and search
- Automatic project detection
- Context bundle integration

### Bug Fixes (v1.2.1)
- Semantic search initialization fixed
- No more first-call timeouts
- Enhanced thread pool (4 workers)

### Core Features (v1.1.x)
- 16 MCP tools (all operational)
- 10 workflow prompts
- 4 MCP resources
- Knowledge graphs with relationships
- Visual Mermaid diagrams
- Triple search (FTS5, semantic, date range)
- Git/GitHub integration

---

## 📚 Documentation

- **Wiki:** https://github.com/neverinfamous/memory-journal-mcp/wiki
- **GitHub:** https://github.com/neverinfamous/memory-journal-mcp
- **PyPI:** https://pypi.org/project/memory-journal-mcp/
- **Docker Hub:** https://hub.docker.com/r/writenotenow/memory-journal-mcp
- **Security Policy:** [SECURITY.md](SECURITY.md)

---

## 🎯 What's Next

v1.2.2 completes the security hardening for the v1.2.x series. Future releases will focus on:
- Enhanced visualization options
- Import/export improvements
- Additional integration capabilities

---

**Full Changelog:** [CHANGELOG.md](CHANGELOG.md)

**Compare:** https://github.com/neverinfamous/memory-journal-mcp/compare/v1.2.1...v1.2.2
