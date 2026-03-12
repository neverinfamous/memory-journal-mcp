# Test memory-journal-mcp — Pass 3: Code Mode

Exhaustively test Code Mode (`mj_execute_code`) — the sandboxed JavaScript execution environment that exposes all 44 tools via the `mj.*` API.

**Scope:** 1 tool (`mj_execute_code`), ~48 test scenarios across 6 phases (Phases 16-21) covering sandbox execution, API discoverability, multi-step workflows, readonly mode, error handling, and cross-group orchestration.

**Prerequisites:**

- Pass 1 must have completed successfully (test data exists in the database).
- Code Mode is included in all tool filtering presets by default.
- Confirm MCP server instructions were auto-received before starting.
- Use the MCP server directly for all tests — not the terminal or scripts.

**Workflow after testing:**

1. Create a plan to fix any issues found, including changes to `ServerInstructions.md`/`ServerInstructions.ts` or this file (`test-server/test-tools-codemode.md`).
2. If the plan requires no user decisions, proceed with implementation immediately.
3. After implementation: run `npm run lint && npm run typecheck`, fix any issues, run `npx vitest run`, fix broken tests, update `CHANGELOG.md` (no duplicate headers), and commit without pushing.
4. Re-test fixes with direct MCP calls.
5. Provide a final summary — after re-testing if fixes were needed, or immediately if no issues were found.

> [!IMPORTANT]
> **Test Session Prerequisites**

1. The server instructions are auto-injected by the MCP protocol. Confirm receipt (no need to read `memory://instructions` separately).
2. Read `memory://briefing` to confirm context loaded (the briefing table confirms receipt).

---

## Phase 16: Sandbox Basics

### 16.1 Simple Expressions

| Test | Code | Expected Result |
|------|------|-----------------|
| Integer return | `return 42;` | `{ success: true, result: 42 }` |
| String return | `return "hello from code mode";` | `{ success: true, result: "hello from code mode" }` |
| Object return | `return { a: 1, b: [2, 3] };` | `{ success: true, result: { a: 1, b: [2, 3] } }` |
| Null return | `return null;` | `{ success: true, result: null }` |
| No return value | `const x = 1;` | `{ success: true, result: undefined }` (implicit undefined) |
| Boolean return | `return true;` | `{ success: true, result: true }` |

### 16.2 Async & Built-ins

| Test | Code | Expected Result |
|------|------|-----------------|
| Async/await | `const x = await Promise.resolve(42); return x;` | `{ success: true, result: 42 }` |
| JSON built-in | `return JSON.parse('{"test": true}');` | `{ success: true, result: { test: true } }` |
| Math built-in | `return Math.max(1, 2, 3);` | `{ success: true, result: 3 }` |
| Array methods | `return [3,1,2].sort();` | `{ success: true, result: [1, 2, 3] }` |
| Date available | `return typeof Date;` | `{ success: true, result: "function" }` |
| Map/Set available | `const m = new Map(); m.set("a", 1); return m.size;` | `{ success: true, result: 1 }` |
| RegExp available | `return /test/.test("testing");` | `{ success: true, result: true }` |

### 16.3 Execution Metrics

| Test | Code | Expected Result |
|------|------|-----------------|
| Metrics present | `return 1;` | Response has `metrics` with `wallTimeMs`, `cpuTimeMs`, `memoryUsedMb` |
| wallTimeMs > 0 | `return 1;` | `metrics.wallTimeMs >= 0` (typically > 0) |
| cpuTimeMs numeric | `return 1;` | `metrics.cpuTimeMs` is a number |
| memoryUsedMb numeric | `return 1;` | `metrics.memoryUsedMb` is a number |

### 16.4 Timeout Handling

| Test | Code | Expected Result |
|------|------|-----------------|
| Custom timeout succeeds | `return "fast";` with `timeout: 5000` | `{ success: true, result: "fast" }` |
| Infinite loop timeout | `while(true) {}` with `timeout: 2000` | `{ success: false, error: "..." }` with timeout indication |

---

## Phase 17: API Discoverability

### 17.1 Top-Level Help

| Test | Code | Expected Result |
|------|------|-----------------|
| mj.help() returns groups | `return await mj.help();` | `groups` array with 9 entries, `totalMethods` > 40, `usage` string |
| All 9 groups present | `const h = await mj.help(); return h.groups;` | Contains: `core`, `search`, `analytics`, `relationships`, `export`, `admin`, `github`, `backup`, `team` |
| Correct group count | `const h = await mj.help(); return h.groups.length;` | `9` |

### 17.2 Per-Group Help

