# Audit Categories

Detailed reference for the 7 performance audit categories. Each category
includes what to measure, anti-patterns, optimization patterns, and
depth-specific considerations.

Agent A (Profiler) uses this as a measurement checklist during Phase 1.
Agent B (Stress Tester) uses it to construct worst-case scenarios in Phase 2.

---

## Category 1 — Build Performance

### What to Measure

- Total TypeScript compilation time (`tsc --noEmit --diagnostics`)
- Bundler build time (`npm run build`)
- Files compiled and lines of code
- Memory usage during compilation
- Incremental vs. clean build times
- Docker image build time (if containerized)

### Anti-Patterns

```typescript
// Deep generic nesting — exponential type resolution
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
} // Deeply nested usage causes slow compilation

// Circular type references
type A = { b: B }
type B = { a: A } // Compiler struggles with these

// Barrel re-exports pulling in entire dependency graph
export * from './module-a'
export * from './module-b'
// Forces tsc to resolve everything even if only one export is used
```

### Optimization Patterns

```typescript
// Explicit exports instead of barrel wildcards
export { SpecificType } from "./module-a";
export { SpecificFunction } from "./module-b";

// Project references for monorepo build parallelism
// tsconfig.json
{ "references": [{ "path": "./packages/core" }] }

// Incremental compilation
// tsconfig.json
{ "compilerOptions": { "incremental": true, "tsBuildInfoFile": ".tsbuildinfo" } }
```

### Depth: Intensive

- Profile individual file compilation times to find the slowest files
- Analyze type complexity (deeply nested generics, conditional types)
- Measure Docker layer cache hit rates
- Compare clean vs. incremental build to validate caching effectiveness

---

## Category 2 — Bundle & Output Analysis

### What to Measure

- Total output size (`dist/` or `build/`)
- Top 5 largest output files by size
- Source map presence and size in production
- Number of output chunks (for code-split builds)
- Tree-shaking effectiveness (are unused exports eliminated?)

### Anti-Patterns

```typescript
// Importing entire library when only one function is needed
import _ from 'lodash' // Pulls in ~600KB
_.get(obj, 'path')

// Dev dependency accidentally in production bundle
import { faker } from '@faker-js/faker' // 3MB+ test utility

// Source maps shipped to production
// tsup.config.ts
{
  sourcemap: true
} // Fine for dev, costly for production
```

### Optimization Patterns

```typescript
// Targeted imports
import get from 'lodash/get' // ~1KB vs 600KB

// External dependencies (not bundled)
// tsup.config.ts
{
  external: ['better-sqlite3', 'sql.js']
}

// Source maps only in dev
{
  sourcemap: process.env.NODE_ENV !== 'production'
}
```

### Depth: Intensive

