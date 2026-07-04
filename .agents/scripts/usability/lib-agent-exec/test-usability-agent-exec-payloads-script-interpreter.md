# Usability Test: Agent-Exec Payloads (Script Interpreter)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly respects the `interpreter` property for `script` payloads, explicitly overriding the default interpreter mapping.

## Instructions

### Phase 1: Adversarial Execution
1. **Script Interpreter Override:** Create a dummy script file (`script.ts`) in `<appDataDir>\brain\<conversation-id>\scratch\`.
2. **Execute:** Create a JSON payload (MUST be saved to `<appDataDir>\brain\<conversation-id>\scratch\payload.json`) for `script` testing a custom interpreter override. Example: `{"type": "script", "scriptPath": "script.ts", "interpreter": "tsx", "cwd": "."}`.
3. **Validation:** Execute via `bun agent-exec.ts <payload.json>`. Verify that the script is executed using the `tsx` interpreter rather than the default `bun` interpreter for `.ts` files.

### Phase 2: Meta-Cognitive Debugging
1. If payload parsing fails or misroutes interpreters:
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case to the schema or parsing test suite.
   - **Fix:** Update payload schema and execution branching. You MUST use `ts-pattern` for handling different payload types.
> **CRITICAL**: Read `C:\Users\chris\Desktop\adamic\skills\pattern-matching\SKILL.md`, `C:\Users\chris\Desktop\adamic\skills\zod\SKILL.md`, and `C:\Users\chris\Desktop\adamic\skills\typescript\SKILL.md` before proceeding.

2. **Regression Check:** Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts (including JSON payloads and dummy scripts).
2. Commit your fix using `commit.ts`.
