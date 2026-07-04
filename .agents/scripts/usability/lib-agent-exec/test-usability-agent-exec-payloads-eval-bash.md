# Usability Test: Agent-Exec Payloads (Eval - Bash)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly parses and handles the `.json` `eval` payload type for the `bash` interpreter.

## Instructions

### Phase 1: Payload Construction
1. **Eval Payload (bash):** Create a JSON payload (MUST be saved to `<appDataDir>\brain\<conversation-id>\scratch\payload.json`) for `eval` with interpreter `bash`. Example: `{"type": "eval", "code": "echo 'hello'", "interpreter": "bash", "cwd": "."}`. Execute and verify outputs.

### Phase 2: Meta-Cognitive Debugging
1. If payload parsing fails or misroutes interpreters:
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case to the schema or parsing test suite.
   - **Fix:** Update payload schema and execution branching. You MUST use `ts-pattern` for handling different payload types.
> **CRITICAL**: Read `C:\Users\chris\Desktop\adamic\skills\pattern-matching\SKILL.md`, `C:\Users\chris\Desktop\adamic\skills\zod\SKILL.md`, and `C:\Users\chris\Desktop\adamic\skills\typescript\SKILL.md` before proceeding.

2. **Regression Check:** Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts (including JSON payloads).
2. Commit your fix using `commit.ts`.
