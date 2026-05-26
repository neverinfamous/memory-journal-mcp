---
name: multi-agent-orchestration
description: |
  Patterns for multi-agent systems and agentic workflows. Use when designing systems where multiple AI agents collaborate, delegate tasks, or follow structured workflows (e.g. Plan-and-Execute).
---

# Multi-Agent Orchestration

## Architectural Patterns
- **Supervisor Pattern**: A top-level agent routes tasks to specialized worker agents. In a multi-agent setup, designate a Supervisor agent responsible for delegating sub-tasks to worker agents and synthesizing their final outputs.
- **Plan-and-Execute**: One agent plans steps, others execute, and a reviewer validates. For complex tasks, separate the planning phase (using a high-reasoning model) from the execution phase (using faster, specialized models or tools).
- **Tool Use**: Agents should have narrowly scoped, deterministic tools to interact with the environment. Worker agents should have the minimum tools required (Principle of Least Privilege). Do not give every agent access to file deletion or database writes.
- **State Management**: Use persistent state (e.g., graphs) to track the conversation and execution flow. Use graph-based state machines (e.g., LangGraph) to model agent interactions as predictable state transitions with explicit human-in-the-loop (HITL) checkpoints for destructive actions.
