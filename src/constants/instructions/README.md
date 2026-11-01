# Server Instructions

This directory contains the compiled server instructions in TypeScript format (`*.ts`). These are automatically generated from the Markdown source files located in the `markdown/` subdirectory.

> [!WARNING]
> **DO NOT EDIT THE `.ts` FILES DIRECTLY.**
> Any manual changes will be overwritten during the next build.

## Modifying Instructions

To update the instructions or narrative help resources (e.g., gotchas, architecture rules, tag taxonomies), edit the corresponding `.md` files in the `markdown/` directory and run the generator script:

```bash
pnpm run generate:instructions
```

This ensures the markdown source of truth remains synchronized with the code.

## Architecture

We use a hybrid documentation approach:
1. **Dynamic Parameters**: Tool parameter lists, types, and descriptions are dynamically generated at runtime by introspecting the Zod schemas using `peelZodType` and `extractParameters`.
2. **Static Narrative**: The `markdown/` directory provides the narrative context, standard operating procedures, and "gotchas" that cannot be expressed purely in code.
   - `overview.md` and `codemode-snippet.md` compile together into `base.ts` (`CORE_INSTRUCTIONS` and `CODE_MODE_INSTRUCTIONS`).
   - Tool-group files (e.g., `core.md`, `search.md`, `team.md`) compile into `*_HELP` constants that `memory://help/{group}` merges with dynamic Zod parameter definitions at runtime.
   - `gotchas.md` (`GOTCHAS_HELP`) and `templates.md` (`TEMPLATES_HELP`) serve static narrative guidance directly via `memory://help/gotchas` and `memory://rules/templates` without schema introspection.
