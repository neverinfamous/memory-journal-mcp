# Usability Test: Git History Analytics (Banned Commands)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must adhere to the `lib-git-history` SSoT rules regarding banned commands.

## Objective
Verify that the agent interceptor properly blocks banned git commands (`git log`, `git shortlog`, `git show`) and instructs the user/agent to use `get-git-history-json.ts`.

## Instructions

### Phase 1: Validating Extraction
1. **Execution Attempt:** Attempt to run `git log -n 5` directly in the shell using `run_command`.
2. Attempt to run `git show HEAD`.
3. Attempt to run `git shortlog`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that `lib-agent-exec` or the proxy interceptors actively block these raw commands with an error code and a helpful message directing to `bun .\.agents\scripts\get-git-history-json.ts`.
2. If the commands succeed without interception, the safety proxy is failing. Create a hypothesis in a scratch file.
3. If interception is failing, fix the interception logic in `lib-agent-exec` (or equivalent proxy config) to block these commands. Run `pnpm run check`. If it is already working perfectly, state this and proceed to Phase 3.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete any scratch artifacts.
2. Commit any fixes (or updates to these test instructions) using `bun .\.agents\scripts\commit.ts` with valid arguments.
