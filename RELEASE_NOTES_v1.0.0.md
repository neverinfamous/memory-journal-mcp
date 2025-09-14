# 🚀 Memory Journal MCP Server v1.0.0 - Docker Hub Release

## 🎉 Major Milestone: Now Available on Docker Hub!

**Repository:** `writenotenow/memory-journal-mcp`

### 🐳 Docker Images Available

| Tag | Size | Features | Best For |
|-----|------|----------|----------|
| **`:lite`** | 116MB | Core journaling, FTS5 search, Git context | Most users, fast startup |
| **`:latest`** | 4.3GB | Everything + semantic search (ML models) | Advanced users, vector search |

### ⚡ 30-Second Setup

```bash
# Pull and run (no build needed!)
docker pull writenotenow/memory-journal-mcp:lite
mkdir data
docker run --rm -i -v ./data:/app/data writenotenow/memory-journal-mcp:lite python src/server.py
```

### ✨ What's New in v1.0.0

- **🚀 Docker Hub Publishing**: Instant deployment, no build required
- **🔧 Fixed Dependencies**: Resolved numpy import issue in lite version  
- **📚 Enhanced Documentation**: Clear setup guide with version comparison
- **🛡️ Production Ready**: Security hardened, performance optimized
- **⚡ Fast Startup**: Lite version starts in seconds vs minutes

### 🎯 Key Features

- **7 MCP Tools**: Complete journaling and search functionality
- **Git Integration**: Automatic context capture with GitHub issues
- **Full-Text Search**: SQLite FTS5 with result highlighting  
- **Semantic Search**: Vector similarity with sentence-transformers (full version)
- **Security**: WAL mode, input validation, non-root containers
- **Performance**: Thread pool execution, aggressive timeouts

### 🔧 Technical Improvements

- **Conditional Dependencies**: Smart numpy import handling
- **Docker Optimization**: Multi-stage builds, minimal base images
- **Error Handling**: Graceful degradation when dependencies unavailable
- **Documentation**: Comprehensive setup and troubleshooting guides

### 🚀 Migration Guide

**From Source Build:**
```bash
# Before: Build from source (5-15 minutes)
git clone repo && cd repo && docker build...

# Now: Pull from Docker Hub (30 seconds)
docker pull writenotenow/memory-journal-mcp:lite
```

**MCP Configuration:**
```json
{
  "mcpServers": {
    "memory-journal": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "-v", "./data:/app/data", "writenotenow/memory-journal-mcp:lite", "python", "src/server.py"]
    }
  }
}
```

### 🎯 What's Next

- Community submissions to MCP registries
- GitHub release automation
- Performance benchmarking
- Integration examples

---

**Ready for production use! 🎊**

Get started: `docker pull writenotenow/memory-journal-mcp:lite`