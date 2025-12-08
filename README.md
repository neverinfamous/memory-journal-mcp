# Memory Journal MCP Server

Last Updated December 8, 2025 - v2.2.0

<!-- mcp-name: io.github.neverinfamous/memory-journal-mcp -->

[![GitHub](https://img.shields.io/badge/GitHub-neverinfamous/memory--journal--mcp-blue?logo=github)](https://github.com/neverinfamous/memory-journal-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/writenotenow/memory-journal-mcp)](https://hub.docker.com/r/writenotenow/memory-journal-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
![Version](https://img.shields.io/badge/version-v2.2.0-green)
![Status](https://img.shields.io/badge/status-Production%2FStable-brightgreen)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-Published-green)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.neverinfamous/memory-journal-mcp)
[![PyPI](https://img.shields.io/pypi/v/memory-journal-mcp)](https://pypi.org/project/memory-journal-mcp/)
[![Security](https://img.shields.io/badge/Security-Enhanced-green.svg)](SECURITY.md)
[![CodeQL](https://img.shields.io/badge/CodeQL-Passing-brightgreen.svg)](https://github.com/neverinfamous/memory-journal-mcp/security/code-scanning)
[![Type Safety](https://img.shields.io/badge/Pyright-Strict-blue.svg)](https://github.com/neverinfamous/memory-journal-mcp)

*Project context management for AI-assisted development - Bridge the gap between fragmented AI threads with persistent knowledge graphs and intelligent context recall*

**🎯 Solve the AI Context Problem:** When working with AI across multiple threads and sessions, context is lost. Memory Journal maintains a persistent, searchable record of your project work, decisions, and progress - making every AI conversation informed by your complete project history.

**[GitHub](https://github.com/neverinfamous/memory-journal-mcp)** • **[Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki)** • **[Changelog](https://github.com/neverinfamous/memory-journal-mcp/wiki/CHANGELOG)** • **[Release Article](https://adamic.tech/articles/memory-journal-mcp-server)**

**🚀 Quick Deploy:**
- **[PyPI Package](https://pypi.org/project/memory-journal-mcp/)** - `pip install memory-journal-mcp`
- **[Docker Hub](https://hub.docker.com/r/writenotenow/memory-journal-mcp)** - Alpine-based (225MB) with full semantic search
- **[MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.neverinfamous/memory-journal-mcp)** - 

---

## 🎯 Why Memory Journal?

### **The Fragmented AI Context Problem**

When managing large projects with AI assistance, you face a critical challenge:

- **Thread Amnesia** - Each new AI conversation starts from zero, unaware of previous work
- **Lost Context** - Decisions, implementations, and learnings scattered across disconnected threads  
- **Repeated Work** - AI suggests solutions you've already tried or abandoned
- **Context Overload** - Manually copying project history into every new conversation is tedious and incomplete

### **The Solution: Persistent Project Memory**

Memory Journal acts as your project's **long-term memory**, bridging the gap between fragmented AI threads:

**For Developers:**
- 📝 **Automatic Context Capture** - Git commits, branches, GitHub issues, PRs, and project state captured with every entry
- 🔗 **Knowledge Graph** - Link related work (specs → implementations → tests → PRs) to build a connected history
- 🔍 **Intelligent Search** - Find past decisions, solutions, and context across your entire project timeline
- 📊 **Project Analytics** - Track progress from issues through PRs, generate reports for standups/retrospectives/code reviews

**For Project Managers:**
- 👥 **Team Context Continuity** - Maintain shared project memory across team members and time
- 📈 **Progress Tracking** - Monitor milestones, velocity, and cross-project insights from issues to PRs
- 🎯 **Status Reporting** - Generate comprehensive project summaries with PR metrics and timelines
- 🔄 **GitHub Integration** - Connect entries with Projects, Issues, and Pull Requests for unified tracking

**For AI-Assisted Work:**
- 💡 AI can query your **complete project history** in any conversation
- 🧠 **Semantic search** finds conceptually related work, even without exact keywords
- 📖 **Context bundles** provide AI with comprehensive project state instantly
- 🔗 **Relationship visualization** shows how different pieces of work connect

### **Real-World Example**

```
Without Memory Journal:
Thread 1: "Help me design the authentication system"
Thread 2 (next day): "How should I implement user sessions?"  
         AI: *suggests approach you already decided against*
Thread 3 (next week): "What was our decision about JWT tokens?"
         AI: *no memory of previous threads*

With Memory Journal:
Thread 1: Work captured → "Decided on JWT with refresh tokens"
Thread 2: AI queries history → "I see you decided on JWT. Let's implement refresh token rotation..."
Thread 3: AI finds related entries → "Based on your design from Oct 15, here's the implementation..."
```

---

## ✨ What's New in v2.2.0 (December 8, 2025)

### 🎛️ **Tool Filtering for Token Efficiency**
- **Reduce token usage by up to 69%** - Disable unused tools to save context window space
- **7 tool groups** - `core`, `search`, `analytics`, `relationships`, `export`, `admin`, `test`
- **Flexible syntax** - `-group` to disable, `-tool` for specific tools, `+tool` to re-enable
- **MCP client compatibility** - Stay under tool limits (e.g., Windsurf's 100-tool limit)
- **Zero breaking changes** - All 16 tools enabled by default

### 🎨 **Dark Mode Improvements**
- **Actions Visual Graph** - Improved color scheme for dark mode readability
- **Better contrast** - Medium-saturated fills with dark text and defined borders

### 📊 **Token Savings by Configuration**
| Configuration | Tools | Token Reduction |
|---------------|-------|-----------------|
| Production (`-test`) | 14 | ~12% |
| Read-only (`-admin`) | 14 | ~15% |
| Lightweight (`-search,-analytics,-relationships,-export,-admin,-test`) | 5 | **~69%** |

**[Complete tool filtering guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tool-Filtering)**

---

## ✨ What's New in v2.1.0 (November 26, 2025)

### 🎉 **Complete GitHub Actions Integration**
- **GitHub Actions Resources** - 5 new MCP resources for CI/CD visibility
- **Actions Visual Graph** - `memory://graph/actions` - CI/CD narrative with Mermaid diagrams
- **Failure Digest Prompt** - `actions-failure-digest` - Comprehensive failure analysis with root cause identification
- **Workflow Run Linking** - Link journal entries to specific workflow runs

### 🔍 **GitHub Issues & Pull Requests Integration**
- **GitHub Issues** - Auto-fetch, link entries, detect from branch names
- **GitHub Pull Requests** - Auto-detect current PR, track lifecycle, link entries
- **3 PR Workflow Prompts** - `pr-summary`, `code-review-prep`, `pr-retrospective`
- **3 New Resources** - Issue/PR entries, PR timelines

### ✅ **True Pyright Strict Type Compliance**
- **700+ type issues fixed** - Complete strict mode compliance
- **All exclusions removed** - Zero compromises on type safety
- **Better IDE support** - Enhanced autocomplete and error detection

### **Current Capabilities**
- **16 MCP tools** - Complete development workflow
- **14 workflow prompts** - Standups, retrospectives, PR workflows, CI/CD failure analysis
- **13 MCP resources** - Recent entries, graphs, project/issue/PR timelines, GitHub Actions
- **GitHub Integration** - Projects, Issues, Pull Requests, Actions with auto-linking
- **Smart caching** - 80%+ API reduction (15min issues, 5min PRs/workflows, 1hr projects)
- **Knowledge graphs** - 5 relationship types, Mermaid visualization
- **10x faster startup** - Lazy ML loading (14s → 2-3s)

**[Architecture Details →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Architecture)**

---

## 🎯 **Workflow Prompts** (14 Total)
- `find-related` - Discover connected entries via semantic similarity
- `prepare-standup` - Daily standup summaries
- `prepare-retro` - Sprint retrospectives
- `weekly-digest` - Day-by-day weekly summaries
- `analyze-period` - Deep period analysis with insights
- `goal-tracker` - Milestone and achievement tracking
- `get-context-bundle` - Project context with Git/GitHub
- `get-recent-entries` - Formatted recent entries
- `project-status-summary` - GitHub Project status reports
- `project-milestone-tracker` - Milestone progress tracking
- `pr-summary` - Pull request journal activity summary
- `code-review-prep` - Comprehensive PR review preparation
- `pr-retrospective` - Completed PR analysis with learnings
- `actions-failure-digest` - **NEW** CI/CD failure analysis with root cause identification

### 📡 **Resources** (13 Total)

**MCP Server Identifier:** `user-memory-journal-mcp` (when using recommended config name; Cursor prefixes your config key with `user-`)

- `memory://recent` - 10 most recent entries
- `memory://significant` - Significant milestones and breakthroughs
- `memory://graph/recent` - Live Mermaid diagram of recent relationships
- `memory://team/recent` - Recent team-shared entries
- `memory://projects/{number}/timeline` - Project activity timeline
- `memory://issues/{issue_number}/entries` - All entries linked to a specific issue
- `memory://prs/{pr_number}/entries` - All entries linked to a specific pull request  
- `memory://prs/{pr_number}/timeline` - Combined PR + journal timeline

**GitHub Actions Resources:**
- `memory://graph/actions` - CI/CD narrative graph: commits → runs → failures → entries → fixes → deployments
- `memory://actions/recent` - Recent workflow runs with CI status (supports `?branch=X&workflow=Y&commit=SHA&pr=N&limit=10`)
- `memory://actions/workflows/{name}/timeline` - Workflow-specific timeline blending runs, journals, PRs
- `memory://actions/branches/{branch}/timeline` - Branch CI timeline with PR lifecycle
- `memory://actions/commits/{sha}/timeline` - Commit-specific CI timeline

### 🗄️ **Database Improvements**
- Automatic schema migrations (seamless v1.0 → v1.1 upgrades)
- Soft delete support with `deleted_at` column
- New `relationships` table with cascading deletes
- Enhanced indexes for optimal query performance

---

## 🚀 Quick Start

### Option 1: PyPI (Fastest - 30 seconds)

**Step 1: Install the package**

```bash
pip install memory-journal-mcp
```

**Step 2: Add to ~/.cursor/mcp.json**

```json
{
  "mcpServers": {
    "memory-journal-mcp": {
      "command": "memory-journal-mcp"
    }
  }
}
```

**Step 3: Restart Cursor**

Restart Cursor or your MCP client, then start journaling!

### Option 2: Docker (Full Features - 2 minutes)

**Step 1: Pull the Docker image**

```bash
docker pull writenotenow/memory-journal-mcp:latest
```

**Step 2: Create data directory**

```bash
mkdir data
```

**Step 3: Add to ~/.cursor/mcp.json**

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

**Step 4: Restart Cursor**

Restart Cursor or your MCP client, then start journaling!

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
- ✅ ~500MB disk space for data directory

### **Configuration**

After installation, Cursor will use this Docker-based configuration. If you prefer manual setup, add this to your `~/.cursor/mcp.json`:

```json
{
  "memory-journal": {
    "command": "docker",
    "args": [
      "run", "--rm", "-i",
      "-v", "./data:/app/data",
      "writenotenow/memory-journal-mcp:latest",
      "python", "src/server.py"
    ]
  }
}
```

**📖 [See Full Installation Guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Installation)**

---

## 📋 Core Capabilities

### 🛠️ **16 MCP Tools**
Entry CRUD • Triple search (FTS5/semantic/date) • Knowledge graphs • Analytics • Export  
**[Complete tools reference →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tools)**

### 🎯 **14 Workflow Prompts**
Standups • Retrospectives • Weekly digests • PR workflows • Goal tracking  
**[Complete prompts guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Prompts)**

### 🔄 **Git & GitHub Auto-Context**
Every entry captures: repo, branch, commit, issues, PRs, projects (user & org)  
**[Integration details →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Git-Integration)**

### 🔧 **Configuration**

**Optional GitHub Integration:**
```bash
export GITHUB_TOKEN="your_token"              # For Projects/Issues/PRs
export GITHUB_ORG_TOKEN="your_org_token"      # Optional: org projects
export DEFAULT_ORG="your-org-name"            # Optional: default org
```
**Scopes:** `repo`, `project`, `read:org` (org only) • **Fallback:** Uses `gh` CLI if tokens not set  
**[Full configuration guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Installation#configuration)**

### 🎛️ **Tool Filtering (Optional)**

Control which tools are exposed to your MCP client using the `MEMORY_JOURNAL_MCP_TOOL_FILTER` environment variable:

```bash
export MEMORY_JOURNAL_MCP_TOOL_FILTER="-analytics,-test"
```

**Filter Syntax:**
- `-group` - Disable all tools in a group (e.g., `-analytics`)
- `-tool` - Disable a specific tool (e.g., `-delete_entry`)
- `+tool` - Re-enable after group disable (e.g., `-admin,+update_entry`)

**Available Groups:**
- `core` (5 tools) - Essential CRUD operations
- `search` (2 tools) - Advanced search capabilities
- `analytics` (2 tools) - Statistics and insights
- `relationships` (2 tools) - Link and visualize entries
- `export` (1 tool) - Export functionality
- `admin` (2 tools) - Update and delete operations
- `test` (2 tools) - Testing and minimal entry creation

**Common Configurations:**

```bash
# Lightweight (core only, ~5 tools)
MEMORY_JOURNAL_MCP_TOOL_FILTER="-search,-analytics,-relationships,-export,-admin,-test"

# Read-only mode (disable modifications)
MEMORY_JOURNAL_MCP_TOOL_FILTER="-admin"

# Production use (disable test tools)
MEMORY_JOURNAL_MCP_TOOL_FILTER="-test"
```

**MCP Config Example:**

```json
{
  "mcpServers": {
    "memory-journal-mcp": {
      "command": "memory-journal-mcp",
      "env": {
        "MEMORY_JOURNAL_MCP_TOOL_FILTER": "-test,-admin",
        "GITHUB_TOKEN": "your_token"
      }
    }
  }
}
```

Useful for MCP clients with tool limits (e.g., Windsurf's 100-tool limit).  
**[Complete tool filtering guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tool-Filtering)**

---

## 📖 Usage Examples

### Create an Entry with GitHub Projects

```javascript
// Create an entry linked to a GitHub Project
create_entry({
  content: "Completed Phase 1 of GitHub Projects integration - all core features implemented!",
  entry_type: "technical_achievement",
  tags: ["github-projects", "integration", "milestone"],
  project_number: 1,  // Links to GitHub Project #1
  significance_type: "technical_breakthrough"
})
// Context automatically includes GitHub Projects info

// Search entries by project
search_entries({
  project_number: 1,
  limit: 10
})

// Filter by project and date range
search_by_date_range({
  start_date: "2025-10-01",
  end_date: "2025-10-31",
  project_number: 1
})
```

### Create an Entry with Relationships

```javascript
// Create a technical achievement
create_entry({
  content: "Implemented lazy loading for ML dependencies - 10x faster startup!",
  entry_type: "technical_achievement",
  tags: ["performance", "optimization", "ml"],
  significance_type: "technical_breakthrough"
})
// Returns: Entry #55

// Link related work
link_entries({
  from_entry_id: 56,  // Testing entry
  to_entry_id: 55,    // Implementation
  relationship_type: "implements"
})

// Visualize the connections
visualize_relationships({
  entry_id: 55,
  depth: 2
})
```

### Search and Analyze

```javascript
// Full-text search with highlighting
search_entries({ query: "performance optimization", limit: 5 })

// Semantic search for concepts
semantic_search({ query: "startup time improvements", limit: 3 })

// Date range with tags
search_by_date_range({
  start_date: "2025-10-01",
  end_date: "2025-10-31",
  tags: ["performance"]
})

// Get analytics
get_statistics({ group_by: "week" })
```

### Generate Visual Maps

```javascript
// Visualize entry relationships
visualize_relationships({
  entry_id: 55,  // Root entry
  depth: 2       // 2 hops out
})

// Filter by tags
visualize_relationships({
  tags: ["visualization", "relationships"],
  limit: 20
})

// Listing resources - IMPORTANT: Call with NO parameters first
list_mcp_resources()  // ✅ Returns actual server identifier (e.g., user-memory-journal-mcp)

// Then fetch using exact identifier from list output
fetch_mcp_resource({
  server: "user-memory-journal-mcp",  // Use exact name from list_mcp_resources()
  uri: "memory://graph/recent"
})

// Available resource URIs:
memory://graph/recent  // Most recent 20 entries with relationships
memory://team/recent   // Recent team-shared entries (v2.0.0)
```

**Note:** Always call `list_mcp_resources()` without parameters first. MCP clients like Cursor may prefix your config name (e.g., `memory-journal-mcp` becomes `user-memory-journal-mcp`).

### Using Workflow Prompts

Ask Cursor's AI naturally:
```
"Show me my recent journal entries"
"Prepare my standup for today"
"Generate a weekly digest"
"Find entries related to refactoring"
```

**[See all 14 prompts →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Prompts)** | **[Complete examples →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Examples)**

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ MCP Server Layer (Async/Await)                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ Entry Creation  │  │ Triple Search   │  │ Relationship│  │
│  │ with Context    │  │ FTS5/Date/ML    │  │ Mapping     │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
├─────────────────────────────────────────────────────────────┤
│ Thread Pool Execution Layer                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ Git Operations  │  │ Database Ops    │  │ Lazy ML     │  │
│  │ (2s timeout)    │  │ Single Conn     │  │ Loading     │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
├─────────────────────────────────────────────────────────────┤
│ SQLite Database with FTS5 + Relationships                   │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ entries + tags + relationships + embeddings + FTS       ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 Technical Highlights

### Performance & Security
- **Python 3.14** - Latest Python with free-threaded support (PEP 779), deferred annotations (PEP 649), and performance optimizations
- **10x faster startup** - Lazy loading of ML dependencies (2-3s vs 14s)
- **Thread-safe operations** - Zero race conditions in tag creation
- **WAL mode** - Better concurrency and crash recovery
- **Database lock prevention** - Single-connection transactions
- **Aggressive timeouts** - Git operations fail-fast (2s per command)
- **Input validation** - Length limits, parameterized queries, SQL injection prevention

### Semantic Search (Optional)
- **Model**: `all-MiniLM-L6-v2` (384-dimensional embeddings)
- **Storage**: FAISS index for fast similarity search
- **Graceful degradation**: Works perfectly without ML dependencies

### Data & Privacy
- **Local-first**: Single SQLite file, you own your data
- **Portable**: Move your `.db` file anywhere
- **Secure**: No external API calls, non-root Docker containers

---

## 📚 Documentation & Resources

- **[GitHub Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki)** - Complete documentation
- **[Practical Examples Gists](https://gist.github.com/neverinfamous/ffedec3bdb5da08376a381733b80c1a7)** - 7 curated use cases
- **[Docker Hub](https://hub.docker.com/r/writenotenow/memory-journal-mcp)** - Container images
- **[PyPI Package](https://pypi.org/project/memory-journal-mcp/)** - Python distribution
- **[Issues](https://github.com/neverinfamous/memory-journal-mcp/issues)** - Bug reports & feature requests

---

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Built by developers, for developers. PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
