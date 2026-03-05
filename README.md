# Memory Journal MCP Server

**Last Updated March 5, 2026**

<!-- mcp-name: io.github.neverinfamous/memory-journal-mcp -->

[![GitHub](https://img.shields.io/badge/GitHub-neverinfamous/memory--journal--mcp-blue?logo=github)](https://github.com/neverinfamous/memory-journal-mcp)
[![npm](https://img.shields.io/npm/v/memory-journal-mcp)](https://www.npmjs.com/package/memory-journal-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/writenotenow/memory-journal-mcp)](https://hub.docker.com/r/writenotenow/memory-journal-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
![Status](https://img.shields.io/badge/status-Production%2FStable-brightgreen)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-Published-green)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.neverinfamous/memory-journal-mcp)
[![Security](https://img.shields.io/badge/Security-Enhanced-green.svg)](SECURITY.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://github.com/neverinfamous/memory-journal-mcp)
![Coverage](https://img.shields.io/badge/Coverage-92%25-brightgreen.svg)
![Tests](https://img.shields.io/badge/Tests-590_passed-brightgreen.svg)

🎯 **AI Context + Project Intelligence:** Bridge disconnected AI sessions with persistent project memory and **automatic session handoff**. Integrates your complete GitHub workflow — Issues, PRs, Actions, Kanban boards, Milestones, Repository Insights, and Knowledge Graphs — into every conversation.

**[GitHub](https://github.com/neverinfamous/memory-journal-mcp)** • **[Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki)** • **[Changelog](CHANGELOG.md)** • **[Release Article](https://adamic.tech/articles/memory-journal-mcp-server)**

**🚀 Quick Deploy:**

- **[npm Package](https://www.npmjs.com/package/memory-journal-mcp)** - `npm install -g memory-journal-mcp`
- **[Docker Hub](https://hub.docker.com/r/writenotenow/memory-journal-mcp)** - Alpine-based with full semantic search

## 🎯 What This Does

### Key Benefits

- 🧠 **Dynamic Context Management** - AI agents automatically query your project history and create entries at the right moments
- 📝 **Auto-capture Git/GitHub context** (commits, branches, issues, milestones, PRs, projects)
- 🔗 **Build knowledge graphs** linking specs → implementations → tests → PRs
- 🔍 **Triple search** (full-text, semantic, date range)
- 📊 **Generate reports** (standups, retrospectives, PR summaries, status)
- 📈 **Track repository insights** — stars, forks, clones, views, top referrers, and popular paths (14-day rolling)
- 🗄️ **Backup & restore** your journal data with one command
- ⏰ **Automated maintenance** — scheduled backups, database optimization, and vector index rebuilds for long-running HTTP deployments

- 🔄 **Session continuity** — automatic end-of-session summaries flow into the next session's briefing
- 💡 **Rule & skill suggestions** — agents offer to codify your recurring patterns with your approval

```mermaid
flowchart TB
    subgraph Session["🤖 AI Session Start"]
        Briefing["📋 Read Briefing<br/>(memory://briefing)"]
    end

    subgraph Core["📝 Journal Operations"]
        Create["Create Entry"]
        Retrieve["Retrieve & Search"]
        Link["Link Entries"]
    end

    subgraph Search["🔍 Triple Search"]
        FTS["Full-Text (FTS5)"]
        Semantic["Semantic (Vector)"]
        DateRange["Date Range"]
    end

    subgraph GitHub["🐙 GitHub Integration"]
        Issues["Issues & Milestones"]
        PRs["Pull Requests"]
        Actions["GitHub Actions"]
        Kanban["Kanban Boards"]
        Insights["Repository Insights"]
    end

    subgraph Outputs["📊 Outputs"]
        Reports["Standups & Retrospectives"]
        Graphs["Knowledge Graphs"]
        Timeline["Project Timelines"]
    end

    subgraph SessionEnd["🔄 Session End"]
        Summary["Session Summary Entry<br/>(retrospective + session-summary tag)"]
    end

    Session --> Core
    Core --> Search
    Core <--> GitHub
    Search --> Outputs
    GitHub --> Outputs
    Core --> SessionEnd
    SessionEnd -.->|"next session"| Briefing
```

### 📈 **Current Capabilities**

- **39 MCP tools** - Complete development workflow + backup/restore + Kanban + Milestones + Insights + issue management
- **15 workflow prompts** - Standups, retrospectives, PR workflows, CI/CD failure analysis, session acknowledgment
- **20 MCP resources** - 13 static + 7 template (require parameters)
- **GitHub Integration** - Projects, Issues, Pull Requests, Actions, **Kanban boards**, **Milestones**
- **8 tool groups** - `core`, `search`, `analytics`, `relationships`, `export`, `admin`, `github`, `backup`
- **Knowledge graphs** - 8 relationship types, Mermaid visualization
- **Semantic search** - AI-powered conceptual search via `@xenova/transformers`
- **IDE Hooks** - Ready-to-use session-end configs for Cursor, Kiro, and Kilo Code ([setup →](hooks/))
- **Automated maintenance** - Scheduled backups, database optimization, and vector index rebuilds (HTTP/SSE only)

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
      "args": ["dist/cli.js", "--default-project", "1"]
    }
  }
}
```

### Option 4: HTTP/SSE Transport (Remote Access)

For remote access or web-based clients, run the server in HTTP mode:

```bash
memory-journal-mcp --transport http --port 3000
```

To bind to all interfaces (required for containers):

```bash
memory-journal-mcp --transport http --port 3000 --server-host 0.0.0.0
```

**Endpoints:**

| Endpoint         | Description                                      | Mode     |
| ---------------- | ------------------------------------------------ | -------- |
| `GET /`          | Server info and available endpoints              | Both     |
| `POST /mcp`      | JSON-RPC requests (initialize, tools/call, etc.) | Both     |
| `GET /mcp`       | SSE stream for server-to-client notifications    | Stateful |
| `DELETE /mcp`    | Session termination                              | Stateful |
| `GET /sse`       | Legacy SSE connection (MCP 2024-11-05)           | Stateful |
| `POST /messages` | Legacy SSE message endpoint                      | Stateful |
| `GET /health`    | Health check (`{ status, timestamp }`)           | Both     |

**Session Management:** The server uses stateful sessions by default. Include the `mcp-session-id` header (returned from initialization) in subsequent requests.

**Security Features:**

- **6 Security Headers** — `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, `Cache-Control`, `Referrer-Policy`, `Permissions-Policy`
- **Rate Limiting** — 100 requests/minute per IP (429 on excess)
- **CORS** — Configurable via `--cors-origin` or `MCP_CORS_ORIGIN` (default: `*`)
- **Body Size Limit** — 1 MB maximum
- **404 Handler** — Unknown paths return `{ error: "Not found" }`
- **Cross-Protocol Guard** — SSE session IDs rejected on `/mcp` and vice versa

**Example with curl:**

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

#### Stateless Mode (Serverless)

For serverless deployments (Lambda, Workers, Vercel), use stateless mode:

```bash
memory-journal-mcp --transport http --port 3000 --stateless
```

| Mode                      | Progress Notifications | Legacy SSE | Serverless |
| ------------------------- | ---------------------- | ---------- | ---------- |
| Stateful (default)        | ✅ Yes                 | ✅ Yes     | ⚠️ Complex |
| Stateless (`--stateless`) | ❌ No                  | ❌ No      | ✅ Native  |

#### Automated Scheduling (HTTP Only)

When running in HTTP/SSE mode, enable periodic maintenance jobs with CLI flags. These jobs run in-process on `setInterval` — no external cron needed.

> **Note:** These flags are ignored for stdio transport because stdio sessions are short-lived (tied to your IDE session). For stdio, use OS-level scheduling (Task Scheduler, cron) or run the backup/cleanup tools manually.

```bash
memory-journal-mcp --transport http --port 3000 \
  --backup-interval 60 --keep-backups 10 \
  --vacuum-interval 1440 \
  --rebuild-index-interval 720
```

| Flag                             | Default | Description                                                          |
| -------------------------------- | ------- | -------------------------------------------------------------------- |
| `--backup-interval <min>`        | 0 (off) | Create timestamped database backups and prune old ones automatically |
| `--keep-backups <count>`         | 5       | Max backups retained during automated cleanup                        |
| `--vacuum-interval <min>`        | 0 (off) | Run `PRAGMA optimize` and flush database to disk                     |
| `--rebuild-index-interval <min>` | 0 (off) | Full vector index rebuild to maintain semantic search quality        |

Each job is error-isolated — a failure in one job won't affect the others. Scheduler status (last run, result, next run) is visible via `memory://health`.

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

| Environment Variable     | Description                                                            |
| ------------------------ | ---------------------------------------------------------------------- |
| `DB_PATH`                | Database file location (CLI: `--db`; default: `./memory_journal.db`)   |
| `GITHUB_TOKEN`           | GitHub personal access token for API access                            |
| `GITHUB_REPO_PATH`       | Path to the git repository for auto-detecting owner/repo               |
| `DEFAULT_PROJECT_NUMBER` | Default GitHub Project number for auto-assignment when creating issues |
| `AUTO_REBUILD_INDEX`     | Set to `true` to rebuild vector index on server startup                |
| `MCP_HOST`               | Server bind host (`0.0.0.0` for containers, default: `localhost`)      |

**Without `GITHUB_REPO_PATH`**: You'll need to explicitly provide `owner` and `repo` parameters when calling GitHub tools.

#### Fallback Behavior

When GitHub tools cannot auto-detect repository information:

1. **With `GITHUB_REPO_PATH` set**: Tools auto-detect `owner` and `repo` from git remote URL
2. **Without `GITHUB_REPO_PATH`**: Tools return structured response with `requiresUserInput: true` and instructions to provide `owner` and `repo` parameters
3. **With explicit parameters**: Always preferred - specify `owner` and `repo` directly in tool calls

**Example response when auto-detection fails:**

```json
{
  "error": "Could not auto-detect repository",
  "requiresUserInput": true,
  "instruction": "Please provide owner and repo parameters"
}
```

### Client-Specific Notes

**Cursor IDE:**

- **Listing MCP Resources**: If the agent has trouble listing resources, instruct it to call `ListMcpResources()` without specifying a server parameter, or with `server: "user-memory-journal-mcp"` (Cursor prefixes server names with `user-`).

**Google AntiGravity IDE:**

- **Server instructions**: Auto-injected via MCP protocol but may be truncated. Read `memory://instructions` for the full, untruncated version.

- **Session start**: Add to your user rules: "At session start, read `memory://briefing` from memory-journal-mcp."

- **Prompts not available**: AntiGravity does not currently support MCP prompts. The 15 workflow prompts are not accessible.

---

### 🔄 Session Management

Memory Journal bridges AI sessions automatically — the agent reads project context at session start and captures a summary at session end.

**How it works:**

1. Session starts → agent reads `memory://briefing` and shows you a project context summary
2. Session ends → agent creates a `retrospective` entry tagged `session-summary`
3. Next session's briefing includes the previous summary — context flows seamlessly

**Setup by IDE:** Ready-to-use rules and hooks in [`hooks/`](hooks/):

| Client         | Primary (agent behavior)                                                                      | Optional (audit/logging)                                                                   |
| -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Cursor**     | Copy [`hooks/cursor/memory-journal.mdc`](hooks/cursor/memory-journal.mdc) to `.cursor/rules/` | Copy [`hooks/cursor/hooks.json`](hooks/cursor/hooks.json) + `session-end.sh` to `.cursor/` |
| **Kiro (AWS)** | Server instructions (automatic)                                                               | Copy [`hooks/kiro/session-end.md`](hooks/kiro/session-end.md) to `.kiro/hooks/`            |
| **Kilo Code**  | Server instructions (automatic)                                                               | Import [`hooks/kilo-code/session-end-mode.json`](hooks/kilo-code/session-end-mode.json)    |

**No rules or hooks?** The built-in server instructions handle both session start and end in any MCP client. The Cursor rule improves reliability by giving the agent explicit always-on instructions. This is **opt-out**: tell the agent "skip the summary" to disable session-end entries.

See [`hooks/README.md`](hooks/README.md) for detailed setup instructions.

---

## 📋 Core Capabilities

### 🛠️ **39 MCP Tools** (8 Groups)

| Group           | Tools | Description                                                                     |
| --------------- | ----- | ------------------------------------------------------------------------------- |
| `core`          | 6     | Entry CRUD, tags, test                                                          |
| `search`        | 4     | Text search, date range, semantic, vector stats                                 |
| `analytics`     | 2     | Statistics, cross-project insights                                              |
| `relationships` | 2     | Link entries, visualize graphs                                                  |
| `export`        | 1     | JSON/Markdown export                                                            |
| `admin`         | 5     | Update, delete, rebuild/add to vector index, merge tags                         |
| `github`        | 15    | Issues, PRs, context, Kanban, **Milestones**, **Insights**, **issue lifecycle** |
| `backup`        | 4     | Backup, list, restore, cleanup                                                  |

**[Complete tools reference →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tools)**

### 🎯 **15 Workflow Prompts**

- `find-related` - Discover connected entries via semantic similarity
- `prepare-standup` - Daily standup summaries
- `prepare-retro` - Sprint retrospectives
- `weekly-digest` - Day-by-day weekly summaries
- `analyze-period` - Deep period analysis with insights
- `goal-tracker` - Milestone and achievement tracking
- `get-context-bundle` - Project context with Git/GitHub/Kanban
- `get-recent-entries` - Formatted recent entries
- `project-status-summary` - GitHub Project status reports
- `pr-summary` - Pull request journal activity summary
- `code-review-prep` - Comprehensive PR review preparation
- `pr-retrospective` - Completed PR analysis with learnings
- `actions-failure-digest` - CI/CD failure analysis
- `project-milestone-tracker` - Milestone progress tracking
- `confirm-briefing` - Acknowledge session context to user

**[Complete prompts guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Prompts)**

### 📡 **20 Resources** (13 Static + 7 Template)

**Static Resources** (appear in resource lists):

- `memory://briefing` - **Session initialization**: compact context for AI agents (~300 tokens)
- `memory://instructions` - **Behavioral guidance**: complete server instructions for AI agents
- `memory://recent` - 10 most recent entries
- `memory://significant` - Significant milestones and breakthroughs
- `memory://graph/recent` - Live Mermaid diagram of recent relationships

- `memory://health` - Server health & diagnostics
- `memory://graph/actions` - CI/CD narrative graph
- `memory://actions/recent` - Recent workflow runs
- `memory://tags` - All tags with usage counts
- `memory://statistics` - Journal statistics
- `memory://github/status` - GitHub repository status overview
- `memory://github/insights` - Repository stars, forks, and 14-day traffic summary
- `memory://github/milestones` - Open milestones with completion percentages

**Template Resources** (require parameters, fetch directly by URI):

- `memory://projects/{number}/timeline` - Project activity timeline
- `memory://issues/{issue_number}/entries` - Entries linked to issue
- `memory://prs/{pr_number}/entries` - Entries linked to PR
- `memory://prs/{pr_number}/timeline` - Combined PR + journal timeline
- `memory://kanban/{project_number}` - GitHub Project Kanban board
- `memory://kanban/{project_number}/diagram` - Kanban Mermaid visualization
- `memory://milestones/{number}` - Milestone detail with completion progress

---

## 🔧 Configuration

### GitHub Integration (Optional)

```bash
export GITHUB_TOKEN="your_token"              # For Projects/Issues/PRs
```

**Scopes:** `repo`, `project`, `read:org` (org-level project discovery only)

### GitHub Management Capabilities

Memory Journal provides a **hybrid approach** to GitHub management:

| Capability Source  | Purpose                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------ |
| **MCP Server**     | Specialized features: Kanban visualization, Milestones, journal linking, project timelines |
| **Agent (gh CLI)** | Full GitHub mutations: create/close issues, create/merge PRs, manage releases              |

**MCP Server Tools (Read + Kanban + Milestones + Issue Lifecycle):**

- `get_github_issues` / `get_github_issue` - Query issues
- `get_github_prs` / `get_github_pr` - Query pull requests
- `get_github_context` - Full repository context
- `get_kanban_board` / `move_kanban_item` - **Kanban management**
- `get_github_milestones` / `get_github_milestone` - **Milestone tracking with completion %**
- `create_github_milestone` / `update_github_milestone` / `delete_github_milestone` - **Milestone CRUD**
- `get_repo_insights` - **Repository traffic & analytics** (stars, clones, views, referrers, popular paths)
- `create_github_issue_with_entry` / `close_github_issue_with_entry` - **Issue lifecycle with journal linking**

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

| Configuration  | Filter String | Tools |
| -------------- | ------------- | ----- |
| Starter        | `starter`     | ~10   |
| Essential      | `essential`   | ~6    |
| Full (default) | `full`        | 39    |
| Read-only      | `readonly`    | ~15   |

**[Complete tool filtering guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tool-Filtering)**

---

## 🏗️ Architecture

### Data Flow

```mermaid
flowchart TB
    AI["🤖 AI Agent<br/>(Cursor, Windsurf, Claude)"]

    subgraph MCP["Memory Journal MCP Server"]
        Tools["🛠️ 39 Tools"]
        Resources["📡 20 Resources"]
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
│  │ Tools (39)      │  │ Resources (21)  │  │ Prompts (15)│  │
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

### Performance Benchmarks

Memory Journal is designed for extremely low overhead during AI task execution. We include a `vitest bench` suite to maintain these baseline guarantees:

- **Database Reads**: Operations execute in fractions of a millisecond. `calculateImportance` is ~55x faster than retrieving 50 recent entries.
- **Vector Search Engine**: Semantic searches via `vectra` perform significantly faster than parallel entry indexing (>190x faster locally).
- **Core MCP Routines**: Complex operations exhibit negligible latency when executed through standard MCP tools. Calling tools natively adds ~1.4x overhead compared to direct function execution.

To run the benchmarking suite locally:

```bash
npm run bench
```

### Security

- **Local-first** - All data stored locally, no external API calls (except optional GitHub)
- **Input validation** - Zod schemas, content size limits, SQL injection prevention
- **Path traversal protection** - Backup filenames validated
- **MCP 2025-11-25 annotations** - Behavioral hints (`readOnlyHint`, `destructiveHint`, etc.)
- **HTTP transport hardening** - 6 security headers (`X-Content-Type-Options`, `X-Frame-Options`, `CSP`, `Cache-Control`, `Referrer-Policy`, `Permissions-Policy`), configurable CORS, 1MB body limit, rate limiting (100 req/min), 30-min session timeout, 404 handler, cross-protocol guard
- **Token scrubbing** - GitHub tokens and credentials automatically redacted from error logs

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

_Migrating from v2.x?_ Your existing database is fully compatible. The TypeScript version uses the same schema and data format.
