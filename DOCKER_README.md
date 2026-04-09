# Memory Journal MCP Server

[![GitHub](https://img.shields.io/badge/GitHub-neverinfamous/memory--journal--mcp-blue?logo=github)](https://github.com/neverinfamous/memory-journal-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/writenotenow/memory-journal-mcp)](https://hub.docker.com/r/writenotenow/memory-journal-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
![Status](https://img.shields.io/badge/status-Production%2FStable-brightgreen)
[![npm](https://img.shields.io/npm/v/memory-journal-mcp)](https://www.npmjs.com/package/memory-journal-mcp)
[![Security](https://img.shields.io/badge/Security-Enhanced-green.svg)](https://github.com/neverinfamous/memory-journal-mcp/blob/main/SECURITY.md)
[![GitHub Stars](https://img.shields.io/github/stars/neverinfamous/memory-journal-mcp?style=social)](https://github.com/neverinfamous/memory-journal-mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://github.com/neverinfamous/memory-journal-mcp)
![Coverage](https://img.shields.io/badge/Coverage-96.08%25-brightgreen.svg)
![Tests](https://img.shields.io/badge/Tests-1782_passed-brightgreen.svg)
![E2E Tests](https://img.shields.io/badge/E2E_Tests-391_passed-brightgreen.svg)
[![CI](https://github.com/neverinfamous/memory-journal-mcp/actions/workflows/gatekeeper.yml/badge.svg)](https://github.com/neverinfamous/memory-journal-mcp/actions/workflows/gatekeeper.yml)

🎯 AI context + project intelligence: persistent memory and automatic session handoff for AI agents.

**[GitHub](https://github.com/neverinfamous/memory-journal-mcp)** • **[Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki)** • **[Changelog](https://github.com/neverinfamous/memory-journal-mcp/blob/main/CHANGELOG.md)** • **[Release Article](https://adamic.tech/articles/memory-journal-mcp-server)**

## 🎯 What This Does

### What Sets Us Apart

**67 MCP Tools** · **17 Workflow Prompts** · **38 Resources** · **10 Tool Groups** · **Code Mode** · **GitHub Commander** (Issue Triage, PR Review, Milestone Sprints, Security/Quality/Perf Audits) · **GitHub Integration** (Issues, PRs, Actions, Kanban, Milestones, Insights) · **Team Collaboration** (Shared DB, Vector Search, Cross-Project Insights)

| Feature                       | Description                                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Session Intelligence**      | Agents auto-query project history, create entries at checkpoints, and hand off context between sessions via `/session-summary`                                 |
| **GitHub Integration**        | 16 tools for Issues, PRs, Actions, Kanban, Milestones (%), Copilot Reviews, and 14-day Insights                                                                |
| **Dynamic Project Routing**   | Switch contexts across multiple repositories using a single server instance via `PROJECT_REGISTRY`                                                             |
| **Knowledge Graphs**          | 8 relationship types linking specs → implementations → tests → PRs with Mermaid visualization                                                                  |
| **Hybrid Search**             | Reciprocal Rank Fusion combining FTS5, semantic vector similarity, heuristics, and date filters                                                                |
| **Code Mode**                 | Execute multi-step operations in a secure sandbox — up to 90% token savings via `mj.*` API                                                                     |
| **Configurable Briefing**     | 12 env vars / CLI flags control `memory://briefing` content — entries, team, GitHub detail, skills awareness                                                   |
| **Reports & Analytics**       | Standups, retrospectives, PR summaries, digests, period analyses, and milestone tracking                                                                       |
| **Team Collaboration**        | 22 tools with full parity — CRUD, vector search, relationship graphs, cross-project insights, author attribution                                               |
| **Data Interoperability**     | Markdown roundtripping, unified IO namespace, and JSON exports with hard path traversal defenses                                                               |
| **Backup & Restore**          | One-command backup/restore with automated scheduling, retention policies, and safety-net auto-backups                                                          |
| **Security & Transport**      | OAuth 2.1 (RFC 9728/8414, JWT/JWKS, scopes), Streamable HTTP + SSE, rate limiting, CORS, SQL injection prevention, non-root Docker                             |
| **Structured Error Handling** | Every tool returns `{success, error, code, category, suggestion, recoverable}` — agents get classification, remediation hints, and recoverability signals      |
| **Agent Collaboration**       | IDE agents and Copilot share context; review findings become searchable knowledge; agents suggest reusable rules and skills ([setup](docs/copilot-setup.md))   |
| **Native Agent Skills**       | Bundled foundational coding paradigms (`bun`, `golang`, `mastering-typescript`, `playwright-standard`, `react-best-practices`, `rust`, `shadcn-ui`) establishing permanent AI behavior and architecture rules                           |
| **GitHub Commander**          | Skills for issue triage, PR reviews, sprint milestones, and security/quality/performance audits with journal trails ([docs](skills/github-commander/SKILL.md)) |

**[See complete examples & prompts →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Examples)**

---

Suggested Rule (Add to AGENTS.md, GEMINI.md, etc):

🛑 MANDATORY SESSION START ROUTINE

Execute BEFORE fulfilling any user request in a new session:

1. **TARGET**: Infer `repo_name` from the active workspace context or user prompt. If the task is not associated with a specific project, fallback to using the generic resource without a repo name (which defaults to the first registered workspace).
2. **FETCH**: Use the MCP `read_resource` tool (Server: `memory-journal-mcp`) to read `memory://briefing/{repo_name}` (or `memory://briefing` if falling back).
   - **RESTRICTION**: Do NOT use `execute_code` for this step.
3. **RENDER TABLE**: Parse the briefing JSON and output a dense 2-column Markdown Table (Field, Value) capturing the core context.
   - **RESTRICTION**: NO bulleted lists. Do NOT truncate issues or summaries.
   - **FORMATTING**: Group related properties to save vertical space. Use `<br>` tags for inner-cell line breaks.
   - **REQUIRED GROUPS**:
     - **GitHub**: Combine Repo, Branch, CI, PRs, and Insights.
     - **GitHub Issues**: List every issue, one per line.
     - Also include Entry Counts (Journal/Team), Latest Entries/Summaries, Milestones, and Workspaces.

---

### Tool Filtering

> [!IMPORTANT]
> All shortcuts and tool groups include **Code Mode** (`mj_execute_code`) by default for token-efficient operations. To exclude it, add `-codemode` to your filter: `--tool-filter starter,-codemode`

Control which tools are exposed via `MEMORY_JOURNAL_MCP_TOOL_FILTER` (or CLI: `--tool-filter`):

| Filter               | Tools | Use Case                 |
| -------------------- | ----- | ------------------------ |
| `full`               | 67    | All tools (default)      |
| `starter`            | ~11   | Core + search + codemode |
| `essential`          | ~7    | Minimal footprint        |
| `readonly`           | ~15   | Disable all mutations    |
| `-github`            | 49    | Exclude a group          |
| `-github,-analytics` | 47    | Exclude multiple groups  |

**Filter Syntax:** `shortcut` or `group` or `tool_name` (whitelist mode) · `-group` (disable group) · `-tool` (disable tool) · `+tool` (re-enable after group disable)

**Custom Selection:** List individual tool names to create your own whitelist: `--tool-filter "create_entry,search_entries,semantic_search"`

**Groups:** `core`, `search`, `analytics`, `relationships`, `io`, `admin`, `github`, `backup`, `team`, `codemode`

**[Complete tool filtering guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tool-Filtering)**

## 📋 Core Capabilities

### 🛠️ **67 MCP Tools** (10 Groups)

| Group           | Tools | Description                                                                                                                              |
| --------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `codemode`      | 1     | Code Mode (sandboxed code execution) 🌟 **Recommended**                                                                                  |
| `core`          | 6     | Entry CRUD, tags, test                                                                                                                   |
| `search`        | 4     | Text search, date range, semantic, vector stats                                                                                          |
| `analytics`     | 2     | Statistics, cross-project insights                                                                                                       |
| `relationships` | 2     | Link entries, visualize graphs                                                                                                           |
| `io`            | 3     | JSON/Markdown export and File-level Markdown Data Integration Interoperability (Import/Export)                                           |
| `admin`         | 5     | Update, delete, rebuild/add to vector index, merge tags                                                                                  |
| `github`        | 18    | Issues, PRs, context, Kanban, **Milestones**, **Insights**, **issue lifecycle**, **Copilot Reviews**                                     |
| `backup`        | 4     | Backup, list, restore, cleanup                                                                                                           |
| `team`          | 22    | CRUD, search, stats, relationships, IO (Markdown import/export), backup, vector search, cross-project insights (requires `TEAM_DB_PATH`) |

**[Complete tools reference →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tools)**

### 🎯 **17 Workflow Prompts**

Standups, retrospectives, PR summaries, weekly digests, period analysis, milestone tracking, context bundles, session summaries, and more. **[Complete prompts guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Prompts)**

### 📡 **38 Resources** (25 Static + 13 Template)

25 static resources (`memory://briefing`, `memory://workflows`, `memory://rules`, `memory://health`, `memory://help`, `memory://help/gotchas`, GitHub status/insights, team stats, and more) plus 13 template resources for dynamic briefings (`memory://briefing/{repo}`), project timelines, issue/PR entries, Kanban boards, milestone details, per-repo GitHub details, and per-group help. **[Resources documentation →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Resources)**

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

| Environment Variable              | Description                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `DB_PATH`                         | Database file location (default: `./memory_journal.db`)                                                         |
| `TEAM_DB_PATH`                    | Team database file location                                                                                     |
| `TEAM_AUTHOR`                     | Override author name for team entries (default: `git config user.name`)                                         |
| `GITHUB_TOKEN`                    | GitHub personal access token for API access                                                                     |
| `DEFAULT_PROJECT_NUMBER`          | Default GitHub Project number for auto-assignment when creating issues                                          |
| `PROJECT_REGISTRY`                | JSON map of repos to `{ path, project_number }` for multi-project auto-detection and routing                    |
| `AUTO_REBUILD_INDEX`              | Set to `true` to rebuild vector index on server startup                                                         |
| `MCP_HOST`                        | Server bind host (`0.0.0.0` for containers, default: `localhost`)                                               |
| `MCP_AUTH_TOKEN`                  | Bearer token for HTTP transport authentication                                                                  |
| `MCP_CORS_ORIGIN`                 | Allowed CORS origins for HTTP transport, comma-separated (default: `*`)                                         |
| `MCP_RATE_LIMIT_MAX`              | Max requests per minute per client IP, HTTP only (default: `100`)                                               |
| `LOG_LEVEL`                       | Log verbosity: `error`, `warn`, `info`, `debug` (default: `info`)                                               |
| `MCP_ENABLE_HSTS`                 | Enable HSTS security header on HTTP responses (default: `false`)                                                |
| `OAUTH_ENABLED`                   | Set to `true` to enable OAuth 2.1 authentication (HTTP only)                                                    |
| `OAUTH_ISSUER`                    | OAuth issuer URL (e.g., `https://auth.example.com/realms/mcp`)                                                  |
| `OAUTH_AUDIENCE`                  | Expected JWT audience claim                                                                                     |
| `OAUTH_JWKS_URI`                  | JWKS endpoint for token signature verification                                                                  |
| `CODE_MODE_MAX_RESULT_SIZE`       | Maximum size in bytes for mj_execute_code result payload (CLI: `--codemode-max-result-size`; default: `102400`) |
| `BRIEFING_ENTRY_COUNT`            | Journal entries in briefing (default: `3`)                                                                      |
| `BRIEFING_SUMMARY_COUNT`          | Session summaries to list in briefing (CLI: `--briefing-summaries`; default: `1`)                               |
| `BRIEFING_INCLUDE_TEAM`           | Include team DB entries in briefing (`true`/`false`; default: `false`)                                          |
| `BRIEFING_MILESTONE_COUNT`        | Milestones to list in briefing; `0` = hide (default: `3`)                                                       |
| `BRIEFING_ISSUE_COUNT`            | Issues to list in briefing; `0` = count only (default: `0`)                                                     |
| `BRIEFING_PR_COUNT`               | PRs to list in briefing; `0` = count only (default: `0`)                                                        |
| `BRIEFING_PR_STATUS`              | Show PR status breakdown (open/merged/closed; default: `false`)                                                 |
| `BRIEFING_WORKFLOW_COUNT`         | Workflow runs to list in briefing; `0` = status only (default: `0`)                                             |
| `BRIEFING_WORKFLOW_STATUS`        | Show workflow status breakdown in briefing (default: `false`)                                                   |
| `BRIEFING_COPILOT_REVIEWS`        | Aggregate Copilot review state in briefing (default: `false`)                                                   |
| `RULES_FILE_PATH`                 | Path to user rules file for agent awareness                                                                     |
| `SKILLS_DIR_PATH`                 | Path to skills directory for agent awareness                                                                    |
| `MEMORY_JOURNAL_WORKFLOW_SUMMARY` | Free-text workflow summary for `memory://workflows`                                                             |
| `INSTRUCTION_LEVEL`               | Briefing depth: `essential`, `standard`, `full` (default: `standard`)                                           |
| `PROJECT_LINT_CMD`                | Project lint command for GitHub Commander validation gates (default: `npm run lint`)                            |
| `PROJECT_TYPECHECK_CMD`           | Project typecheck command (default: `npm run typecheck`; empty = skip)                                          |
| `PROJECT_BUILD_CMD`               | Project build command (default: `npm run build`; empty = skip)                                                  |
| `PROJECT_TEST_CMD`                | Project test command (default: `npm run test`)                                                                  |
| `PROJECT_E2E_CMD`                 | Project E2E test command (default: empty = skip)                                                                |
| `PROJECT_PACKAGE_MANAGER`         | Package manager override: `npm`, `yarn`, `pnpm`, `bun` (default: auto-detect from lockfile)                     |
| `PROJECT_HAS_DOCKERFILE`          | Enable Docker audit steps (default: auto-detect)                                                                |
| `COMMANDER_HITL_FILE_THRESHOLD`   | Human-in-the-loop checkpoint if changes touch > N files (default: `10`)                                         |
| `COMMANDER_SECURITY_TOOLS`        | Override security tool auto-detection (comma-separated; default: auto-detect)                                   |
| `COMMANDER_BRANCH_PREFIX`         | Branch naming prefix for PRs (default: `fix`)                                                                   |
| `AUDIT_LOG_PATH`                  | Path for the JSONL audit log of write/admin tool calls. Rotates at 10 MB (keeps 5 archives). Omit to disable.   |
| `AUDIT_REDACT`                    | Set to `true` to omit tool arguments from audit log entries for privacy (default: `false`)                      |
| `AUDIT_READS`                     | Log read-scoped tool calls in addition to write/admin (default: `false`)                                        |
| `AUDIT_LOG_MAX_SIZE`              | Maximum audit log file size in bytes before rotation (default: `10485760`)                                      |
| `MCP_METRICS_ENABLED`             | Set to `false` to disable in-memory tool call metrics accumulation (default: `true`)                            |

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

Enable periodic maintenance jobs (`--backup-interval`, `--vacuum-interval`, `--rebuild-index-interval`) for long-running HTTP containers. **[See the full scheduling documentation in the Wiki →](https://github.com/neverinfamous/memory-journal-mcp/wiki/)**

## 🔐 OAuth 2.1 Authentication

For production deployments, enable full OAuth 2.1 support on the HTTP transport (opt-in via `--oauth-enabled`). Features include RFC 9728/8414 discovery, JWKS token validation, and granular scopes.

**[See the OAuth 2.1 Setup Guide in the Wiki →](https://github.com/neverinfamous/memory-journal-mcp/wiki/HTTP-Server-and-Production#oauth-21-authentication)**

## 🔧 Configuration

### GitHub Commander Workflows

The server natively bundles the `github-commander` agent skill (accessible via `memory://skills/github-commander`). This extends your AI assistant with 8 autonomous DevOps workflows for repository stewardship: **Issue Triage**, **Milestone Sprints**, **PR Reviews**, **Security Audits**, **Code Quality Audits**, **Performance Audits**, **Roadmap Kickoffs**, and **Dependency Updates**. Configure validation layers using the `PROJECT_*` environment overrides to enforce CI-matching execution locally during agent tasks!

### GitHub Management Capabilities

18 GitHub tools covering issues, PRs, Kanban boards, milestones (with completion %), repository insights, Copilot reviews, and issue lifecycle with journal linking. Standard mutations (create/close issues, merge PRs) are handled by agents via `gh` CLI. **[Complete GitHub integration guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Git-Integration)**

## 📄 License

MIT License - See [LICENSE](https://github.com/neverinfamous/memory-journal-mcp/blob/main/LICENSE)

_Migrating from v2.x?_ Your existing database is fully compatible.
