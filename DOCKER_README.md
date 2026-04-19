# Memory Journal MCP Server

[![GitHub](https://img.shields.io/badge/GitHub-neverinfamous/memory--journal--mcp-blue?logo=github)](https://github.com/neverinfamous/memory-journal-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/writenotenow/memory-journal-mcp)](https://hub.docker.com/r/writenotenow/memory-journal-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
![Status](https://img.shields.io/badge/status-Production%2FStable-brightgreen)
[![npm](https://img.shields.io/npm/v/memory-journal-mcp)](https://www.npmjs.com/package/memory-journal-mcp)
[![Security](https://img.shields.io/badge/Security-Enhanced-green.svg)](https://github.com/neverinfamous/memory-journal-mcp/blob/main/SECURITY.md)
[![GitHub Stars](https://img.shields.io/github/stars/neverinfamous/memory-journal-mcp?style=social)](https://github.com/neverinfamous/memory-journal-mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://github.com/neverinfamous/memory-journal-mcp)
![Coverage](https://img.shields.io/badge/Coverage-87.15%25-green.svg)
![Tests](https://img.shields.io/badge/Tests-1782_passed-brightgreen.svg)
![E2E Tests](https://img.shields.io/badge/E2E_Tests-391_passed-brightgreen.svg)
[![CI](https://github.com/neverinfamous/memory-journal-mcp/actions/workflows/gatekeeper.yml/badge.svg)](https://github.com/neverinfamous/memory-journal-mcp/actions/workflows/gatekeeper.yml)

🎯 Persistent AI project memory. Bridge disconnected sessions and auto-resume context seamlessly.

**[GitHub](https://github.com/neverinfamous/memory-journal-mcp)** • **[Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki)** • **[Changelog](https://github.com/neverinfamous/memory-journal-mcp/blob/main/CHANGELOG.md)** • **[Release Article](https://adamic.tech/articles/memory-journal-mcp-server)**

## 🧠 Stop Experiencing AI Amnesia

When managing large projects with AI assistance, you face a critical challenge:

- **Thread Amnesia** - Each new conversation starts from zero, unaware of previous work.
- **Lost Context** - Decisions, implementations, and learnings scattered across disconnected threads.
- **Repeated Work** - AI suggests solutions you've already tried or abandoned.

Memory Journal solves this by acting as your project's **long-term memory**, bridging the gap between fragmented AI sessions.

**Experience true context-aware development:**

- _"Why did we choose SQLite over Postgres for this service last month?"_ (Semantic search)
- _"Run the `/issue-triage` workflow on the top priority ticket in the Kanban board."_ (GitHub operations)
- _"Who has been touching the auth module recently, and what's our team collaboration density?"_ (Team analytics)
- _"I'm stuck on this database error. Raise a 'blocker' flag for @sarah so her agent sees it next session."_ (Hush Protocol)
- _"Close issue #42 and log an entry explaining our architectural fix for the parsing bug."_ (Context lifecycles)
- _"Draw a visual graph showing how my last 10 architectural decisions relate to each other."_ (Knowledge graph)

**[See complete examples & prompts →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Examples)**

---

## 🎯 What Sets Us Apart

**70 MCP Tools** · **17 Workflow Prompts** · **36 Resources** · **10 Tool Groups** · **Code Mode** · **GitHub Commander** (Issue Triage, PR Review, Milestone Sprints, Security/Quality/Perf Audits) · **GitHub Integration** (Issues, PRs, Actions, Kanban, Milestones, Insights) · **Team Collaboration** (Shared DB, Vector Search, Cross-Project Insights, Hush Protocol Flags)

| Feature                       | Description                                                                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Session Intelligence**      | Agents auto-query project history, create entries at checkpoints, and hand off context between sessions via `/session-summary` and `team-session-summary`                                     |
| **GitHub Integration**        | 18 tools for Issues, PRs, Actions, Kanban, Milestones (%), Copilot Reviews, and 14-day Insights                                                                                               |
| **Dynamic Project Routing**   | Switch contexts across multiple repositories using a single server instance via `PROJECT_REGISTRY`                                                                                            |
| **Knowledge Graphs**          | 8 relationship types linking specs → implementations → tests → PRs with Mermaid visualization                                                                                                 |
| **Hybrid Search**             | Reciprocal Rank Fusion combining FTS5, semantic vector similarity, heuristics, and date filters                                                                                               |
| **Code Mode**                 | Execute multi-step operations in a secure sandbox — up to 90% token savings via `mj.*` API                                                                                                    |
| **Configurable Briefing**     | 15 env vars / CLI flags control `memory://briefing` content — entries, team, GitHub detail, skills awareness, chronological grounding                                                         |
| **Reports & Analytics**       | Standups, retrospectives, PR summaries, digests, period analyses, and milestone tracking                                                                                                      |
| **Hush Protocol (Flags)**     | Replace Slack/Teams noise with structured, actionable, and searchable AI flags (blockers, reviews) that automatically surface in session briefings                                            |
| **Team Collaboration**        | 25 tools with full parity — CRUD, vector search, relationship graphs, cross-project insights, matrix, author attribution, Hush Protocol flags                                                 |
| **Data Interoperability**     | Markdown roundtripping, unified IO namespace, and JSON exports with hard path traversal defenses                                                                                              |
| **Backup & Restore**          | One-command backup/restore with automated scheduling, retention policies, and safety-net auto-backups                                                                                         |
| **Security & Transport**      | OAuth 2.1 (RFC 9728/8414, JWT/JWKS, scopes), Streamable HTTP + SSE, rate limiting, CORS, SQL injection prevention, non-root Docker                                                            |
| **Structured Error Handling** | Every tool returns `{success, error, code, category, suggestion, recoverable}` — agents get classification, remediation hints, and recoverability signals                                     |
| **Agent Collaboration**       | IDE agents and Copilot share context; review findings become searchable knowledge; agents suggest reusable rules and skills ([setup](docs/copilot-setup.md))                                  |
| **Native Agent Skills**       | Bundled foundational coding paradigms (`autonomous-dev`, `python`, `docker`, `tailwind-css`, `golang`, `playwright-standard`, etc.) establishing permanent AI behavior and architecture rules |
| **GitHub Commander**          | Skills for issue triage, PR reviews, sprint milestones, and security/quality/performance audits with journal trails ([docs](skills/github-commander/SKILL.md))                                |

<details>
<summary><strong>Recommended AI Agent Instructions/Rule</strong></summary>

_Suggested Rule (Add to AGENTS.md, GEMINI.md, system prompts, etc.)_

**🛑 MANDATORY SESSION START ROUTINE**

Execute BEFORE fulfilling any user request in a new session:

1. **TARGET**: Infer `repo_name` from the active workspace context or user prompt. If the task is not associated with a specific project, fallback to using the generic resource without a repo name (which defaults to the first registered workspace).
2. **FETCH**: Use the MCP `read_resource` tool (Server: `memory-journal-mcp`) to read `memory://briefing/{repo_name}` (or `memory://briefing` if falling back).
   - **RESTRICTION**: Do NOT use `execute_code` for this step.
3. **ACKNOWLEDGE FLAGS**: If the briefing JSON contains `activeFlags` (count > 0), you MUST print an alert ABOVE the table: `⚠️ **{count} active flag(s)** — review before proceeding.` followed by each flag (`🚩 {flag_type} → @{target_user}: {preview}`).
4. **RENDER TABLE**: Parse the remaining JSON into a dense 2-column Markdown Table (Field, Value).
   - **RESTRICTION**: NO bulleted lists inside the table. Do NOT truncate summaries or issues.
   - **FORMATTING**: Group related properties (use `<br>` for line breaks).
   - **REQUIRED GROUPS**: GitHub (Repo, Branch, CI, PRs, Insights), Issues, Entry Counts, Latest Entries/Summaries, Analytics, Milestones, Workspaces.
5. **STOP & WAIT**: Do NOT autonomously resume past tasks or start work on new issues mentioned in the session summary. The briefing is strictly for context.

</details>

---

### Tool Filtering

> [!IMPORTANT]
> All shortcuts and tool groups include **Code Mode** (`mj_execute_code`) by default for token-efficient operations. To exclude it, add `-codemode` to your filter: `--tool-filter starter,-codemode`

Control which tools are exposed via `MEMORY_JOURNAL_MCP_TOOL_FILTER` (or CLI: `--tool-filter`):

| Filter               | Tools | Use Case                 |
| -------------------- | ----- | ------------------------ |
| `full`               | 70    | All tools (default)      |
| `starter`            | ~11   | Core + search + codemode |
| `essential`          | ~7    | Minimal footprint        |
| `readonly`           | 17    | Disable all mutations    |
| `-github`            | 52    | Exclude a group          |
| `-github,-analytics` | 48    | Exclude multiple groups  |

**Filter Syntax:** `shortcut` or `group` or `tool_name` (whitelist mode) · `-group` (disable group) · `-tool` (disable tool) · `+tool` (re-enable after group disable)

**Custom Selection:** List individual tool names to create your own whitelist: `--tool-filter "create_entry,search_entries,semantic_search"`

**Groups:** `core`, `search`, `analytics`, `relationships`, `io`, `admin`, `github`, `backup`, `team`, `codemode`

**[Complete tool filtering guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tool-Filtering)**

## 📋 Core Capabilities

### 🛠️ **70 MCP Tools** (10 Groups)

| Group           | Tools | Description                                                                                                                                                               |
| --------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codemode`      | 1     | Code Mode (sandboxed code execution) 🌟 **Recommended**                                                                                                                   |
| `core`          | 6     | Entry CRUD, tags, test                                                                                                                                                    |
| `search`        | 4     | Text search, date range, semantic, vector stats                                                                                                                           |
| `analytics`     | 2     | Statistics, cross-project insights                                                                                                                                        |
| `relationships` | 2     | Link entries, visualize graphs                                                                                                                                            |
| `io`            | 3     | JSON/Markdown export and File-level Markdown Data Integration Interoperability (Import/Export)                                                                            |
| `admin`         | 5     | Update, delete, rebuild/add to vector index, merge tags                                                                                                                   |
| `github`        | 18    | Issues, PRs, context, Kanban, **Milestones**, **Insights**, **issue lifecycle**, **Copilot Reviews**                                                                      |
| `backup`        | 4     | Backup, list, restore, cleanup                                                                                                                                            |
| `team`          | 25    | CRUD, search, stats, relationships, IO (Markdown import/export), backup, vector search, cross-project insights, matrix, **Hush Protocol flags** (requires `TEAM_DB_PATH`) |

**[Complete tools reference →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tools)**

### 🎯 **17 Workflow Prompts**

Standups, retrospectives, PR summaries, weekly digests, period analysis, milestone tracking, context bundles, session summaries, and more. **[Complete prompts guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Prompts)**

### 📡 **36 Resources** (27 Static + 9 Template)

27 static resources (`memory://briefing`, `memory://workflows`, `memory://rules`, `memory://health`, `memory://help`, `memory://help/gotchas`, `memory://flags`, `memory://flags/vocabulary`, GitHub status/insights, team stats, and more) plus 9 template resources for dynamic briefings (`memory://briefing/{repo}`), project timelines, issue/PR entries, Kanban boards, milestone details, and per-group help. **[Resources documentation →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Resources)**

## ⚡ Code Mode: Maximum Efficiency (90% Token Savings)

Code Mode (`mj_execute_code`) is a revolutionary approach that **dramatically reduces token usage by up to 90%** and is included by default in all presets. Instead of spending thousands of tokens on sequential tool calls, AI agents use a single sandboxed execution to reason faster.

Code executes in a **sandboxed VM context** with multiple layers of security. All `mj.*` API calls execute against the journal within the sandbox, providing:

- **Static code validation** — blocked patterns include `require()`, `process`, `eval()`, and filesystem access
- **Rate limiting** — 60 executions per minute per client
- **Hard timeouts** — configurable execution limit (default 30s)
- **Full API access** — all 10 tool groups are available via `mj.*` (e.g., `mj.core.createEntry()`, `mj.search.searchEntries()`, `mj.github.getGithubIssues()`, `mj.team.passTeamFlag()`)
- **Strict Readonly Contract** — Calling any mutation method under `--tool-filter readonly` safely halts the sandbox to prevent execution, returning a structured error response to the agent instead of a raw MCP protocol exception.

---

## 🤫 Hush Protocol: Asynchronous Team Collaboration

The **Hush Protocol** reimagines team collaboration for AI-augmented workflows by replacing noisy Slack/Teams messages with structured, machine-actionable flags.

When you encounter a blocker, need a review, or want to broadcast a milestone, your AI agent can raise a flag in the shared Team Database:

- **Actionable Visibility**: Active flags automatically surface at the very top of the `memory://briefing` payload for all team members. When another developer's agent starts a session, it immediately sees your blockers and can help resolve them autonomously.
- **Structured Types**: Raise specific flag types (`blocker`, `needs_review`, `help_requested`, `fyi`). You can customize your team's vocabulary via the `--flag-vocabulary` configuration.
- **Searchable History**: Unlike chat messages that disappear into the void, Hush flags are permanent, query-able AI journal entries. Your agents can search past `needs_review` flags to understand how architectural blockers were conquered.

**Dashboard & Operations**: Read `memory://flags` to see an active dashboard overview and use `mj.team.passTeamFlag()` / `mj.team.resolveTeamFlag()` to manage them programmatically in Code Mode.

**[Complete Hush Protocol guide and Mermaid sequence diagrams →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Hush-Protocol)**

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
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

### Advanced Configuration (Recommended)

Showcasing the full power of the server, including Multi-Project Routing, Team Collaboration, Copilot awareness, and Context Injections.

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
        "AUTO_REBUILD_INDEX": "true",
        "MEMORY_JOURNAL_MCP_TOOL_FILTER": "codemode",
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
        "MEMORY_JOURNAL_WORKFLOW_SUMMARY": "/deploy: prod deployment | /audit: security scan"
      }
    }
  }
}
```

> 💡 **Tip:** Optimize your context window! **Journal entries** (`BRIEFING_ENTRY_COUNT`) capture frequent, granular actions (e.g. bug fixes, implementation steps). **Session summaries** (`BRIEFING_SUMMARY_COUNT`) surface high-level retrospectives meant to pass strategic context continuously across distinct AI sessions. Use both appropriately to keep the agent briefing highly focused!

**Variants** (modify the config array above):

- **Minimal**: Remove `-e GITHUB_TOKEN`, repo mount, and `env` block.
- **Team**: Add `-e "TEAM_DB_PATH=/app/data/team.db"`.
- **Code Mode**: Add `"--tool-filter", "codemode"`.
- **Briefing**: Add `-e "BRIEFING_ENTRY_COUNT=5"`.

### 4. Restart & Journal!

Restart Cursor or your MCP client and start journaling!

### GitHub Integration Configuration

The GitHub tools (`get_github_issues`, `get_github_prs`, etc.) auto-detect the repository from your git context when `PROJECT_REGISTRY` is configured or the MCP server is run inside a git repository.

For a complete list of all 30+ environment variables (including remote HTTP scheduling, payload truncations, context injection parameters, flag vocabulary, and audit logging), please refer to the **[Official Configuration Resource](https://github.com/neverinfamous/memory-journal-mcp/wiki/)** in our Wiki.

**Multi-Project Workflows**: For agents to seamlessly support multiple projects, provide **`PROJECT_REGISTRY`**.

#### Context Resolution & Project Routing

**Context resolution order**: Dynamic `PROJECT_REGISTRY` routing → explicit `owner`/`repo` → blocks with `{requiresUserInput: true}`. Kanban/issue project numbers resolve via passed argument → `PROJECT_REGISTRY` lookup → global `DEFAULT_PROJECT_NUMBER`.

**[Full routing & auto-detection docs →](https://github.com/neverinfamous/memory-journal-mcp/wiki/)**

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

- **Features**: OAuth 2.1, 7 Security Headers, Rate Limiting, CORS, and more.
- **Stateless Mode**: Add `--stateless` to the command above.

**[See the full HTTP/SSE Transport & Endpoints documentation in the Wiki →](https://github.com/neverinfamous/memory-journal-mcp/wiki/HTTP-Server-and-Production)**

#### Automated Scheduling (HTTP Only)

Enable periodic maintenance jobs (`--backup-interval`, `--vacuum-interval`, `--rebuild-index-interval`, `--digest-interval`) for long-running HTTP containers. **[See the full scheduling documentation in the Wiki →](https://github.com/neverinfamous/memory-journal-mcp/wiki/)**

## 🔐 OAuth 2.1 Authentication

For production deployments, enable full OAuth 2.1 support on the HTTP transport (opt-in via `--oauth-enabled`). Features include RFC 9728/8414 discovery, JWKS token validation, and granular scopes.

**[See the OAuth 2.1 Setup Guide in the Wiki →](https://github.com/neverinfamous/memory-journal-mcp/wiki/HTTP-Server-and-Production#oauth-21-authentication)**

## 🔧 Configuration

### GitHub Commander Workflows

The server natively bundles the `github-commander` agent skill (accessible via `memory://skills/github-commander`). This extends your AI assistant with 9 autonomous DevOps workflows for repository stewardship: **Issue Triage**, **Milestone Sprints**, **PR Reviews**, **Copilot Audits**, **Security Audits**, **Code Quality Audits**, **Performance Audits**, **Roadmap Kickoffs**, and **Dependency Updates**. Configure validation layers using the `PROJECT_*` environment overrides to enforce CI-matching execution locally during agent tasks!

### GitHub Management Capabilities

18 GitHub tools covering issues, PRs, Kanban boards, milestones (with completion %), repository insights, Copilot reviews, and issue lifecycle with journal linking. Standard mutations (create/close issues, merge PRs) are handled by agents via `gh` CLI. **[Complete GitHub integration guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Git-Integration)**

## 📄 License

MIT License - See [LICENSE](https://github.com/neverinfamous/memory-journal-mcp/blob/main/LICENSE)

_Migrating from v2.x?_ Your existing database is fully compatible.