| Test | Code | Expected Result |
|------|------|-----------------|
| core.help() | `return await mj.core.help();` | `group: "core"`, `methods` array with core method names |
| search.help() | `return await mj.search.help();` | `group: "search"`, `methods` array |
| analytics.help() | `return await mj.analytics.help();` | `group: "analytics"`, `methods` array |
| github.help() | `return await mj.github.help();` | `group: "github"`, `methods` array |
| backup.help() | `return await mj.backup.help();` | `group: "backup"`, `methods` array |

### 17.3 Aliases & Positional Arguments

| Test | Code | Expected Result |
|------|------|-----------------|
| Alias: mj.core.recent() | `const r = await mj.core.recent(2); return { count: r.entries?.length ?? r.count };` | Returns entries (alias for `getRecentEntries`) |
| Alias: mj.analytics.stats() | `const s = await mj.analytics.stats(); return typeof s.totalEntries;` | Returns `"number"` (alias for `getStatistics`) |
| Positional: mj.core.get(id) | `const r = await mj.core.getRecentEntries({limit:1}); const id = r.entries[0].id; const e = await mj.core.get(id); return { hasEntry: !!e };` | Returns the entry (positional for `getEntryById`) |

---

## Phase 18: Multi-Step Workflows

### 18.1 Read-Only Pipelines

| Test | Code | Expected Result |
|------|------|-----------------|
| Stats + recent summary | `const stats = await mj.analytics.getStatistics({}); const recent = await mj.core.getRecentEntries({limit: 3}); return { total: stats.totalEntries, recentCount: recent.entries.length };` | Both fields populated |
| Search + count | `const results = await mj.search.searchEntries({query: "test", limit: 5}); return { matchCount: results.entries.length, query: "test" };` | `matchCount` ≥ 0, `query: "test"` |
| Recent + tag extraction | `const r = await mj.core.getRecentEntries({limit: 10}); const tags = r.entries.flatMap(e => e.tags \|\| []); const counts = {}; for (const t of tags) { counts[t] = (counts[t] \|\| 0) + 1; } return { uniqueTags: Object.keys(counts).length, topTags: Object.entries(counts).sort(([,a],[,b]) => b - a).slice(0, 5) };` | `uniqueTags` ≥ 0, `topTags` array |

### 18.2 Conditional Branching

| Test | Code | Expected Result |
|------|------|-----------------|
| Conditional on stats | `const s = await mj.analytics.getStatistics({}); if (s.totalEntries > 0) { return { status: "has entries", count: s.totalEntries }; } else { return { status: "empty journal" }; }` | Returns either branch based on data |
| Loop over entries | `const r = await mj.core.getRecentEntries({limit: 5}); const summaries = r.entries.map(e => ({ id: e.id, type: e.entry_type, len: e.content?.length ?? 0 })); return summaries;` | Array of summary objects |

### 18.3 Create + Read Round-Trip (via Code Mode)

| Test | Code | Expected Result |
|------|------|-----------------|
| Create + read back | `const created = await mj.core.createEntryMinimal({content: "Code Mode round-trip test"}); const fetched = await mj.core.getEntryById({entry_id: created.entry.id}); return { createdId: created.entry.id, fetchedContent: fetched.entry.content };` | `fetchedContent` matches "Code Mode round-trip test" |
| Create + search | `const created = await mj.core.createEntry({content: "CodeMode search marker XYZ789", tags: ["codemode-test"]}); const found = await mj.search.searchEntries({query: "CodeMode search marker XYZ789", limit: 1}); return { found: found.entries.length > 0, createdId: created.entry.id };` | `found: true` |

---

## Phase 19: Readonly Mode

> [!NOTE]
> When `readonly: true`, only tools with `readOnlyHint: true` are available. Write tools should be filtered out of the API bridge.

### 19.1 Read Operations Succeed

| Test | Code (readonly: true) | Expected Result |
|------|----------------------|-----------------|
| Get recent entries | `return await mj.core.getRecentEntries({limit: 2});` | `{ success: true }`, entries returned |
| Search entries | `return await mj.search.searchEntries({query: "test", limit: 2});` | `{ success: true }`, search works |
| Get statistics | `return await mj.analytics.getStatistics({});` | `{ success: true }`, stats returned |
| Help still works | `return await mj.help();` | Groups and methods listed |

### 19.2 Write Operations Blocked

| Test | Code (readonly: true) | Expected Result |
|------|----------------------|-----------------|
| Create entry blocked | `return await mj.core.createEntry({content: "should fail"});` | ⚠️ Verify: either method doesn't exist (TypeError) or returns error |
| Update entry blocked | `return await mj.admin.updateEntry({entry_id: 1, content: "fail"});` | ⚠️ Verify: blocked or error |
| Delete entry blocked | `return await mj.admin.deleteEntry({entry_id: 999999});` | ⚠️ Verify: blocked or error |

### 19.3 Default Mode Allows Writes

| Test | Code (readonly: false, default) | Expected Result |
|------|--------------------------------|-----------------|
| Create works in default | `const r = await mj.core.createEntryMinimal({content: "readonly=false test"}); return { success: r.success, id: r.entry?.id };` | `success: true`, entry created |

