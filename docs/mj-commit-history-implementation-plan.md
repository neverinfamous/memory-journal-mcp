# Git Commit History Implementation Plan

This implementation plan creates a new **`git` tool group** (5 tools) for `memory-journal-mcp` to mine commit histories and refactors the `memory://briefing` resource's System section to replace file-based changelog reads with live `simple-git` queries.

## Architecture & Security Requirements

1. **Namespace & Group**: The tools must be named under the `git` group (not `history` to avoid collision with `get_entry_history`), and exposed in Code Mode as `mj.git.*`. The group belongs in `full` and `readonly` meta-groups only (do NOT add to `starter`).
2. **Multi-Project Support**: `GitHistoryClient` must be initialized per workspace/project via `PROJECT_REGISTRY` in `src/server/mcp-server/initialization.ts`, similar to `GitHubIntegration`.
3. **Security (Path Traversal & Command Injection)**: Add strict Zod validation (`/^[a-zA-Z0-9._\-\/@]+$/`) for git refs/paths. Never forward absolute paths from the sandbox. Catch `simple-git` errors and sanitize absolute file paths before returning them.
4. **Performance (ReDoS & O(n) Loops)**: `simple-git` must be initialized with `{ timeout: { block: 30_000 } }`. Cap search queries to 200 characters and block complex regex. Limit commit loops (e.g., max 10 for getReleaseInfo).

## 1. Git Client Module (TDD Recommended)

Create the backend infrastructure wrapping `simple-git`.

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
Implement logic to parse git trailers from commit messages.

#### [NEW] `src/git/commit-analyzer.ts`
Handle aggregation logic for file hotspots, commit frequencies, and contributors.

#### [NEW] `src/git/git-client.ts`
Implement `GitHistoryClient` wrapping `simple-git`.
- Instantiate with `simpleGit(workingDir, { timeout: { block: 30_000 } })`.
- `getCommitHistory(options)`: Fetch commit logs. Validate refs/paths.
- `searchCommits(query, options)`: Search commit messages. Sanitize `query` to prevent ReDoS.
- `getReleaseInfo(options)`: Cap `count` to 5 default, 10 max to prevent O(n) explosion.
- Implement robust error handling (handling missing tags, detached heads, non-git directories).

#### [NEW] `src/git/index.ts`
Barrel export.

## 2. Briefing Refactor (System Section)

#### [MODIFY] `src/handlers/resources/core/briefing/system-section.ts`
- **Delete**: `loadCachedUnreleased()` and `loadCachedLastReleaseDaysAgo()` legacy file reading logic.
- **Update**: `buildSystemContext` is already async. Map the `GitUnreleasedSummary` array explicitly to the briefing's required numeric format (`{ added, changed, fixed, security, removed }`).
- Populate `SystemContext.lastReleaseDaysAgo` using the new git client.

#### [MODIFY] `src/handlers/resources/shared.ts`
- Add `gitClient?: GitHistoryClient | null` to `ResourceContext`.

## 3. Tool Group Registration

Register the tool group into the core MCP Server routing ecosystem.

#### [MODIFY] `src/types/filtering.ts`
Add `'git'` to the `ToolGroup` union type. (Hard dependency for compilation).

#### [MODIFY] `src/filtering/tool-constants.ts`
Add `git` to `TOOL_GROUPS`. Update `META_GROUPS` to include `git` in `full` and `readonly` only.

#### [MODIFY] `src/auth/scopes.ts`
Add `git: SCOPES.READ` to `TOOL_GROUP_SCOPES`.

#### [MODIFY] `src/constants/icons.ts`
Add `ICON_GIT` and `git: [ICON_GIT]`.

#### [MODIFY] `src/types/index.ts`
Add `gitClient?: GitHistoryClient | null` to `ToolContext`.

## 4. Tool Handlers

#### [NEW] `src/handlers/tools/git.ts`
Implement the 5 git tool handlers (e.g., `get_commit_history`, `search_commits`, `get_release_info`, `get_unreleased_commits`, `analyze_commit_patterns`) with dual Zod/JSON Schema definitions.
- **Anti-Hallucination (Schema)**: Add explicit `.describe()` hint strings to complex Zod parameters to proactively guide agents (e.g., explaining date formats, or that `repo` should be omitted to use context).
- Add strict Zod validation regex to refs/tags (`/^[a-zA-Z0-9._\-\/@]+$/`).
- Wrap errors in a sanitizer to prevent exposing raw paths from `simple-git`.

#### [MODIFY] `src/handlers/tools/index.ts`
Import `getGitTools` and wire into `getTools()`.

## 5. Server Startup & Context Injection

#### [MODIFY] `src/server/mcp-server/initialization.ts`
- Initialize `GitHistoryClient` inside the project resolution loop (`PROJECT_REGISTRY`), matching the `GitHubIntegration` pattern.
- Inject `gitClient` into Context objects.
- Warm up the `getUnreleasedChanges` cache immediately after creation to eliminate briefing cold-start latency.

## 6. Code Mode Bindings

#### [NEW] `src/codemode/api/git-api.ts`
Extract git proxy bindings into a new file to keep `worker-api-proxy.ts` within the 500-line module limit. Expose them under `mj.git.*`.

#### [MODIFY] `src/codemode/api-constants.ts`
Add `mj.git.*` mappings.
- **Anti-Hallucination (Aliases)**: Add common fallback aliases to `METHOD_ALIASES` (e.g., map `log` to `getCommitHistory`, map `search` to `searchCommits`) to silently heal extrapolated method calls without shadowing legitimate methods.

#### [MODIFY] `src/codemode/worker-api-proxy.ts`
Import and bind the `gitApi` namespace. Do NOT forward absolute paths from the sandbox.
- **Anti-Hallucination (Interceptors)**: Ensure the proxy includes interceptors that catch missing `await` calls on git methods and provide highly actionable custom errors.

## 7. Server Instructions & Documentation

#### [MODIFY] `src/constants/server-instructions.ts`
Add a new `## Git` block explaining how agents should utilize the new git tools.

#### [MODIFY] `README.md` & `test-server/code-map.md` & `test-server/tool-reference.md`
Increment the reported tool counts (100 → 105) and document the new group.

## 8. Testing

- Write a new unit test suite `tests/git/git-client.test.ts` mocking `simple-git`.
- Write handler tests `tests/handlers/tools/git.test.ts`.
- Create `test-git.md` for standard, codemode, and usability testing directories. Update `coordinator-workflow.md` DAGs.
- Run `pnpm run check ; pnpm run test ; pnpm run test:e2e` to verify.
