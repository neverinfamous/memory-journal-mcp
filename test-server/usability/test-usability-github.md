# Usability & Hallucination Test: Github

> **This test is optimized for an autonomous agent.**

This prompt instructs you to organically test the `github` tool group using Code Mode (`mj_execute_code`), intentionally fuzzing the inputs to discover agent hallucinations, and permanently hardening the codebase against them.

## 1. Fuzz Phase

Use the `mj_execute_code` tool to interact with the following tools in the `github` group:
`get_github_issues`, `get_github_prs`, `get_github_issue`, `get_github_pr`, `get_github_context`, `get_kanban_board`, `move_kanban_item`, `add_kanban_item`, `delete_kanban_item`, `create_github_issue_with_entry`, `close_github_issue_with_entry`, `get_github_milestones`, `get_github_milestone`, `create_github_milestone`, `update_github_milestone`, `delete_github_milestone`, `get_repo_insights`, `get_copilot_reviews`

**Instructions:**
- Do not perfectly structure your initial calls. Act intuitively as an agent.
- Try natural, ambiguous scripting (e.g., guessing property names, forgetting `await`, assuming incorrect return types like arrays instead of objects).
- Do not try to bypass the sandbox, simply test the API surface.
- Note any errors, exceptions, or unexpected behavior.

## 2. Heal Phase

If you encounter any failures, errors, or hallucinations:
1. STOP. Do not just work around the issue in your script.
2. Read the hardening guidelines in `skills/mj-mcp-optimize/SKILL.md`.
3. Locate the appropriate file in the codebase (e.g., schemas in `src/handlers/tools/github/schemas.ts`, proxies in `src/codemode/worker-api-proxy.ts`, or aliases in `src/codemode/api-constants.ts`).
4. Apply the permanent fix.

## 3. Refresh Checkpoint (CRITICAL)

If you made any codebase changes in the Heal Phase, the changes will not take effect until the server is restarted.
**You cannot restart the server yourself.**

Output the following message to the user:
> "Please manually refresh the `memory-journal-mcp` server, then say 'ready' so I can verify the fix."

**DO NOT PROCEED** to the verification phase until the user confirms the server has been refreshed.

## 4. Verification & Commit

Once the server is refreshed (or if no codebase changes were needed):
1. Re-run your Code Mode script to verify that the guardrail successfully intercepts the hallucination and provides actionable feedback (or seamlessly heals it).
2. If successful, run `git add .` and `git commit -m "Optimize github tool usage"` to save your changes locally.
3. Conclude the test and report your findings.
