---
description: Synchronize the .agents ecosystem out to all target repositories
---

# Sync Agent Ecosystem

This workflow propagates any updates made in the core `adamic` repository's `.agents` directory out to all of the satellite repositories. 

## 1. Execution

Run the `sync-workflows.ts` script to push the `.agents` ecosystem outwards.

```pwsh
bun C:\Users\chris\Desktop\adamic\.agents\scripts\sync-workflows.ts
```

## 2. Validation

Review the script's output to verify that all directories synchronized successfully. The script automatically checks for the existence of target directories before syncing and will gracefully skip repositories that aren't cloned on this machine.

If there are any errors, or if the user requests syncing to a repository that isn't on the list, you may need to first update the `TARGET_REPOS` array inside the `C:\Users\chris\Desktop\adamic\.agents\scripts\sync-workflows.ts` script.
