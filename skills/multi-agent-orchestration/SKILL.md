---
name: multi-agent-orchestration
description: |
  Patterns for multi-agent systems and agentic workflows. Use when designing systems where multiple AI agents collaborate, delegate tasks, or follow structured workflows (e.g. Plan-and-Execute).
---

# Multi-Agent Orchestration

## Architectural Patterns
- **Supervisor Pattern**: A top-level agent routes tasks to specialized worker agents.
- **Plan-and-Execute**: One agent plans steps, others execute, and a reviewer validates.
- **Tool Use**: Agents should have narrowly scoped, deterministic tools to interact with the environment.
- **State Management**: Use persistent state (e.g., graphs) to track the conversation and execution flow.
