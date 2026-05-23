# Copilot Performance Prompts

Reference for Phase 4 of the adversarial performance protocol — the
independent external validation pass using the GitHub Copilot CLI.

## Prerequisites

1. **Copilot CLI installed**: `npm list -g @github/copilot`
2. **Authenticated**: `copilot auth`

If unavailable, skip Phase 4 gracefully.

## Prompt Templates

### Full Repository Performance Audit

Primary Phase 4 prompt:

```bash
echo "You are a senior performance engineer reviewing a TypeScript/Node.js codebase. Focus on:

1. **Hot-path allocations** — object/array creation in loops, repeated JSON.parse/stringify, unnecessary spread in iteration, closure captures over large scopes.
2. **Blocking operations** — synchronous file I/O, CPU-intensive loops without yielding, serial await where parallel is safe.
3. **N+1 queries** — database queries inside loops, missing batch operations, unbounded SELECT *.
4. **Memory leaks** — event listeners not cleaned up, growing Maps/Sets without eviction, timers without clearInterval.
5. **Build inefficiency** — dev dependencies in production bundle, missing tree-shaking, unnecessary polyfills.
6. **Startup cost** — heavy top-level initialization, eager loading of rarely-used modules.

Here are the key source files:

$(find src/ -name '*.ts' -not -path '*/node_modules/*' | head -50 | while read f; do echo "=== \$f ==="; head -100 "\$f"; echo; done)

Output a Markdown table with columns: #, Category, Severity (Critical/High/Moderate/Low), File:Line, Finding, Optimization, Expected Improvement." | copilot
```

### Dependency Weight Review

```bash
echo "You are a Node.js dependency optimization expert. Review this project's dependencies for weight and efficiency:

1. **Heavy dependencies** — packages that are large relative to their usage. Could lighter alternatives work?
2. **Duplicate packages** — different versions of the same package in the tree.
3. **Unused dependencies** — packages in dependencies that don't appear in import statements.
4. **Dev leakage** — devDependencies functionality accidentally bundled into production.

$(cat package.json)

$(npm ls --all --prod 2>/dev/null | head -100)

Output a findings table with package names, sizes, and specific alternatives." | copilot
```

### MCP Token Efficiency Review

Use when the target is an MCP server:

```bash
echo "You are an AI agent efficiency expert. This is an MCP (Model Context Protocol) server. Review it for token and context window efficiency:

1. **Verbose tool output** — tools returning full objects when summaries suffice. Do outputSchemas constrain response size?
2. **Instruction bloat** — is the instructions field sending full documentation instead of slim pointers?
3. **Tool count** — does the server expose so many tools that it wastes context? Is there tool filtering?
4. **Code Mode** — does the server offer sandboxed JS execution for multi-step operations? Saves 70-90% tokens.
5. **Redundant tools** — are there tools whose functionality overlaps significantly?

$(find src/ -name '*.ts' -path '*/tools/*' | head -30 | while read f; do echo "=== \$f ==="; head -60 "\$f"; echo; done)

Output a structured assessment with token-saving estimates." | copilot
```

## Parsing Copilot Output

1. **Extract findings** — parse tables or numbered lists
2. **Map to categories** — classify against the 7 audit categories
3. **Quantify impact** — if Copilot didn't estimate improvement, add
   your own estimates based on the code context
4. **Deduplicate** — compare against Phase 2 findings
5. **Disposition** — apply Accept/Reject/Modify/Defer from Phase 3

## Prompt Selection Guide

| Audit Depth | Project Profile | Prompts to Use |
| --- | --- | --- |
| Scan | Any | Full Repository only |
| Standard | Non-MCP | Full Repository + Dependencies |
| Standard | MCP Server | Full Repository + Dependencies + MCP Token |
| Intensive | Any | All 3 prompts |
