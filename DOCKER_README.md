# Memory Journal MCP Server

Last Updated October 28, 2025 - Production/Stable v2.0.0

[![GitHub](https://img.shields.io/badge/GitHub-neverinfamous/memory--journal--mcp-blue?logo=github)](https://github.com/neverinfamous/memory-journal-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/writenotenow/memory-journal-mcp)](https://hub.docker.com/r/writenotenow/memory-journal-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
![Version](https://img.shields.io/badge/version-v2.0.0-green)
![Status](https://img.shields.io/badge/status-Production%2FStable-brightgreen)
[![PyPI](https://img.shields.io/pypi/v/memory-journal-mcp)](https://pypi.org/project/memory-journal-mcp/)
[![Security](https://img.shields.io/badge/Security-Enhanced-green.svg)](https://github.com/neverinfamous/memory-journal-mcp/blob/main/SECURITY.md)
[![GitHub Stars](https://img.shields.io/github/stars/neverinfamous/memory-journal-mcp?style=social)](https://github.com/neverinfamous/memory-journal-mcp)
[![Type Safety](https://img.shields.io/badge/Pyright-Strict-blue.svg)](https://github.com/neverinfamous/memory-journal-mcp)

**Project context management for AI-assisted development - Maintain continuity across fragmented AI threads with persistent knowledge graphs and intelligent context recall**

🎯 **Solve the AI Context Problem:** Bridge the gap between disconnected AI sessions. Memory Journal provides persistent project memory, enabling AI to access your complete development history, past decisions, and work patterns across any thread or timeframe.

**🚀 Multiple Deployment Options:**
- **[Docker Hub](https://hub.docker.com/r/writenotenow/memory-journal-mcp)** - Alpine-based (~225MB) multi-platform support
- **[PyPI Package](https://pypi.org/project/memory-journal-mcp/)** - Simple `pip install` for local deployment
- **[MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.neverinfamous/memory-journal-mcp)** - Discoverable by MCP clients

**📚 Documentation:** [Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki) • [v2.0.0 Release](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v2.0.0)

**📰 [Read the v2.0.0 Release Article](https://adamic.tech/articles/2025-10-28-memory-journal-mcp-v2-0-0)** - Learn about knowledge graphs, performance optimizations, and relationship mapping

---

## 🎯 What This Does

**Solve the AI Context Problem:** When working with AI across multiple threads, context is lost. Memory Journal provides persistent project memory - every AI conversation can access your complete development history, past decisions, and work patterns.

### Key Benefits
- 📝 **Auto-capture Git/GitHub context** (commits, branches, issues, PRs, projects)
- 🔗 **Build knowledge graphs** linking specs → implementations → tests → PRs  
- 🔍 **Triple search** (full-text, semantic, date range)
- 📊 **Generate reports** (standups, retrospectives, PR summaries, status)

---

## ✨ v2.0.0 Highlights (October 28, 2025)

### **16 MCP Tools • 13 Workflow Prompts • 8 Resources**
- **16 MCP tools** - Complete development workflow from entry creation to export
- **13 workflow prompts** - Including PR workflow prompts (`pr-summary`, `code-review-prep`, `pr-retrospective`)
- **8 MCP resources** - Including issue/PR resources (issue entries, PR entries, PR timelines)
- **GitHub Integration** - Projects, Issues, and Pull Requests with auto-linking
- **Smart caching system** - GitHub API response caching (15min issues, 5min PRs, 1hr projects)
- **Enhanced analytics** - Project breakdown, issue/PR tracking, cross-project insights
- **Backward compatible** - Seamless upgrade with automatic schema migration
- **10x faster startup** - Lazy ML loading (14s → 2-3s)
- **Knowledge graphs** - 5 relationship types, Mermaid diagram visualization

---

## 🚀 Quick Start (2 Minutes)

### 1. Pull the Image

```bash
docker pull writenotenow/memory-journal-mcp:latest
```

### 2. Create Data Directory

```bash
mkdir data
```

### 3. Add to MCP Config

Add this to your `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "memory-journal-mcp": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "./data:/app/data",
        "writenotenow/memory-journal-mcp:latest",
        "python", "src/server.py"
      ]
    }
  }
}
```

### 4. Restart & Journal!

Restart Cursor or your MCP client and start journaling!

---

## ⚡ **Install to Cursor IDE**

### **One-Click Installation**

Click the button below to install directly into Cursor:

[![Install to Cursor](https://img.shields.io/badge/Install%20to%20Cursor-Click%20Here-blue?style=for-the-badge)](cursor://anysphere.cursor-deeplink/mcp/install?name=Memory%20Journal%20MCP&config=eyJtZW1vcnktam91cm5hbCI6eyJhcmdzIjpbInJ1biIsIi0tcm0iLCItaSIsIi12IiwiLi9kYXRhOi9hcHAvZGF0YSIsIndyaXRlbm90ZW5vdy9tZW1vcnktam91cm5hbC1tY3A6bGF0ZXN0IiwicHl0aG9uIiwic3JjL3NlcnZlci5weSJdLCJjb21tYW5kIjoiZG9ja2VyIn19)

Or copy this deep link:
```
cursor://anysphere.cursor-deeplink/mcp/install?name=Memory%20Journal%20MCP&config=eyJtZW1vcnktam91cm5hbCI6eyJhcmdzIjpbInJ1biIsIi0tcm0iLCItaSIsIi12IiwiLi9kYXRhOi9hcHAvZGF0YSIsIndyaXRlbm90ZW5vdy9tZW1vcnktam91cm5hbC1tY3A6bGF0ZXN0IiwicHl0aG9uIiwic3JjL3NlcnZlci5weSJdLCJjb21tYW5kIjoiZG9ja2VyIn19
```

### **Prerequisites**
- ✅ Docker installed and running
- ✅ ~500MB disk space available

**📖 [See Full Installation Guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Installation)**

---

## 🛡️ Supply Chain Security

For enhanced security and reproducible builds, use SHA-pinned images:

**Find SHA tags:** https://hub.docker.com/r/writenotenow/memory-journal-mcp/tags

**Option 1: Multi-arch manifest (recommended)**
```bash
docker pull writenotenow/memory-journal-mcp:sha256-<manifest-digest>
```

**Option 2: Direct digest (maximum security)**
```bash
docker pull writenotenow/memory-journal-mcp@sha256:<manifest-digest>
```

**Security Features:**
- ✅ **Build Provenance** - Cryptographic proof of build process
- ✅ **SBOM Available** - Complete software bill of materials
- ✅ **Supply Chain Attestations** - Verifiable build integrity
- ✅ **Non-root Execution** - Minimal attack surface

---

## ⚡ Core Features

### 🛠️ 16 MCP Tools
Entry management • Full-text/semantic/date search • Knowledge graphs • Analytics • Export  
**[Complete tools documentation →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tools)**

### 🎯 13 Workflow Prompts
Standups • Retrospectives • Weekly digests • PR summaries • Code review prep • Goal tracking  
**[Complete prompts guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Prompts)**

### 🔄 Git & GitHub Auto-Context
Every entry captures: repo, branch, commit, issues, PRs, projects (user & org)  
**[Git integration details →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Git-Integration)**

---

## 📖 Quick Examples

```javascript
// Create entry with auto-context
create_entry({
  content: "Implemented lazy ML loading",
  tags: ["performance"]
})

// Search entries
search_entries({ query: "performance" })

// Access MCP resources
memory://recent                  // Recent entries
memory://projects/1/timeline     // Project timeline
memory://prs/456/timeline        // PR + journal timeline
```

**Ask Cursor AI naturally:**
- "Show me my recent journal entries"
- "Prepare my standup for today"
- "Find entries related to performance"

**[See complete examples & prompts →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Examples)**

---

## 🔧 Configuration

### Optional Environment Variables

```bash
# GitHub integration (optional - enables Projects/Issues/PRs)
-e GITHUB_TOKEN=your_token
-e GITHUB_ORG_TOKEN=your_org_token  # For org projects
-e DEFAULT_ORG=your-org-name

# Other options
-e DEBUG=true                       # Enable debug logging
-e DB_PATH=/app/data/custom.db      # Custom database location
```

**Token Scopes:** `repo`, `project`, `read:org` (org projects only)  
**Fallback:** Uses GitHub CLI (`gh`) if tokens not set, works without tokens (features gracefully disabled)  
**[Full configuration guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Installation#configuration)**

---

## 📦 Image Details

| Platform | Size | Features | Startup Time |
|----------|------|----------|--------------|
| **AMD64** (x86_64) | 231MB | Complete: journaling, FTS5, semantic search, Git context, PyTorch ML, relationship graphs, knowledge graph visualization | ~2-3 seconds |
| **ARM64** (Apple Silicon) | 207MB | Core: journaling, FTS5 search, Git context, relationship graphs, knowledge graph visualization (semantic search unavailable) | ~2-3 seconds |

**Production-Ready Image:**
- **Python 3.13.x on Alpine Linux** - Latest Python with minimal attack surface (225MB avg vs 500MB+ for Ubuntu)
- **Multi-Platform Support** - AMD64 with full ML, ARM64 with core features
- **ML Capabilities (AMD64)** - PyTorch + sentence-transformers + FAISS
- **Graceful Degradation (ARM64)** - Core features work without ML dependencies
- **10x Faster Startup** - Lazy loading reduces init from 14s → 2-3s
- **Production/Stable** - Comprehensive error handling and automatic migrations
- **Zero Race Conditions** - Thread-safe tag creation and single-connection transactions
- **Latest Python Features** - PEP 779 (free-threaded), PEP 649 (deferred annotations), enhanced performance

**Automated Deployment:**
- ⚡ **Always Fresh** - Images built within 5-10 minutes of commits
- 🔒 **Security Scanned** - Automatic vulnerability scanning
- 🌍 **Multi-Platform** - Intel (amd64) and Apple Silicon (arm64)
- ✅ **Quality Tested** - Automated testing before deployment
- 📋 **SBOM Available** - Complete software bill of materials
- 🔐 **Build Provenance** - Cryptographic proof of build process

**Note:** ARM64 images don't include semantic search due to PyTorch Alpine incompatibility. All other features (FTS5 search, relationships, Git integration, visualization) work identically on both platforms.

**Available Tags:**
- `2.0.0` - Specific version (recommended for production)
- `2.0` - Latest patch in 2.0.x series
- `2` - Latest minor in 2.x series
- `latest` - Always the newest version
- `sha256-<digest>` - SHA-pinned for maximum security

---

## 🏗️ Build from Source

**Step 1: Clone the repository**

```bash
git clone https://github.com/neverinfamous/memory-journal-mcp.git
cd memory-journal-mcp
```

**Step 2: Build the Docker image**

```bash
docker build -f Dockerfile -t memory-journal-mcp-local .
```

**Step 3: Add to MCP config**

Update your `~/.cursor/mcp.json` to use the local build:

```json
{
  "mcpServers": {
    "memory-journal-mcp": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "./data:/app/data",
        "memory-journal-mcp-local",
        "python", "src/server.py"
      ]
    }
  }
}
```

---

## 📚 Documentation & Resources

- **[GitHub Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki)** - Complete documentation
- **[Practical Examples Gists](https://gist.github.com/neverinfamous/ffedec3bdb5da08376a381733b80c1a7)** - 7 curated use cases
- **[PyPI Package](https://pypi.org/project/memory-journal-mcp/)** - Python distribution
- **[Issues](https://github.com/neverinfamous/memory-journal-mcp/issues)** - Bug reports & feature requests

---

## 📄 License

MIT License - See [LICENSE](https://github.com/neverinfamous/memory-journal-mcp/blob/main/LICENSE)

---

**Built by developers, for developers.** PRs welcome! 🚀
