# Usability Test: Agent-Exec Payload Validation Output Capture - truncateOutputLength

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly parses and respects the `truncateOutputLength` option.

## Instructions

### Phase 1: Payload Options
1. **Truncation Limits:** Verify that large outputs are correctly truncated according to the `truncateOutputLength` parameter. Ensure that when `stdoutFile` or `stderrFile` is used, the default truncation limit expands to 1GB unless specified otherwise.

### Phase 2: Meta-Cognitive Debugging
1. **Formulate Hypothesis:** If options fail to apply, create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a test case in `.agents/scripts/lib-agent-exec/tests/`, and run `bun run typecheck` and `bun run lint`.
3. **Fix & Verify:** Implement the fix in the payload parser or execution engine.
4. **Regression Check:** Verify default behavior remains intact when options are omitted.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Commit your fix using `.agents/scripts/commit.ts`.
