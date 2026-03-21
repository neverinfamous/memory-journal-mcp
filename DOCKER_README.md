# Memory Journal MCP Server

[![GitHub](https://img.shields.io/badge/GitHub-neverinfamous/memory--journal--mcp-blue?logo=github)](https://github.com/neverinfamous/memory-journal-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/writenotenow/memory-journal-mcp)](https://hub.docker.com/r/writenotenow/memory-journal-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
![Status](https://img.shields.io/badge/status-Production%2FStable-brightgreen)
[![npm](https://img.shields.io/npm/v/memory-journal-mcp)](https://www.npmjs.com/package/memory-journal-mcp)
[![Security](https://img.shields.io/badge/Security-Enhanced-green.svg)](https://github.com/neverinfamous/memory-journal-mcp/blob/main/SECURITY.md)
[![GitHub Stars](https://img.shields.io/github/stars/neverinfamous/memory-journal-mcp?style=social)](https://github.com/neverinfamous/memory-journal-mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://github.com/neverinfamous/memory-journal-mcp)
![Coverage](https://img.shields.io/badge/Coverage-91%25-brightgreen.svg)
![Tests](https://img.shields.io/badge/Tests-1522_passed-brightgreen.svg)
![E2E Tests](https://img.shields.io/badge/E2E_Tests-105_passed-brightgreen.svg)

🎯 **AI Context + Project Intelligence:** Bridge disconnected AI sessions with persistent project memory and **automatic session handoff** — with full GitHub workflow integration.

**[GitHub](https://github.com/neverinfamous/memory-journal-mcp)** • **[Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki)** • **[Changelog](https://github.com/neverinfamous/memory-journal-mcp/blob/main/CHANGELOG.md)** • **[Release Article](https://adamic.tech/articles/memory-journal-mcp-server)**

## 🎯 What This Does

### What Sets Us Apart

**61 MCP Tools** · **16 Workflow Prompts** · **22 Resources** · **10 Tool Groups** · **Code Mode** · **GitHub Integration** (Issues, PRs, Actions, Kanban, Milestones, Insights)

| Feature                        | Description                                                                                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Dynamic Context Management** | AI agents automatically query your project history and create entries at the right moments                                                                                                                                                                                     |
| **GitHub Integration**         | 16 tools covering Issues, PRs, Actions, Kanban boards, Milestones with completion %, Copilot Reviews, and 14-day repository Insights (stars, clones, views, referrers)                                                                                                         |
| **Knowledge Graphs**           | 8 relationship types linking specs → implementations → tests → PRs with automatic Mermaid visualization                                                                                                                                                                        |
| **Triple Search**              | Full-text (FTS5), semantic (AI-powered via `@huggingface/transformers` + `sqlite-vec`), and date-range search in one server                                                                                                                                                    |
| **Code Mode**                  | **Massive Token Savings:** Execute complex, multi-step operations inside a secure JavaScript sandbox — reducing token overhead by up to 90% while exposing all 61 capabilities via `mj.*` API                                                                                  |
| **Configurable Briefing**      | 11 env vars / CLI flags to customize `memory://briefing` — control entry count, team inclusion, issue/PR/workflow detail level, Copilot review aggregation, and rules/skills awareness                                                                                         |
| **Session Continuity**         | A quick `/session-summary` captures progress and feeds it into the next session's briefing threads                                                                                                                                                                             |
| **Reports & Analytics**        | Generate standups, retrospectives, PR summaries, weekly digests, period analyses, and milestone tracking                                                                                                                                                                       |
| **Team Collaboration**         | Separate public team database with author attribution, cross-DB search, and dedicated team tools                                                                                                                                                                               |
| **Backup & Restore**           | One-command backup/restore with automated scheduling, retention policies, and auto-backup-on-restore safety net                                                                                                                                                                |
| **OAuth 2.1 + Access Control** | Enterprise-ready security with RFC 9728/8414 compliance, granular scopes (`read`, `write`, `admin`), JWT/JWKS validation, and Keycloak-compatible integration                                                                                                                  |
| **HTTP Streaming Transport**   | Dual-protocol HTTP with Streamable HTTP + Legacy SSE, security headers, rate limiting, CORS, and stateless mode for serverless                                                                                                                                                 |
| **Production-Ready Security**  | SQL injection prevention, input validation (Zod), path traversal protection, token scrubbing, 7 security headers, server timeouts, and non-root Docker execution                                                                                                               |
| **Rule & Skill Suggestions**   | Agents offer to codify your recurring patterns into reusable rules and skills with your approval                                                                                                                                                                               |
| **Cross-Agent Memory**         | IDE agents and GitHub Copilot share context through journal entries — Copilot review findings become searchable knowledge, and IDE agents proactively apply past patterns ([setup guide](https://github.com/neverinfamous/memory-journal-mcp/blob/main/docs/copilot-setup.md)) |
| **Strict TypeScript**          | 100% type-safe codebase with strict mode                                                                                                                                                                                                                                       |

**[See complete examples & prompts →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Examples)**

## Rule (Add to AGENTS.md, GEMINI.md, etc)

## Session Start

**REQUIRED**: Before processing any user request, read `memory://briefing` and **present the briefing to the user as a two-column markdown table** (Context | Value). This format is strongly preferred over bullet lists for scannability. Example:

```
📋 **Session Context Loaded**

| Context | Value |
|---------|-------|
| **Project** | neverinfamous/memory-journal-mcp |
| **Branch** | main |
| **CI** | ✅ passing |
| **Journal** | 414 entries |
| **Team DB** | 2 entries |
| **Issues** | 0 open |
| **PRs** | 1 open · 2 merged |
| **Milestones** | Add GitHub Projects Integration (100%) |
| **Insights** | ⭐ 11 · 🍴 3 · 📦 1,058 clones · 👁️ 365 views (14d) |
| **Skills** | 15 available |
| **Rules** | GEMINI.md (6 KB, updated just now) |
```

---

### Tool Filtering

> [!IMPORTANT]
> All shortcuts and tool groups include **Code Mode** (`mj_execute_code`) by default for token-efficient operations. To exclude it, add `-codemode` to your filter: `--tool-filter starter,-codemode`

Control which tools are exposed via `MEMORY_JOURNAL_MCP_TOOL_FILTER` (or CLI: `--tool-filter`):

| Filter               | Tools | Use Case                 |
| -------------------- | ----- | ------------------------ |
| `full`               | 61    | All tools (default)      |
| `starter`            | ~11   | Core + search + codemode |
| `essential`          | ~7    | Minimal footprint        |
| `readonly`           | ~15   | Disable all mutations    |
| `-github`            | 45    | Exclude a group          |
| `-github,-analytics` | 43    | Exclude multiple groups  |

**Filter Syntax:** `shortcut` or `group` or `tool_name` (whitelist mode) · `-group` (disable group) · `-tool` (disable tool) · `+tool` (re-enable after group disable)

**Custom Selection:** List individual tool names to create your own whitelist: `--tool-filter "create_entry,search_entries,semantic_search"`

**Groups:** `core`, `search`, `analytics`, `relationships`, `export`, `admin`, `github`, `backup`, `team`, `codemode`

**[Complete tool filtering guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tool-Filtering)**

## 📋 Core Capabilities

### 🛠️ **61 MCP Tools** (10 Groups)

| Group           | Tools | Description                                                                                          |
| --------------- | ----- | ---------------------------------------------------------------------------------------------------- |
| `codemode`      | 1     | Code Mode (sandboxed code execution) 🌟 **Recommended**                                              |
| `core`          | 6     | Entry CRUD, tags, test                                                                               |
| `search`        | 4     | Text search, date range, semantic, vector stats                                                      |
| `analytics`     | 2     | Statistics, cross-project insights                                                                   |
| `relationships` | 2     | Link entries, visualize graphs                                                                       |
| `export`        | 1     | JSON/Markdown export                                                                                 |
| `admin`         | 5     | Update, delete, rebuild/add to vector index, merge tags                                              |
| `github`        | 16    | Issues, PRs, context, Kanban, **Milestones**, **Insights**, **issue lifecycle**, **Copilot Reviews** |
| `backup`        | 4     | Backup, list, restore, cleanup                                                                       |
| `team`          | 20    | CRUD, search, stats, relationships, export, backup, vector search, cross-project insights (requires `TEAM_DB_PATH`) |

**[Complete tools reference →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tools)**

### 🎯 **16 Workflow Prompts**

Standups, retrospectives, PR summaries, weekly digests, period analysis, milestone tracking, context bundles, session summaries, and more. **[Complete prompts guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Prompts)**

### 📡 **22 Resources** (15 Static + 7 Template)

15 static resources (`memory://briefing`, `memory://health`, `memory://recent`, GitHub status/insights/milestones, team stats, and more) plus 7 template resources for project timelines, issue/PR entries, Kanban boards, and milestone details. **[Resources documentation →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Resources)**

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

| Variant                 | Change                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------- |
| **Minimal (no GitHub)** | Remove the `-e GITHUB_TOKEN`, `-e GITHUB_REPO_PATH`, repo volume mount, and `env` block |
| **Team collaboration**  | Add `-e`, `"TEAM_DB_PATH=/app/data/team.db"` to `args`                                  |
| **Code Mode only**      | Add `"--tool-filter"`, `"codemode"` to `args` (single tool, all capabilities)           |

| **Briefing config** | Add `-e`, `"BRIEFING_ENTRY_COUNT=5"` to `args` (see env var table below) |
| **Local build** | Replace `writenotenow/memory-journal-mcp:latest` with your local image name |

### 4. Restart & Journal!

Restart Cursor or your MCP client and start journaling!

| Environment Variable       | Description                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `DB_PATH`                  | Database location (default: `/app/data/memory_journal.db` in Docker)                              |
| `TEAM_DB_PATH`             | Team database file location (CLI: `--team-db`)                                                    |
| `TEAM_AUTHOR`              | Override author name for team entries (default: `git config user.name`)                           |
| `GITHUB_TOKEN`             | GitHub personal access token for API access                                                       |
| `GITHUB_REPO_PATH`         | Path to git repo inside container (mount your repo)                                               |
| `DEFAULT_PROJECT_NUMBER`   | Default GitHub Project number for auto-assignment when creating issues                            |
| `AUTO_REBUILD_INDEX`       | Set to `true` to rebuild vector index on server startup                                           |
| `MCP_HOST`                 | Server bind host (`0.0.0.0` for containers, default: `localhost`)                                 |
| `MCP_AUTH_TOKEN`           | Bearer token for HTTP transport authentication (CLI: `--auth-token`)                              |
| `MCP_ENABLE_HSTS`          | Enable HSTS security header on HTTP responses (CLI: `--enable-hsts`; default: `false`)            |
| `OAUTH_ENABLED`            | Set to `true` to enable OAuth 2.1 authentication (HTTP only)                                      |
| `OAUTH_ISSUER`             | OAuth issuer URL (e.g., `https://auth.example.com/realms/mcp`)                                    |
| `OAUTH_AUDIENCE`           | Expected JWT audience claim                                                                       |
| `OAUTH_JWKS_URI`           | JWKS endpoint for token signature verification                                                    |
| `BRIEFING_ENTRY_COUNT`     | Journal entries in briefing (CLI: `--briefing-entries`; default: `3`)                             |
| `BRIEFING_INCLUDE_TEAM`    | Include team DB entries in briefing (`true`/`false`; default: `false`)                            |
| `BRIEFING_ISSUE_COUNT`     | Issues to list in briefing; `0` = count only (default: `0`)                                       |
| `BRIEFING_PR_COUNT`        | PRs to list in briefing; `0` = count only (default: `0`)                                          |
| `BRIEFING_PR_STATUS`       | Show PR status breakdown (open/merged/closed; default: `false`)                                   |
| `BRIEFING_WORKFLOW_COUNT`  | Workflow runs to list in briefing; `0` = status only (default: `0`)                               |
| `BRIEFING_WORKFLOW_STATUS` | Show workflow status breakdown in briefing (default: `false`)                                     |
| `BRIEFING_COPILOT_REVIEWS` | Aggregate Copilot review state in briefing (default: `false`)                                     |
| `RULES_FILE_PATH`          | Path to user rules file for agent awareness (CLI: `--rules-file`)                                 |
| `SKILLS_DIR_PATH`          | Path to skills directory for agent awareness (CLI: `--skills-dir`)                                |
| `INSTRUCTION_LEVEL`        | Briefing depth: `essential`, `standard`, `full` (CLI: `--instruction-level`; default: `standard`) |

**Without `GITHUB_REPO_PATH`**: Explicitly provide `owner` and `repo` when calling GitHub tools.

**Fallback:** With `GITHUB_REPO_PATH` set, tools auto-detect `owner`/`repo` from the mounted repo's git remote. Without it, provide `owner` and `repo` parameters explicitly. Mount read-only: `-v /path/to/repo:/app/repo:ro`.

### 🔄 Session Management

1. **Session start** → agent reads `memory://briefing` and shows project context
2. **Session summary** → use `/session-summary` to capture progress and next-session context
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

- **OAuth 2.1** — RFC 9728/8414, JWT/JWKS, granular scopes (opt-in via `--oauth-enabled`)
- **7 Security Headers** — CSP, HSTS (opt-in), X-Frame-Options, and more
- **Rate Limiting** — 100 req/min per IP · **CORS** — configurable multi-origin (exact-match) · **1MB body limit**
- **Server Timeouts** — Request (120s), keep-alive (65s), headers (66s) · **404 handler** · **Cross-protocol guard**
- **Build Provenance** · **SBOM** · **Supply Chain Attestations** · **Non-root execution**

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

## 🔧 Configuration

### GitHub Management Capabilities

16 GitHub tools covering issues, PRs, Kanban boards, milestones (with completion %), repository insights, Copilot reviews, and issue lifecycle with journal linking. Standard mutations (create/close issues, merge PRs) are handled by agents via `gh` CLI. **[Complete GitHub integration guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Git-Integration)**

## 🏗️ Build from Source

```bash
git clone https://github.com/neverinfamous/memory-journal-mcp.git
cd memory-journal-mcp
docker build -f Dockerfile -t memory-journal-mcp-local .
```

Then use `memory-journal-mcp-local` as the image name in your MCP config (see Quick Start above).

## 📚 Documentation & Resources

- **[GitHub Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki)** - Complete documentation
- **[Copilot Setup Guide](https://github.com/neverinfamous/memory-journal-mcp/blob/main/docs/copilot-setup.md)** - Cross-agent memory bridge between IDE agents and GitHub Copilot
- **[npm Package](https://www.npmjs.com/package/memory-journal-mcp)** - Node.js distribution
- **[Issues](https://github.com/neverinfamous/memory-journal-mcp/issues)** - Bug reports & feature requests

## 📄 License

MIT License - See [LICENSE](https://github.com/neverinfamous/memory-journal-mcp/blob/main/LICENSE)

_Migrating from v2.x?_ Your existing database is fully compatible. The TypeScript version uses the same schema and data format.
