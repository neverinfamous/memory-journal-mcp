# Memory Journal MCP - Config Reload Test

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas (e.g., Team Tools, Admin Tools).

This document provides a guided walkthrough for testing the dynamic configuration update capabilities of the memory-journal-mcp server. 
It ensures that the `update_configuration` tool properly updates the configuration state and notifies the client.

## Verification Requirements
- Clean test database: `mcp_test_db.db`
- Server running via `npx tsx src/cli.ts --config ./mcp-config.json`
- An initial configuration file at `./mcp-config.json`

## Setup

Start the server using:
```powershell
npx tsx src/cli.ts --db data/mcp_test_db.db --config ./mcp-config.json
```

## Step 1: Initial State Inspection

1. Read `memory://briefing` to observe the current instruction level and briefing details.
2. Call `list_tools` to observe the currently available tools (e.g., if `toolFilter: "starter"` is set, only starter tools should appear).

## Step 2: Dynamic Configuration Update

1. Use the `update_configuration` tool to modify the configuration:
   - `instruction_level`: `full`
   - `tool_filter`: `full,-admin` (if starting from something else)
   - `briefing_entries`: `5`
   
**Expected Result**:
- `success: true`
- The server responds with `updated: ["instruction_level", "tool_filter", "briefing_entries"]`.
- The server emits `notifications/resources/updated` for `memory://briefing`.
- The MCP client may automatically re-fetch tools depending on its integration (triggering `tools/list` internally).

## Step 3: Verify Persistence and State

1. Read `memory://briefing` again.
   - You should notice the changes applied dynamically (e.g., the briefing is longer, or instruction level is changed).
2. Call `list_tools` to verify that the tool list now reflects `full,-admin`.
3. Open `./mcp-config.json` in a text editor and verify that the updated fields were persisted accurately to the file.

## Step 4: Verify File Watcher

1. Open `./mcp-config.json` manually and change `briefing_entries` to `10`.
2. Wait a second, then read `memory://briefing` from the MCP client.
3. Verify that the briefing length/count reflects the manual change made directly to the file, proving hot-reload works.

## Step 5: Clean Up

1. Revert changes to `./mcp-config.json` to leave the environment clean for other tests.


## Token Consumption

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
