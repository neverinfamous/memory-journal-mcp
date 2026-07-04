---
description: Synchronize core infrastructure scripts (lib-agent-exec and lib-git-history) as vendor plugins into memory-journal-mcp
---

# Sync Vendor Plugins Workflow

> **Purpose**: The core infrastructure scripts (`lib-agent-exec` and `lib-git-history`) inside the `adamic` repository act as authoritative sources for vendor plugins used within the `memory-journal-mcp` server. Whenever you modify these scripts in `adamic`, you **MUST** sync them over to the memory-journal repository.

## Phase 1: Validate Adamic Source

Before syncing, ensure the source files in the `adamic` repository are fully tested and committed.

1. Validate your modifications using isolated tests in your scratch directory (`<appDataDir>\brain\<conversation-id>\scratch\`).
2. If you modified code files, run `pwsh -c "bun run check"` inside `adamic` to guarantee the changes are completely safe. If you only modified documentation (`.md` files), this validation can be skipped.
3. **Commit** the changes to the `adamic` repository (using the standard `commit.ts` workflow). The sync script pulls the latest commit SHA from `HEAD` to update the vendor tracking file.

## Phase 2: Execute Sync Script

Once validated and committed in `adamic`, run the synchronization script located in the `memory-journal-mcp` repository. 

Because `sync-vendor.ts` makes file modifications and executes tests via `bun`, you must use the `agent-exec.ts` bridge.

1. Write a `payload_sync.json` file in your `<appDataDir>\brain\<conversation-id>\scratch\` directory:
```json
{
  "type": "script",
  "scriptPath": "C:\\Users\\chris\\Desktop\\memory-journal-mcp\\scripts\\sync-vendor.ts",
  "cwd": "C:\\Users\\chris\\Desktop\\memory-journal-mcp",
  "args": ["--adamic-root", "C:\\Users\\chris\\Desktop\\adamic", "--test"]
}
```
*Tip: To sync only a specific library, add `"--lib", "lib-agent-exec"` or `"--lib", "lib-git-history"` to the `args` array.*
*Tip: The `--test` flag automatically executes `bun test src/vendor/` inside `memory-journal-mcp` to ensure the synced plugins pass their unit tests.*

2. Execute the payload:
```pwsh
pwsh -c "bun C:\Users\chris\Desktop\adamic\.agents\scripts\agent-exec.ts <path-to-payload_sync.json>"
```

## Phase 3: Validate and Commit in memory-journal-mcp

1. Verify the sync script output. It should indicate how many files were synced and that the `bun test` run was successful.
2. The script will have automatically updated `C:\Users\chris\Desktop\memory-journal-mcp\src\vendor\VENDOR.json` with the new `syncedAt` timestamp and `syncedFromCommit` SHA.
3. Navigate into `memory-journal-mcp` and perform a full validation pass using `pwsh -c "bun run check"`. You may skip this if only documentation files were synchronized.
4. Finally, commit the synchronized vendor files and updated `VENDOR.json` within `memory-journal-mcp`.
   > **🛠️ AUTONOMOUS HEALING:** Do not guess the path to the commit script! The commit script in satellite repositories is ALWAYS located at `.agents/scripts/commit.ts`.
   > Example: `bun .\.agents\scripts\commit.ts --msg "chore(vendor): sync from adamic" --no-history --category Changed --confidence 1.0 --impact 0.1 --validation passed --add src/vendor/VENDOR.json --add <other-files> --journal`

> [!CAUTION]
> **Data Loss Warning:** Never manually edit the vendor files directly within `memory-journal-mcp\src\vendor\`. Those files are automatically overwritten during synchronization. Always edit the authoritative source in `adamic\.agents\scripts\` first.
