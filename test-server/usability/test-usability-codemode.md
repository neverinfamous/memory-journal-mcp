# memory-journal-mcp Usability & Hallucination Test: Code Mode Mechanics

> **This test is optimized for an autonomous agent.**
>
> **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.

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
2. Read the hardening guidelines in `skills/mj-mcp-heal/SKILL.md`.
3. Modify `src/codemode/worker-api-proxy.ts`, `worker-result-proxy.ts`, or the main dispatcher.
4. Apply the permanent fix (e.g. throwing custom errors with actionable feedback).

## 3. Local Verification & Commit

If you made any codebase changes in the Heal Phase:

1. Run `pnpm run check` locally to verify that all validation passes (linting, tests, types).
2. DO NOT perform live server verification. DO NOT pause or wait for a server restart.
3. Run `git add .` and `git commit -m "Optimize tools tool usage"` to save your changes locally.
4. Conclude the test and report your findings.

## 4. Continuous Improvement

If during this test you discover a blind spot, a new hallucination vector, or a way to make this very testing prompt more effective, you are encouraged to edit this markdown file directly to permanently improve the testing apparatus. Commit any prompt improvements alongside your codebase fixes.
