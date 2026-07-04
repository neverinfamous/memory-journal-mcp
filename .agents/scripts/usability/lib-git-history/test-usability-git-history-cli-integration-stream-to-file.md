# Usability Test: CLI Integration - Stream to File

## Objective
Verify that the `get-git-history-json.ts` CLI accurately processes the `--stream-to-file` flag, writing the JSON output directly to the specified file path instead of stdout.

## Setup
Ensure that you are running this test in a scratch directory or that you clean up the generated file after testing.

## Instructions

1. Execute the git history extraction using the `--stream-to-file` flag with a small limit, outputting to a temporary file (e.g., `test-output.json`):
   ```bash
   bun get-git-history-json.ts -n 1 --stream-to-file test-output.json
   ```

2. Assert that the stdout does not contain the JSON payload (though agent stderr hints may still appear).

3. Assert that the file `test-output.json` was created.

4. Read `test-output.json` and assert that it contains valid JSON matching the expected extraction shape.

## Expected Output Structure (test-output.json)

```json
{
  "metadata": {
    "truncated": true,
    "implicitLimit": 1,
    "resolvedRange": "HEAD"
  },
  "commits": [
    ...
  ]
}
```
