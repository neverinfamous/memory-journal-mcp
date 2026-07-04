# Usability Test: CLI Integration - Package Version

## Objective
Verify that the `get-git-history-json.ts` CLI accurately processes the `--package-version` flag, injecting the current `package.json` version into the top-level metadata object.

## Setup
Ensure that the repository root (or the current working directory from which you execute the script) contains a valid `package.json` file with a `version` field (e.g., `"version": "1.0.0"`).

## Instructions

1. Execute the git history extraction using the `--package-version` flag and a limit of 1:
   ```bash
   bun get-git-history-json.ts -n 1 --package-version
   ```

2. Assert that the top-level `metadata` object is present in the JSON output.

3. Assert that `metadata.packageVersion` exists and matches the version defined in `package.json`.

## Expected Output Structure

```json
{
  "metadata": {
    "truncated": true,
    "implicitLimit": 1,
    "resolvedRange": "HEAD",
    "packageVersion": "x.y.z"
  },
  "commits": [
    ...
  ]
}
```
