# Git History Mining & Briefing Refactor (Revised)

This implementation plan creates a **`git` tool group** (5 tools) for `memory-journal-mcp` and refactors the `memory://briefing` resource's System section to replace file-based changelog reads with live `simple-git` queries. It also adds testing prompts for all three test categories and updates server instructions.

## Audit Findings & Adversarial Review Resolutions

> [!NOTE]
> The following issues were identified in the [original plan](file:///C:/Users/chris/Desktop/adamic/docs/mj-git-mining-implementation-plan.md) via cross-referencing against the live codebase and rigorous adversarial review (Phase 2 & Phase 3 via Copilot).

### Critical Fixes from Adversarial Review
| # | Issue | Resolution |
|---|-------|------------|
| 1 | **Wrong Server Init Path** | `mcp-server.ts` was split. The correct dependency injection point is `src/server/mcp-server/initialization.ts`. |
| 2 | **`UnreleasedSummary` Collision** | The briefing's `UnreleasedSummary` expects numeric category counts (`{ added, changed, fixed... }`), while git types need array maps. Rename git type to `GitUnreleasedSummary` and explicitly map to the briefing format. |
| 3 | **Ghost File** | `commit-analyzer.ts` was missing from Phase 1. Added to Phase 1 setup. |
| 4 | **Unvalidated Git Ref Injection** | Prevent arbitrary shell options. Add strict Zod validation (`/^[a-zA-Z0-9._\-\/@]+$/`) for refs/paths. |
| 5 | **ReDoS via `--grep`** | Cap search `query` length to 200 and block complex regex captures. |
| 6 | **Error Leakage** | `simple-git` errors expose local filesystem paths. Must sanitize absolute paths in error catches before returning. |
| 7 | **Code Mode API Proxy limit** | `worker-api-proxy.ts` is 84KB. Extract bindings to `src/codemode/api/git-api.ts` to adhere to the 500-line module limit. |
| 8 | **`starter` meta-group inclusion** | The `starter` group is for minimal configs. Git tools belong in `full` and `readonly`, not `starter`. |
| 9 | **Multi-Project Support** | `GitHistoryClient` must be initialized per workspace/project via `PROJECT_REGISTRY`, similar to `GitHubIntegration`. |
| 10 | **Git Block Timeout** | `simple-git` can hang indefinitely. Initialize with `{ timeout: { block: 30_000 } }`. |

---

## User Review Required

> [!IMPORTANT]
> **Group Rename: `history` → `git`**
> The original plan used `history`. This revision renames to `git` to avoid confusion with the existing `get_entry_history` tool.

> [!IMPORTANT]
> **Briefing File Fallback Removed**
> `UNRELEASED.md` reads are permanently removed. If users use `starter` or non-git directories, the briefing will gracefully omit the Unreleased row.

> [!WARNING]
> **Code Mode Namespace: `mj.git.*`**
> The 5 new tools will be exposed under `mj.git.*`.

---

## Proposed Changes

> [!NOTE]
> Task Execution Order: **1 → 3 → 4 → 5 → 2 → 6 → 7 → 8 → 9** (Briefing refactor delayed until tools are proven).

---

### 1. Git Client Module (TDD Recommended)

Create the backend infrastructure. Write `tests/git/trailer-parser.test.ts` concurrently.

#### [NEW] `src/git/types.ts`

```typescript
export interface GitCommit {
  hash: string
  shortHash: string
  author: { name: string; email: string }
  date: string  // ISO 8601
  message: string
  body: string
  trailers: Record<string, string>
  refs?: string[]
}

export interface GitUnreleasedSummary {
  tag: string | null
  tagDate: string | null
  daysSinceRelease: number | null
  commitCount: number
  categories: Record<string, string[]>
  keyItems: string[]
  isShallowClone?: boolean
}
```

#### [NEW] `src/git/trailer-parser.ts`
Parse git trailers.

#### [NEW] `src/git/commit-analyzer.ts`
Handle aggregation logic for file hotspots and contributors.

#### [NEW] `src/git/git-client.ts`
Implement `GitHistoryClient` wrapping `simple-git`.
- Instantiate with `simpleGit(workingDir, { timeout: { block: 30_000 } })`
- `getCommitHistory(options)`: validate refs/paths.
- `searchCommits(query, options)`: sanitize `query` to prevent ReDoS.
- `getReleaseInfo(options)`: Cap `count` to 5 default, 10 max to prevent O(n) explosion.

#### [NEW] `src/git/index.ts`
Barrel export.

---

### 2. Briefing Refactor (System Section)

#### [MODIFY] [system-section.ts](file:///C:/Users/chris/Desktop/memory-journal-mcp/src/handlers/resources/core/briefing/system-section.ts)
- **Delete**: `loadCachedUnreleased()`, `loadCachedLastReleaseDaysAgo()`
- **Update**: `buildSystemContext` is already async. Map `GitUnreleasedSummary` explicitly to the briefing's numeric format.
- Populate `SystemContext.lastReleaseDaysAgo` using `getLastReleaseDaysAgoFromGit()`.

#### [MODIFY] [shared.ts](file:///C:/Users/chris/Desktop/memory-journal-mcp/src/handlers/resources/shared.ts)
- Add `gitClient?: GitHistoryClient | null` to `ResourceContext`.

---

### 3. Tool Group Registration

#### [MODIFY] [filtering.ts](file:///C:/Users/chris/Desktop/memory-journal-mcp/src/types/filtering.ts)
Add `'git'` to `ToolGroup`. **Hard dependency for compilation.**

#### [MODIFY] [tool-constants.ts](file:///C:/Users/chris/Desktop/memory-journal-mcp/src/filtering/tool-constants.ts)
Add `git` to `TOOL_GROUPS`. Update `META_GROUPS` (`full`, `readonly` only. **NOT** `starter`).

#### [MODIFY] [scopes.ts](file:///C:/Users/chris/Desktop/memory-journal-mcp/src/auth/scopes.ts)
Add `git: SCOPES.READ` to `TOOL_GROUP_SCOPES`.

#### [MODIFY] [icons.ts](file:///C:/Users/chris/Desktop/memory-journal-mcp/src/constants/icons.ts)
Add `ICON_GIT` and `git: [ICON_GIT]`.

#### [MODIFY] [index.ts](file:///C:/Users/chris/Desktop/memory-journal-mcp/src/types/index.ts)
Add `gitClient?: GitHistoryClient | null` to `ToolContext`.

---

### 4. Tool Handlers

#### [NEW] `src/handlers/tools/git.ts`
Implement the 5 git tool handlers.
- Add strict Zod validation regex to refs/tags (`/^[a-zA-Z0-9._\-\/@]+$/`).
- Wrap errors in a sanitizer to prevent exposing raw paths from `simple-git`.
- **Anti-Hallucination (Schema)**: Add explicit `.describe()` hint strings to complex Zod parameters to proactively guide agents (e.g., explaining date formats, or that `repo` should be omitted to use context).

#### [MODIFY] [index.ts](file:///C:/Users/chris/Desktop/memory-journal-mcp/src/handlers/tools/index.ts)
Import `getGitTools` and wire into `getTools()`.

---

### 5. Server Startup & Context Injection

#### [MODIFY] `src/server/mcp-server/initialization.ts`
- Initialize `GitHistoryClient` inside the project resolution loop (`PROJECT_REGISTRY`), matching `GitHubIntegration`.
- Inject `gitClient` into Context objects.
- Warm up the `getUnreleasedChanges` cache immediately after creation to eliminate briefing cold-start latency.

---

### 6. Code Mode Bindings

#### [NEW] `src/codemode/api/git-api.ts`
Extract git proxy bindings into a new file to keep `worker-api-proxy.ts` within the 500-line limit.

#### [MODIFY] [api-constants.ts](file:///C:/Users/chris/Desktop/memory-journal-mcp/src/codemode/api-constants.ts)
Add `mj.git.*` mappings.
- **Anti-Hallucination (Aliases)**: Add common fallback aliases to `METHOD_ALIASES` (e.g., map `log` to `getCommitHistory`, map `search` to `searchCommits`) to silently heal extrapolated method calls without shadowing legitimate methods.

#### [MODIFY] [worker-api-proxy.ts](file:///C:/Users/chris/Desktop/memory-journal-mcp/src/codemode/worker-api-proxy.ts)
Import and bind `gitApi` namespace. Do NOT forward absolute paths from the sandbox.
- **Anti-Hallucination (Interceptors)**: Ensure the proxy includes interceptors that catch missing `await` calls and provide highly actionable custom errors.

---

### 7. Server Instructions
#### [MODIFY] [server-instructions.ts](file:///C:/Users/chris/Desktop/memory-journal-mcp/src/constants/server-instructions.ts)
Add `git` help block.

---

### 8. Testing Prompts
Create `test-git-history.md` for standard, codemode, and usability testing directories. Update `coordinator-workflow.md` DAGs.

---

### 9. Documentation Updates
Update `code-map.md`, `tool-reference.md`, `README.md`, and `Git-Integration.md`.

---

## Verification Plan
Same structure as previously defined, with additional focus on validating the security blocks (ReDoS, Path traversal) and cold-start latency tests.
