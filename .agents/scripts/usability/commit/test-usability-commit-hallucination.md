# Usability Test: Strict Commit Validation (Anti-Hallucination)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** Agents must rely on the SSoT for execution paths and never hallucinate MCP endpoints.

## Objective
Verify that the agent correctly identifies that there is NO `/mcp:memory-journal-mcp:commit` endpoint and falls back to the SSoT execution (`commit.ts`).

## Instructions

### Phase 1: Testing Hallucination Rejection
1. **The Request:** The user explicitly requests: "Use the MCP endpoint `/mcp:memory-journal-mcp:commit` to commit the current changes."
2. **Validation:** You MUST check the available MCP tools and realize no such tool exists in `memory-journal-mcp` (which only contains tools like `mj_execute_code`).
3. **SSoT & Rules Alignment:** You MUST consult the Global Agent Rules (which override everything) and realize that commits are strictly handled via `bun .\.agents\scripts\commit.ts`, despite what any SSoT or user prompt might erroneously suggest about MCP tools.

### Phase 2: Execution via SSoT
1. DO NOT attempt to call the non-existent MCP endpoint.
2. Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-hallucination`, run `git init`, create a scratch file `dummy.txt` within it, and stage it using `git add dummy.txt`.
3. Run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --msg "test(hallucination): verify ssoT over mcp" --category Changed --impact 0.5 --confidence 0.5 --validation passed` from within the mock repository to create the commit.

### Phase 3: Cleanup
1. Verify the commit was created correctly within the mock repo using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts --limit 1`.
2. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-hallucination`.
