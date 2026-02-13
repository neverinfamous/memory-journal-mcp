# Memory Journal MCP Server

**Last Updated February 13, 2026**

[![GitHub](https://img.shields.io/badge/GitHub-neverinfamous/memory--journal--mcp-blue?logo=github)](https://github.com/neverinfamous/memory-journal-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/writenotenow/memory-journal-mcp)](https://hub.docker.com/r/writenotenow/memory-journal-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
![Status](https://img.shields.io/badge/status-Production%2FStable-brightgreen)
[![npm](https://img.shields.io/npm/v/memory-journal-mcp)](https://www.npmjs.com/package/memory-journal-mcp)
[![Security](https://img.shields.io/badge/Security-Enhanced-green.svg)](https://github.com/neverinfamous/memory-journal-mcp/blob/main/SECURITY.md)
[![GitHub Stars](https://img.shields.io/github/stars/neverinfamous/memory-journal-mcp?style=social)](https://github.com/neverinfamous/memory-journal-mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://github.com/neverinfamous/memory-journal-mcp)

🎯 **AI Context + Project Intelligence:** Bridge disconnected AI sessions with persistent project memory, while integrating your complete GitHub workflow — Issues, PRs, Actions, Kanban boards, and knowledge graphs — into every conversation.

**[GitHub](https://github.com/neverinfamous/memory-journal-mcp)** • **[Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki)** • **[Changelog](https://github.com/neverinfamous/memory-journal-mcp/wiki/CHANGELOG)** • **[Release Article](https://adamic.tech/articles/memory-journal-mcp-server)**

## 🎯 What This Does

### Key Benefits

- 🧠 **Dynamic Context Management** - AI agents automatically query your project history and create entries at the right moments
- 📝 **Auto-capture Git/GitHub context** (commits, branches, issues, PRs, projects)
- 🔗 **Build knowledge graphs** linking specs → implementations → tests → PRs
- 🔍 **Triple search** (full-text, semantic, date range)
- 📊 **Generate reports** (standups, retrospectives, PR summaries, status)
- 🗄️ **Backup & restore** your journal data with one command

### Deployment Options

- **[Docker Hub](https://hub.docker.com/r/writenotenow/memory-journal-mcp)** - Node.js Alpine-based multi-platform support
- **[npm Package](https://www.npmjs.com/package/memory-journal-mcp)** - Simple `npm install -g` for local deployment
- **[MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.neverinfamous/memory-journal-mcp)**

```
+---------------------------+
| 🤖 AI Session Start       |
|---------------------------|
|  📋 Read Briefing         |
|  (memory://briefing)      |
+-------------+-------------+
              |
              v
+---------------------------+
| 📝 Journal Operations     |
|---------------------------|
|  - Create Entry           |
|  - Retrieve & Search      |
|  - Link Entries           |
+------+------+------+------+
       |      |      |
       |      |      |
       v      |      v
+--------------+   +---------------------------+
| 🔍 Triple    |<->| 🐙 GitHub Integration    |
|    Search    |   |---------------------------|
|--------------|   |  - Issues & Milestones    |
|  - Full-Text |   |  - Pull Requests          |
|    (FTS5)    |   |  - GitHub Actions         |
|  - Semantic  |   |  - Kanban Boards          |
|    (Vector)  |   +-------------+-------------+
|  - Date      |                 |
|    Range     |                 |
+------+-------+                 |
       |                         |
       v                         v
       +-----------+-------------+
                   |
                   v
        +---------------------------+
        | 📊 Outputs                |
        |---------------------------|
        |  - Standups & Retros      |
        |  - Knowledge Graphs       |
        |  - Project Timelines      |
        +---------------------------+
```

### 📈 **Current Capabilities**

- **33 MCP tools** - Complete development workflow + backup/restore + Kanban + issue management
- **15 workflow prompts** - Standups, retrospectives, PR workflows, CI/CD failure analysis, session acknowledgment
- **18 MCP resources** - 12 static + 6 template (require parameters)
- **GitHub Integration** - Projects, Issues, Pull Requests, Actions, **Kanban boards**
- **8 tool groups** - `core`, `search`, `analytics`, `relationships`, `export`, `admin`, `github`, `backup`
- **Knowledge graphs** - 8 relationship types, Mermaid visualization
- **Semantic search** - AI-powered conceptual search via `@xenova/transformers`

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
        "run",
        "--rm",
        "-i",
        "-v",
        "./data:/app/data",
        "writenotenow/memory-journal-mcp:latest"
      ]
    }
  }
}
```

### 4. Restart & Journal!

Restart Cursor or your MCP client and start journaling!

### GitHub Integration (Optional)

To enable GitHub tools (`get_github_issues`, `get_github_prs`, etc.), add environment variables:

```json
{
  "mcpServers": {
    "memory-journal-mcp": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-v",
        "./data:/app/data",
        "-e",
        "GITHUB_TOKEN",
        "-e",
        "GITHUB_REPO_PATH=/app/repo",
        "-v",
        "/path/to/your/repo:/app/repo:ro",
        "writenotenow/memory-journal-mcp:latest"
      ],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

| Environment Variable     | Description                                                            |
| ------------------------ | ---------------------------------------------------------------------- |
| `GITHUB_TOKEN`           | GitHub personal access token for API access                            |
| `GITHUB_REPO_PATH`       | Path to git repo inside container (mount your repo)                    |
| `DEFAULT_PROJECT_NUMBER` | Default GitHub Project number for auto-assignment when creating issues |
| `AUTO_REBUILD_INDEX`     | Set to `true` to rebuild vector index on server startup                |

**Without `GITHUB_REPO_PATH`**: Explicitly provide `owner` and `repo` when calling GitHub tools.

#### Fallback Behavior

When GitHub tools cannot auto-detect repository information:

1. **With `GITHUB_REPO_PATH` set**: Tools auto-detect `owner` and `repo` from your mounted repo's git remote
2. **Without `GITHUB_REPO_PATH`**: Tools return `requiresUserInput: true` with instructions
3. **With explicit parameters**: Always works - specify `owner` and `repo` directly

**Note**: In Docker, mount your repo read-only (`-v /path/to/repo:/app/repo:ro`) for auto-detection.

### Client-Specific Notes

**Cursor IDE:**

- **Listing MCP Resources**: If the agent has trouble listing resources, instruct it to call `ListMcpResources()` without specifying a server parameter, or with `server: "user-memory-journal-mcp"` (Cursor prefixes server names with `user-`).

**Google AntiGravity IDE:**

- **AntiGravity Users:** Server instructions are automatically sent to MCP clients during initialization. However, AntiGravity does not currently support MCP server instructions. For optimal usage in AntiGravity, manually provide the contents of [`src/constants/ServerInstructions.ts`](src/constants/ServerInstructions.ts) to the agent in your prompt or user rules.

- **Session start**: Add to your user rules: "At session start, read `memory://briefing` from memory-journal-mcp."

- **Full guidance**: If behaviors missing, read `memory://instructions` for complete Dynamic Context Management patterns.

- **Prompts not available**: AntiGravity does not currently support MCP prompts. The 15 workflow prompts are not accessible.

### HTTP/SSE Transport (Remote Access)

For remote access, web-based clients, or HTTP-compatible MCP hosts:

**Stateful Mode (default):**

```bash
docker run --rm -p 3000:3000 \
  -v ./data:/app/data \
  writenotenow/memory-journal-mcp:latest \
  --transport http --port 3000 --server-host 0.0.0.0
```

**Stateless Mode (serverless):**

```bash
docker run --rm -p 3000:3000 \
  -v ./data:/app/data \
  writenotenow/memory-journal-mcp:latest \
  --transport http --port 3000 --server-host 0.0.0.0 --stateless
```

**Endpoints:**

- `POST /mcp` — JSON-RPC requests (initialize, tools/call, resources/read, etc.)
- `GET /mcp` — SSE stream for server-to-client notifications (stateful only)
- `DELETE /mcp` — Session termination (stateful only)

**Session Management:** In stateful mode, include the `mcp-session-id` header (returned from initialization) in subsequent requests.

| Mode                      | Progress Notifications | SSE Streaming | Serverless |
| ------------------------- | ---------------------- | ------------- | ---------- |
| Stateful (default)        | ✅ Yes                 | ✅ Yes        | ⚠️ Complex |
| Stateless (`--stateless`) | ❌ No                  | ❌ No         | ✅ Native  |

**Example with curl (stateful):**

```bash
# Initialize session
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
# Returns mcp-session-id header

# List tools (with session)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: YOUR_SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

---

## ⚡ **Install to Cursor IDE**

### **One-Click Installation**

Click the button below to install directly into Cursor:

[![Install to Cursor](https://img.shields.io/badge/Install%20to%20Cursor-Click%20Here-blue?style=for-the-badge)](cursor://anysphere.cursor-deeplink/mcp/install?name=Memory%20Journal%20MCP&config=eyJtZW1vcnktam91cm5hbC1tY3AiOnsiYXJncyI6WyJydW4iLCItLXJtIiwiLWkiLCItdiIsIi4vZGF0YTovYXBwL2RhdGEiLCJ3cml0ZW5vdGVub3cvbWVtb3J5LWpvdXJuYWwtbWNwOmxhdGVzdCJdLCJjb21tYW5kIjoiZG9ja2VyIn19)

Or copy this deep link:

```
cursor://anysphere.cursor-deeplink/mcp/install?name=Memory%20Journal%20MCP&config=eyJtZW1vcnktam91cm5hbC1tY3AiOnsiYXJncyI6WyJydW4iLCItLXJtIiwiLWkiLCItdiIsIi4vZGF0YTovYXBwL2RhdGEiLCJ3cml0ZW5vdGVub3cvbWVtb3J5LWpvdXJuYWwtbWNwOmxhdGVzdCJdLCJjb21tYW5kIjoiZG9ja2VyIn19
```

### **Prerequisites**

- ✅ Docker installed and running
- ✅ ~300MB disk space available

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
- ✅ **No Native Dependencies** - Pure JS stack reduces attack surface

---

## ⚡ Core Features

### 🛠️ 33 MCP Tools (8 Groups)

| Group           | Tools | Description                                         |
| --------------- | ----- | --------------------------------------------------- |
| `core`          | 6     | Entry CRUD, tags, test                              |
| `search`        | 4     | Text search, date range, semantic, vector stats     |
| `analytics`     | 2     | Statistics, cross-project insights                  |
| `relationships` | 2     | Link entries, visualize graphs                      |
| `export`        | 1     | JSON/Markdown export                                |
| `admin`         | 5     | Update, delete, vector index management, merge tags |
| `github`        | 9     | Issues, PRs, context, Kanban, **issue lifecycle**   |
| `backup`        | 4     | Backup, list, restore, cleanup                      |

**[Complete tools documentation →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tools)**

### 🎯 15 Workflow Prompts

Standups • Retrospectives • Weekly digests • PR summaries • Code review prep • Goal tracking
**[Complete prompts guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Prompts)**

### 📡 18 Resources (12 Static + 6 Template)

Including `memory://briefing` for session initialization, `memory://instructions` for behavioral guidance, `memory://health` for diagnostics, and `memory://kanban/{n}` for Kanban boards. Template resources require parameters and are accessed directly by URI.
**[Resources documentation →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Resources)**

---

**Ask Cursor AI naturally:**

- "Show me my recent journal entries"
- "Create a backup of my journal"
- "Check the server health status"
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

# Tool filtering (optional - control which tools are exposed)
-e MEMORY_JOURNAL_MCP_TOOL_FILTER="-github"

# Server bind host (required for containers, default: localhost)
-e MCP_HOST=0.0.0.0

# Database location
-e DB_PATH=/app/data/custom.db
```

**Token Scopes:** `repo`, `project`, `read:org` (org projects only)
**[Full configuration guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Installation#configuration)**

### GitHub Management Capabilities

Memory Journal provides a **hybrid approach** to GitHub management:

| Capability Source  | Purpose                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| **MCP Server**     | Specialized features: Kanban visualization, journal linking, project timelines |
| **Agent (gh CLI)** | Full GitHub mutations: create/close issues, create/merge PRs, manage releases  |

**MCP Server Tools (Read + Kanban + Issue Lifecycle):**

- `get_github_issues` / `get_github_issue` - Query issues
- `get_github_prs` / `get_github_pr` - Query pull requests
- `get_github_context` - Full repository context
- `get_kanban_board` / `move_kanban_item` - **Kanban management**
- `create_github_issue_with_entry` / `close_github_issue_with_entry` - **Issue lifecycle with journal linking**

**Agent Operations (via gh CLI):**

```bash
# Issues
gh issue create --title "Bug fix" --body "Description"
gh issue close 42

# Pull Requests
gh pr create --fill
gh pr merge 123
```

> **Why this design?** The MCP server focuses on value-added features that integrate journal entries with GitHub (Kanban views, timeline resources, context linking). Standard GitHub mutations are handled by `gh` CLI, which agents can invoke directly.

**[Complete GitHub integration guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Git-Integration)**

### Tool Filtering

Control which tools are exposed using `MEMORY_JOURNAL_MCP_TOOL_FILTER`:

```bash
docker run -i --rm \
  -e MEMORY_JOURNAL_MCP_TOOL_FILTER="-github,-analytics" \
  -v ./data:/app/data \
  writenotenow/memory-journal-mcp:latest
```

**Common configurations:**

```bash
# Starter mode (core + search only)
-e MEMORY_JOURNAL_MCP_TOOL_FILTER="starter"

# Read-only mode (disable modifications)
-e MEMORY_JOURNAL_MCP_TOOL_FILTER="readonly"

# Full mode (all tools, default)
-e MEMORY_JOURNAL_MCP_TOOL_FILTER="full"
```

**Available tool groups:** `core`, `search`, `analytics`, `relationships`, `export`, `admin`, `github`, `backup`

**[Complete tool filtering guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tool-Filtering)**

---

## 📦 Image Details

| Platform                  | Features                                          |
| ------------------------- | ------------------------------------------------- |
| **AMD64** (x86_64)        | Complete: all tools, semantic search, Git context |
| **ARM64** (Apple Silicon) | Complete: all tools, semantic search, Git context |

**TypeScript Image Benefits:**

- **Node.js 24 on Alpine Linux** - Minimal footprint (~150MB compressed)
- **Pure JS Stack** - No native compilation, identical features on all platforms
- **sql.js** - SQLite in pure JavaScript
- **vectra** - Vector similarity search without native dependencies
- **@xenova/transformers** - ML embeddings in JavaScript
- **Instant Startup** - Lazy loading of ML models
- **Production/Stable** - Comprehensive error handling and automatic migrations

**Automated Deployment:**

- ⚡ **Always Fresh** - Images built within minutes of commits
- 🔒 **Security Scanned** - Automatic vulnerability scanning
- 🌍 **Multi-Platform** - Intel (amd64) and Apple Silicon (arm64)
- ✅ **Quality Tested** - Automated testing before deployment
- 📋 **SBOM Available** - Complete software bill of materials

**Available Tags:**

- `4.0.0` - Specific version (recommended for production)
- `3.0` - Latest patch in 3.0.x series
- `3` - Latest minor in 3.x series
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
      "args": ["run", "--rm", "-i", "-v", "./data:/app/data", "memory-journal-mcp-local"]
    }
  }
}
```

---

## 📚 Documentation & Resources

- **[GitHub Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki)** - Complete documentation
- **[npm Package](https://www.npmjs.com/package/memory-journal-mcp)** - Node.js distribution
- **[Issues](https://github.com/neverinfamous/memory-journal-mcp/issues)** - Bug reports & feature requests

---

## 📄 License

MIT License - See [LICENSE](https://github.com/neverinfamous/memory-journal-mcp/blob/main/LICENSE)

---

_Migrating from v2.x?_ Your existing database is fully compatible. The TypeScript version uses the same schema and data format.
