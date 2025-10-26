# Memory Journal MCP v1.2.1 - Patch Release

*Released: October 26, 2025*

## 🐛 Bug Fixes

### Semantic Search Initialization Fixed
Resolved a critical issue where semantic search could hang or timeout on first use after server restart.

**What was fixed:**
- **Async/lazy loading race condition** - ML dependency imports now happen at module-level during server startup instead of during first semantic_search call
- **Lock deadlock** - Eliminated async lock acquisition issues that caused 30+ second hangs
- **Thread pool contention** - Increased worker count from 2 to 4 for better concurrent operation handling

**User impact:**
- ✅ First semantic_search call now completes in <1 second (was: could timeout after 30+ seconds)
- ✅ No more need to cancel and retry
- ✅ Reliable semantic search on every server restart

### Performance Improvements
- Enhanced initialization with step-by-step progress messages
- Added explicit stderr flushing for real-time feedback
- Optimized thread pool for ML model loading

---

## 📦 Installation

This is a patch release that maintains full compatibility with v1.2.0. Upgrade is seamless:

**PyPI:**
```bash
pip install --upgrade memory-journal-mcp
```

**Docker:**
```bash
docker pull writenotenow/memory-journal-mcp:latest
```

---

## 🔄 Upgrading from v1.2.0

No breaking changes! Simply:
1. Update the package
2. Restart your MCP client
3. Semantic search will now work reliably on first use

---

## 📝 Technical Details

**Root Cause:**
The lazy loading pattern introduced in v1.1.0 (for 10x faster startup) had an edge case where async imports of ML dependencies (sentence-transformers, faiss) could deadlock during concurrent initialization attempts.

**Solution:**
- Moved ML dependency imports to module-level (happens once at server startup)
- Preserved fast startup time (imports are still lazy, just earlier in the lifecycle)
- Eliminates all async/await complexity from import logic

**Testing:**
- Semantic search verified working on first call after restart
- No regression in startup performance
- All 16 MCP tools tested and operational

---

## 🔗 Full v1.2.0 Feature Set

This patch release maintains all v1.2.0 features:

### Phase 3: Organization Support
- Organization-level GitHub Projects integration
- Automatic user vs org detection
- Dual token support for org permissions
- Cross-org project analytics

### Phase 2: Advanced Analytics  
- Cross-project insights
- Project status summaries
- Milestone tracking
- Smart API caching (80%+ reduction)

### Phase 1: GitHub Projects
- Entry-project linking
- Project filtering and search
- Automatic project detection
- Context bundle integration

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

---

## 🎯 What's Next

v1.2.1 completes the stability work for the v1.2.0 feature set. Future releases will focus on:
- Enhanced visualization options
- Import/export improvements
- Additional integration capabilities

---

**Full Changelog:** [CHANGELOG.md](CHANGELOG.md)

**Compare:** https://github.com/neverinfamous/memory-journal-mcp/compare/v1.2.0...v1.2.1
