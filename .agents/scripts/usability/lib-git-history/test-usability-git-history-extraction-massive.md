# Usability Test: Git History Analytics Extraction (Massive Inputs)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly verify the JSON payload structure before attempting data extraction. All output files must be confined to the scratch directory.

## Objective
Verify that `lib-git-history` can reliably fetch, serialize, and extract massive historical logs without breaking JSON parsers or exceeding context limits.

## Instructions

### Phase 1: Adversarial Scaling
1. **Massive Inputs:** Query the git history for the last 500 commits using `bun .\.agents\scripts\get-git-history-json.ts --limit 500`. 
2. **Scratch Confinement:** Redirect the output into your designated scratch directory using `--stream-to-file <appDataDir>\\brain\\<conversation-id>\\scratch\\history-test.json`. DO NOT output raw JSON to the user terminal. (Avoid `>` in PowerShell as it introduces UTF-16 BOM issues).

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output file is valid JSON and contains exactly 500 records.
2. If the script fails, drops data, or runs out of memory:
   - **Formulate Hypothesis:** Write your reasoning in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`) before touching code.
   - **Fix:** Update the parser logic. Ensure any extraction logic safely handles chunking or stream parsing without blowing up string limits.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete `history-test.json` and any other scratch artifacts.
2. Once the workspace is clean and tests pass, commit any fixes using `bun .\.agents\scripts\commit.ts --msg "type(scope): message" --category Changed --impact 0.5 --confidence 0.5 --validation passed`.
