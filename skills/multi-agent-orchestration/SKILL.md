---
name: multi-agent-orchestration
description: |
  Patterns for multi-agent systems and agentic workflows. Use when designing systems where multiple AI agents collaborate, delegate tasks, or follow structured workflows (e.g. Plan-and-Execute).
---

# Multi-Agent Orchestration

Best practices for designing, coordinating, and managing multi-agent systems.

## 1. Architectural Patterns

- **Supervisor (Router) Pattern**: A top-level LLM acts as a router, classifying the user intent and delegating the task to a specialized sub-agent. The supervisor does not execute tools itself.
- **Plan-and-Execute**: One agent drafts a step-by-step plan. A separate executor agent runs the steps sequentially. A reviewer agent validates the final result against the original plan.
- **Network / Peer-to-Peer**: Agents can call each other as tools. Ensure strict recursion limits to prevent infinite delegation loops.

## 2. Tool Design for Agents

- **Narrow Scope**: Tools should do one thing deterministically. Do not build "swiss-army-knife" tools.
- **Structured Inputs**: Use strict Zod schemas for tool arguments. Provide detailed descriptions for each argument so the agent knows exactly what to pass.
- **Graceful Error Handling**: If a tool fails, return a structured error message to the agent (e.g., "Error: User not found. Please try searching by email instead.") so the agent can self-correct.

## 3. State Management

- **Graph-Based Execution**: Use state graphs (e.g., LangGraph or custom state machines) to represent agent workflows. Nodes are agent executions; edges are conditional routing logic.
- **Persistent Memory**: Store the conversation and execution state in a durable database (like SQLite or Postgres) to support long-running or paused workflows.
- **Checkpoints**: Save state after every tool call. This allows Human-in-the-Loop (HITL) interventions or resuming after a crash.

## 4. Human-in-the-Loop (HITL)

- **Approval Gates**: Pause execution and wait for human approval before executing destructive actions (e.g., deleting database rows, sending emails).
- **Feedback Injection**: Allow humans to modify the agent's internal state or prompt before it resumes execution.

## 5. Anti-Patterns to Avoid

- **The Monolithic Agent**: Giving one agent 50 tools and a massive system prompt. It will degrade in performance and hallucinate tool uses.
- **Infinite Loops**: Failing to set a `max_iterations` cap on agent loops.
