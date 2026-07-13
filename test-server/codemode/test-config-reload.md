# Memory Journal MCP - Config Reload Test (Code Mode)



This document provides a guided walkthrough for testing the dynamic configuration update capabilities of the memory-journal-mcp server using Code Mode.

## Verification Requirements
- Clean test database: `mcp_test_db.db`
- Server running with Code Mode enabled and an initial config file.

## Step 1: Execute Config Update via Code Mode

Use `mj_execute_code` to call `update_configuration` programmatically:

```javascript
const result = await mj.admin.updateConfiguration({
  instruction_level: 'full',
  tool_filter: 'core,search',
  briefing_entries: 5
});
return result;
```

**Expected Result**:
- The tool executes successfully.
- `result.success` is true.
- `result.updated` array contains `instruction_level`, `tool_filter`, and `briefing_entries`.

## Step 2: Verify Internal Configuration Changes

Read the `memory://briefing` resource natively using the host MCP client (outside of Code Mode, as Code Mode properly restricts direct resource reads) and verify the output reflects the updated instruction level and entries.

## Step 3: Verify Persistence

Use the standard `read_file` tool from your host environment to read the configuration file (e.g. `./mcp-config.json`) and assert that the values were correctly persisted by `ConfigManager`.

*(Note: `require('fs')` is correctly blocked by the Code Mode sandbox security policies, so persistence verification must be performed by the host client natively).*

Verify the JSON payload matches the requested updates.