---

## Phase 20: Error Handling & Security

### 20.1 Input Validation

| Test | Input | Expected Result |
|------|-------|-----------------|
| Empty code | `code: ""` | `{ success: false, error: "..." }` — pre-execution validation |
| Whitespace only | `code: "   "` (if treated as empty) | Structured error or executes with `undefined` result |

### 20.2 Blocked Patterns

| Test | Code | Expected Result |
|------|------|-----------------|
| require() | `require('fs')` | `{ success: false, error: "..." }` — blocked pattern |
| process.exit | `process.exit(1)` | `{ success: false, error: "..." }` — blocked pattern |
| eval() | `eval('1+1')` | `{ success: false, error: "..." }` — blocked pattern |
| import() | `import('fs')` | `{ success: false, error: "..." }` — blocked pattern |
| Function constructor | `new Function('return 1')()` | `{ success: false, error: "..." }` — blocked pattern |
| __proto__ | `({}).__proto__` | `{ success: false, error: "..." }` — blocked pattern |
| child_process | `require('child_process')` | `{ success: false, error: "..." }` — blocked pattern |

### 20.3 Runtime Errors

| Test | Code | Expected Result |
|------|------|-----------------|
| Syntax error | `{{{` | `{ success: false, error: "..." }` with syntax error message |
| ReferenceError | `return nonexistentVariable;` | `{ success: false, error: "..." }` with ReferenceError |
| TypeError in code | `null.foo()` | `{ success: false, error: "..." }` with TypeError |
| RPC method not found | `return await mj.core.nonexistentMethod();` | `{ success: false }` — method doesn't exist on proxy |

### 20.4 Nulled Globals

| Test | Code | Expected Result |
|------|------|-----------------|
| process is undefined | `return typeof process;` | `result: "undefined"` |
| require is undefined | `return typeof require;` | `result: "undefined"` |
| setTimeout is undefined | `return typeof setTimeout;` | `result: "undefined"` |
| globalThis is undefined | `return typeof globalThis;` | `result: "undefined"` |

---

## Phase 21: Cross-Group Orchestration

> [!TIP]
> These tests simulate real agent workflows that span multiple API groups in a single Code Mode execution — the primary use case for token savings.

### 21.1 Journal Health Dashboard

```javascript
// Test code:
const stats = await mj.analytics.getStatistics({});
const recent = await mj.core.getRecentEntries({ limit: 5 });
const tags = await mj.core.listTags({});
return {
  totalEntries: stats.totalEntries,
  recentTitles: recent.entries.map(e => e.title || e.content?.substring(0, 50)),
  tagCount: tags.tags?.length ?? 0,
  healthStatus: stats.totalEntries > 0 ? "healthy" : "empty"
};
```

| Check | Expected |
|-------|----------|
| `totalEntries` | Number > 0 |
| `recentTitles` | Array of strings |
| `tagCount` | Number ≥ 0 |
| `healthStatus` | `"healthy"` |

### 21.2 GitHub-Journal Coverage Report

