# Server Instructions Overview

**🤖 AGENT OPTIMIZED README**

This directory contains the Markdown files that serve as the foundation for the `memory-journal-mcp` dynamic help system. These files are presented directly to AI agents making context-gathering queries.

## ⚠️ Critical Workflow

**DO NOT** edit `src/constants/server-instructions.ts` directly. It is auto-generated.

If you need to update a tool group's instructions or the general gotchas, follow these steps:

1. Modify the relevant `.md` file in this directory (e.g., `gotchas.md`, `overview.md`, etc.).
2. Run the generator script to compile these markdown files into the TypeScript constant map:
   ```bash
   npm run generate:instructions
   ```
   _(or `npx tsx scripts/generate-server-instructions.ts`)_
3. The generator script converts your markdown into escaped strings embedded in the `server-instructions.ts` generated code.
4. **Never** attempt to add `README.md` into the generator logic. The generation script automatically ignores any file ending in `.md` and starting with `readme` (case-insensitive).

## File Structure

- `overview.md`: The init payload sent to all clients on initialization. Contains behaviors (session start, entry types, tags, significance, linking) and the core quick-access table. Larger than the DB connectors' overviews (~7.0KB vs ~0.7KB) because MJ requires behavioral guidance before agents start work.
- `github.md`: GitHub Integration patterns returned for `memory://help/github`.
- `hush-protocol.md`, `skills.md`: Static help content for non-tool-group keys.

## Guidelines

- Write strictly for AI consumption (concise, rule-based, clear mappings).
- Use code blocks for specific exact schemas/examples.
- Watch payload sizes; do not put the entire documentation in here.
