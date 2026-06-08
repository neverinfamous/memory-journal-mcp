# Memory Journal MCP - Config Reload Test (Code Mode)

This document provides a guided walkthrough for testing the dynamic configuration update capabilities of the memory-journal-mcp server using Code Mode.

## Verification Requirements
- Clean test database: `mcp_test_db.db`
- Server running with Code Mode enabled and an initial config file.

## Step 1: Execute Config Update via Code Mode

Use `mj_execute_code` to call `update_configuration` programmatically:

```javascript
const result = await mcp.callTool('update_configuration', {
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

Execute another script to read `memory://briefing` and verify the output reflects the updated instruction level and entries.

```javascript
const briefing = await mcp.readResource('memory://briefing');
return briefing.contents[0].text;
```

## Step 3: Verify Persistence

Use `mcp.readResource` or standard `read_file` to read the configuration file (e.g. `./mcp-config.json`) and assert that the values were correctly persisted by `ConfigManager`.

```javascript
const fs = require('fs');
return fs.readFileSync('./mcp-config.json', 'utf-8');
```

Verify the JSON payload matches the requested updates.
