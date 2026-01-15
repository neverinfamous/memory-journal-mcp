# Memory Journal MCP Server

Last Updated January 15, 2026 - v3.1.5

<!-- mcp-name: io.github.neverinfamous/memory-journal-mcp -->

[![GitHub](https://img.shields.io/badge/GitHub-neverinfamous/memory--journal--mcp-blue?logo=github)](https://github.com/neverinfamous/memory-journal-mcp)
[![npm](https://img.shields.io/npm/v/memory-journal-mcp)](https://www.npmjs.com/package/memory-journal-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/writenotenow/memory-journal-mcp)](https://hub.docker.com/r/writenotenow/memory-journal-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
![Version](https://img.shields.io/badge/version-v3.1.5-green)
![Status](https://img.shields.io/badge/status-Production%2FStable-brightgreen)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-Published-green)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.neverinfamous/memory-journal-mcp)
[![Security](https://img.shields.io/badge/Security-Enhanced-green.svg)](SECURITY.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://github.com/neverinfamous/memory-journal-mcp)

🎯 **Solve the AI Context Problem:** Bridge the gap between disconnected AI sessions with persistent project memory - every AI conversation can access your complete development history, past decisions, and work patterns across any thread or timeframe.

**[GitHub](https://github.com/neverinfamous/memory-journal-mcp)** • **[Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki)** • **[Changelog](https://github.com/neverinfamous/memory-journal-mcp/wiki/CHANGELOG)** • **[Release Article](https://adamic.tech/articles/memory-journal-mcp-server)**

**🚀 Quick Deploy:**
- **[npm Package](https://www.npmjs.com/package/memory-journal-mcp)** - `npm install -g memory-journal-mcp`
- **[Docker Hub](https://hub.docker.com/r/writenotenow/memory-journal-mcp)** - Alpine-based with full semantic search

## 🎯 What This Does

### Key Benefits
- 🧠 **Dynamic Context Management** - AI agents automatically query your project history and create entries at the right moments
- 📝 **Auto-capture Git/GitHub context** (commits, branches, issues, PRs, projects)
- 🔗 **Build knowledge graphs** linking specs → implementations → tests → PRs  
- 🔍 **Triple search** (full-text, semantic, date range)
- 📊 **Generate reports** (standups, retrospectives, PR summaries, status)
- 🗄️ **Backup & restore** your journal data with one command

```mermaid
flowchart LR
    subgraph Problem["❌ Without Memory Journal"]
        direction TB
        A1["Session 1<br/>Context Lost"] --> A2["Session 2<br/>Start Over"]
    end
    
    subgraph Solution["✅ With Memory Journal"]
        direction TB
        B1["Session 1"] --> MJ[("📚 Memory<br/>Journal")]
        B2["Session 2"] --> MJ
        MJ --> |"Recall"| B1
        MJ --> |"Search"| B2
    end
    
    Problem -.->|"Solve with"| Solution
```

---

## ✨ What's New in v3.0.0 (December 28, 2025)

### 🚀 **Complete TypeScript Rewrite**

Memory Journal v3.0 is a ground-up rewrite in TypeScript, delivering:

- **Pure JS Stack** - No native compilation required (`sql.js` + `vectra` + `@xenova/transformers`)
- **Cross-Platform Portability** - Works on Windows, macOS, Linux without binary dependencies
- **Strict Type Safety** - Zero TypeScript errors, 100% strict mode compliance
- **Faster Startup** - Lazy ML loading with instant cold starts
- **MCP 2025-11-25 Compliance** - Full spec compliance with behavioral annotations

### 🗄️ **New: Backup & Restore Tools**

Never lose your journal data again:

| Tool | Description |
|------|-------------|
| `backup_journal` | Create timestamped database backups |
| `list_backups` | List all available backup files |
| `restore_backup` | Restore from any backup (with auto-backup before restore) |

### 📊 **New: Server Health Resource**

Get comprehensive server diagnostics via `memory://health`:

### 📈 **Current Capabilities**

- **29 MCP tools** - Complete development workflow + backup/restore + Kanban
- **15 workflow prompts** - Standups, retrospectives, PR workflows, CI/CD failure analysis, session acknowledgment
- **17 MCP resources** - 11 static + 6 template (require parameters)
- **GitHub Integration** - Projects, Issues, Pull Requests, Actions, **Kanban boards**
- **8 tool groups** - `core`, `search`, `analytics`, `relationships`, `export`, `admin`, `github`, `backup`
- **Knowledge graphs** - 5 relationship types, Mermaid visualization
- **Semantic search** - AI-powered conceptual search via `@xenova/transformers`

---

## 🎯 Why Memory Journal?

### **The Fragmented AI Context Problem**

When managing large projects with AI assistance, you face a critical challenge:

- **Thread Amnesia** - Each new AI conversation starts from zero, unaware of previous work
- **Lost Context** - Decisions, implementations, and learnings scattered across disconnected threads  
- **Repeated Work** - AI suggests solutions you've already tried or abandoned
- **Context Overload** - Manually copying project history into every new conversation

### **The Solution: Persistent Project Memory**

Memory Journal acts as your project's **long-term memory**, bridging the gap between fragmented AI threads:

**For Developers:**
- 📝 **Automatic Context Capture** - Git commits, branches, GitHub issues, PRs, and project state captured with every entry
- 🔗 **Knowledge Graph** - Link related work (specs → implementations → tests → PRs) to build a connected history
- 🔍 **Intelligent Search** - Find past decisions, solutions, and context across your entire project timeline
- 📊 **Project Analytics** - Track progress from issues through PRs, generate reports for standups/retrospectives

**For AI-Assisted Work:**
- 🧠 **Dynamic Context Management** - Built-in guidance teaches AI agents when to query your project history and when to create entries
- 💡 AI can query your **complete project history** in any conversation
- 🔍 **Semantic search** finds conceptually related work, even without exact keywords
- 📖 **Context bundles** provide AI with comprehensive project state instantly
- 🔗 **Relationship visualization** shows how different pieces of work connect

---

## 🚀 Quick Start

### Option 1: npm (Recommended)

**Step 1: Install the package**

```bash
npm install -g memory-journal-mcp
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

### Option 2: npx (No Installation)

```json
{
  "mcpServers": {
    "memory-journal-mcp": {
      "command": "npx",
      "args": ["-y", "memory-journal-mcp"]
    }
  }
}
```

### Option 3: From Source

```bash
git clone https://github.com/neverinfamous/memory-journal-mcp.git
cd memory-journal-mcp
npm install
npm run build
```

```json
{
  "mcpServers": {
    "memory-journal-mcp": {
      "command": "node",
      "args": ["dist/cli.js"]
    }
  }
}
```

### GitHub Integration Configuration

The GitHub tools (`get_github_issues`, `get_github_prs`, etc.) can auto-detect the repository from your git context. However, MCP clients may run the server from a different directory than your project.

**To enable GitHub auto-detection**, add `GITHUB_REPO_PATH` to your config:

```json
{
  "mcpServers": {
    "memory-journal-mcp": {
      "command": "memory-journal-mcp",
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here",
        "GITHUB_REPO_PATH": "/path/to/your/git/repo"
      }
    }
  }
}
```

| Environment Variable | Description |
|---------------------|-------------|
| `GITHUB_TOKEN` | GitHub personal access token for API access |
| `GITHUB_REPO_PATH` | Path to the git repository for auto-detecting owner/repo |

**Without `GITHUB_REPO_PATH`**: You'll need to explicitly provide `owner` and `repo` parameters when calling GitHub tools.

### Client-Specific Notes

**Cursor IDE:**
- **Listing MCP Resources**: If the agent has trouble listing resources, instruct it to call `ListMcpResources()` without specifying a server parameter, or with `server: "user-memory-journal-mcp"` (Cursor prefixes server names with `user-`).

**Google AntiGravity IDE:**
- **ServerInstructions not injected**: AntiGravity does not currently call `getServerInstructions()` or inject the server's behavioral guidance into the AI context. The AI agent will have access to tools but won't automatically know about Dynamic Context Management patterns.
- **Resource hints not honored**: The `memory://briefing` resource includes `autoRead` and `sessionInit` hints, but AntiGravity does not currently honor these. Have the agent manually read `memory://briefing` at session start for optimal context.
- **Workaround**: Add to your user rules: "At session start, read `memory://briefing` from memory-journal-mcp for project context." The briefing includes behavioral guidance and the 6 template resource URIs.

---

## 📋 Core Capabilities

### 🛠️ **29 MCP Tools** (8 Groups)

| Group | Tools | Description |
|-------|-------|-------------|
| `core` | 6 | Entry CRUD, tags, test |
| `search` | 4 | Text search, date range, semantic, vector stats |
| `analytics` | 2 | Statistics, cross-project insights |
| `relationships` | 2 | Link entries, visualize graphs |
| `export` | 1 | JSON/Markdown export |
| `admin` | 4 | Update, delete, rebuild/add to vector index |
| `github` | 7 | Issues, PRs, context, **Kanban board** |
| `backup` | 3 | Backup, list, restore |

**[Complete tools reference →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tools)**

### 🎯 **15 Workflow Prompts**

- `find-related` - Discover connected entries via semantic similarity
- `prepare-standup` - Daily standup summaries
- `prepare-retro` - Sprint retrospectives
- `weekly-digest` - Day-by-day weekly summaries
- `analyze-period` - Deep period analysis with insights
- `goal-tracker` - Milestone and achievement tracking
- `get-context-bundle` - Project context with Git/GitHub/Kanban
- `pr-summary` - Pull request journal activity summary
- `code-review-prep` - Comprehensive PR review preparation
- `pr-retrospective` - Completed PR analysis with learnings
- `actions-failure-digest` - CI/CD failure analysis
- `confirm-briefing` - **NEW** Acknowledge session context to user

**[Complete prompts guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Prompts)**

### 📡 **17 Resources** (11 Static + 6 Template)

**Static Resources** (appear in resource lists):
- `memory://briefing` - **Session initialization**: compact context for AI agents (~300 tokens)
- `memory://recent` - 10 most recent entries
- `memory://significant` - Significant milestones and breakthroughs
- `memory://graph/recent` - Live Mermaid diagram of recent relationships
- `memory://team/recent` - Recent team-shared entries
- `memory://health` - Server health & diagnostics
- `memory://graph/actions` - CI/CD narrative graph
- `memory://actions/recent` - Recent workflow runs
- `memory://tags` - All tags with usage counts
- `memory://statistics` - Journal statistics
- `memory://github/status` - GitHub repository status overview

**Template Resources** (require parameters, fetch directly by URI):
- `memory://projects/{number}/timeline` - Project activity timeline
- `memory://issues/{issue_number}/entries` - Entries linked to issue
- `memory://prs/{pr_number}/entries` - Entries linked to PR
- `memory://prs/{pr_number}/timeline` - Combined PR + journal timeline
- `memory://kanban/{project_number}` - GitHub Project Kanban board
- `memory://kanban/{project_number}/diagram` - Kanban Mermaid visualization

---

## 🔧 Configuration

### GitHub Integration (Optional)

```bash
export GITHUB_TOKEN="your_token"              # For Projects/Issues/PRs
export GITHUB_ORG_TOKEN="your_org_token"      # Optional: org projects
export DEFAULT_ORG="your-org-name"            # Optional: default org
```

**Scopes:** `repo`, `project`, `read:org` (org only)

### GitHub Management Capabilities

Memory Journal provides a **hybrid approach** to GitHub management:

| Capability Source | Purpose |
|-------------------|---------|
| **MCP Server** | Specialized features: Kanban visualization, journal linking, project timelines |
| **Agent (gh CLI)** | Full GitHub mutations: create/close issues, create/merge PRs, manage releases |

**MCP Server Tools (Read + Kanban):**
- `get_github_issues` / `get_github_issue` - Query issues
- `get_github_prs` / `get_github_pr` - Query pull requests
- `get_github_context` - Full repository context
- `get_kanban_board` / `move_kanban_item` - **Kanban management**

**Agent Operations (via gh CLI):**
```bash
# Issues
gh issue create --title "Bug fix" --body "Description"
gh issue close 42

# Pull Requests  
gh pr create --fill
gh pr merge 123

# Projects
gh project item-add 5 --owner neverinfamous --url "issue-url"

# Releases
gh release create v1.0.0 --generate-notes
```

> **Why this design?** The MCP server focuses on value-added features that integrate journal entries with GitHub (Kanban views, timeline resources, context linking). Standard GitHub operations are already excellently handled by `gh` CLI, which agents can invoke directly.

**[Complete GitHub integration guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Git-Integration)**

### Tool Filtering (Optional)

Control which tools are exposed using `MEMORY_JOURNAL_MCP_TOOL_FILTER`:

```bash
export MEMORY_JOURNAL_MCP_TOOL_FILTER="-analytics,-github"
```

**Filter Syntax:**
- `-group` - Disable all tools in a group
- `-tool` - Disable a specific tool
- `+tool` - Re-enable after group disable
- Meta-groups: `starter`, `essential`, `full`, `readonly`

**Example Configurations:**

```json
{
  "mcpServers": {
    "memory-journal-mcp": {
      "command": "memory-journal-mcp",
      "env": {
        "MEMORY_JOURNAL_MCP_TOOL_FILTER": "starter",
        "GITHUB_TOKEN": "your_token"
      }
    }
  }
}
```

| Configuration | Filter String | Tools |
|---------------|---------------|-------|
| Starter | `starter` | ~10 |
| Essential | `essential` | ~6 |
| Full (default) | `full` | 29 |
| Read-only | `readonly` | ~20 |

**[Complete tool filtering guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tool-Filtering)**

---

## 🏗️ Architecture

### Data Flow

```mermaid
flowchart TB
    AI["🤖 AI Agent<br/>(Cursor, Windsurf, Claude)"]
    
    subgraph MCP["Memory Journal MCP Server"]
        Tools["🛠️ 29 Tools"]
        Resources["📡 17 Resources"]
        Prompts["💬 15 Prompts"]
    end
    
    subgraph Storage["Persistence Layer"]
        SQLite[("💾 SQLite<br/>Entries, Tags, Relationships")]
        Vector[("🔍 Vector Index<br/>Semantic Embeddings")]
        Backups["📦 Backups"]
    end
    
    subgraph External["External Integrations"]
        GitHub["🐙 GitHub API<br/>Issues, PRs, Actions"]
        Kanban["📋 Projects v2<br/>Kanban Boards"]
    end
    
    AI <-->|"MCP Protocol"| MCP
    Tools --> Storage
    Tools --> External
    Resources --> Storage
    Resources --> External
```

### Stack

```
┌─────────────────────────────────────────────────────────────┐
│ MCP Server Layer (TypeScript)                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ Tools (29)      │  │ Resources (17)  │  │ Prompts (15)│  │
│  │ with Annotations│  │ with Annotations│  │             │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
├─────────────────────────────────────────────────────────────┤
│ Pure JS Stack (No Native Dependencies)                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ sql.js          │  │ vectra          │  │ transformers│  │
│  │ (SQLite)        │  │ (Vector Index)  │  │ (Embeddings)│  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
├─────────────────────────────────────────────────────────────┤
│ SQLite Database with Hybrid Search                          │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ entries + tags + relationships + embeddings + backups   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 Technical Highlights

### Performance & Portability
- **TypeScript + Pure JS Stack** - No native compilation, works everywhere
- **sql.js** - SQLite in pure JavaScript with disk sync
- **vectra** - Vector similarity search without native dependencies
- **@xenova/transformers** - ML embeddings in JavaScript
- **Lazy loading** - ML models load on first use, not startup

### Security
- **Local-first** - All data stored locally, no external API calls (except optional GitHub)
- **Input validation** - Zod schemas, content size limits, SQL injection prevention
- **Path traversal protection** - Backup filenames validated
- **MCP 2025-11-25 annotations** - Behavioral hints (`readOnlyHint`, `destructiveHint`, etc.)

### Data & Privacy
- **Single SQLite file** - You own your data
- **Portable** - Move your `.db` file anywhere
- **Soft delete** - Entries can be recovered
- **Auto-backup on restore** - Never lose data accidentally

---

## 📚 Documentation & Resources

- **[GitHub Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki)** - Complete documentation
- **[Docker Hub](https://hub.docker.com/r/writenotenow/memory-journal-mcp)** - Container images
- **[npm Package](https://www.npmjs.com/package/memory-journal-mcp)** - Node.js distribution
- **[Issues](https://github.com/neverinfamous/memory-journal-mcp/issues)** - Bug reports & feature requests

---

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Built by developers, for developers. PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

*Migrating from v2.x?* Your existing database is fully compatible. The TypeScript version uses the same schema and data format.
