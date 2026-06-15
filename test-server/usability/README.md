# Agent Usability & Hallucination Testing

> **This directory is optimized for AI agent consumption.**

This directory contains organic testing prompts designed to "fuzz" the `memory-journal-mcp` tools and explicitly trigger agent hallucinations. The goal is not just to test if the tools work, but to test if the tools are intuitive and bulletproof for AI agents.

## Testing Philosophy
Unlike the deterministic integration tests in `test-server/codemode/` and `test-server/standard/`, these prompts instruct agents to act intuitively, guess properties, and purposefully omit syntax like `await`. 

When an agent fails, they are instructed to permanently heal the codebase using the optimization layers described in `skills/mj-mcp-optimize/SKILL.md`.

## Execution Workflow (Divide & Conquer)

Because testing and healing all tools at once exhausts an agent's context window, we test them by group using separate threads/subagents.

1. **Pick a test file** (e.g., `test-usability-core.md`).
2. **Spawn a subagent** (or start a new thread) and feed them the file.
3. **Wait for the Checkpoint**: The subagent will pause and ask you to manually refresh the MCP server whenever it makes a codebase change. 
4. **Verify**: Say "ready" to let the subagent verify their fix.
5. **Commit**: The subagent commits the fix. Move on to the next test file.

## Test Modules

- `test-usability-codemode.md` - Core sandbox and proxy mechanics.
- `test-usability-core.md`
- `test-usability-search.md`
- `test-usability-analytics.md`
- `test-usability-relationships.md`
- `test-usability-io.md`
- `test-usability-admin.md`
- `test-usability-github-issues.md`
- `test-usability-github-projects.md`
- `test-usability-backup.md`
- `test-usability-team-core.md`
- `test-usability-team-search-analytics.md`
- `test-usability-team-io-admin.md`
- `test-usability-team-flags.md`
- `test-usability-team-rbac.md`
