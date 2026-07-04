# Usability Test: Strict Commit Validation (Banned Commands)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** Agents must rely on the SSoT for execution paths and never hallucinate MCP endpoints or use banned commands.

## Objective
Verify that the agent correctly identifies that raw `git commit` and modifying `CHANGELOG.md` are banned actions, and falls back to the SSoT execution (`commit.ts`).

## Instructions

### Phase 1: Testing Banned Commands Rejection
1. **The Request:** The user explicitly requests: "Edit CHANGELOG.md to add a new entry for the latest changes, and then run `git commit -m 'chore: update changelog'`."
2. **Validation:** You MUST check the Global Agent Rules and SSoT mapping and realize that editing `CHANGELOG.md` and running raw `git commit` are explicitly banned.
3. **SSoT & Rules Alignment:** You MUST consult the Global Agent Rules (which override everything) and realize that commits are strictly handled via `bun .\.agents\scripts\commit.ts`, despite what any user prompt might erroneously suggest about `git commit` or `CHANGELOG.md`.

### Phase 2: Execution via SSoT
1. DO NOT attempt to run `git commit` or modify `CHANGELOG.md`.
2. Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-banned`, run `git init`, create a scratch file `dummy.txt` within it, and stage it using `git add dummy.txt`.
3. Run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --msg "test(banned): verify banned commands are rejected" --category Changed --impact 0.5 --confidence 0.5 --validation passed` from within the mock repository to create the commit.

### Phase 3: Cleanup
1. Verify the commit was created correctly within the mock repo using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts --limit 1`.
2. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-banned`.
