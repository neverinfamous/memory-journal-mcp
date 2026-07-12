# Test memory-journal-mcp — Seed Data

**Scope:** Create 17 seed entries (S1–S17) for FTS5, filter, semantic search, cross-DB, and cross-project insight tests. **This file must run first** — all other test files depend on this seed data.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls to ensure tests hit the test database instead of production.
- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing.
4. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify with `pnpm run check` yourself—you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 0: Seed Test Data

> [!IMPORTANT]
> Create these entries **before running any other test files** to ensure FTS5, filter, semantic search, and relationship tests have matching data. Each entry is mapped to the test cases it enables.
>
> **Do NOT skip this phase** — without it, many search tests will return empty results and won't validate the underlying feature.

### 0.1 FTS5 Content Entries

These entries ensure every FTS5 query pattern in `test-core-search.md` returns actual results.

| #   | Tool           | Params                                                                                                                                                                                              | Enables Tests                                                      |
| --- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| S1  | `create_entry` | `project_number: 5`, `content: "Redesigned the authentication architecture for the OAuth 2.1 module"`, `entry_type: "technical_note"`, `tags: ["architecture", "auth"]`                                                  | `architecture`, `auth*`, `"authentication architecture"` phrase    |
| S2  | `create_entry` | `project_number: 5`, `content: "Improved error handling in the database adapter layer with typed error classes"`, `entry_type: "bug_fix"`, `significance_type: "lesson_learned"`, `tags: ["error-handling", "database"]` | `"error handling"` phrase, `significance_type` filter              |
| S3  | `create_entry` | `project_number: 5`, `content: "Deploy new release candidate to the CDN edge network"`, `entry_type: "feature_implementation"`, `tags: ["deploy", "release"]`, `is_personal: false`                                      | `deploy NOT staging`, `deploy OR release`                          |
| S4  | `create_entry` | `project_number: 5`, `content: "Released v5.0 with breaking API changes and migration guide"`, `entry_type: "milestone"`, `significance_type: "breakthrough"`, `tags: ["release"]`                                       | `deploy OR release` (via "release"), semantic search for "release" |
| S5  | `create_entry` | `project_number: 5`, `content: "Deploy to staging environment failed — rollback initiated"`, `entry_type: "bug_fix"`, `tags: ["deploy", "staging"]`                                                                      | `deploy NOT staging` (negative match — verifies NOT exclusion)     |
| S6  | `create_entry` | `project_number: 5`, `content: "The test's scope was expanded to cover 100% of edge cases"`, `entry_type: "planning"`, `tags: ["testing"]`                                                                               | `test's` LIKE fallback, `100%` LIKE fallback                       |

### 0.2 Filter & GitHub-Linked Entries

These entries ensure filter tests (`issue_number`, `pr_status`, `workflow_run_id`, `project_number`) return results.

| #   | Tool           | Params                                                                                                                                                                                                                                     | Enables Tests                                                                            |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| S7  | `create_entry` | `content: "Investigated performance regression in issue #44 — root cause was N+1 queries"`, `entry_type: "research"`, `issue_number: 44`, `project_number: 5`, `tags: ["performance", "investigation"]`                                    | `issue_number: 44` filter, `project_number: 5` filter, semantic search for "performance" |
| S8  | `create_entry` | `project_number: 5`, `content: "Code review feedback from PR #67 merged — refactored authentication middleware"`, `entry_type: "code_review"`, `pr_number: 67`, `pr_status: "merged"`, `tags: ["code-review", "auth"]`                                          | `pr_status: "merged"` filter, `pr_number` filter, `auth*` prefix                         |
| S9  | `create_entry` | `project_number: 5`, `content: "CI workflow run completed — all 910 tests passing across 3 test suites"`, `entry_type: "technical_note"`, `workflow_run_id: 12345`, `workflow_name: "lint-and-test"`, `workflow_status: "completed"`, `tags: ["ci", "testing"]` | `workflow_run_id` filter, workflow field persistence                                     |
| S10 | `create_entry` | `project_number: 5`, `content: "Personal reflection on improving development velocity and reducing technical debt"`, `entry_type: "personal_reflection"`, `is_personal: true`, `tags: ["personal", "velocity"]`                                                 | `is_personal: true` filter, semantic search for "improving performance"                  |

### 0.3 Team & Cross-DB Entries

These entries ensure cross-DB search merging (`source: 'personal' | 'team'`) returns results from both databases.

