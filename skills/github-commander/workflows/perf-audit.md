# Performance Audit

Run a comprehensive performance audit covering build times, bundle size, runtime
patterns, test suite speed, and database/IO efficiency.

## 1. Build Performance

Measure compilation speed and identify bottlenecks.

For TypeScript projects:

```bash
npx tsc --noEmit --diagnostics
```

If a bundler is configured, also run `PROJECT_BUILD_CMD` and report build time.

Report:

- Total compilation time
- Files compiled, lines of code
- Memory usage
- Any abnormally slow type-resolution (deep generics, circular types)

## 2. Bundle & Output Analysis

Analyze the compiled output for size and optimization opportunities:

- Count total output files and aggregate size
- Identify the largest output files (top 5 by size)
- Check for accidental bundling of dev dependencies or test fixtures
- Flag output files that include source maps in production builds

For frontend projects, additionally check:

- Code-splitting effectiveness
- Asset optimization (images, fonts, CSS)
- Tree-shaking gaps

## 3. Dependency Weight

Audit dependency footprint:

```bash
# npm
npm ls --all --prod 2>/dev/null | tail -1

# yarn
yarn list --prod

# pnpm
pnpm list --prod
```

Report:

- Total production dependency count (direct + transitive)
- Top 5 heaviest dependencies
- Duplicate packages (different versions of same dep)
- Dependencies replaceable with lighter alternatives
- devDependencies accidentally listed in dependencies

## 4. Runtime Performance

Static analysis pass for runtime performance issues:

- **Hot-path allocations** — object/array creation inside tight loops, repeated
  `JSON.parse`/`JSON.stringify`, unnecessary spread in iteration
- **Missing early returns** — expensive work before guard conditions
- **Redundant computation** — values computed multiple times when cacheable
- **Blocking operations** — synchronous I/O, CPU-intensive loops without
  yielding, serial `await` where parallel is safe
- **Memory leaks** — event listeners not cleaned up, growing collections
  without eviction, closures capturing large scopes
- **Startup cost** — heavy top-level initialization, eager loading of
  rarely-used modules

## 5. Test Suite Performance

Run tests with verbose output:

```bash
<PROJECT_TEST_CMD> -- --reporter=verbose
```

Report:

- Total suite duration
- Top 5 slowest test files
- Top 5 slowest individual tests
- Tests doing real I/O without mocking
- Parallelization opportunities

## 6. Database & I/O Performance

If the project interacts with databases or performs significant I/O:

- **Query patterns** — N+1 queries, missing indexes, unbounded queries,
  sequential queries that could be batched
- **Connection management** — pool sizing, connection leak risks, missing
  timeouts
- **Caching** — repeated identical queries without caching, stale TTLs
- **Serialization** — excessive object transformation between layers

## Findings Report

Journal each finding:

```
create_entry({
  content: "Performance finding: <severity> — <description>. File: <path>:<lines>. Expected improvement: <estimate>.",
  entry_type: "audit_finding",
  tags: ["commander", "performance", "<category>"],
})
```

Produce a structured summary:

| Category            | Score (A–F) | Findings | Critical |
| ------------------- | ----------- | -------- | -------- |
| Build Performance   |             |          |          |
| Bundle & Output     |             |          |          |
| Dependency Weight   |             |          |          |
| Runtime Performance |             |          |          |
| Test Suite Speed    |             |          |          |
| Database & I/O      |             |          |          |

Assign an **overall performance score (A–F)** and list the top 3 highest-impact
improvements.

## HITL Checkpoint

Present findings to the human. Wait for approval before applying any fixes.

## Apply Fixes

After approval:

1. Apply fixes in impact order (highest improvement first)
2. Run validation gates
3. Update changelog
4. Commit
