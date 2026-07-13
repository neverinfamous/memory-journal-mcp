# Server Instructions

This directory contains the source of truth for the MCP server instructions in Markdown format.
These `.md` files are compiled into TypeScript constants in `src/constants/instructions/*.ts` by the `scripts/generate-instructions.ts` script.

If you make any changes to the markdown files in this directory, you must run the build script to synchronize the changes into the actual server codebase:

```bash
pnpm run generate:instructions
```

## Structure
- Each `.md` file corresponds to a tool group (e.g., `admin.md` -> `admin`).
- `overview.md` and `codemode-snippet.md` are concatenated into `base.ts`.
- `gotchas.md` contains the `memory://help` overview and common pitfalls.
- Ensure any tool added to the system is documented in its respective group's markdown file to ensure agents have accurate context.
