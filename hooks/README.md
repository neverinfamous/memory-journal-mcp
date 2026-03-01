# IDE Hook & Rule Configurations

Ready-to-use configurations for automatic session management with memory-journal-mcp.

## How It Works

Memory Journal bridges AI sessions with two behaviors:

- **Session start** — Agent reads `memory://briefing` and shows the user a project context summary
- **Session end** — Agent creates a `retrospective` entry tagged `session-summary` capturing what was done, what's pending, and context for the next session

The next session's briefing automatically includes the previous session's summary.

## Progressive Enhancement

```
┌─────────────────────────────────────────────────────┐
│  Cursor Rule (most reliable for agent behavior)     │
│  .cursor/rules/memory-journal.mdc                   │
│  ↓ always-apply rule instructs agent directly       │
├─────────────────────────────────────────────────────┤
│  Server Instructions (fallback for any MCP client)  │
│  Embedded in MCP server initialization              │
│  ↓ agent follows Session Start / Session End steps  │
├─────────────────────────────────────────────────────┤
│  IDE Hooks (audit & logging)                        │
│  Cursor sessionEnd · Kiro hooks · Kilo Code modes   │
│  ↓ fire-and-forget observation on session close     │
├─────────────────────────────────────────────────────┤
│  User opt-out                                       │
│  User says "skip the summary" → agent skips          │
└─────────────────────────────────────────────────────┘
```

## Setup by IDE

### Cursor

#### Step 1: Cursor Rule (handles session start + end behavior)

Copy `cursor/memory-journal.mdc` to your project's `.cursor/rules/`:

```powershell
# From your project root
mkdir -p .cursor/rules
cp <path-to-memory-journal-mcp>/hooks/cursor/memory-journal.mdc .cursor/rules/memory-journal.mdc
```

This `alwaysApply` rule instructs the agent to:

- Read `memory://briefing` and show project context at session start
- Create a session summary entry when the conversation wraps up

**Requirements**: Cursor with Rules support (`.cursor/rules/` directory).

#### Step 2: sessionEnd Hook (optional — audit logging)

Copy `cursor/hooks.json` and `cursor/session-end.sh` to your project's `.cursor/`:

```powershell
cp <path-to-memory-journal-mcp>/hooks/cursor/hooks.json .cursor/hooks.json
mkdir -p .cursor/hooks
cp <path-to-memory-journal-mcp>/hooks/cursor/session-end.sh .cursor/hooks/session-end.sh
chmod +x .cursor/hooks/session-end.sh
```

The `sessionEnd` hook is **fire-and-forget** — Cursor does not use its output. It logs session metadata to `/tmp/memory-journal-sessions.log`. Customize the script for your own auditing needs.

> **Note:** Cursor's `sessionEnd` hook cannot inject messages or trigger agent actions. Session summary creation is handled by the Cursor rule and server instructions, not the hook.

**Requirements**: Cursor v1.7+ with Hooks enabled.

### Kiro (AWS)

Copy `kiro/session-end.md` to your project's `.kiro/hooks/` directory:

```powershell
mkdir -p .kiro/hooks
cp <path-to-memory-journal-mcp>/hooks/kiro/session-end.md .kiro/hooks/
```

Kiro hooks use markdown files with YAML frontmatter. The `manual` trigger means you activate it from the Kiro hook panel when ending a session.

### Kilo Code

Copy `kilo-code/session-end-mode.json` to your Kilo Code settings:

```powershell
# Import via Kilo Code settings UI, or add to your modes configuration
cp <path-to-memory-journal-mcp>/hooks/kilo-code/session-end-mode.json ~/.kilocode/modes/
```

This creates a `session-end` custom mode. Switch to it at the end of a session and Kilo Code will create the summary entry using MCP tools.

### VS Code + GitHub Copilot

Agent hooks are in **preview** (early 2026). When stabilized, a configuration will be added here. In the meantime, the server instructions fallback handles session management.

### AntiGravity

Does not currently support hooks or rules. The server instructions fallback handles session management automatically. For session-start behavior, add to your user rules: "At session start, read `memory://briefing` from memory-journal-mcp."

## No Rules or Hooks? No Problem

The `server-instructions.md` in this project includes **Session Start** and **Session End** behavior sections that instruct any MCP-connected agent to manage sessions automatically. This works in **every** MCP client, regardless of rule or hook support — though reliability varies by client.

To **disable** session-end entries, tell the agent: "Skip the session summary" or "Don't create an end-of-session entry."
