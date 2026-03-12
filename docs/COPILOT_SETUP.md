# Copilot ↔ Memory Journal MCP Bridge

Connect memory-journal-mcp to GitHub Copilot for cross-agent knowledge sharing. Two agents, one shared memory.

## How It Works

```
IDE Agent (AntiGravity/Cursor)  ←→  memory-journal-mcp  ←→  Copilot (GitHub)
         reads reviews via API        shared memory         reads context via MCP
```

**Pattern 1 — Learn from reviews:** The IDE agent reads Copilot's PR review findings with `get_copilot_reviews`, creates `copilot-finding` journal entries, and suggests rule updates.

**Pattern 2 — Pre-emptive checking:** Before writing code, the IDE agent searches past `copilot-finding` entries and applies patterns proactively.

**Pattern 3 — Context-aware reviews:** Copilot uses memory-journal-mcp as an MCP server during PR review, gaining access to project history and architectural decisions.

## Setup: Copilot → Memory Journal (MCP Server)

### Local MCP (VS Code / Copilot Chat)

Add to your workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "memory-journal": {
      "command": "npx",
      "args": ["-y", "memory-journal-mcp"],
      "env": {
        "DB_PATH": "./memory-journal.db",
        "GITHUB_TOKEN": "${env:GITHUB_TOKEN}",
        "GITHUB_REPO_PATH": "."
      }
    }
  }
}
```

### Remote MCP (HTTP Transport)

For Copilot Code Review or remote agents, deploy in HTTP mode:

```bash
npx memory-journal-mcp --transport http --port 3100
```

Then configure as a remote MCP server in your GitHub Copilot settings.

## Setup: IDE Agent → Copilot Reviews

Enable Copilot review data in the briefing by setting:

```
BRIEFING_COPILOT_REVIEWS=true
```

Or use the CLI flag:

```
--briefing-copilot
```

Then use `get_copilot_reviews(pr_number)` to fetch Copilot's findings for any PR.

## Security Note

When connecting memory-journal-mcp to Copilot:

- Use **read-only OAuth scopes** (e.g., a `read`-level scope) and follow the principle of least privilege if OAuth is enabled
- The journal database may contain project decisions, architecture notes, and code patterns — share only what's appropriate
- Copilot's access follows your GitHub repository permissions
