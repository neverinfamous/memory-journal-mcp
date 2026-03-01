# IDE Hook Configurations

Ready-to-use hook configurations for automatic session-end journaling with memory-journal-mcp.

## How It Works

When a session ends, the hook prompts the agent to create a journal entry summarizing:

- **What was accomplished** — key changes, decisions, files modified
- **What's unfinished** — pending items, open questions
- **Context for next session** — entry IDs, branch names, PR numbers

The entry uses `entry_type: "retrospective"` tagged `session-summary`. The next session's `memory://briefing` automatically includes it.

## Progressive Enhancement

```
┌─────────────────────────────────────────────────────┐
│  IDE Hooks (most reliable)                          │
│  Cursor sessionEnd · Kiro hooks · Kilo Code modes   │
│  ↓ fires automatically on session close             │
├─────────────────────────────────────────────────────┤
│  ServerInstructions.ts (fallback)                   │
│  Agent detects session end → creates entry           │
│  ↓ works in any MCP client                          │
├─────────────────────────────────────────────────────┤
│  User opt-out                                       │
│  User says "skip the summary" → agent skips          │
└─────────────────────────────────────────────────────┘
```

If both a hook **and** the instructions fire, two similar entries is acceptable — two is better than zero.

## Setup by IDE

### Cursor

Copy `cursor/hooks.json` to your project's `.cursor/hooks.json`:

```powershell
# From your project root
mkdir -p .cursor
cp <path-to-memory-journal-mcp>/hooks/cursor/hooks.json .cursor/hooks.json
```

The hook uses the **message-injection** approach: on `sessionEnd`, it injects a user message telling the agent to create the summary entry. This is simpler and more reliable than directly calling MCP tools from a hook script.

**Requirements**: Cursor v1.7+ with Hooks (beta) enabled.

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

Agent hooks are in **preview** (early 2026). When stabilized, a configuration will be added here. In the meantime, the `ServerInstructions.ts` fallback handles session-end capture.

### AntiGravity

Does not currently support hooks. The `ServerInstructions.ts` fallback handles session-end capture automatically.

## No Hooks? No Problem

The `server-instructions.md` in this project includes a **Session End** behavior section that instructs any MCP-connected agent to create a session summary entry when the conversation wraps up. This works in **every** MCP client, regardless of hook support.

To **disable** session-end entries, tell the agent: "Skip the session summary" or "Don't create an end-of-session entry."
