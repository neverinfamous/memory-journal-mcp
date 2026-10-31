# Memory Journal MCP Server

[![GitHub](https://img.shields.io/badge/GitHub-neverinfamous/memory--journal--mcp-blue?logo=github)](https://github.com/neverinfamous/memory-journal-mcp) [![Docker Pulls](https://img.shields.io/docker/pulls/writenotenow/memory-journal-mcp)](https://hub.docker.com/r/writenotenow/memory-journal-mcp) [![npm](https://img.shields.io/npm/v/memory-journal-mcp)](https://www.npmjs.com/package/memory-journal-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT) ![Status](https://img.shields.io/badge/status-Production%2FStable-brightgreen)
[![Security](https://img.shields.io/badge/Security-Enhanced-green.svg)](https://github.com/neverinfamous/memory-journal-mcp/blob/main/SECURITY.md) [![GitHub Stars](https://img.shields.io/github/stars/neverinfamous/memory-journal-mcp?style=social)](https://github.com/neverinfamous/memory-journal-mcp) [![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://github.com/neverinfamous/memory-journal-mcp)
![Coverage](https://img.shields.io/badge/Coverage-81.06%25-yellowgreen.svg) ![E2E](https://img.shields.io/badge/E2E-448%20passing%20%C2%B7%200%20skipped-blue.svg) ![Tests](https://img.shields.io/badge/Tests-1782_passed-brightgreen.svg)
![E2E Tests](https://img.shields.io/badge/E2E_Tests-391_passed-brightgreen.svg) [![CI](https://github.com/neverinfamous/memory-journal-mcp/actions/workflows/gatekeeper.yml/badge.svg)](https://github.com/neverinfamous/memory-journal-mcp/actions/workflows/gatekeeper.yml)

**[GitHub](https://github.com/neverinfamous/memory-journal-mcp)** • **[Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki)** • **[Changelog](https://github.com/neverinfamous/memory-journal-mcp/blob/main/CHANGELOG.md)** • **[Release Article](https://adamic.tech/articles/memory-journal-mcp-server)**

> [!TIP]
> **Value Proposition**
> Bridge disconnected AI sessions seamlessly. Enable persistent project memory instantly. Automate handoffs with robust GitHub integration. Eliminate AI amnesia today.

## 🧠 Eliminate AI Amnesia

Large projects face a critical challenge. You lose context between sessions.

- **Stop Thread Amnesia** - AI conversations start fresh. They ignore previous work.
- **Retain Deep Context** - You scatter decisions and code across threads. We save them.
- **End Repeated Work** - AI repeats failed solutions. We remember your attempts.

Memory Journal builds your project's long-term memory. It bridges fragmented AI sessions seamlessly.

**Experience true context-aware development:**

- _"Why did we choose SQLite over Postgres for this service last month?"_ (Semantic search)
- _"Run the `/issue-triage` workflow on the top priority ticket in the Kanban board."_ (GitHub operations)
- _"Who has been touching the auth module recently, and what's our team collaboration density?"_ (Team analytics)
- _"Commit the changes and automatically generate a structured journal entry using the \`--journal\` wrapper flag."_ (Automated lifecycles)
- _"Draw a visual graph showing how my last 10 architectural decisions relate to each other."_ (Knowledge graph)

**[See complete examples & prompts →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Examples)**

---

## 🎯 What Sets Us Apart

**MCP Tools** · **Workflow Prompts** · **Resources** · **Tool Groups** · **Code Mode** · **GitHub Commander** (Issue Triage, PR Review, Milestone Sprints, Security/Quality/Perf Audits) · **GitHub Integration** (Issues, PRs, Actions, Kanban, Milestones, Insights) · **Team Collaboration** (Shared DB, Vector Search, Cross-Project Insights)

| Feature                       | Description                                                                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Session Intelligence**      | Auto-query history, create checkpoints, and hand off context between sessions. Briefings adapt dynamically to your workspace.                                                                        |
| **GitHub Integration**        | Manage Issues, PRs, Actions, Kanban boards, and milestones. Switch contexts across multiple repositories seamlessly.                                                                                 |
| **Knowledge & Search**        | Find entries instantly using hybrid search and visualize relationships with Mermaid graphs. Auto-prune low-value entries to maintain search relevance.                                               |
| **Code Mode**                 | Execute multi-step operations efficiently in a secure sandbox to drastically reduce token usage.                                                                                                     |
| **Team Collaboration**        | Share databases across teams with cross-project insights and role-based access control.                                                                                                              |
| **Data & Architecture**       | Export schemas safely, sync Markdown directories, secure data with encryption and automated backups, and handle errors effectively.                                                                  |
| **Agent Collaboration**       | Share context between agents, suggest reusable rules, and automate tasks like issue triage and PR reviews.                                                                                           |

_Suggested Rule (Add to AGENTS.md, GEMINI.md, system prompts, etc.)_

<details>
<summary><strong>View Session Initialization Routine</strong></summary>

🛑 Session Initialization Routine

When the user initializes the session context by executing the `load-briefing` prompt:

1. You will receive the output of the `memory://briefing/{repo_name}` resource.
2. Prepend your response EXACTLY as:
   > **📋 Briefing loaded** — `{repo_name}`
   > _{paste ENTIRE briefing here}_
3. Address the user's request below the briefing.
4. NEVER autonomously execute tasks listed in the briefing.
5. Do NOT proactively ask the user to load the briefing. Wait for them to use the prompt.
</details>

---

### Tool Filtering

> [!IMPORTANT]
> All shortcuts and tool groups include **Code Mode** (`mj_execute_code`) by default for token-efficient operations. To exclude it, add `-codemode` to your filter: `--tool-filter starter,-codemode`

Control which tools are exposed via `MEMORY_JOURNAL_MCP_TOOL_FILTER` (or CLI: `--tool-filter`):

| Filter               | Use Case                 |
| -------------------- | ------------------------ |
| `full`               | All tools (default)      |
| `starter`            | Core + search + codemode |
| `essential`          | Minimal footprint        |
| `readonly`           | Disable all mutations    |
| `-github`            | Exclude a group          |
| `-github,-analytics` | Exclude multiple groups  |

**Filter Syntax:** `shortcut` or `group` or `tool_name` (whitelist mode) · `-group` (disable group) · `-tool` (disable tool) · `+tool` (re-enable after group disable)

**Custom Selection:** List individual tool names to create your own whitelist: `--tool-filter "create_entry,search_entries,semantic_search"`

**Groups:** `core`, `search`, `analytics`, `relationships`, `io`, `admin`, `github`, `git`, `backup`, `team`, `codemode`

**[Complete tool filtering guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tool-Filtering)**

## 📋 Core Capabilities

### 🛠️ **MCP Tools**

| Group           | Description                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codemode`      | Code Mode (sandboxed code execution) 🌟 **Recommended**                                                                                                                                           |
| `core`          | Entry CRUD, tags, test, staleness                                                                                                                                                                 |
| `search`        | Text search, date range, semantic, vector stats, cross-team                                                                                                                                       |
| `analytics`     | Statistics, cross-project insights                                                                                                                                                                |
| `relationships` | Link entries, visualize graphs                                                                                                                                                                    |
| `io`            | JSON/Markdown export and File-level Markdown Data Integration Interoperability (Import/Export)                                                                                                    |
| `admin`         | Update configuration, update, delete, restore, rebuild/add to vector index, merge tags, search audit log, bulk operations (batch create/update/delete)                                            |
| `github`        | Issues, PRs, context, Kanban, **Milestones**, **Insights**, **issue lifecycle**, **Copilot Reviews**                                                                                              |
| `git`           | Commit history, search, release info, patterns, staleness checks                                                                                                                                  |
| `backup`        | Backup, list, restore, cleanup                                                                                                                                                                    |
| `team`          | CRUD, search, stats, relationships, IO (Markdown import/export), backup, vector search, cross-project insights, matrix, RBAC member management (requires `TEAM_DB_PATH`) |

**[Complete tools reference →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tools)**

### 🎯 **Workflow Prompts**

Session briefing, time period analysis, goal tracking, PR & issue command, session summaries, adversarial plan reviews, exhaustive code & security audits, secure commit workflows, anti-hallucination healing. **[Complete prompts guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Prompts)**

### 📡 **Resources**

Comprehensive access to internal state via resources (`memory://briefing`, `memory://workflows`, `memory://rules`, `memory://health`, `memory://help`, `memory://staleness`, GitHub status/insights, team stats, metrics/latency, and more) plus dynamic repo variants for cross-repo targeting (like `memory://briefing/{repo}` or `memory://kanban/{repo}/{project_number}`). **[Resources documentation →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Resources)**

## ⚡ Code Mode: Maximum Efficiency (90% Token Savings)

Code Mode (`mj_execute_code`) is a revolutionary approach that **dramatically reduces token usage by up to 90%** and is included by default in all presets. Instead of spending thousands of tokens on sequential tool calls, AI agents use a single sandboxed execution to reason faster.

Code executes in a **worker_threads sandbox** with multiple layers of security. All `mj.*` API calls execute against the journal within the sandbox, providing:

- **Static code validation** — blocked patterns include `require()`, `process`, `eval()`, and filesystem access
- **Rate limiting** — 60 executions per minute per client
- **Hard timeouts** — configurable execution limit (default 30s)
- **Full API access** — all tool groups are available via `mj.*` (e.g., `mj.core.createEntry()`, `mj.search.searchEntries()`, `mj.github.getGithubIssues()`)
- **Strict Readonly Contract** — Calling any mutation method under `--tool-filter readonly` safely halts the sandbox to prevent execution, returning a structured error response to the agent instead of a raw MCP protocol exception.

---


## 🚀 Quick Start (2 Minutes)

**Prerequisites:** Docker installed and running · ~250MB disk space · **[Full Installation Guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Installation)**

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

### Basic Configuration

> 💡 **Tip:** Don't want to manually escape JSON strings for `PROJECT_REGISTRY`? Run `npx memory-journal-mcp project create` in your terminal to automatically bootstrap and update your MCP configuration!

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
        "PROJECT_REGISTRY={\"my-repo\":{\"path\":\"/app/repo\",\"project_number\":1}}",
        "-v",
        "/path/to/your/repo:/app/repo:ro",
        "writenotenow/memory-journal-mcp:latest"
      ],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here",
        "ALLOWED_IO_ROOTS": "/app/repo"
      }
    }
  }
}
```

### Advanced Configuration (Recommended)

Showcasing the full power of the server, including Multi-Project Routing, Team Collaboration, Copilot awareness, and Context Injections.

> 💡 **Tip:** Use `npx memory-journal-mcp project create` to easily configure multiple repositories into your `PROJECT_REGISTRY` without manual JSON escaping!

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
        "-v",
        "/path/to/shared/team.db:/app/data/team.db:rw",
        "-v",
        "/path/to/your/projects:/app/projects:ro",
        "-v",
        "/path/to/rules.md:/app/rules.md:ro",
        "-v",
        "/path/to/skills:/app/skills:ro",
        "writenotenow/memory-journal-mcp:latest"
      ],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here",
        "TEAM_DB_PATH": "/app/data/team.db",
        "PROJECT_REGISTRY": "{\"my-repo\":{\"path\":\"/app/projects/repo1\",\"project_number\":1},\"other-repo\":{\"path\":\"/app/projects/repo2\",\"project_number\":5}}",
        "ALLOWED_IO_ROOTS": "/app/projects,/app/data,/app/skills",
        "AUTO_REBUILD_INDEX": "true",
        "EMBEDDING_MODEL": "Xenova/all-MiniLM-L6-v2",
        "MEMORY_JOURNAL_MCP_TOOL_FILTER": "codemode",
        "CODEMODE_INTERNAL_FULL_ACCESS": "true",
        "BRIEFING_ENTRY_COUNT": "3",
        "BRIEFING_SUMMARY_COUNT": "1",
        "BRIEFING_INCLUDE_TEAM": "true",
        "BRIEFING_ISSUE_COUNT": "1",
        "BRIEFING_PR_COUNT": "1",
        "BRIEFING_PR_STATUS": "true",
        "BRIEFING_WORKFLOW_COUNT": "1",
        "BRIEFING_WORKFLOW_STATUS": "true",
        "BRIEFING_COPILOT_REVIEWS": "true",
        "RULES_FILE_PATH": "/app/rules.md",
        "SKILLS_DIR_PATH": "/app/skills",
        "MEMORY_JOURNAL_WORKFLOW_SUMMARY": "/deploy: prod deployment | /audit: security scan",
        "AUDIT_LOG_PATH": "/app/data/mcp-audit.jsonl",
        "TEAM_AUTHOR": "your_username"
      }
    }
  }
}
```

> 💡 **Tip:** Optimize your context window! **Journal entries** (`BRIEFING_ENTRY_COUNT`) capture frequent, granular actions (e.g. bug fixes, implementation steps). **Session summaries** (`BRIEFING_SUMMARY_COUNT`) surface high-level retrospectives meant to pass strategic context continuously across distinct AI sessions. Use both appropriately to keep the agent briefing highly focused!

### 📋 Customizing the Session Briefing

The `memory://briefing` resource is dynamically assembled at each session start, automatically providing ambient context like test health, workspace paths, unreleased changes, and git status. Control what your agent sees by tuning three dimensions via environment variables:

- **Focus** — `TOOL_FILTER`: `full` (default), `starter`, or `essential`
- **Journal Content** — `BRIEFING_ENTRY_COUNT`, `BRIEFING_SUMMARY_COUNT`, `BRIEFING_INCLUDE_TEAM`
- **GitHub Enrichment** — `BRIEFING_ISSUE_COUNT`, `BRIEFING_PR_COUNT`, `BRIEFING_PR_STATUS`, `BRIEFING_MILESTONE_COUNT`, `BRIEFING_WORKFLOW_COUNT`, `BRIEFING_WORKFLOW_STATUS`, `BRIEFING_COPILOT_REVIEWS`

Set `RULES_FILE_PATH` and `SKILLS_DIR_PATH` to surface agent rules and skills as companion resources. In multi-repo setups, agents read `memory://briefing/{repo}` for repo-scoped context.

**[Full briefing customization guide with presets →](https://github.com/neverinfamous/memory-journal-mcp#-customizing-the-session-briefing)**

**Variants** (modify the config array above):

- **Minimal**: Remove `-e GITHUB_TOKEN`, repo mount, and `env` block.
- **Team**: Add `-e "TEAM_DB_PATH=/app/data/team.db"`.
- **Cross-Team**: Add `-e "ADDITIONAL_TEAM_DBS={\"other-team\":\"/app/data/other-team.db\"}"`.
- **Code Mode**: Add `"--tool-filter", "codemode"`.
- **Briefing**: Add `-e "BRIEFING_ENTRY_COUNT=5"`.

### 4. Restart & Journal!

Restart Cursor or your MCP client and start journaling!

### 🔧 Configuration Highlights

- **`--config <path>`**: Load settings from `.yaml` or `.json`. Use `--dump-config` to debug precedence.
- **`DB_ENCRYPTION_KEY`**: Enables SQLCipher at-rest encryption.
- **`PROJECT_REGISTRY`**: Maps repo names to paths for seamless multi-project GitHub context routing.
- **`MCP_AGENT_HEALING` / `--no-agent-healing`**: Set `MCP_AGENT_HEALING=false` (or pass `--no-agent-healing`) to disable autonomous MCP tool and parameter healing/interception.
- **`ARCHIVE_OLDER_THAN_DAYS` / `HARD_DELETE_OLDER_THAN_DAYS` / `PRUNE_DRY_RUN`**: Control the auto-prune data lifecycle. Test rules safely with `--prune-dry-run`.

For a complete list of all extensive environment variables and detailed routing docs, see the **[Configuration Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki/Configuration)**.

### 🔄 Session Management

1. **Session start** → agent reads `memory://briefing` (or `memory://briefing/{repo}`) and shows project context
2. **Session summary** → use `/session-summary` to capture progress and next-session context
3. Next session's briefing includes the previous summary — context flows seamlessly

### HTTP/SSE Transport (Remote Access)

For remote access, web-based clients, or HTTP-compatible MCP hosts. The server supports both stateful (SSE) and stateless (serverless) modes.

```bash
docker run --rm -p 3000:3000 \
  -v ./data:/app/data \
  writenotenow/memory-journal-mcp:latest \
  --transport http --port 3000 --server-host 0.0.0.0
```

- **Features**: OAuth 2.1, Security Headers, Rate Limiting, CORS, and more.
- **Stateless Mode**: Add `--stateless` to the command above.

**[See the full HTTP/SSE Transport & Endpoints documentation in the Wiki →](https://github.com/neverinfamous/memory-journal-mcp/wiki/HTTP-Transport)**

#### Automated Scheduling (HTTP Only)

Enable periodic maintenance jobs (`--backup-interval`, `--vacuum-interval`, `--rebuild-index-interval`, `--digest-interval`) for long-running HTTP containers. **[See the full scheduling documentation in the Wiki →](https://github.com/neverinfamous/memory-journal-mcp/wiki/HTTP-Transport#automated-scheduling)**

## 🔐 OAuth 2.1 Authentication

For production deployments, enable full OAuth 2.1 support on the HTTP transport (opt-in via `--oauth-enabled`). Features include RFC 9728/8414 discovery, JWKS token validation, and granular scopes.

**[See the OAuth 2.1 Setup Guide in the Wiki →](https://github.com/neverinfamous/memory-journal-mcp/wiki/HTTP-Transport#oauth-21-authentication)**

## 🔧 Configuration

All detailed setup and configuration guides are available in our Wiki.

**[Complete Configuration Documentation →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Configuration)**

## 📄 License

MIT License - See [LICENSE](https://github.com/neverinfamous/memory-journal-mcp/blob/main/LICENSE)

_Migrating from v2.x?_ Your existing database is fully compatible.