- Trace each large output file to its source to find bundling waste
- Analyze tree-shaking failures (what's included but never called?)
- Measure gzip/brotli compressed sizes for realistic transfer cost

---

## Category 3 — Dependency Weight

### What to Measure

- Total production dependency count (direct + transitive)
- Top 5 heaviest dependencies by install size
- Duplicate packages (different versions of the same dep)
- Dependency tree depth (deep trees increase install time and risk)
- `devDependencies` accidentally in `dependencies`

### Anti-Patterns

```json
// Heavy utility library for one function
"dependencies": { "moment": "^2.30.0" }  // 300KB+ for date formatting

// Duplicate versions in tree
"better-sqlite3": "11.0.0"  // direct
"some-plugin > better-sqlite3": "10.0.0"  // transitive duplicate

// Dev dependency in prod
"dependencies": { "@types/node": "^22.0.0" }  // Should be devDependencies
```

### Optimization Patterns

```json
// Lighter alternatives
"dependencies": { "dayjs": "^1.11.0" }  // 2KB vs 300KB

// Deduplication
// npm dedupe

// Correct dependency placement
"devDependencies": { "@types/node": "^22.0.0" }
```

### Depth: Intensive

- Calculate total `node_modules` size for production install
- Compare each heavy dependency against lighter alternatives
- Check for phantom dependencies (used but not declared — rely on hoisting)

---

## Category 4 — Runtime Performance

### What to Look For

This is a **static analysis** category. Scan source code for patterns that
cause runtime performance issues without running a profiler.

- **Hot-path allocations** — object/array creation inside tight loops,
  repeated `JSON.parse`/`JSON.stringify`, unnecessary spread operators in
  iteration
- **Missing early returns** — functions doing expensive work before checking
  guard conditions
- **Redundant computation** — values computed multiple times when they could
  be cached or hoisted
- **Blocking operations** — synchronous file I/O (`fs.readFileSync` in
  request handlers), CPU-intensive loops without yielding, serial `await`
  where parallel is safe
- **Memory leaks** — event listeners not cleaned up, growing Maps/Sets
  without eviction, closures capturing large scopes, timers without
  `clearInterval`
- **Startup cost** — heavy top-level initialization, eager loading of
  rarely-used modules

### Anti-Patterns

```typescript
// Object allocation in hot loop
for (const row of rows) {
  const result = { ...defaults, ...row } // New object every iteration
  results.push(result)
}

// Serial await where parallel is safe
const a = await fetchA()
const b = await fetchB() // b doesn't depend on a — should be parallel

// Sync file I/O in request handler
app.get('/config', (req, res) => {
  const config = fs.readFileSync('config.json') // Blocks event loop
  res.json(JSON.parse(config))
})

// Missing early return
function processItem(item) {
  const expensive = computeExpensiveThing(item) // Done before validation
  if (!item.isValid) return null // Wasted computation
  return expensive
}

// Memory leak — growing Map without eviction
const cache = new Map()
function getUser(id) {
  if (!cache.has(id)) cache.set(id, fetchUser(id)) // Never evicts
  return cache.get(id)
}
```

### Optimization Patterns

```typescript
// Reuse object shape
const result = Object.create(null)
for (const row of rows) {
  Object.assign(result, defaults, row)
  results.push({ ...result })
}

// Parallel await
const [a, b] = await Promise.all([fetchA(), fetchB()])

// Async file I/O with caching
let configCache
app.get('/config', async (req, res) => {
  configCache ??= await fs.readFile('config.json', 'utf8')
  res.json(JSON.parse(configCache))
})

// Early return before expensive work
function processItem(item) {
  if (!item.isValid) return null
  return computeExpensiveThing(item)
}

// LRU cache with eviction
import { LRUCache } from 'lru-cache'
const cache = new LRUCache({ max: 1000, ttl: 60_000 })
```

### Depth: Intensive

- Trace hot paths end-to-end (request → handler → query → response)
- Analyze Big-O complexity of key algorithms
- Check for event loop blocking using heuristic detection (sync I/O,
  heavy computation, long-running regex)
- Estimate cold start time (first request after process start)

---

## Category 5 — Test Suite Performance

### What to Measure

- Total suite duration
- Top 5 slowest test files (with durations)
- Top 5 slowest individual tests (with durations)
- Parallelization configuration (Vitest `pool`, `poolOptions`)
- Test isolation overhead (setup/teardown time)

### Anti-Patterns

```typescript
// Real I/O in unit tests
test("fetches data", async () => {
  const data = await fetch("https://api.example.com/data"); // Network I/O
});

// Heavy setup for simple assertions
beforeEach(async () => {
  await seedEntireDatabase(); // 500ms setup for a 10ms assertion
});

// Sequential tests that could parallelize
// vitest.config.ts
{ test: { pool: "forks", poolOptions: { forks: { singleFork: true } } } }
```

### Optimization Patterns

```typescript
// Mock external I/O
vi.mock('node:fetch', () => ({ default: vi.fn() }))

// Minimal setup — seed only what the test needs
beforeEach(async () => {
  await seedSingleTable('users', [testUser])
})

// Parallel execution
// vitest.config.ts
{
  test: {
    pool: 'threads'
  }
}
```

### Applicability

If the project has no test suite, report this category as N/A.

---

## Category 6 — Database & I/O Performance

### What to Look For

- **N+1 queries** — database queries executed inside loops instead of
  batching
- **Unbounded queries** — `SELECT *` without `LIMIT`, missing pagination
- **Missing indexes** — filtered/joined columns without indexes
- **Connection management** — pool sizing, connection leak risks, missing
  timeouts
- **Caching** — repeated identical queries without caching, stale TTLs
- **Serialization overhead** — excessive object transformation between
  layers, unnecessary deep cloning

### Anti-Patterns

```typescript
// N+1 query
const users = await db.query('SELECT * FROM users')
for (const user of users) {
  const orders = await db.query(`SELECT * FROM orders WHERE user_id = ?`, [user.id])
  // Each iteration is a new query
}

// Unbounded query
const allRows = await db.query('SELECT * FROM large_table') // No LIMIT

// Unnecessary deep clone
const copy = JSON.parse(JSON.stringify(largeObject)) // Expensive!
```

### Optimization Patterns

```typescript
// Batch query
const users = await db.query('SELECT * FROM users')
const userIds = users.map((u) => u.id)
const orders = await db.query(
  `SELECT * FROM orders WHERE user_id IN (${userIds.map(() => '?').join(',')})`,
  userIds
)

// Bounded query with pagination
const rows = await db.query('SELECT * FROM large_table LIMIT ? OFFSET ?', [100, offset])

// Structured clone (faster than JSON roundtrip)
const copy = structuredClone(largeObject)
```

### Applicability

If the project doesn't interact with databases or perform significant I/O,
report this category as N/A. Still check for file system operations and
network calls.

---

## Category 7 — Token & Context Efficiency

### Applicability

This category applies to **all project types** with graceful degradation:

| Project Profile | Depth         | Rationale                              |
| --------------- | ------------- | -------------------------------------- |
| `mcp-server`    | Full          | Primary target — all checks apply      |
| `web-app`       | Informational | Check API response verbosity           |
| `cli-tool`      | Informational | Check output verbosity, help text size |
| `library`       | Informational | Check type export complexity           |

### What to Look For

- **Verbose tool output** — tools returning full objects when summaries
  suffice. Do `outputSchema` definitions constrain response size?
- **Missing Code Mode** — servers with 15+ tools should offer sandboxed JS
  execution for token-efficient multi-step operations (70–90% savings)
- **Instruction bloat** — `instructions` field sending full documentation
  instead of slim pointers to pull-based help resources
- **Tool count** — 50+ tool servers without `--tool-filter` waste context
  on unused tool definitions
- **Redundant tools** — tools with significantly overlapping functionality
- **Response padding** — success responses including unnecessary metadata,
  empty arrays, or default values that could be omitted

### Anti-Patterns

```typescript
// Tool returning everything — wastes tokens
return {
  success: true,
  data: entireTable, // Could be thousands of rows
  metadata: fullSchemaInfo, // Not requested
  stats: computedStats, // Not requested
}

// Huge instructions field — pushed on every connection
const INSTRUCTIONS = `Full 10-page documentation here...` // 5KB+

// 170 tools, no filtering
server.registerAllTools() // Client receives all 170 tool schemas
```

### Optimization Patterns

```typescript
// Constrained output — only what was asked for
return {
  success: true,
  rows: data.slice(0, limit),
  totalCount: data.length,
  truncated: data.length > limit,
}

// Slim instructions + pull-based help resources
const INSTRUCTIONS = 'Use sqlite://help for documentation.' // ~50 chars

// Tool filtering
// --tool-filter "core,json,codemode"  → 47 tools instead of 170
```

### MCP Server Checklist

When the target is an MCP server, specifically verify:

- [ ] `instructions` field is < 1KB (slim pointer, not full docs)
- [ ] Help resources exist for pull-based documentation
- [ ] `--tool-filter` is implemented for large tool counts
- [ ] Code Mode (sandboxed JS) is available for multi-step operations
- [ ] `outputSchema` constrains response shapes (no unbounded arrays)
- [ ] Tools don't return redundant metadata by default
- [ ] Progress notifications are used for long-running operations
- [ ] Resources are used for large static data (schemas, configs)

---

## Category Cross-Reference

Quick lookup for which categories matter most by project profile:

| Project Profile | Primary Categories | Secondary |
| --------------- | ------------------ | --------- |
| MCP Server      | 4, 6, 7            | 1, 3      |
| Web App         | 1, 2, 4            | 3, 5      |
| CLI Tool        | 1, 3, 4            | 5         |
| Library         | 1, 2, 3            | 4         |
| Data-heavy      | 4, 6               | 1, 3, 5   |
| Test-heavy      | 5, 4               | 1         |
