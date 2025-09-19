# 🛠️ Memory Journal MCP Server

* Last Updated September 17, 2025 10:54 PM EST *

[![GitHub](https://img.shields.io/badge/GitHub-neverinfamous/memory--journal--mcp-blue?logo=github)](https://github.com/neverinfamous/memory-journal-mcp)
![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-v1.0.0-green)
[![Docker Pulls](https://img.shields.io/docker/pulls/writenotenow/memory-journal-mcp)](https://hub.docker.com/r/writenotenow/memory-journal-mcp)

*A developer's project journal and context manager*

**🚀 Docker Deployment:**

  - **[Docker Hub](https://hub.docker.com/r/writenotenow/memory-journal-mcp)** - Alpine-based (225MB) with full semantic search

**⚡ Auto-Deployed:** All versions automatically built and pushed on every commit - always up-to-date\!

**📋 Docker MCP Registry:** Submitted to [Docker's official MCP catalog](https://github.com/docker/mcp-registry) for inclusion in Docker Desktop's MCP Toolkit

A MCP server built for developers enabling Git based project management with project and personal journaling. Think of it as a scrapbook for your projects— one that captures technical details, GitHub issues, code context, and the personal threads that shape a project's story.

Whether you're tracking a feature sprint, logging a bug hunt, planning strategy, or leaving behind breadcrumbs for future-you (or your team), this system gives you a structured but flexible way to journal your dev work.

-----

## ✨ Features

### Why Memory Journal? (The Benefits)

  * **Project context on tap** → Git, GitHub issues, branch, commit, and working directory are auto-captured.
  * **Journaling tuned for dev work** → Specialized entry types like `technical_achievement`, `milestone`, and `development_note`.
  * **Productivity & organization** → Powerful search, tags, significance markers, and relationship mapping.
  * **Performance reviews & retros** → Chart your progress and revisit major breakthroughs with ease.
  * **Scrapbook of the process** → Capture not only *what* you built but *how it felt building it*.
  * **Team continuity** → Leave clear breadcrumbs for future-you and your teammates.

### Core Capabilities

  * **7 MCP Tools**: Entry creation, search, semantic search, context bundle retrieval, and more.
  * **Git & GitHub Integration**: Automatically captures commits, branches, and recent issues.
  * **Dual Search**: High-performance full-text search (SQLite FTS5) with result highlighting, plus optional semantic/vector search (FAISS).
  * **Relationship Mapping**: Link related entries with typed relationships like `implements`, `references`, and `clarifies`.
  * **Significance Classification**: Flag breakthroughs, milestones, and project completions for easy retrieval.
  * **Context Bundles**: On-demand capture of the complete project state.
  * **Async Operations**: Non-blocking Git operations with aggressive timeouts to ensure server responsiveness.

### Developer-Friendly Design

  * **Zero Friction**: No authentication, API keys, or external rate limits to worry about.
  * **Secure & Private**: Local-first architecture where you own your data. Hardened with input validation, WAL mode, and non-root Docker containers.
  * **Portable**: Your entire journal, including tags and relationships, is a single SQLite `.db` file.
  * **Context-Aware**: The server automatically captures the project state without any manual input.
  * **Extensible**: Designed to support future capabilities like graph visualization and team-based features.
  * **Performant & Resilient**: Utilizes a thread pool for blocking operations, fail-fast timeouts, and comprehensive error handling.

-----

## 🚀 Installation & Deployment

Choose the option that best fits your workflow.

### Option 1: Docker (Recommended)

The simplest way to run the full-featured server locally. This single, optimized image includes all dependencies for semantic search.

**1. Pull the Image**

```bash
# Pull the secure, Alpine-based image with full ML capabilities
docker pull writenotenow/memory-journal-mcp:latest
```

**2. Create a Data Directory**
This directory will persist your SQLite database on your host machine.

```bash
mkdir data
```

**3. Configure Your MCP Client**
Add the server to your `~/.cursor/mcp.json` file:

```json
{
  "mcpServers": {
    "memory-journal": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "-v", "./data:/app/data", "writenotenow/memory-journal-mcp:latest", "python", "src/server.py"]
    }
  }
}
```

**4. Restart Your Client**
Restart Cursor or your MCP client, and you're ready to start journaling\!

**Docker Image Details**

| Tag | Size | Features | Best For |
|---|---|---|---|
| **`:latest`** | 225MB | Complete feature set: journaling, FTS5 search, semantic search, Git context, PyTorch ML | **All users - secure Alpine base with full capabilities** |

  * **Security**: Minimal attack surface with Alpine Linux.
  * **Performance**: Optimized 225MB image size with full ML capabilities.
  * **Simplicity**: One image covers all use cases.

**Automated Deployment**

Docker images are automatically built and deployed from `main` on every commit, ensuring you always have the latest version.

  * **Always Fresh**: Images are available on Docker Hub within 5-10 minutes of a code change.
  * **Security Scanned**: Every image is automatically scanned for vulnerabilities.
  * **Quality Tested**: Images are tested before deployment.

### Option 2: Advanced Local Setup

**Build from Source:**

```bash
# 1. Clone and build
git clone <repo-url>
cd memory-journal-mcp
docker build -f Dockerfile -t memory-journal-mcp-local .

# 2. Add to MCP config (use local image name)
# ... (similar to Docker Hub config but with "memory-journal-mcp-local")
```

**Manual Installation:**

```bash
# 1. Clone the repo and install dependencies (Python 3.10+)
git clone <repo-url>
cd memory-journal-mcp
pip install -r requirements.txt
# Optional: for semantic search
pip install sentence-transformers faiss-cpu

# 2. Add to MCP config
{
  "mcpServers": {
    "memory-journal": {
      "command": "python",
      "args": ["path/to/memory-journal-mcp/src/server.py"]
    }
  }
}
```

-----

## 📝 Usage Examples

### Creating Entries

**Log a Technical Achievement:**

```javascript
create_entry({
  content: "Successfully implemented async Git operations with fail-fast timeouts, resolving the MCP server hanging issue.",
  entry_type: "technical_achievement",
  tags: ["git", "async", "performance", "debugging"],
  significance_type: "technical_breakthrough",
  auto_context: true // Captures Git repo, branch, commit info
})
```

**Capture a Personal Reflection:**

```javascript
create_entry({
  content: "Today I reflected on new patterns in my thinking...",
  is_personal: true,
  entry_type: "personal_reflection",
  tags: ["consciousness", "growth", "reflection"]
})
```

### Searching Entries

**Full-Text Search with Highlighting:**

```javascript
search_entries({
  query: "async Git timeout",
  limit: 5
})
// Returns: "Testing **async** **Git** operations with aggressive timeouts..."
```

**Semantic Search for Concepts:**

```javascript
semantic_search({
  query: "performance optimization challenges",
  limit: 3
})
```

**Filter by Type or Recency:**

```javascript
search_entries({ is_personal: false, limit: 10 }) // Technical entries only
get_recent_entries({ limit: 5 }) // Most recent 5 entries
```

### Tag Management

```javascript
list_tags() // Shows all tags with usage counts
```

-----

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ MCP Server Layer (Async/Await)                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ Entry Creation  │  │ FTS5 Search     │  │ Resource    │  │
│  │ with Context    │  │ with Highlight  │  │ Management  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
├─────────────────────────────────────────────────────────────┤
│ Thread Pool Execution Layer                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ Git Operations  │  │ Database Ops    │  │ Tag Creation│  │
│  │ (2s timeout)    │  │ with Commit     │  │ Auto-Mgmt   │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
├─────────────────────────────────────────────────────────────┤
│ SQLite Database with FTS5                                   │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ entries + tags + relationships + significance + FTS     ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

-----

## 🛠️ Tools Available (Programmatic API)

### Core Tools

#### `create_entry` - Create Journal Entries

**Parameters:**

  - `content` (required): The journal entry content.
  - `entry_type` (optional): `personal_reflection`, `technical_achievement`, etc.
  - `is_personal` (optional): Boolean to separate personal vs project entries.
  - `significance_type` (optional): Mark as significant (`milestone`, `technical_breakthrough`).
  - `tags` (optional): Array of string tags.

#### `search_entries` - Full-Text Search

**Parameters:**

  - `query` (required): Search terms.
  - `limit` (optional): Max results (default: 10).

#### `semantic_search` - Vector Similarity Search

**Parameters:**

  - `query` (required): Search query for semantic similarity.
  - `limit` (optional): Max results (default: 10).
  - `similarity_threshold` (optional): Minimum score 0.0-1.0 (default: 0.3).

#### `get_recent_entries` - Retrieve Recent Entries

**Parameters:**

  - `limit` (optional): Number of entries (default: 5).

#### `list_tags` - Show All Tags

Returns all tags with usage statistics.

### Diagnostic Tools

  - **`test_simple`**: Basic connectivity test.
  - **`create_entry_minimal`**: Minimal entry creation for debugging.

-----

## 🎯 MCP Prompts (User-Initiated)

The server provides interactive prompts accessible through your MCP client's prompt palette (e.g., `/` in Cursor).

### `get-context-bundle`

Get the current project context as structured JSON.

**Arguments:**

  - `include_git` (optional, default: `true`): Include Git repository information.

**Sample Output:**

```json
{
  "repo_name": "memory-journal-mcp",
  "repo_path": "C:\\Users\\chris\\Desktop\\memory-journal-mcp", 
  "branch": "main",
  "last_commit": { "hash": "5ee4651", "message": "Update memory journal readme" },
  "github_issues": {
    "count": 2,
    "recent_issues": [
      { "number": 15, "title": "Add GitHub issue context...", "state": "OPEN" }
    ]
  },
  "cwd": "C:\\Users\\chris\\Desktop\\memory-journal-mcp",
  "timestamp": "2025-09-13T15:41:28.080365"
}
```

### `get-recent-entries`

Get the last X journal entries with formatted display.

**Arguments:**

  - `count` (optional, default: `5`): Number of entries to retrieve.
  - `personal_only` (optional, default: `false`): Only show personal entries.

**Sample Output:**

```
Here are the 1 most recent journal entries:

**Entry #10** (milestone) - 2025-09-13 19:41:28
Personal: False
Content: Successfully implemented MCP prompts functionality...

Context: memory-journal-mcp (main branch)
```

**💡 Troubleshooting & Notes:**

  - **GitHub CLI Required**: For issue data, install `gh` and authenticate with `gh auth login`. The tool falls back gracefully if `gh` is unavailable.
  - Prompts not appearing? Restart your MCP client after server changes.
  - Git operations timing out? Use `include_git=false` for faster context capture.

-----

## 🗄️ Data & Schema

### Database Schema

  - **`entries`**: Main journal entries with content and metadata.
  - **`tags`**: Auto-managed tags with usage tracking.
  - **`entry_tags`**: Many-to-many relationship between entries and tags.
  - **`relationships`**: Typed connections between entries.
  - **`significant_entries`**: Classification of important entries.
  - **`memory_journal_fts`**: FTS5 full-text search index.

### Context Bundle Example

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

### Entry, Relationship, and Significance Types

  - **Entry Types**: `personal_reflection`, `technical_achievement`, `milestone`, `development_note`, etc.
  - **Relationship Types**: `evolves_from`, `references`, `implements`, `clarifies`, `response_to`.
  - **Significance Types**: `identity_development`, `technical_breakthrough`, `project_completion`, `major_breakthrough`.

-----

## 🔧 Technical Implementation Details

### Performance & Security

  - **Thread Pool Execution**: All blocking I/O (database, Git) runs in background threads to keep the server responsive.
  - **Aggressive Timeouts**: Git operations timeout after 2 seconds per command.
  - **WAL Mode**: Write-Ahead Logging is enabled for better concurrency and crash recovery.
  - **Database Optimization**: 64MB cache, 256MB memory-mapped I/O, and `NORMAL` synchronous mode for a balance of speed and safety.
  - **Input Validation**: Length limits (50KB entries), character filtering, and parameterized queries to prevent SQL injection.
  - **Docker Security**: Non-root user execution and minimal container privileges.

### Semantic Search

  - **Dependencies**: Requires `pip install sentence-transformers faiss-cpu` (optional).
  - **Model**: Uses `all-MiniLM-L6-v2` (384-dimensional embeddings, \~100MB download).
  - **Graceful Degradation**: The system functions perfectly without these dependencies; the `semantic_search` tool will simply be unavailable.
  - **Storage**: Embeddings are stored as `BLOB` in SQLite, with a FAISS index for fast similarity search.

### Resources Provided

The server provides two MCP resources for direct data access:

  - **`memory://recent`**: Returns the 5 most recent journal entries.
  - **`memory://significant`**: Returns all entries marked with a significance classification.

-----

## 🔮 Future Roadmap

  - **Graph visualization** → See how your entries and projects connect.
  - **Team features** → Share context bundles and collaborate on project journals.
  - **Import/export utilities** → Backup/restore via markdown or JSON.
  - **Minimal CLI client** → Journal from the command line without a full MCP client.

## 📄 License

MIT License — do whatever you want, just don't blame us if it writes your autobiography.

## 🤝 Contributing

Built by developers, for developers. PRs are welcome, especially for new entry types, better Git/GitHub integrations, and performance improvements.

-----

## 🎯 Status

**✅ Ready for developers & Battle-tested**

  - All 7 MCP tools are working and tested.
  - Docker images are auto-deployed and validated.
  - Security has been hardened (WAL mode, input validation, non-root containers).
  - Context bundles seamlessly capture Git + GitHub data.
  - Both full-text and semantic search are functional and optimized.
  - The system is stable, with over 15+ entries created during development and testing.