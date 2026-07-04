# Usability Test: Git History Analytics Extraction (WSL Payload Boundary)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must adhere to the `lib-agent-exec` SSoT rules for WSL2 and POSIX pipeline execution.

## Objective
Verify that the agent correctly crafts a JSON payload with `"target": "wsl2"` for POSIX pipelines (like `jq`) instead of using raw `wsl bash -c`, which is blocked natively.

## Instructions

### Phase 1: Creating Test Data
1. Generate a small test JSON file (`<appDataDir>\brain\<conversation-id>\scratch\history-dummy.json`) containing an array of 2 dummy commit objects, one with a `"metadata"` object containing `"customTrailers"` and one without.

### Phase 2: Extraction & WSL Boundary Verification
1. Use `jq` via the `lib-agent-exec` interceptor to parse the scratch file and filter for commits where `.metadata.customTrailers != null`.
2. **SSoT Validation:** According to the SSoT mapping (`ssot-mapping.md`), since native PowerShell does not support `&&` or POSIX pipelines natively, you **MUST** create a JSON payload with `"target": "wsl2"` to execute complex pipelines. 
   - Create a JSON payload to run `jq '.[] | select(.metadata.customTrailers != null)' /path/to/scratch-file` inside WSL2 and save it to your scratch directory.
   - Run the JSON payload by invoking `bun .\.agents\scripts\agent-exec.ts <path-to-your-payload.json>`. Ensure the `expectJsonEnvelope` flag is set to `true` to capture structured output if necessary.

### Phase 3: Validation & Cleanup
1. Verify the pipeline executes successfully inside WSL2 and returns only the filtered object.
2. If `lib-agent-exec` fails to process the WSL2 JSON payload, fix the interceptor logic.
3. **Crucial Cleanup:** Delete the scratch files (`history-dummy.json` and your JSON payload script).
4. Commit any fixes using `bun .\.agents\scripts\commit.ts --msg "type(scope): message" --category Changed --impact 0.5 --confidence 0.5 --validation passed`.