```javascript
// Test code:
const issues = await mj.github.getGithubIssues({ limit: 3 });
const results = [];
for (const issue of (issues.issues || []).slice(0, 2)) {
  const entries = await mj.search.searchEntries({
    query: `#${issue.number}`,
    limit: 3
  });
  results.push({
    issue: `#${issue.number}: ${issue.title}`,
    linkedEntries: entries.entries.length
  });
}
return { issueCount: issues.issues?.length ?? 0, coverage: results };
```

| Check | Expected |
|-------|----------|
| `issueCount` | Number ≥ 0 |
| `coverage` | Array with `issue` and `linkedEntries` per item |

### 21.3 Tag Analysis Pipeline

```javascript
// Test code:
const tagList = await mj.core.listTags({});
const topTags = (tagList.tags || []).sort((a, b) => b.count - a.count).slice(0, 3);
const report = [];
for (const tag of topTags) {
  const entries = await mj.search.searchEntries({ query: tag.name, limit: 2 });
  report.push({ tag: tag.name, count: tag.count, sampleEntries: entries.entries.length });
}
return { analyzedTags: report.length, report };
```

| Check | Expected |
|-------|----------|
| `analyzedTags` | Number ≥ 0 |
| `report` | Array with `tag`, `count`, `sampleEntries` per item |

### 21.4 Relationship Graph Summary

```javascript
// Test code:
const recent = await mj.core.getRecentEntries({ limit: 5 });
const withRelationships = [];
for (const entry of recent.entries.slice(0, 3)) {
  const detail = await mj.core.getEntryById({ entry_id: entry.id });
  const relCount = detail.entry?.relationships?.length ?? 0;
  if (relCount > 0) {
    withRelationships.push({ id: entry.id, relationships: relCount });
  }
}
return { checked: Math.min(recent.entries.length, 3), withRelationships };
```

| Check | Expected |
|-------|----------|
| `checked` | Number (1-3) |
| `withRelationships` | Array (may be empty if no relationships exist) |

### 21.5 Full Pipeline: Create → Index → Search

> [!CAUTION]
> This test creates a real entry and modifies the vector index.

```javascript
// Test code:
const entry = await mj.core.createEntry({
  content: "Code Mode pipeline test: semantic indexing verification ZQJKM",
  tags: ["codemode-pipeline-test"],
  entry_type: "technical_note"
});
await mj.admin.addToVectorIndex({ entry_id: entry.entry.id });
const found = await mj.search.semanticSearch({
  query: "semantic indexing verification",
  limit: 5
});
const match = found.entries?.some(e => e.id === entry.entry.id);
return {
  createdId: entry.entry.id,
  indexed: true,
  foundInSemantic: match,
  totalResults: found.entries?.length ?? 0
};
```

| Check | Expected |
|-------|----------|
| `createdId` | Number |
| `foundInSemantic` | `true` or `false` — may be `false` due to vector indexing latency within a single Code Mode execution |
| `totalResults` | ≥ 1 |

---

## Test Execution Order

1. **Phase 16**: Sandbox Basics (must pass before proceeding)
2. **Phase 17**: API Discoverability (verifies mj.* proxy construction)
3. **Phase 18**: Multi-Step Workflows (tests real data pipelines)
4. **Phase 19**: Readonly Mode (verifies write filtering)
5. **Phase 20**: Error Handling & Security (blocked patterns, runtime errors)
6. **Phase 21**: Cross-Group Orchestration (real-world agent workflows)

---

## Cleanup

After testing, remove test entries created during Phases 18 and 21:

| Cleanup Step | Command/Action |
|--------------|----------------|
| Delete round-trip entry | `delete_entry(entry_id: <round_trip_id>, permanent: true)` |
| Delete search marker entry | `delete_entry(entry_id: <search_marker_id>, permanent: true)` |
| Delete readonly test entry | `delete_entry(entry_id: <readonly_test_id>, permanent: true)` |
| Delete pipeline test entry | `delete_entry(entry_id: <pipeline_test_id>, permanent: true)` |

---

## Success Criteria

### Sandbox Basics (Phase 16)

- [ ] Simple expressions return correct types: integer, string, object, null, boolean
- [ ] Async/await resolves correctly inside sandbox
- [ ] Built-in constructors available: JSON, Math, Date, Array, Map, Set, RegExp
- [ ] `metrics` field present with `wallTimeMs`, `cpuTimeMs`, `memoryUsedMb`
- [ ] Custom `timeout` parameter accepted and enforced
- [ ] Infinite loop terminated with structured error (not hang or crash)

### API Discoverability (Phase 17)

- [ ] `mj.help()` returns all 9 groups with correct `totalMethods` count
- [ ] Per-group `help()` returns method names for each group
- [ ] Method aliases work (e.g., `mj.core.recent()`, `mj.analytics.stats()`)
- [ ] Positional arguments work (e.g., `mj.core.get(id)`)

### Multi-Step Workflows (Phase 18)

- [ ] Chaining 2+ API calls in single execution works
- [ ] Data transformation (map, flatMap, sort, reduce) works on results
- [ ] Conditional branching based on query results works
- [ ] Create + read round-trip produces matching data
- [ ] Create + search finds the created entry

### Readonly Mode (Phase 19)

- [ ] `readonly: true` allows read operations (getRecentEntries, searchEntries, getStatistics)
- [ ] `readonly: true` blocks or errors on write operations (createEntry, updateEntry, deleteEntry)
- [ ] `readonly: false` (default) allows both read and write operations
- [ ] `mj.help()` still works in readonly mode

### Error Handling & Security (Phase 20)

- [ ] Empty code returns structured error (not raw MCP error)
- [ ] All 7 blocked patterns (`require`, `process`, `eval`, `import`, `Function`, `__proto__`, `child_process`) return structured security errors
- [ ] Syntax errors return `{ success: false, error: "..." }` with descriptive message
- [ ] Runtime errors (ReferenceError, TypeError) caught and returned as structured errors
- [ ] Nulled globals confirmed: `process`, `require`, `setTimeout`, `globalThis` are all `undefined`

### Cross-Group Orchestration (Phase 21)

- [ ] Journal health dashboard aggregates stats + recent + tags correctly
- [ ] GitHub-journal coverage report iterates issues and searches entries
- [ ] Tag analysis pipeline processes multiple tags with search per tag
- [ ] Relationship graph summary checks entries for relationship counts
- [ ] Full pipeline (create → index → semantic search) completes end-to-end
- [ ] All test entries cleaned up after Phase 21