| #   | Tool                                   | Params                                                                                                                                                                                     | Enables Tests                                                                    |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| S11 | `create_entry`                         | `project_number: 5`, `content: "Architecture decision: adopted event-driven design for webhook processing"`, `entry_type: "project_decision"`, `share_with_team: true`, `tags: ["architecture", "team-shared"]` | Cross-DB `search_entries` with `source` marker, team search, `architecture` FTS5 |
| S12 | `team_create_entry(project_number: 5)` | `content: "Team standup: discussed authorization flow improvements and deploy pipeline"`, `entry_type: "standup"`, `tags: ["standup", "auth", "deploy"]`                | Team-only search, cross-DB date range, `auth*` and `deploy` in team DB           |

### 0.4 Cross-Project Insights Seed

> [!IMPORTANT]
> `get_cross_project_insights` and `team_get_cross_project_insights` require a **minimum of 3 entries** sharing the same `project_number` before they appear in results (default `min_entries: 3`). S7 already has `project_number: 5` — add S13–S14 to reach the threshold in the personal journal. S15–S17 seed the team DB with project-linked entries.

**Personal journal — complete project #5 to 3 entries:**

| #   | Tool           | Params                                                                                                                                                                                               | Enables Tests                                                                     |
| --- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| S13 | `create_entry` | `content: "Completed sprint planning for project #5: scoped auth and deploy milestones"`, `entry_type: "planning"`, `project_number: 5`, `tags: ["planning", "sprint"]`                              | `project_number: 5` filter, `get_cross_project_insights` non-zero `project_count` |
| S14 | `create_entry` | `content: "Project #5 retrospective: identified bottlenecks in deployment pipeline and action items"`, `entry_type: "personal_reflection"`, `project_number: 5`, `tags: ["retrospective", "deploy"]` | `get_cross_project_insights` — 3rd entry to meet `min_entries: 3` for project 5   |

**Team DB — seed 3 project-linked entries:**

| #   | Tool                                   | Params                                                                                                                                                                                                                 | Enables Tests                                                                         |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| S15 | `team_create_entry(project_number: 5)` | `content: "Team kickoff for project #5: aligned on goals and delivery timeline"`, `entry_type: "standup"`, `project_number: 5`, `tags: ["kickoff", "project"]`, `author: "alice"`                                      | `team_get_cross_project_insights` non-zero `project_count`                            |
| S16 | `team_create_entry(project_number: 5)` | `content: "Project #5 mid-sprint check-in: auth module ahead of schedule, deploy pipeline at risk"`, `entry_type: "standup"`, `project_number: 5`, `tags: ["standup", "project"]`, `author: "bob"`                     | `team_get_cross_project_insights` — 2nd team entry for project 5                      |
| S17 | `team_create_entry(project_number: 5)` | `content: "Project #5 release review: all acceptance criteria met, feature flags enabled for rollout"`, `entry_type: "standup"`, `project_number: 5`, `tags: ["release", "project", "team-shared"]`, `author: "alice"` | `team_get_cross_project_insights` — 3rd team entry to meet `min_entries: 3` threshold |

### 0.5 Post-Seed Verification

After creating all 17 entries, verify the seed data is searchable:

| Check                       | Command                                                    | Expected                                                                                                            |
| --------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| FTS5 indexed                | `search_entries(project_number: 5, query: "architecture")` | ≥ 1 result (S1 or S11 depending on BM25 rank); use phrase `"authentication architecture"` to ensure S1 specifically |
| Filters work                | `search_entries(project_number: 5, issue_number: 44)`      | ≥ 1 result (S7)                                                                                                     |
| Cross-DB merged             | `search_entries(project_number: 5, query: "architecture")` | At least 1 result includes `source: 'team'` (S11); use `auth*` for cross-DB results spanning both DBs               |
| Rebuild vector index        | `rebuild_vector_index`                                     | `entriesIndexed` > 0                                                                                                |
| Semantic search             | `semantic_search(query: "improving performance")`          | ≥ 1 result (S7, S10 should be semantically similar)                                                                 |
| Cross-project insights      | `get_cross_project_insights({})`                           | `project_count ≥ 1`, project 5 appears with `entry_count ≥ 3`                                                       |
| Team cross-project insights | `team_get_cross_project_insights({})`                      | `project_count ≥ 1`, project 5 appears with `entry_count ≥ 3`                                                       |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- All 17 seed entries (S1–S17) created successfully
- FTS5 search returns results for `"architecture"` query
- Filter search returns results for `issue_number: 44`
- Cross-DB search includes `source: 'team'` entries
- Vector index rebuilt with `entriesIndexed > 0`
- Semantic search returns results for `"improving performance"`
- `get_cross_project_insights` returns `project_count ≥ 1` (project 5 with ≥ 3 entries)
- `team_get_cross_project_insights` returns `project_count ≥ 1` (project 5 with ≥ 3 entries)
