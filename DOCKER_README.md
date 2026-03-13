# Memory Journal MCP Server

[![GitHub](https://img.shields.io/badge/GitHub-neverinfamous/memory--journal--mcp-blue?logo=github)](https://github.com/neverinfamous/memory-journal-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/writenotenow/memory-journal-mcp)](https://hub.docker.com/r/writenotenow/memory-journal-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
![Status](https://img.shields.io/badge/status-Production%2FStable-brightgreen)
[![npm](https://img.shields.io/npm/v/memory-journal-mcp)](https://www.npmjs.com/package/memory-journal-mcp)
[![Security](https://img.shields.io/badge/Security-Enhanced-green.svg)](https://github.com/neverinfamous/memory-journal-mcp/blob/main/SECURITY.md)
[![GitHub Stars](https://img.shields.io/github/stars/neverinfamous/memory-journal-mcp?style=social)](https://github.com/neverinfamous/memory-journal-mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://github.com/neverinfamous/memory-journal-mcp)
![Coverage](https://img.shields.io/badge/Coverage-93%78-brightgreen.svg)
![Tests](https://img.shields.io/badge/Tests-785_passed-brightgreen.svg)

🎯 **AI Context + Project Intelligence:** Bridge disconnected AI sessions with persistent project memory and **automatic session handoff** — with full GitHub workflow integration.

**[GitHub](https://github.com/neverinfamous/memory-journal-mcp)** • **[Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki)** • **[Changelog](https://github.com/neverinfamous/memory-journal-mcp/blob/main/CHANGELOG.md)** • **[Release Article](https://adamic.tech/articles/memory-journal-mcp-server)**

## 🎯 What This Does

### Key Benefits

**44 MCP Tools** · **16 Workflow Prompts** · **22 Resources** · **10 Tool Groups** · **Code Mode** · **GitHub Integration** (Issues, PRs, Actions, Kanban, Milestones, Insights)

- 🧠 **Dynamic Context Management** - AI agents automatically query your project history and create entries at the right moments
- 📝 **Auto-capture Git/GitHub context** (commits, branches, issues, milestones, PRs, projects)
- 🔗 **Knowledge graphs** - 8 relationship types linking specs → implementations → tests → PRs with Mermaid visualization
- 🔍 **Triple search** - full-text, semantic (AI-powered via `@huggingface/transformers`), and date range
- 📊 **Generate reports** (standups, retrospectives, PR summaries, status)
- 📈 **Track repository insights** — stars, forks, clones, views, top referrers, and popular paths (14-day rolling)
- 🗄️ **Backup & restore** your journal data with one command
- ⏰ **Automated maintenance** — scheduled backups, database optimization, and vector index rebuilds for long-running containers
- 🌐 **Dual HTTP transport** — Streamable HTTP (`/mcp`) for modern clients + legacy SSE (`/sse`) for backward compatibility, with stateless mode for serverless deployments
- 👥 **Team collaboration** — separate public team database with author attribution, cross-DB search, and dedicated team tools
- 🔄 **Session continuity** — a quick `/session-summary` captures your progress and feeds it into the next session's briefing
- 💡 **Rule & skill suggestions** — agents offer to codify your recurring patterns with your approval
- ⚡ **Code Mode** — execute complex, multi-step operations in a secure JavaScript sandbox. Exposes all 43 capabilities via `mj.*` API, reducing token overhead by up to 90%
- ✅ **Deterministic error handling** — every tool returns structured `{success, error, code, category, suggestion, recoverable}` responses — no raw exceptions, no silent failures. Agents get actionable context instead of cryptic stack traces

**Ask Agent naturally:**

- "Show me my recent journal entries"
- "Create a backup of my journal"
- "Check the server health status"
- "Find entries related to performance"

**[See complete examples & prompts →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Examples)**

### Deployment Options

- **[Docker Hub](https://hub.docker.com/r/writenotenow/memory-journal-mcp)** - Node.js Alpine-based multi-platform support
- **[npm Package](https://www.npmjs.com/package/memory-journal-mcp)** - Simple `npm install -g` for local deployment
- **[MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.neverinfamous/memory-journal-mcp)**

**Flow:** AI Session Start → Read `memory://briefing` → Journal Operations (Create, Search, Link) → Triple Search + GitHub Integration → Outputs (Standups, Knowledge Graphs, Timelines) → Use `session-summary` prompt when ready to capture session context

### Tool Filtering

> [!IMPORTANT]
> All shortcuts and tool groups include **Code Mode** (`mj_execute_code`) by default for token-efficient operations. To exclude it, add `-codemode` to your filter.

Control which tools are exposed via `MEMORY_JOURNAL_MCP_TOOL_FILTER` (or CLI: `--tool-filter`):

| Filter               | Tools | Use Case                 |
| -------------------- | ----- | ------------------------ |
| `full`               | 43    | All tools (default)      |
| `starter`            | ~10   | Core + search + codemode |
| `essential`          | ~6    | Minimal footprint        |
| `readonly`           | ~15   | Disable all mutations    |
| `-github`            | 28    | Exclude a group          |
| `-github,-analytics` | 26    | Exclude multiple groups  |

**Filter Syntax:** `-group` (disable group) · `-tool` (disable tool) · `+tool` (re-enable after group disable)

**Groups:** `core`, `search`, `analytics`, `relationships`, `export`, `admin`, `github`, `backup`, `team`, `codemode`

**[Complete tool filtering guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tool-Filtering)**

## 📋 Core Capabilities

### 🛠️ 44 MCP Tools (10 Groups)

| Group           | Tools | Description                                                                     |
| --------------- | ----- | ------------------------------------------------------------------------------- |
| `codemode`      | 1     | Code Mode (sandboxed code execution) 🌟 **Recommended**                         |
| `core`          | 6     | Entry CRUD, tags, test                                                          |
| `search`        | 4     | Text search, date range, semantic, vector stats                                 |
| `analytics`     | 2     | Statistics, cross-project insights                                              |
| `relationships` | 2     | Link entries, visualize graphs                                                  |
| `export`        | 1     | JSON/Markdown export                                                            |
| `admin`         | 5     | Update, delete, rebuild/add to vector index, merge tags                         |
| `github`        | 16    | Issues, PRs, context, Kanban, **Milestones**, **Insights**, **issue lifecycle**, **Copilot Reviews** |
| `backup`        | 4     | Backup, list, restore, cleanup                                                  |
| `team`          | 3     | Team create, get recent, search (requires `TEAM_DB_PATH`)                       |

**[Complete tools documentation →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tools)**

### 🎯 **16 Workflow Prompts**

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
- `session-summary` - Create a session summary entry with accomplishments, pending items, and next-session context

**[Complete prompts guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Prompts)**

### 📡 **22 Resources** (15 Static + 7 Template)

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
- `memory://team/recent` - Recent team entries with author attribution
- `memory://team/statistics` - Team entry counts, types, and author breakdown

**Template Resources** (require parameters, fetch directly by URI):

- `memory://projects/{number}/timeline` - Project activity timeline
- `memory://issues/{issue_number}/entries` - Entries linked to issue
- `memory://prs/{pr_number}/entries` - Entries linked to PR
- `memory://prs/{pr_number}/timeline` - Combined PR + journal timeline
- `memory://kanban/{project_number}` - GitHub Project Kanban board
- `memory://kanban/{project_number}/diagram` - Kanban Mermaid visualization
- `memory://milestones/{number}` - Milestone detail with completion progress

**[Resources documentation →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Resources)**

## 🚀 Quick Start (2 Minutes)

**Prerequisites:** Docker installed and running · ~300MB disk space · **[Full Installation Guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Installation)**

### 1. Pull the Image

```bash
docker pull writenotenow/memory-journal-mcp:latest
```

### 2. Create Data Directory

```bash
mkdir data
```

### 3. Add to MCP Config

Add this to your `~/.cursor/mcp.json`, Claude Desktop config, or equivalent:

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

**Variants** (modify the config above):

| Variant | Change |
|---------|--------|
| **Minimal (no GitHub)** | Remove the `-e GITHUB_TOKEN`, `-e GITHUB_REPO_PATH`, repo volume mount, and `env` block |
| **Team collaboration** | Add `-e`, `"TEAM_DB_PATH=/app/data/team.db"` to `args` |
| **Code Mode only** | Add `"--tool-filter"`, `"codemode"` to `args` (single tool, all capabilities) |
| **Force WASM Fallback** | Add `"--no-sqlite-native"` to `args` to disable the native engine |
| **Briefing config** | Add `-e`, `"BRIEFING_ENTRY_COUNT=5"` to `args` (see env var table below) |
| **Local build** | Replace `writenotenow/memory-journal-mcp:latest` with your local image name |

### 4. Restart & Journal!

Restart Cursor or your MCP client and start journaling!

| Environment Variable     | Description                                                             |
| ------------------------ | ----------------------------------------------------------------------- |
| `DB_PATH`                | Database location (default: `/app/data/memory_journal.db` in Docker)    |
| `TEAM_DB_PATH`           | Team database file location (CLI: `--team-db`)                          |
| `TEAM_AUTHOR`            | Override author name for team entries (default: `git config user.name`) |
| `GITHUB_TOKEN`           | GitHub personal access token for API access                             |
| `GITHUB_REPO_PATH`       | Path to git repo inside container (mount your repo)                     |
| `DEFAULT_PROJECT_NUMBER` | Default GitHub Project number for auto-assignment when creating issues  |
| `AUTO_REBUILD_INDEX`     | Set to `true` to rebuild vector index on server startup                 |
| `MCP_HOST`               | Server bind host (`0.0.0.0` for containers, default: `localhost`)       |
| `OAUTH_ENABLED`          | Set to `true` to enable OAuth 2.1 authentication (HTTP only)            |
| `OAUTH_ISSUER`           | OAuth issuer URL (e.g., `https://auth.example.com/realms/mcp`)          |
| `OAUTH_AUDIENCE`         | Expected JWT audience claim                                             |
| `OAUTH_JWKS_URI`         | JWKS endpoint for token signature verification                          |
| `BRIEFING_ENTRY_COUNT`   | Journal entries in briefing (CLI: `--briefing-entries`; default: `3`)   |
| `BRIEFING_INCLUDE_TEAM`  | Include team DB entries in briefing (`true`/`false`; default: `false`)  |
| `BRIEFING_ISSUE_COUNT`   | Issues to list in briefing; `0` = count only (default: `0`)             |
| `BRIEFING_PR_COUNT`      | PRs to list in briefing; `0` = count only (default: `0`)                |
| `BRIEFING_PR_STATUS`     | Show PR status breakdown (open/merged/closed; default: `false`)         |
| `BRIEFING_WORKFLOW_COUNT`| Workflow runs to list in briefing; `0` = status only (default: `0`)     |
| `BRIEFING_WORKFLOW_STATUS`| Show workflow status breakdown in briefing (default: `false`)          |
| `BRIEFING_COPILOT_REVIEWS`| Aggregate Copilot review state in briefing (default: `false`)         |
| `RULES_FILE_PATH`        | Path to user rules file for agent awareness (CLI: `--rules-file`)       |
| `SKILLS_DIR_PATH`        | Path to skills directory for agent awareness (CLI: `--skills-dir`)      |

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

### 🔄 Session Management

Memory Journal bridges AI sessions with a three-step cycle:

1. **Session start** → agent reads `memory://briefing` and shows you a project context summary (automatic via server instructions)
2. **Session summary** → use the `session-summary` prompt to capture what was accomplished, what's pending, and context for the next session
3. Next session's briefing includes the previous summary — context flows seamlessly

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

| Endpoint                                    | Description                                      | Mode     |
| ------------------------------------------- | ------------------------------------------------ | -------- |
| `GET /`                                     | Server info and available endpoints              | Both     |
| `POST /mcp`                                 | JSON-RPC requests (initialize, tools/call, etc.) | Both     |
| `GET /mcp`                                  | SSE stream for server-to-client notifications    | Stateful |
| `DELETE /mcp`                               | Session termination                              | Stateful |
| `GET /sse`                                  | Legacy SSE connection (MCP 2024-11-05)           | Stateful |
| `POST /messages`                            | Legacy SSE message endpoint                      | Stateful |
| `GET /health`                               | Health check (`{ status, timestamp }`)           | Both     |
| `GET /.well-known/oauth-protected-resource` | RFC 9728 Protected Resource Metadata             | Both     |

**Session Management:** In stateful mode, include the `mcp-session-id` header (returned from initialization) in subsequent requests.

**Security Features:**

- **OAuth 2.1 Authentication** — RFC 9728/8414 compliant with JWT validation, JWKS caching, and granular scope enforcement (opt-in via `--oauth-enabled`)
- **7 Security Headers** — `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, `Cache-Control`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security` (opt-in)
- **Rate Limiting** — 100 requests/minute per IP with built-in sliding window (429 on excess)
- **CORS** — Configurable via `--cors-origin` or `MCP_CORS_ORIGIN` (default: `*`). Supports comma-separated multiple origins and wildcard subdomains (e.g., `*.example.com`)
- **Body Size Limit** — 1 MB maximum (configurable)
- **Server Timeouts** — Request (120s), keep-alive (65s), and headers (66s) timeouts for DoS mitigation
- **404 Handler** — Unknown paths return `{ error: "Not found" }`
- **Cross-Protocol Guard** — SSE session IDs rejected on `/mcp` and vice versa
- **Build Provenance** - Cryptographic proof of build process
- **SBOM Available** - Complete software bill of materials
- **Supply Chain Attestations** - Verifiable build integrity
- **Non-root Execution** - Minimal attack surface
- **No Native Dependencies (Optional)** - Pure JS fallback reduces attack surface when native builds fail

| Mode                      | Progress Notifications | Legacy SSE | Serverless |
| ------------------------- | ---------------------- | ---------- | ---------- |
| Stateful (default)        | ✅ Yes                 | ✅ Yes     | ⚠️ Complex |
| Stateless (`--stateless`) | ❌ No                  | ❌ No      | ✅ Native  |

#### Automated Scheduling (HTTP Only)

Enable periodic maintenance jobs for long-running containers. These jobs run in-process on `setInterval` — no external cron needed.

> **Note:** These flags only work with HTTP/SSE transport. Stdio sessions (IDE integrations) are short-lived — use `backup_journal` and `cleanup_backups` tools manually instead.

```bash
docker run --rm -p 3000:3000 \
  -v ./data:/app/data \
  writenotenow/memory-journal-mcp:latest \
  --transport http --port 3000 --server-host 0.0.0.0 \
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

**Example with curl:**

Initialize session (returns `mcp-session-id` header). Include `mcp-session-id` header in subsequent requests.

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

## 🔐 OAuth 2.1 Authentication

For production deployments, enable OAuth 2.1 on the HTTP transport:

| Component                   | Status | Description                                      |
| --------------------------- | ------ | ------------------------------------------------ |
| Protected Resource Metadata | ✅     | RFC 9728 `/.well-known/oauth-protected-resource` |
| Auth Server Discovery       | ✅     | RFC 8414 metadata discovery with caching         |
| Token Validation            | ✅     | JWT validation with JWKS support                 |
| Scope Enforcement           | ✅     | Granular `read`, `write`, `admin` scopes         |

**Scopes:** `read` (core, search, analytics, relationships, export) · `write` (github, team + read) · `admin` (admin, backup, codemode + all)

```bash
docker run --rm -p 3000:3000 \
  -v ./data:/app/data \
  -e OAUTH_ENABLED=true \
  -e OAUTH_ISSUER=https://auth.example.com/realms/mcp \
  -e OAUTH_AUDIENCE=memory-journal-mcp \
  writenotenow/memory-journal-mcp:latest \
  --transport http --port 3000 --server-host 0.0.0.0
```

> **Note:** OAuth is opt-in. When not enabled, the server falls back to simple token authentication via `MCP_AUTH_TOKEN`, or runs without authentication.

## ️ Supply Chain Security

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

## 🔧 Configuration

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

**[Complete GitHub integration guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Git-Integration)**

## 📦 Image Details

| Platform                  | Features                                          |
| ------------------------- | ------------------------------------------------- |
| **AMD64** (x86_64)        | Complete: all tools, semantic search, Git context |
| **ARM64** (Apple Silicon) | Complete: all tools, semantic search, Git context |

**TypeScript Image Benefits:**

- **Node.js 24 on Alpine Linux** - Minimal footprint (~150MB compressed)
- **Dual-Backend Architecture** - Native `better-sqlite3` performance with pure JS `sql.js` fallback
- **sqlite-vec** - Vector similarity search via SQLite extension
- **@huggingface/transformers** - ML embeddings in JavaScript
- **Faster Startup** - Lazy loading of ML models
- **Production/Stable** - Deterministic error handling (`{success, error, code, category, suggestion, recoverable}` on every tool) and automatic migrations

Designed for extremely low overhead: database reads in sub-millisecond, vector search and indexing both exceed 640 ops/sec, tool dispatch cached at O(1) with >4800x overhead reduction. Run `npm run bench` for local benchmarks.

**Automated Deployment:**

- ⚡ **Always Fresh** - Images built within minutes of commits
- 🔒 **Security Scanned** - Automatic vulnerability scanning
- 🌍 **Multi-Platform** - Intel (amd64) and Apple Silicon (arm64)
- ✅ **Quality Tested** - Automated testing before deployment
- 📋 **SBOM Available** - Complete software bill of materials

**Available Tags:**

- `5.1.1` - Specific version (recommended for production)
- `5.1` - Latest patch in 5.1.x series
- `5` - Latest minor in 5.x series
- `latest` - Always the newest version
- `sha256-<digest>` - SHA-pinned for maximum security

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

## 📚 Documentation & Resources

- **[GitHub Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki)** - Complete documentation
- **[npm Package](https://www.npmjs.com/package/memory-journal-mcp)** - Node.js distribution
- **[Issues](https://github.com/neverinfamous/memory-journal-mcp/issues)** - Bug reports & feature requests

## 📄 License

MIT License - See [LICENSE](https://github.com/neverinfamous/memory-journal-mcp/blob/main/LICENSE)

_Migrating from v2.x?_ Your existing database is fully compatible. The TypeScript version uses the same schema and data format.
