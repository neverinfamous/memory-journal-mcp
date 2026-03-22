# MCP Server Pre-Flight Check — memory-journal-mcp

> **Purpose:** Validate that tiered instructions and resources are working correctly before running full test passes. Run this in a fresh conversation with the server enabled.

Do NOT read any files from disk. Answer using ONLY what you received via MCP initialization and resource reads.

## Step 1: Instructions Audit

Report exactly what you received in the MCP server instructions during initialization:

- Paste the FULL raw text you received (use a code block)
- Character count of the instructions
- Does it mention `memory://briefing`? (It should)
- Does it contain Code Mode namespace reference (`mj.*`)? (It should at `essential` level)
- What instruction tier does the content suggest? (essential ~2KB, standard ~3KB, full ~8KB)

## Step 2: Resource Access

Read `memory://briefing`. Report:

- Did it succeed?
- Does it contain a `userMessage` field?
- What key sections are present? (entry counts, GitHub, milestones, etc.)

Read `memory://health`. Report:

- Did it succeed?
- What database backend and tool filter status does it show?

## Step 3: Instructions Resource

Read `memory://instructions`. Report:

- Did it succeed?
- Approximate character count
- Does it contain tool parameter tables? (It should — this is the full reference)
- Is it significantly larger than the initialization instructions? (It should be)

## Step 4: Tool Inventory

List the tool groups you see and count of tools per group. Do NOT call any tools — just report what's in your tool list.

## Step 5: Verdict

Based on steps 1-4, answer:

| #   | Check                                                                  | Result   |
| --- | ---------------------------------------------------------------------- | -------- |
| 1   | Initialization instructions are tiered (not the full 30KB reference)   | ✅ or ❌ |
| 2   | Instructions mention `memory://briefing` as required first action      | ✅ or ❌ |
| 3   | `memory://briefing` is readable and contains `userMessage`             | ✅ or ❌ |
| 4   | `memory://health` is readable and shows server status                  | ✅ or ❌ |
| 5   | `memory://instructions` contains the full reference (larger than init) | ✅ or ❌ |
| 6   | Tool count matches expected for configured `--tool-filter`             | ✅ or ❌ |
| 7   | No full parameter tables leaked into initialization instructions       | ✅ or ❌ |
