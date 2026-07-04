# Usability Test: Agent-Exec Prompt Detector (Inquirer)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` heuristically detects and aborts interactive prompts (`inquirer.js`, `y/n` prompts).

## Instructions

### Phase 1: Adversarial Execution
1. **Interactive Prompts:** Attempt to run a script that prompts for user input (e.g., an inquirer prompt, or a simple script that asks `Are you sure? [y/N]`).
2. Verify the `prompt-detector` heuristics detect these prompts and terminate the process with an appropriate intercept message.

### Phase 2: Meta-Cognitive Debugging
If a command successfully hangs the agent or fails to trigger the prompt detector:
1. **Formulate Hypothesis:** Create a file `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/prompt-detector.test.ts`.
3. **Fix & Verify:** Modify the interceptor logic using `ts-pattern`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files you created.
2. Commit the changes using `commit.ts`.
