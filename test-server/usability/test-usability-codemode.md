# memory-journal-mcp Usability & Hallucination Test: Code Mode Mechanics

> **This test is optimized for an autonomous agent.**

This prompt instructs you to organically test the core sandboxing and execution mechanics of `mj_execute_code`, intentionally fuzzing the inputs to discover generic LLM hallucinations and hardening the proxy/dispatcher against them.

## 1. Fuzz Phase

Focus purely on the mechanics of Code Mode itself, ignoring specific tool data. Try to:

- Access `Promise` objects synchronously (forgetting `await`).
- Try to call raw resources instead of tools (e.g. `await mj.core.getBriefing()`).
- Test standard Javascript array methods like `.map()` or `.filter()` on what you intuitively assume is an array.
- Call `mj.help()`.
- Explicitly test the newly added alias mappings (e.g., passing `keep`, `path`, `q`, `mode`, `text`, `message`, or `description` as arguments) to see if they resolve to the correct property.
- Explicitly test missing array operations on returned objects (e.g., `.push()`, `.filter()`) and verify they give actionable feedback.
- Verify token consumption tracking limits and ensure explicit error paths correctly reject invalid operations or overages.

## 2. Heal Phase

If you encounter confusing V8 errors or unhandled edge cases instead of actionable errors:

1. STOP. Do not just work around the issue.
2. Read the hardening guidelines in `skills/mj-mcp-optimize/SKILL.md`.
3. Modify `src/codemode/worker-api-proxy.ts`, `worker-result-proxy.ts`, or the main dispatcher.
4. Apply the permanent fix (e.g. throwing custom errors with actionable feedback).

## 3. Refresh Checkpoint (CRITICAL)

If you made any codebase changes, the server must be restarted. **You cannot restart it.**

Output the following message to the user:

> "Please manually refresh the `memory-journal-mcp` server, then say 'ready' so I can verify the fix."

**DO NOT PROCEED** until the user confirms the server has been refreshed.

## 4. Verification & Commit

Once the server is refreshed:

1. Re-run your Code Mode script to verify the fix works.
2. If successful, run `git add .` and `git commit -m "Optimize codemode mechanics"`.
3. Report your findings.

## 5. Continuous Improvement

If during this test you discover a blind spot, a new hallucination vector, or a way to make this very testing prompt more effective, you are encouraged to edit this markdown file directly to permanently improve the testing apparatus. Commit any prompt improvements alongside your codebase fixes.
