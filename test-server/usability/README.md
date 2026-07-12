# Agent Usability & Hallucination Testing

> **This directory is optimized for AI agent consumption.**

This directory contains organic testing prompts designed to "fuzz" the `memory-journal-mcp` tools and explicitly trigger agent hallucinations. The goal is not just to test if the tools work, but to test if the tools are intuitive and bulletproof for AI agents.

## Testing Philosophy
Unlike the deterministic integration tests in `test-server/codemode/` and `test-server/standard/`, these prompts instruct agents to act intuitively, guess properties, and purposefully omit syntax like `await`. 

When an agent fails, they are instructed to permanently heal the codebase using the optimization layers described in `skills/mj-mcp-heal/SKILL.md`.

## Execution Workflow (Divide & Conquer)

Because testing and healing all tools at once exhausts an agent's context window, we test them by group using separate threads/subagents.

1. **Pick a test file** (e.g., `test-usability-core-read.md`).
2. **Spawn a subagent** (or start a new thread) and feed them the file.
3. **Wait for the Checkpoint**: The subagent will pause and ask you to manually refresh the MCP server whenever it makes a codebase change. 
4. **Verify**: Say "ready" to let the subagent verify their fix.
5. **Commit**: The subagent commits the fix. Move on to the next test file.

## Test Modules

Please refer to [`coordinator-workflow.md`](./coordinator-workflow.md) for the complete and sequential list of test modules to execute.
