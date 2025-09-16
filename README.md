# 🛠️ Memory Journal MCP Server

* Last Updated September 16, 2025 4:45 PM EST *

*A developer's project journal and context manager*

**🚀 Multiple Deployment Options:**
- **[Docker Hub](https://hub.docker.com/r/writenotenow/memory-journal-mcp)** - Alpine-based (225MB) with full semantic search
- **[Cloudflare Workers](https://memory-journal-mcp-remote.writenotenow.workers.dev)** - Global edge deployment with full features
- **[Smithery](https://smithery.ai/connect/1_hqoRNf4)** - One-click deploy, no setup required

**⚡ Auto-Deployed:** All versions automatically built and pushed on every commit - always up-to-date!

**📋 Docker MCP Registry:** Submitted to [Docker's official MCP catalog](https://github.com/docker/mcp-registry) for inclusion in Docker Desktop's MCP Toolkit

A MCP server built for developers enabling Git based project management with project and personal journaling. Think of it as a scrapbook for your projects— one that captures technical details, GitHub issues, code context, and the personal threads that shape a project's story.

Whether you're tracking a feature sprint, logging a bug hunt, planning strategy, or leaving behind breadcrumbs for future-you (or your team), this system gives you a structured but flexible way to journal your dev work.

---

## 🚀 **Why Developers Use This**

* **Project context on tap** → Git + GitHub issues, branch, commit, and working directory auto-captured
* **Journaling tuned for dev work** → `technical_achievement`, `milestone`, `development_note` entry types
* **Productivity & organization** → search, tags, significance markers, relationship mapping
* **Performance reviews & retros** → chart your progress, revisit major breakthroughs
* **Scrapbook of the process** → capture not only *what* you built but *how it felt building it*
* **Team continuity** → leave breadcrumbs for future-you and your teammates

---

## ⚡ **Core Features**

* **7 MCP Tools**: Entry creation, search, semantic search, context bundle retrieval
* **Git & GitHub integration**: Pulls in commits and recent issues automatically
* **Full-text + semantic search**: SQLite FTS5 plus FAISS embeddings (optional)
* **Typed relationships**: Connect entries (`implements`, `references`, `clarifies`)
* **Significance classification**: Flag breakthroughs, milestones, completions
* **Portable, private, local-first**: Each user owns a single SQLite `.db` file

---

## 🏗️ **Developer-Friendly Design**

* **Zero friction** → no auth, no external API limits
* **Context-aware** → project state captured automatically
* **Dockerized** → Alpine-based secure image with full semantic search capabilities
* **Secure** → WAL mode, input validation, non-root containers, no data leakage
* **Extensible** → semantic search, relationship mapping, future summaries

---

## 📊 **Example Use Cases**

**Track technical breakthroughs:**
```javascript
create_entry({
  content: "Implemented async Git operations with 2s fail-fast timeout to stop MCP hangs.",
  entry_type: "technical_achievement",
  tags: ["git", "async", "performance"],
  significance_type: "technical_breakthrough",
  auto_context: true
})
```

**Log a milestone:**
```javascript
create_entry({
  content: "Shipped v1.0 of the journaling system with full Docker support.",
  entry_type: "milestone",
  is_personal: false,
  tags: ["release", "deployment"]
})
```

**Search your history:**
```javascript
search_entries({ query: "async Git timeout", limit: 5 })
semantic_search({ query: "performance optimization challenges", limit: 3 })
```

**Capture project context automatically:**
```javascript
// Context bundle includes: Git repo, branch, commit, GitHub issues, working directory
/get-context-bundle  // Available in Cursor prompt palette
```

---

## 🚀 **Features**

### **Core Capabilities**
- **Personal & Project Journaling**: Separate personal reflections from technical entries
- **Context Bundles**: Automatically capture Git repository, branch, commit information, and GitHub issues
- **Smart Tagging**: Auto-create tags with usage tracking
- **Full-Text Search**: Powered by SQLite FTS5 with result highlighting
- **Semantic Search**: Vector similarity search using sentence-transformers and FAISS
- **Relationship Mapping**: Link related entries with typed relationships
- **Significance Classification**: Mark important entries for easy retrieval
- **Async Operations**: Non-blocking Git operations with aggressive timeouts

### **Design Principles**
- **Friction-Free**: No authentication or API limitations
- **Context-Aware**: Automatically captures current project state
- **Portable**: Single SQLite database contains everything
- **Performant**: Thread pool execution prevents blocking
- **Resilient**: Fail-fast timeouts and comprehensive error handling
- **Secure**: Production-grade security with input validation and WAL mode
- **Privacy-First**: Local-only operation, no external data transmission

## 🏗️ **Architecture**

```
┌─────────────────────────────────────────────────────────────┐
│ MCP Server Layer (Async/Await)                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ Entry Creation  │  │ FTS5 Search     │  │ Resource    │  │
│  │ with Context    │  │ with Highlight  │  │ Management  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
├─────────────────────────────────────────────────────────────┤
│ Thread Pool Execution Layer                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ Git Operations  │  │ Database Ops    │  │ Tag Creation│  │
│  │ (2s timeout)    │  │ with Commit     │  │ Auto-Mgmt   │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
├─────────────────────────────────────────────────────────────┤
│ SQLite Database with FTS5                                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ entries + tags + relationships + significance + FTS    ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## 🛠️ **Setup in 3 Steps**

**Option 1: Docker Hub (Recommended)**

**Single Optimized Image:**
- **`:latest`** (225MB) - **Alpine-based with full features**, includes PyTorch + semantic search, maximum security

```bash
# 1. Pull the optimized image (no build needed!)
docker pull writenotenow/memory-journal-mcp:latest   # Secure Alpine base with full ML capabilities

mkdir data  # Create data directory

# 2. Add to your MCP config (~/.cursor/mcp.json)
{
  "mcpServers": {
    "memory-journal": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "-v", "./data:/app/data", "writenotenow/memory-journal-mcp:latest", "python", "src/server.py"]
    }
  }
}

# 3. Restart Cursor → Start journaling!
```

**Option 2: Build from Source**
```bash
# 1. Clone and build
git clone <repo-url>
cd memory-journal-mcp
docker build -f Dockerfile -t memory-journal-mcp-local .

# 2. Add to MCP config (use local image)
{
  "mcpServers": {
    "memory-journal": {
      "command": "docker", 
      "args": ["run", "--rm", "-i", "-v", "./data:/app/data", "memory-journal-mcp-local", "python", "src/server.py"]
    }
  }
}
```

**Option 3: Manual Installation**
```bash
# 1. Clone the repo
git clone <repo-url>
cd memory-journal-mcp

# 2. Install dependencies (requires Python 3.10+)
pip install -r requirements.txt
# Optional: semantic search
pip install sentence-transformers faiss-cpu

# 3. Add to MCP config
{
  "mcpServers": {
    "memory-journal": {
      "command": "python",
      "args": ["path/to/memory-journal-mcp/src/server.py"],
      "priority": 1
    }
  }
}
```

### **🐳 Docker Hub Images**

**Available on Docker Hub:** `writenotenow/memory-journal-mcp`

| Tag | Size | Features | Best For |
|-----|------|----------|----------|
| **`:latest`** | 225MB | Complete feature set: journaling, FTS5 search, semantic search, Git context, PyTorch ML | **All users - secure Alpine base with full capabilities** |

**Quick test:**
```bash
# Test the optimized image
docker run --rm writenotenow/memory-journal-mcp:latest python -c "print('✅ Memory Journal MCP ready with full features!')"
```

**Why Alpine-based:**
- **Security**: Minimal attack surface with Alpine Linux base
- **Performance**: Optimized 225MB image with full ML capabilities  
- **Simplicity**: One image covers all use cases - no version confusion

### **🔄 Automated Deployment**

**Always Fresh Images** - Docker images are automatically built and deployed on every commit to `main`:

- **Latest builds**: Available within 5-10 minutes of code changes
- **Security scanned**: Every image automatically scanned for vulnerabilities  
- **Multi-platform**: Lite images support both Intel and Apple Silicon
- **Version tagged**: Git tags automatically create versioned Docker releases
- **Quality tested**: Images tested before deployment to ensure they work

**No stale images** - What's on GitHub is what's on Docker Hub! 🚀

**Option 2: Cloudflare Workers (Remote MCP Server)**

Deploy as a remote MCP server on Cloudflare's global edge network with D1 database persistence:

🌐 **Live Demo:** [memory-journal-mcp-remote.writenotenow.workers.dev](https://memory-journal-mcp-remote.writenotenow.workers.dev)

```json
{
  "mcpServers": {
    "memory-journal-remote": {
      "command": "npx",
      "args": [
        "mcp-remote", 
        "https://memory-journal-mcp-remote.writenotenow.workers.dev/sse"
      ]
    }
  }
}
```

**Features:**
- ✅ **Full semantic search** capabilities via Cloudflare Workers AI
- ✅ **Global edge deployment** - sub-100ms response times worldwide  
- ✅ **Persistent D1 database** - your data stays safe in Cloudflare's database
- ✅ **Zero server management** - completely serverless, automatic scaling
- ✅ **All original features** - complete feature parity with local version

**Option 3: Smithery (One-Click Deploy)**

Deploy instantly via Smithery's MCP marketplace:

🚀 **One-Click Deploy:** [smithery.ai/neverinfamous-memory-journal-mcp](https://smithery.ai/connect/1_hqoRNf4)

```json
{
  "mcpServers": {
    "memory-journal-smithery": {
      "command": "smithery",
      "args": ["serve", "neverinfamous/memory-journal-mcp"]
    }
  }
}
```

**Features:**
- ✅ **Instant deployment** - no Docker or setup required
- ✅ **HTTP MCP protocol** - streamable connection for real-time updates
- ✅ **Alpine-based security** - minimal attack surface, same as Docker image
- ✅ **Core features** - journaling, search, Git context (no semantic search)

---

## 📝 **Usage**

### **Creating Entries**

**Personal Reflection:**
```javascript
create_entry({
  content: "Today I reflected on new patterns in my thinking...",
  is_personal: true,
  entry_type: "personal_reflection",
  tags: ["consciousness", "growth", "reflection"],
  significance_type: "identity_development"
})
```

**Technical Achievement:**
```javascript
create_entry({
  content: "Successfully implemented async Git operations with fail-fast timeouts, resolving the MCP server hanging issue",
  is_personal: false,
  entry_type: "technical_achievement",
  tags: ["git", "async", "performance", "debugging"],
  significance_type: "technical_breakthrough",
  auto_context: true  // Captures Git repo, branch, commit info
})
```

### **Searching Entries**

**Full-Text Search with Highlighting:**
```javascript
search_entries({
  query: "async Git timeout",
  limit: 5
})
// Returns: "Testing **async** **Git** operations with aggressive timeouts..."
```

**Filter by Type:**
```javascript
search_entries({
  is_personal: false,  // Technical entries only
  limit: 10
})
```

**Recent Entries:**
```javascript
get_recent_entries({
  limit: 5,
  is_personal: true
})
```

### **Tag Management**
```javascript
list_tags()  // Shows all tags with usage counts
```

## 🗄️ **Database Schema**

### **Core Tables**
- **`entries`**: Main journal entries with content and metadata
- **`tags`**: Auto-managed tag system with usage tracking  
- **`entry_tags`**: Many-to-many relationships between entries and tags
- **`relationships`**: Typed connections between entries
- **`significant_entries`**: Classification of important entries
- **`memory_journal_fts`**: FTS5 full-text search index

### **Context Bundle Example**
Each entry automatically captures rich project context:
```json
{
  "repo_name": "memory-journal-mcp",
  "repo_path": "C:\\Users\\chris\\Desktop\\memory-journal-mcp",
  "branch": "main",
  "last_commit": {
    "hash": "d4a0c69a",
    "message": "Implement async Git operations for context capture"
  },
  "cwd": "C:\\Users\\chris\\Desktop\\memory-journal-mcp",
  "timestamp": "2025-09-13T18:26:46.123456"
}
```

## 📊 **Entry Types**

Supports various entry types for different use cases:
- `personal_reflection` (default)
- `technical_achievement`
- `milestone`
- `development_note`
- `test_entry`
- `project_context`
- `thread_initialization`

## 🔗 **Relationship Types**

Link related entries with semantic relationships:
- `evolves_from`: Entry represents evolution from target
- `references`: Entry explicitly references target
- `related_to`: Entries are thematically related
- `implements`: Entry implements concepts from target
- `clarifies`: Entry clarifies concepts in target
- `response_to`: Entry directly responds to target

## ⭐ **Significance Classification**

Mark important entries for easy retrieval:
- `identity_development`: Key identity formations
- `technical_breakthrough`: Major technical achievements  
- `major_breakthrough`: Significant discoveries
- `project_completion`: Milestone completions
- `consciousness_emergence`: Awareness developments

## 🔧 **Technical Implementation**

### **Performance Optimizations**
- **Thread Pool Execution**: All blocking operations run in background threads
- **Aggressive Timeouts**: Git operations timeout after 2 seconds per command
- **Fail-Fast Approach**: Operations complete quickly even if Git hangs
- **Database Transactions**: Proper commit handling prevents hanging
- **FTS5 Integration**: Efficient full-text search with highlighting

### **Error Handling**
- **Git Timeouts**: Graceful fallback when Git operations exceed timeout
- **Missing Git**: Continues operation when Git binary not found
- **Database Locks**: Proper transaction management prevents deadlocks
- **Async Safety**: All operations designed for async/await patterns

### **Key Technical Fixes Applied**
1. **FTS5 Configuration**: `content='memory_journal', content_rowid='id'`
2. **Async Timeouts**: `asyncio.wait_for()` with 10-second total limit
3. **Subprocess Handling**: `timeout=2, shell=False` for Git commands
4. **Database Commits**: Added missing `conn.commit()` calls
5. **Thread Safety**: All database operations in thread pool

## 📈 **Resources**

The server provides two MCP resources:

### **memory://recent**
Returns the 5 most recent journal entries with full content and metadata.

### **memory://significant**  
Returns entries marked with significance classifications, useful for reviewing important developments.

## 🎯 **MCP Prompts** (User-Initiated)

The server provides interactive prompts accessible through your MCP client's prompt palette (typically `/` in Cursor):

### **get-context-bundle**
Get current project context as structured JSON for the AI assistant.

**Arguments:**
- `include_git` (optional): Include Git repository information (default: true)

**How to Use:**
1. In Cursor, type `/` to open prompt palette
2. Select `get-context-bundle` from the list
3. Optionally add `include_git=false` to skip Git operations

**Sample Output:**
```json
{
  "repo_name": "memory-journal-mcp",
  "repo_path": "C:\\Users\\chris\\Desktop\\memory-journal-mcp", 
  "branch": "main",
  "last_commit": {
    "hash": "5ee4651",
    "message": "Update memory journal readme"
  },
  "github_issues": {
    "count": 2,
    "recent_issues": [
      {
        "number": 15,
        "title": "Add GitHub issue context to memory journal entries",
        "state": "OPEN",
        "created": "2025-09-13"
      },
      {
        "number": 12,
        "title": "Improve MCP prompt error handling and timeout management",
        "state": "OPEN", 
        "created": "2025-09-12"
      }
    ]
  },
  "cwd": "C:\\Users\\chris\\Desktop\\memory-journal-mcp",
  "timestamp": "2025-09-13T15:41:28.080365"
}
```

### **get-recent-entries** 
Get the last X journal entries with formatted display.

**Arguments:**
- `count` (optional): Number of entries to retrieve (default: 5)
- `personal_only` (optional): Only show personal entries (default: false)

**How to Use:**
1. In Cursor, type `/` to open prompt palette
2. Select `get-recent-entries` from the list
3. Optionally add arguments like `count=10` or `personal_only=true`

**Sample Output:**
```
Here are the 1 most recent journal entries:

**Entry #10** (milestone) - 2025-09-13 19:41:28
Personal: False
Content: Successfully implemented MCP prompts functionality for the Memory Journal system! Added two powerful prompts: get-context-bundle for retrieving project context as JSON...

Context: memory-journal-mcp (main branch)
```

**💡 Troubleshooting Prompts:**
- If prompts don't appear in `/` palette, restart Cursor after server changes
- If Git operations timeout, use `include_git=false` for faster context capture
- Prompts work from any directory - they capture context of the current working directory

**🔗 GitHub Integration:**
- **GitHub CLI Required**: Install `gh` and authenticate with `gh auth login`
- **Context Includes**: Recent open issues (limit 3), issue numbers, titles, and creation dates
- **Fallback**: If GitHub CLI unavailable, context bundle works without issue data
- **Performance**: GitHub issue queries use same aggressive timeouts as Git operations

**🔍 Semantic Search:**
- **Dependencies**: `pip install sentence-transformers faiss-cpu` (optional)
- **Model**: Uses `all-MiniLM-L6-v2` (384-dimensional embeddings, ~100MB download)
- **Performance**: Embeddings generated automatically for new entries
- **Graceful Degradation**: System works without vector search if dependencies unavailable
- **Storage**: Embeddings stored as BLOB in SQLite with FAISS index for fast similarity search

**🔒 Security & Performance:**
- **WAL Mode**: Write-Ahead Logging enabled for better concurrency and crash recovery
- **Database Optimization**: 64MB cache, 256MB memory-mapped I/O, NORMAL synchronous mode
- **Input Validation**: Length limits (50KB entries), character filtering, SQL injection prevention
- **File Security**: Restrictive permissions (600 for database, 700 for directories)
- **Docker Security**: Non-root user execution, minimal container privileges
- **Privacy**: Local-first architecture, no external data transmission, full data ownership

## 🛠️ **Tools Available** (Programmatic Access)

### **Core Tools**

#### **`create_entry`** - Create Journal Entries
**Parameters:**
- `content` (required): The journal entry content
- `entry_type` (optional): Type classification (default: "personal_reflection")
- `is_personal` (optional): Personal vs project entry (default: true)
- `significance_type` (optional): Mark as significant ("milestone", "breakthrough", etc.)
- `tags` (optional): Array of tags (auto-created if they don't exist)

**Example Usage:**
```python
create_entry(
    content="Successfully implemented MCP prompts functionality!",
    entry_type="milestone", 
    is_personal=false,
    significance_type="technical_achievement",
    tags=["mcp", "prompts", "development"]
)
```

#### **`search_entries`** - Full-Text Search
**Parameters:**
- `query` (required): Search terms
- `limit` (optional): Max results (default: 10)
- `is_personal` (optional): Filter by personal/project entries

**Example Usage:**
```python
search_entries(query="MCP prompts", limit=5, is_personal=false)
```

#### **`semantic_search`** - Vector Similarity Search
**Parameters:**
- `query` (required): Search query for semantic similarity
- `limit` (optional): Max results (default: 10)
- `similarity_threshold` (optional): Minimum similarity score 0.0-1.0 (default: 0.3)
- `is_personal` (optional): Filter by personal/project entries

**Example Usage:**
```python
semantic_search(query="project development challenges", limit=5, similarity_threshold=0.4)
```

#### **`get_recent_entries`** - Retrieve Recent Entries
**Parameters:**
- `limit` (optional): Number of entries (default: 5)
- `is_personal` (optional): Filter by personal/project entries

#### **`list_tags`** - Show All Tags
Returns all tags with usage statistics.

### **Diagnostic Tools**
- **`test_simple`**: Basic connectivity test
- **`create_entry_minimal`**: Minimal entry creation for debugging

### **Search Tools**
- **`search_entries`**: Full-text search with FTS5
- **`semantic_search`**: Vector similarity search with embeddings

## 🎯 **Prompts Available**

1. **`get-context-bundle`**: Get current project context as JSON
2. **`get-recent-entries`**: Get formatted display of recent journal entries

## 🔮 **Future Roadmap**

**Next up for developers:**
- **Graph visualization** → See how your entries and projects connect
- **Team features** → Share context bundles, collaborative project journals
- **Import/export utilities** → Backup and restore history, markdown or json or git commit hooks
- **Minimal CLI client** → CLI (Python or Node) that wraps create_entry and search_entries would let devs journal without needing to hit MCP directly

## 📄 **License**

MIT License — do whatever you want, just don't blame us if it writes your autobiography.

## 🤝 **Contributing**

Built by developers, for developers. PRs welcome, especially for:
- New entry types that make sense for dev work
- Better Git/GitHub integrations
- Performance improvements
- Cool semantic search features

---

## 🎯 **Status**

**✅ Ready for developers**
- All 7 MCP tools working and tested
- Docker images auto-deployed and validated
- Security hardened (WAL mode, input validation, non-root containers)
- Community standards compliant (Code of Conduct, Contributing guidelines, issue templates)
- Automated CI/CD with dependency management (Dependabot enabled)
- Comprehensive docs (setup, security, Docker guides)
- 15+ entries created during testing — system is solid

**✅ Battle-tested features**
- Context bundles capture Git + GitHub seamlessly
- Full-text search with highlighting works great
- Semantic search gracefully degrades without ML deps
- Tag management and relationship mapping functional
- Performance optimized with 64MB cache and memory mapping