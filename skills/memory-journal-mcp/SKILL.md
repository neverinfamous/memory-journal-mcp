---
name: memory-journal-mcp
version: 1.1.0
tags:
  - "agent-skill"
description: Core guidelines and instruction pointers for the Memory Journal MCP. Use when interacting with the memory journal (creating, reading, searching entries), orchestrating commits, or writing session summaries.
---
# Memory Journal MCP Guidelines

This skill acts as a static anchor to reinforce core usage patterns, commit workflows, and anti-hallucination guardrails for the Memory Journal MCP.

## 1. Accessing Detailed Server Instructions
The Memory Journal MCP provides comprehensive, dynamic instructions via its `memory://help` resources:
- Use `read_resource` on `memory://help` for critical gotchas and core usage patterns.
- Use `read_resource` on `memory://help/{group}` for specific tool groups (e.g., `core`, `search`, `admin`, `codemode`, `github`, `git`, `templates`, `team`).

## 2. Core Agent Directives
- **Session Briefing:** Read the workspace briefing via `memory://briefing/{repo_name}` (or fallback to `memory://briefing`) at session start. DO NOT autonomously execute tasks listed in the briefing.
- **Context Integrity & Metadata:** Always include mandatory context fields when creating entries:
  - `workspace_id`: Repository name (e.g. `adamic`, `memory-journal-mcp`). Required string.
  - `session_id`: Current AI conversation ID.
  - `project_number`: Numeric project ID.
  - `impact_score` / `trust_score`: Blast radius and confidence heuristics (0.0 to 1.0).
  - `validation_status`: `'passed'`, `'none'`, or `'failed'`.
- **Context Recovery:** If you lose workspace context mid-task (e.g., needing a `project_number`), NEVER re-query `memory://briefing`. Query `memory://agent-id`.

## 3. Commit Integration & Entry Creation
- **Commit Journaling:** When recording commit history in the journal, create an entry (via `mj_execute_code`, `create_entry`, or `memory-journal-mcp entry create`) tagged `commit-narrative` containing `auto_context` with `commits: ["<sha>"]` and heuristic metadata (`impact_score`, `trust_score`, `validation_status`).
- **Commit Narrative Guardrails:** Any entry tagged `"commit-narrative"` MUST include `auto_context` containing a non-empty `commits` array (e.g., `{ "commits": ["<sha>"] }`).

## 4. Session Summary Guardrails
- **Required Structure:** Entries tagged `"session-summary"` (or `entry_type: "retrospective"`) MUST contain **EXACTLY** these 4 top-level section headers:
  - `## Accomplished`
  - `## Unfinished / Blocked`
  - `## Context for Next Session`
  - `## Commits`
- **Strict Validation:** DO NOT invent extra top-level section headers or duplicate headers. Must include `auto_context` with a non-empty `commits` array.

## 5. Tool Execution & Lifecycle Rules
- **Token Efficiency:** Prioritize MCP Code Mode (`mj_execute_code`) or native MCP tools for token-efficient entry logging, searches, and aggregations.
- **Runtime Configuration:** Use `update_configuration` to hot-reload tool filters (`tool_filter`) and briefing settings at runtime—the server automatically emits `notifications/tools/list_changed` without requiring a restart.
