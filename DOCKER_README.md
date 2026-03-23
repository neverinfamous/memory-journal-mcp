# Memory Journal MCP Server

[![GitHub](https://img.shields.io/badge/GitHub-neverinfamous/memory--journal--mcp-blue?logo=github)](https://github.com/neverinfamous/memory-journal-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/writenotenow/memory-journal-mcp)](https://hub.docker.com/r/writenotenow/memory-journal-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
![Status](https://img.shields.io/badge/status-Production%2FStable-brightgreen)
[![npm](https://img.shields.io/npm/v/memory-journal-mcp)](https://www.npmjs.com/package/memory-journal-mcp)
[![Security](https://img.shields.io/badge/Security-Enhanced-green.svg)](https://github.com/neverinfamous/memory-journal-mcp/blob/main/SECURITY.md)
[![GitHub Stars](https://img.shields.io/github/stars/neverinfamous/memory-journal-mcp?style=social)](https://github.com/neverinfamous/memory-journal-mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://github.com/neverinfamous/memory-journal-mcp)
![Coverage](https://img.shields.io/badge/Coverage-96%25-brightgreen.svg)
![Tests](https://img.shields.io/badge/Tests-1767_passed-brightgreen.svg)
![E2E Tests](https://img.shields.io/badge/E2E_Tests-377_passed-brightgreen.svg)

🎯 **AI Context + Project Intelligence:** Bridge disconnected AI sessions with persistent project memory and **automatic session handoff** — with full GitHub workflow integration.

**[GitHub](https://github.com/neverinfamous/memory-journal-mcp)** • **[Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki)** • **[Changelog](https://github.com/neverinfamous/memory-journal-mcp/blob/main/CHANGELOG.md)** • **[Release Article](https://adamic.tech/articles/memory-journal-mcp-server)**

## 🎯 What This Does

### What Sets Us Apart

**61 MCP Tools** · **16 Workflow Prompts** · **28 Resources** · **10 Tool Groups** · **Code Mode** · **GitHub Commander** (Issue Triage, PR Review, Milestone Sprints, Security/Quality/Perf Audits) · **GitHub Integration** (Issues, PRs, Actions, Kanban, Milestones, Insights) · **Team Collaboration** (Shared DB, Vector Search, Cross-Project Insights)

| Feature                   | Description                                                                                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Session Intelligence**  | Agents auto-query project history, create entries at checkpoints, and hand off context between sessions via `/session-summary`                                                                                             |
| **GitHub Integration**    | 16 tools for Issues, PRs, Actions, Kanban, Milestones (%), Copilot Reviews, and 14-day Insights                                                                                                                            |
| **Knowledge Graphs**      | 8 relationship types linking specs → implementations → tests → PRs with Mermaid visualization                                                                                                                              |
| **Triple Search**         | Full-text (FTS5), semantic (`@huggingface/transformers` + `sqlite-vec`), and date-range search                                                                                                                             |
| **Code Mode**             | Execute multi-step operations in a secure sandbox — up to 90% token savings via `mj.*` API                                                                                                                                 |
| **Configurable Briefing** | 12 env vars / CLI flags control `memory://briefing` content — entries, team, GitHub detail, skills awareness                                                                                                               |
| **Reports & Analytics**   | Standups, retrospectives, PR summaries, digests, period analyses, and milestone tracking                                                                                                                                   |
| **Team Collaboration**    | 20 tools with full parity — CRUD, vector search, relationship graphs, cross-project insights, author attribution                                                                                                           |
| **Backup & Restore**      | One-command backup/restore with automated scheduling, retention policies, and safety-net auto-backups                                                                                                                      |
| **Security & Transport**  | OAuth 2.1 (RFC 9728/8414, JWT/JWKS, scopes), Streamable HTTP + SSE, rate limiting, CORS, SQL injection prevention, non-root Docker                                                                                         |
| **Agent Collaboration**   | IDE agents and Copilot share context; review findings become searchable knowledge; agents suggest reusable rules and skills ([setup](https://github.com/neverinfamous/memory-journal-mcp/blob/main/docs/copilot-setup.md)) |
| **GitHub Commander**      | Skills for issue triage, PR reviews, sprint milestones, and security/quality/performance audits with journal trails ([docs](skills/github-commander/SKILL.md))                                                             |

**[See complete examples & prompts →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Examples)**

---

## Suggested Rule (Add to AGENTS.md, GEMINI.md, etc)

**PERFORM AT START OF CHATS**: Read `memory://briefing`, present as two-column markdown table (Context | Value). Include all available fields; omit absent rows.

**CREATE JOURNAL ENTRIES** at natural checkpoints:

- After pushing to main (`milestone` or `technical_note`, tag with version)
- After significant design decisions or learnings (`project_decision`)
- After resolving non-trivial bugs (`bug_fix`, link to issue number)

**SUGGEST CREATING OR IMPROVING RULES AND SKILLS** as you notice workflow opportunities.

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

| Group           | Tools | Description                                                                                                         |
| --------------- | ----- | ------------------------------------------------------------------------------------------------------------------- |
| `codemode`      | 1     | Code Mode (sandboxed code execution) 🌟 **Recommended**                                                             |
| `core`          | 6     | Entry CRUD, tags, test                                                                                              |
| `search`        | 4     | Text search, date range, semantic, vector stats                                                                     |
| `analytics`     | 2     | Statistics, cross-project insights                                                                                  |
| `relationships` | 2     | Link entries, visualize graphs                                                                                      |
| `export`        | 1     | JSON/Markdown export                                                                                                |
| `admin`         | 5     | Update, delete, rebuild/add to vector index, merge tags                                                             |
| `github`        | 16    | Issues, PRs, context, Kanban, **Milestones**, **Insights**, **issue lifecycle**, **Copilot Reviews**                |
| `backup`        | 4     | Backup, list, restore, cleanup                                                                                      |
| `team`          | 20    | CRUD, search, stats, relationships, export, backup, vector search, cross-project insights (requires `TEAM_DB_PATH`) |

**[Complete tools reference →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tools)**

### 🎯 **16 Workflow Prompts**

Standups, retrospectives, PR summaries, weekly digests, period analysis, milestone tracking, context bundles, session summaries, and more. **[Complete prompts guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Prompts)**

### 📡 **28 Resources** (20 Static + 8 Template)

20 static resources (`memory://briefing`, `memory://workflows`, `memory://rules`, `memory://health`, `memory://help`, `memory://help/gotchas`, GitHub status/insights, team stats, and more) plus 8 template resources for project timelines, issue/PR entries, Kanban boards, milestone details, and per-group help. **[Resources documentation →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Resources)**

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

| Environment Variable              | Description                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `DB_PATH`                         | Database location (default: `/app/data/memory_journal.db` in Docker)                              |
| `TEAM_DB_PATH`                    | Team database file location (CLI: `--team-db`)                                                    |
| `TEAM_AUTHOR`                     | Override author name for team entries (default: `git config user.name`)                           |
| `GITHUB_TOKEN`                    | GitHub personal access token for API access                                                       |
| `GITHUB_REPO_PATH`                | Path to git repo inside container (mount your repo)                                               |
| `DEFAULT_PROJECT_NUMBER`          | Default GitHub Project number for auto-assignment when creating issues                            |
| `AUTO_REBUILD_INDEX`              | Set to `true` to rebuild vector index on server startup                                           |
| `MCP_HOST`                        | Server bind host (`0.0.0.0` for containers, default: `localhost`)                                 |
| `MCP_AUTH_TOKEN`                  | Bearer token for HTTP transport authentication (CLI: `--auth-token`)                              |
| `MCP_ENABLE_HSTS`                 | Enable HSTS security header on HTTP responses (CLI: `--enable-hsts`; default: `false`)            |
| `OAUTH_ENABLED`                   | Set to `true` to enable OAuth 2.1 authentication (HTTP only)                                      |
| `OAUTH_ISSUER`                    | OAuth issuer URL (e.g., `https://auth.example.com/realms/mcp`)                                    |
| `OAUTH_AUDIENCE`                  | Expected JWT audience claim                                                                       |
| `OAUTH_JWKS_URI`                  | JWKS endpoint for token signature verification                                                    |
| `BRIEFING_ENTRY_COUNT`            | Journal entries in briefing (CLI: `--briefing-entries`; default: `3`)                             |
| `BRIEFING_INCLUDE_TEAM`           | Include team DB entries in briefing (`true`/`false`; default: `false`)                            |
| `BRIEFING_ISSUE_COUNT`            | Issues to list in briefing; `0` = count only (default: `0`)                                       |
| `BRIEFING_PR_COUNT`               | PRs to list in briefing; `0` = count only (default: `0`)                                          |
| `BRIEFING_PR_STATUS`              | Show PR status breakdown (open/merged/closed; default: `false`)                                   |
| `BRIEFING_WORKFLOW_COUNT`         | Workflow runs to list in briefing; `0` = status only (default: `0`)                               |
| `BRIEFING_WORKFLOW_STATUS`        | Show workflow status breakdown in briefing (default: `false`)                                     |
| `BRIEFING_COPILOT_REVIEWS`        | Aggregate Copilot review state in briefing (default: `false`)                                     |
| `RULES_FILE_PATH`                 | Path to user rules file for agent awareness (CLI: `--rules-file`)                                 |
| `SKILLS_DIR_PATH`                 | Path to skills directory for agent awareness (CLI: `--skills-dir`)                                |
| `MEMORY_JOURNAL_WORKFLOW_SUMMARY` | Free-text workflow summary for `memory://workflows` (CLI: `--workflow-summary`)                   |
| `INSTRUCTION_LEVEL`               | Briefing depth: `essential`, `standard`, `full` (CLI: `--instruction-level`; default: `standard`) |
| `PROJECT_LINT_CMD`                | Project lint command for GitHub Commander validation gates (default: `npm run lint`)              |
| `PROJECT_TYPECHECK_CMD`           | Project typecheck command (default: `npm run typecheck`; empty = skip)                            |
| `PROJECT_BUILD_CMD`               | Project build command (default: `npm run build`; empty = skip)                                    |
| `PROJECT_TEST_CMD`                | Project test command (default: `npm run test`)                                                    |
| `PROJECT_E2E_CMD`                 | Project E2E test command (default: empty = skip)                                                  |
| `PROJECT_PACKAGE_MANAGER`         | Package manager override: `npm`, `yarn`, `pnpm`, `bun` (default: auto-detect from lockfile)       |
| `PROJECT_HAS_DOCKERFILE`          | Enable Docker audit steps (default: auto-detect)                                                  |
| `COMMANDER_HITL_FILE_THRESHOLD`   | Human-in-the-loop checkpoint if changes touch > N files (default: `10`)                           |
| `COMMANDER_SECURITY_TOOLS`        | Override security tool auto-detection (comma-separated; default: auto-detect)                     |
| `COMMANDER_BRANCH_PREFIX`         | Branch naming prefix for PRs (default: `fix`)                                                     |

**Without `GITHUB_REPO_PATH`**: Explicitly provide `owner` and `repo` when calling GitHub tools.

**Fallback:** With `GITHUB_REPO_PATH` set, tools auto-detect `owner`/`repo` from git config. Without it, provide `owner` and `repo` args explicitly. Mount read-only: `-v /path/to/repo:/app/repo:ro`.

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
| HTTP Transport              | ✅     | Streamable HTTP with OAuth middleware            |

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

_Migrating from v2.x?_ Your existing database is fully compatible.
