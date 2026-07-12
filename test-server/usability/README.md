# Agent Usability & Hallucination Testing

> **This directory is optimized for AI agent consumption.**

This directory contains organic testing prompts designed to "fuzz" the `memory-journal-mcp` tools and explicitly trigger agent hallucinations. The goal is not just to test if the tools work, but to test if the tools are intuitive and bulletproof for AI agents.

## Testing Philosophy
Unlike the deterministic integration tests in `test-server/codemode/` and `test-server/standard/`, these prompts instruct agents to act intuitively, guess properties, and purposefully omit syntax like `await`. 

When an agent fails, they are instructed to permanently heal the codebase using the optimization layers described in `skills/mj-mcp-heal/SKILL.md`.

## Execution Workflow (Divide & Conquer)

Because testing and healing all tools at once exhausts an agent's context window, we test them by group using separate threads/subagents.

Please refer to [`coordinator-workflow.md`](./coordinator-workflow.md) for the complete workflow and the sequential list of test modules to execute.

## Test Modules

Please refer to [`coordinator-workflow.md`](./coordinator-workflow.md) for the complete and sequential list of test modules to execute.
