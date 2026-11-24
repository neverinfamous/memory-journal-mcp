# Memory Journal MCP Server

[![GitHub](https://img.shields.io/badge/GitHub-neverinfamous/memory--journal--mcp-blue?logo=github)](https://github.com/neverinfamous/memory-journal-mcp) [![npm](https://img.shields.io/npm/v/memory-journal-mcp)](https://www.npmjs.com/package/memory-journal-mcp) [![Docker Pulls](https://img.shields.io/docker/pulls/writenotenow/memory-journal-mcp)](https://hub.docker.com/r/writenotenow/memory-journal-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT) ![Status](https://img.shields.io/badge/status-Production%2FStable-brightgreen)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-Published-green)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.neverinfamous/memory-journal-mcp) [![Security](https://img.shields.io/badge/Security-Enhanced-green.svg)](https://github.com/neverinfamous/memory-journal-mcp/blob/main/SECURITY.md) [![GitHub Stars](https://img.shields.io/github/stars/neverinfamous/memory-journal-mcp?style=social)](https://github.com/neverinfamous/memory-journal-mcp) [![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://github.com/neverinfamous/memory-journal-mcp)
![Coverage](https://img.shields.io/badge/Coverage-85.73%25-green.svg) ![E2E](https://img.shields.io/badge/E2E-466%20passing%20%C2%B7%200%20skipped-blue.svg) ![Tests](https://img.shields.io/badge/Tests-2556_passed-brightgreen.svg) [![Benchmarks](https://img.shields.io/badge/Benchmarks-21_passed-brightgreen.svg)](https://github.com/neverinfamous/memory-journal-mcp/wiki/Performance) [![CI](https://github.com/neverinfamous/memory-journal-mcp/actions/workflows/gatekeeper.yml/badge.svg)](https://github.com/neverinfamous/memory-journal-mcp/actions/workflows/gatekeeper.yml)

**[GitHub](https://github.com/neverinfamous/memory-journal-mcp)** • **[Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki)** • **[Changelog](https://github.com/neverinfamous/memory-journal-mcp/blob/main/CHANGELOG.md)** • **[Release Article](https://adamic.tech/articles/memory-journal-mcp-server)**

> [!TIP]
> **Value Proposition**
> Keep project context across AI sessions. Recall past decisions, hand work off through GitHub, and resume without rebuilding the history by hand.

**Experience true context-aware development:**

- _"Why did we choose SQLite over Postgres for this service last month?"_ (Semantic search)
- _"Run the `/issue-commander` (`triage` workflow) on the top priority ticket in the Kanban board."_ (GitHub operations)
- _"Who has been touching the auth module recently, and what's our team collaboration density?"_ (Team analytics)
- _"Commit the changes and record a structured journal entry with the `commit` prompt or `create_entry`."_ (Automated lifecycles)
- _"Draw a visual graph showing how my last 10 architectural decisions relate to each other."_ (Knowledge graph)

**[See complete examples & prompts →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Examples)**

---

## 🎯 What Sets Us Apart

**MCP Tools** · **Workflow Prompts** · **Resources** · **Tool Groups** · **Code Mode** · **Cognitive Automations (CMS)** · **GitHub Commander** (Issue Triage, PR Review, Milestone Sprints, Security/Quality/Perf Audits) · **GitHub Integration** (Issues, PRs, Actions, Kanban, Milestones, Insights) · **Team Collaboration** (Shared DB, Vector Search, Cross-Project Insights)

| Feature | Description |
| --- | --- |
| **Session Intelligence** | Auto-query history, create checkpoints, and hand off context between sessions. Briefings adapt dynamically to your workspace. |
| **Cognitive Automations** | Consolidate episodic notes nightly (`CMS-02`), audit soft-deletions, and self-heal recurring agent friction (`CMS-04`). |
| **GitHub Integration** | Manage Issues, PRs, Actions, Kanban boards, and milestones. Switch contexts across multiple repositories seamlessly. |
| **Knowledge & Search** | Find entries instantly using hybrid search and visualize relationships with Mermaid graphs. Auto-prune low-value entries to maintain search relevance. |
| **Code Mode** | Execute multi-step operations efficiently in a secure sandbox to drastically reduce token usage. |
| **Team Collaboration** | Share databases across teams with cross-project insights and role-based access control. |
| **Multi-Tenant Workspaces** | Isolate project journals on a single SQLite database via `workspace_id`, with automatic resolution from `PROJECT_REGISTRY` or working directory. |
| **Data & Architecture** | Export schemas safely, sync Markdown directories, secure data with encryption and automated backups, and handle errors effectively. |
| **Agent Collaboration** | Share context between agents, suggest reusable rules, and automate tasks like issue triage and PR reviews. |

---

### Isolate Environments with Multi-Tenancy

Memory Journal supports multi-tenancy out of the box via the `workspace_id` construct, acting as a strict isolation barrier for multiple journals sharing the same SQLite database file.

- **Auto-Resolution:** When `workspace_id` is omitted, the server automatically resolves the target workspace by matching `project_number` against `PROJECT_REGISTRY` or inspecting `process.cwd()`, before falling back to `DEFAULT_WORKSPACE_ID` (default: `default`).
- **Data Partitioning & Cross-Workspace Queries:** Core CRUD, Soft-Delete/Restore, FTS5 Search, Vector Semantic Search (`semantic_search`), and Analytics tools enforce `workspace_id` isolation end-to-end. Read and search tools accept `workspace_id: "*"` to query across all workspaces. `create_entry` ignores `workspace_id: "*"` and stores a resolved workspace. `update_entry` with `workspace_id: "*"` and `target_workspace_id` moves an entry. `delete_entry`, `restore_entry`, and batch deletes accept `*` and then match by id without a workspace predicate.
- **Controlled Migration:** A `workspace_id` is assigned on creation and migrated only via `update_entry` (`workspace_id: "*"` + `target_workspace_id`).
- **Server Config:** Set `--default-workspace-id` (or `DEFAULT_WORKSPACE_ID`) to configure the default fallback workspace for the container.

---

_Suggested Rule (Add to AGENTS.md, GEMINI.md, system prompts, etc.)_

<details>
<summary><strong>View Session Initialization Routine</strong></summary>

🛑 Session Initialization Routine

When the user initializes the session context by executing the `load-briefing` prompt:

1. You will receive the output of the `memory://briefing/{+repo}` resource.
2. Prepend your response EXACTLY as:
   > **📋 Briefing loaded** — `{repo_name}`
   > _{paste ENTIRE briefing here}_
3. Address the user's request below the briefing.
4. NEVER autonomously execute tasks listed in the briefing.
5. Do NOT proactively ask the user to load the briefing. Wait for them to use the prompt.
</details>

---

### 🎯 Control Access with Tool Filtering

> [!IMPORTANT]
> All shortcuts and tool groups always include **Code Mode** (`mj_execute_code`) and **Runtime Configuration** (`update_configuration`) as escape-hatch tools so agents can never lock themselves out of the configuration system or Code Mode.

Control which tools and tool groups are exposed using `MEMORY_JOURNAL_MCP_TOOL_FILTER` (or any of the 3 configuration sources; precedence: CLI flag > environment variable > config file):
- **CLI flag**: `--tool-filter <filter>`
- **Environment variable**: `MEMORY_JOURNAL_MCP_TOOL_FILTER` (`TOOL_FILTER` is not read)
- **`memory-journal.config.{yaml,yml,json}` key**: `"toolFilter"`

| Filter               | Use Case                 |
| -------------------- | ------------------------ |
| `full`               | All tools (default)      |
| `starter`            | Core + search + codemode |
| `essential`          | Minimal footprint        |
| `codemode`           | Code Mode sandbox only (`mj_execute_code`, `update_configuration`) |
| `readonly`           | Exposes those groups, then drops tools whose `readOnlyHint` is not `true`. `update_configuration` and `mj_execute_code` stay registered. |
| `-github`            | Exclude a group          |
| `-github,-analytics` | Exclude multiple groups  |

**Filter Syntax:** `shortcut` or `group` or `tool_name` (whitelist mode) · `-group` (disable group) · `-tool` (disable tool) · `+tool` (re-enable after group disable)

**Custom Selection:** List individual tool names to create your own whitelist: `--tool-filter "create_entry,search_entries,semantic_search"`

**Groups:** `core`, `search`, `analytics`, `relationships`, `io`, `admin`, `github`, `git`, `backup`, `team`, `codemode`

**[Complete tool filtering guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tool-Filtering)**

## 📋 Unlock Core Capabilities

### 🛠️ **MCP Tools**

| Group           | Description                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codemode`      | Code Mode (sandboxed code execution) 🌟 **Recommended**                                                                                                                                           |
| `core`          | Entry creation/read/history, tags, resource & briefing helpers, anchor staleness, test                                                                                                            |
| `search`        | Text search, date range, semantic, vector stats, deleted entries, cross-team                                                                                                                      |
| `analytics`     | Statistics, cross-project insights                                                                                                                                                                |
| `relationships` | Link entries, visualize graphs (`include_content: false` default, `source: "team"`)                                                                                                             |
| `io`            | JSON/Markdown export, Markdown directory import/export, and external import (Notion, Obsidian, Logseq)                                                                                            |
| `admin`         | Update configuration, project registry, update, delete, restore, rebuild/add to vector index, merge tags, audit log, auto-prune, bulk operations                                                  |
| `github`        | Issues, PRs, context, Kanban, **Milestones**, **Insights**, **issue lifecycle**, **Copilot Reviews**                                                                                              |
| `git`           | Commit history, search, release info, patterns, staleness checks                                                                                                                                  |
| `backup`        | Backup, list, restore, cleanup                                                                                                                                                                    |
| `team`          | CRUD, search, stats, relationships, IO, backup, vector search, cross-project insights, matrix, RBAC members, author aliases (requires `TEAM_DB_PATH`) |

**[Complete tools reference →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Tools)**

### 🎯 **Workflow Prompts**

Specialized workflow prompts for session briefing, standup & retro prep, goal tracking, PR & issue command, session summaries, journal optimization, CMS REM supervision (`cms-rem-supervisor`), adversarial plan reviews, exhaustive code & security audits, secure commit workflows, and anti-hallucination healing. **[Complete prompts guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Prompts)** • **[Automations guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Automations)**

### 📡 **Resources**

Comprehensive access to internal state via resources (`memory://briefing`, `memory://workflows`, `memory://rules`, `memory://skills`, `memory://health`, `memory://help`, `memory://staleness`, `memory://graph`, GitHub status/milestones, team stats, metrics/latency, and more) plus dynamic repo variants for cross-repo targeting (like `memory://briefing/{+repo}`, `memory://agent-context/{+repo}`, `memory://graph/{+repo}`, or `memory://kanban/{+repo}/{project_number}`). **[Resources documentation →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Resources)**

### ⚡ Cut Token Usage with Code Mode

Code Mode (`mj_execute_code`) runs multi-step journal operations in one sandboxed call, avoiding repeated tool schema overhead. Code executes in a **pre-warmed `worker_threads` V8 isolate pool + secondary `vm.createContext` boundary** with full `mj.*` API access:

- **V8 & Prototype Lockdown** — Disables `eval()`/`Function()` string codegen (`codeGeneration: { strings: false, wasm: false }`), nullifies `Proxy`, freezes built-in prototypes and `mj.*` bindings, and neuters `.constructor` chains across inner and outer realms.
- **Lexical Validation & RPC Allowlist** — Enforces 50KB code caps, blocks `require()`, `import()`, `process`, `Reflect.*`, `Symbol.*`, prototype mutators, and filesystem/network access, and validates `mj.*` calls against `Object.hasOwn()` and active `--tool-filter` rules (`readonly` restricts `mj.*` to `readOnlyHint: true`).
- **Resource & Egress Bounds** — Enforces 60 executions/min rate limits, bounded async timers (30s default timeout), and 100KB egress compaction (`CODE_MODE_MAX_RESULT_SIZE`).

**[Complete Code Mode guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Code-Mode)**

---


## 🚀 Quick Start (2 Minutes)

**Prerequisites:** Docker installed and running · ~250MB disk space · **[Full Installation Guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Installation)**

### 1. Pull the Image

```bash
docker pull writenotenow/memory-journal-mcp:latest
```

The image sets `DB_PATH=/app/data/memory_journal.db` and `MCP_HOST=0.0.0.0`. A non-loopback bind still requires `MCP_AUTH_TOKEN` or OAuth.

### 2. Create Data Directory

```bash
mkdir data
```

### 3. Add to Your MCP Client (Cursor, Antigravity, Windsurf)

Add this to your `~/.cursor/mcp.json`, Claude Desktop config, or equivalent:

### Basic Configuration

> 💡 **Tip:** `npx memory-journal-mcp project create <name> --path <path> [--number <project-number>]` writes `projectRegistry` to `memory-journal.config.json` (default `~/.gemini/config/memory-journal.config.json`, or `MEMORY_JOURNAL_CONFIG`). It does not edit `PROJECT_REGISTRY`. A client `PROJECT_REGISTRY` overrides the file; leave it unset so the server loads that file.

```json
{
  "mcpServers": {
    "memory-journal-mcp": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "./data:/app/data",
        "-e", "GITHUB_TOKEN", "-e", "ALLOWED_IO_ROOTS",
        "-e", "PROJECT_REGISTRY={\"my-repo\":{\"path\":\"/app/repo\",\"project_number\":1}}",
        "-v", "/path/to/your/repo:/app/repo:ro",
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

```json
{
  "mcpServers": {
    "memory-journal-mcp": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "./data:/app/data",
        "-e", "GITHUB_TOKEN", "-e", "TEAM_DB_PATH", "-e", "PROJECT_REGISTRY",
        "-e", "ALLOWED_IO_ROOTS", "-e", "AUTO_REBUILD_INDEX", "-e", "EMBEDDING_MODEL",
        "-e", "CODEMODE_INTERNAL_FULL_ACCESS",
        "-e", "RULES_FILE_PATH", "-e", "SKILLS_DIR_PATH",
        "-e", "MEMORY_JOURNAL_WORKFLOW_SUMMARY", "-e", "AUDIT_LOG_PATH", "-e", "TEAM_AUTHOR",
        "-v", "/path/to/shared/team.db:/app/data/team.db:rw",
        "-v", "/path/to/your/projects:/app/projects:ro",
        "-v", "/path/to/rules.md:/app/rules.md:ro",
        "-v", "/path/to/skills:/app/skills:ro",
        "writenotenow/memory-journal-mcp:latest",
        "--tool-filter", "codemode"
      ],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here",
        "TEAM_DB_PATH": "/app/data/team.db",
        "PROJECT_REGISTRY": "{\"my-repo\":{\"path\":\"/app/projects/repo1\",\"project_number\":1},\"other-repo\":{\"path\":\"/app/projects/repo2\",\"project_number\":5}}",
        "ALLOWED_IO_ROOTS": "/app/projects,/app/data,/app/skills",
        "AUTO_REBUILD_INDEX": "true",
        "EMBEDDING_MODEL": "Xenova/all-MiniLM-L6-v2",
        "CODEMODE_INTERNAL_FULL_ACCESS": "true",
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

### 📋 Customizing the Session Briefing

The `memory://briefing` resource is dynamically assembled at session start with live Git/CI status, tracking, journal previews, 14-day graph pivots, and recent commits. Tune three dimensions via environment variables:

- **Focus** — `MEMORY_JOURNAL_MCP_TOOL_FILTER` (CLI: `--tool-filter`, config file key: `"toolFilter"`): `full` (default), `starter`, `essential`, `readonly`, or `codemode`
- **Journal Content** — `BRIEFING_ENTRY_COUNT`, `BRIEFING_SUMMARY_COUNT`, `BRIEFING_COMMIT_COUNT`, `BRIEFING_IMPORTANCE_THRESHOLD`, `BRIEFING_INCLUDE_TEAM`, `BRIEFING_GRAPH`, `BRIEFING_INSIGHTS`
- **GitHub Enrichment** — `BRIEFING_ISSUE_COUNT`, `BRIEFING_PR_COUNT`, `BRIEFING_PR_STATUS`, `BRIEFING_MILESTONE_COUNT`, `BRIEFING_WORKFLOW_COUNT`, `BRIEFING_WORKFLOW_STATUS`, `BRIEFING_COPILOT_REVIEWS`

Set `RULES_FILE_PATH` and `SKILLS_DIR_PATH` to surface agent rules and skills as companion resources. In multi-repo setups, agents read `memory://briefing/{+repo}` for repo-scoped context.

**[Full briefing customization guide with presets →](https://github.com/neverinfamous/memory-journal-mcp#customizing-the-session-briefing)**

**Variants** (modify the config array above):

- **Minimal**: Remove `-e GITHUB_TOKEN`, repo mount, and `env` block.
- **Team**: Add `-e "TEAM_DB_PATH=/app/data/team.db"`.
- **Cross-Team**: Add `-e "ADDITIONAL_TEAM_DBS={\"other-team\":\"/app/data/other-team.db\"}"`.
- **Code Mode**: Add `"--tool-filter", "codemode", "--codemode-internal-full-access"`.
- **Briefing**: Add `-e "BRIEFING_ENTRY_COUNT=5"`.

### 4. Restart & Journal!

Restart Cursor or your MCP client and start journaling!

### 🔧 Configuration Highlights

- **`--config <path>`**: Load settings from `.yaml` or `.json` (see [`memory-journal-config-example.json`](https://github.com/neverinfamous/memory-journal-mcp/blob/main/memory-journal-config-example.json)). Use `--dump-config` to debug precedence.
- **`ALLOWED_IO_ROOTS` / `--allowed-io-roots`**: Comma-separated allowed filesystem paths (default: none — fail-closed in stdio; mandatory when `--transport http` is used).
- **`MCP_AUTH_TOKEN` / `MCP_AUTH_SCOPES`** (`--auth-token`, `--auth-scopes`): Static Bearer token and granted scopes (`read` default; use `full` for full access).
- **`MEMORY_JOURNAL_MCP_TOOL_FILTER` / `--tool-filter`**: Control tool exposure (`full`, `starter`, `essential`, `codemode`, `readonly`, `-github`; config key: `"toolFilter"`).
- **`MJ_DB_ENCRYPTION_KEY` / `DB_ENCRYPTION_KEY`**: Enables SQLCipher at-rest encryption.
- **`CODEMODE_INTERNAL_FULL_ACCESS`**: Allow Code Mode to bypass tool filters internally (`false`).
- **`DEFAULT_WORKSPACE_ID` / `--default-workspace-id`**: Default workspace for multi-tenant isolation (`default`).
- **`PROJECT_REGISTRY`**: Maps repo names to paths and project numbers for `workspace_id` resolution and multi-project routing.
- **`MCP_AGENT_HEALING` / `--no-agent-healing`**: Set `MCP_AGENT_HEALING=false` (or `--no-agent-healing`) to disable autonomous tool/parameter healing.
- **`MAX_TOOL_INPUT_ELEMENTS` / `--max-tool-input-elements`**: Max array/object elements in tool inputs (default: `25000`, `0` or `Infinity` = disabled).
- **`AUDIT_LOG_PATH` / `AUDIT_REDACT` / `AUDIT_READS` / `AUDIT_LOG_MAX_SIZE`** (`--audit-log`, `--no-audit-redact`, `--audit-reads`, `--audit-log-max-size`): JSONL audit log path (or `stderr`), redaction, read logging, and rotation size.
- **`ARCHIVE_OLDER_THAN_DAYS` / `PRUNE_OLDER_THAN_DAYS` / `HARD_DELETE_OLDER_THAN_DAYS` / `PRUNE_IMPORTANCE_THRESHOLD` / `PRUNE_EXCLUDE_TAGS` / `PRUNE_DRY_RUN`**: Control startup and `admin prune` auto-prune lifecycle. Test rules safely with `--prune-dry-run`.

For all environment variables and routing docs, see the **[Configuration Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki/Configuration)**.

### 🔄 Session Management & Nightly Automations (CMS)

1. **Session start** → agent reads `memory://briefing` (or `memory://briefing/{+repo}`) and client `SessionStart` hooks inject `workspace_id` + `project_number` context.
2. **Session summary & telemetry** → `/session-summary` captures handoff context, while built-in error logging (`logs/agent-issues.jsonl`) and client `PostToolUse` / `afterMCPExecution` hooks record tool friction.
3. **Nightly Cognitive Maintenance (`CMS-02` & `CMS-04`)** → schedule or run native MCP prompts in **Cursor**, **Google Antigravity**, **Claude Code**, or **Windsurf**:
   - `/mcp:memory-journal-mcp:optimize-journal mode="full" autoRun="true" limit="0"` (`CMS-02`: backups, unassigned migration, Git/GitHub ground-truth & staleness checks, episodic compaction, tag/graph defrag, auto-prune, and vector parity)
   - `/mcp:memory-journal-mcp:cms-rem-supervisor lookbackHours="24" autoRestore="true"` (`CMS-04`: soft-delete safety rollback, issue-log mining, and self-healing)

**[Complete Automations, Hooks & Scheduling Guide →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Automations)**

### 🌐 Scale with HTTP/SSE Transport

For remote access, web-based clients, or HTTP-compatible MCP hosts. The server supports both stateful (SSE) and stateless (no-session HTTP) modes.

> [!IMPORTANT]
> In HTTP transport mode (`--transport http`), the server enforces three fail-closed startup guards: (1) explicit `ALLOWED_IO_ROOTS` / `--allowed-io-roots` is always required, (2) explicit authentication (`MCP_AUTH_TOKEN` / `--auth-token` or `--oauth-enabled`) is required when binding to a non-loopback address (`0.0.0.0`), and (3) explicit `PUBLIC_ORIGIN` / `--public-origin` is required when `--oauth-enabled` is bound to a non-loopback address.

```bash
docker run --rm -p 3000:3000 \
  -v ./data:/app/data \
  -e ALLOWED_IO_ROOTS="/app/data" \
  -e MCP_AUTH_TOKEN="your_secure_random_token" \
  -e MCP_AUTH_SCOPES="full" \
  writenotenow/memory-journal-mcp:latest \
  --transport http --port 3000 --server-host 0.0.0.0
```

- **Features**: OAuth 2.1, Security Headers, Rate Limiting, CORS, and more.
- **Stateless Mode**: Add `--stateless` to the command above.

**[See the full HTTP/SSE Transport & Endpoints documentation in the Wiki →](https://github.com/neverinfamous/memory-journal-mcp/wiki/HTTP-Transport)**

#### Maintenance & Scheduled Automation

Schedule nightly **[Agentic CMS Automations →](https://github.com/neverinfamous/memory-journal-mcp/wiki/Automations)** (`CMS-02` / `CMS-04`) in your MCP client, or run zero-token one-shot maintenance CLI commands (`memory-journal-mcp admin backup`, `admin vacuum`, `admin prune`, `admin rebuild-index`) from container cron / Kubernetes `CronJob` / host schedulers. See the **[CLI Reference →](https://github.com/neverinfamous/memory-journal-mcp/wiki/CLI#admin)** for flags.

## 🔐 OAuth 2.1 Authentication

For production deployments, enable full OAuth 2.1 support on the HTTP transport (opt-in via `--oauth-enabled`). Features include RFC 9728/8414 discovery, JWKS token validation, and granular scopes.

**[See the OAuth 2.1 Setup Guide in the Wiki →](https://github.com/neverinfamous/memory-journal-mcp/wiki/HTTP-Transport#configuration-reference)**

## 📄 License

MIT License - See [LICENSE](https://github.com/neverinfamous/memory-journal-mcp/blob/main/LICENSE)

_Upgrading?_ Your existing database is automatically migrated on startup.
