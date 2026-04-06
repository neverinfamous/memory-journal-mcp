# Test memory-journal-mcp — Seed Data

**Scope:** Create 17 seed entries (S1–S17) for FTS5, filter, semantic search, cross-DB, and cross-project insight tests. **This file must run first** — all other test files depend on this seed data.

**Prerequisites:** MCP server instructions auto-injected. `TEAM_DB_PATH` configured for S11–S12, S15–S17.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. User verifies: `npm run lint && npm run typecheck`, `npm run test`, `npm run test:e2e`.
4. Re-test fixes with direct MCP calls.
5. Brief final summary.
   * **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total tokens used by this test pass.

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
| S1  | `create_entry` | `content: "Redesigned the authentication architecture for the OAuth 2.1 module"`, `entry_type: "technical_note"`, `tags: ["architecture", "auth"]`                                                  | `architecture`, `auth*`, `"authentication architecture"` phrase    |
| S2  | `create_entry` | `content: "Improved error handling in the database adapter layer with typed error classes"`, `entry_type: "bug_fix"`, `significance_type: "lesson_learned"`, `tags: ["error-handling", "database"]` | `"error handling"` phrase, `significance_type` filter              |
| S3  | `create_entry` | `content: "Deploy new release candidate to the CDN edge network"`, `entry_type: "feature_implementation"`, `tags: ["deploy", "release"]`, `is_personal: false`                                      | `deploy NOT staging`, `deploy OR release`                          |
| S4  | `create_entry` | `content: "Released v5.0 with breaking API changes and migration guide"`, `entry_type: "milestone"`, `significance_type: "breakthrough"`, `tags: ["release"]`                                       | `deploy OR release` (via "release"), semantic search for "release" |
| S5  | `create_entry` | `content: "Deploy to staging environment failed — rollback initiated"`, `entry_type: "bug_fix"`, `tags: ["deploy", "staging"]`                                                                      | `deploy NOT staging` (negative match — verifies NOT exclusion)     |
| S6  | `create_entry` | `content: "The test's scope was expanded to cover 100% of edge cases"`, `entry_type: "planning"`, `tags: ["testing"]`                                                                               | `test's` LIKE fallback, `100%` LIKE fallback                       |

### 0.2 Filter & GitHub-Linked Entries

These entries ensure filter tests (`issue_number`, `pr_status`, `workflow_run_id`, `project_number`) return results.

| #   | Tool           | Params                                                                                                                                                                                                                                     | Enables Tests                                                                            |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| S7  | `create_entry` | `content: "Investigated performance regression in issue #44 — root cause was N+1 queries"`, `entry_type: "research"`, `issue_number: 44`, `project_number: 5`, `tags: ["performance", "investigation"]`                                    | `issue_number: 44` filter, `project_number: 5` filter, semantic search for "performance" |
| S8  | `create_entry` | `content: "Code review feedback from PR #67 merged — refactored authentication middleware"`, `entry_type: "code_review"`, `pr_number: 67`, `pr_status: "merged"`, `tags: ["code-review", "auth"]`                                          | `pr_status: "merged"` filter, `pr_number` filter, `auth*` prefix                         |
| S9  | `create_entry` | `content: "CI workflow run completed — all 910 tests passing across 3 test suites"`, `entry_type: "technical_note"`, `workflow_run_id: 12345`, `workflow_name: "lint-and-test"`, `workflow_status: "completed"`, `tags: ["ci", "testing"]` | `workflow_run_id` filter, workflow field persistence                                     |
| S10 | `create_entry` | `content: "Personal reflection on improving development velocity and reducing technical debt"`, `entry_type: "personal_reflection"`, `is_personal: true`, `tags: ["personal", "velocity"]`                                                 | `is_personal: true` filter, semantic search for "improving performance"                  |

### 0.3 Team & Cross-DB Entries

These entries ensure cross-DB search merging (`source: 'personal' | 'team'`) returns results from both databases.

| #   | Tool                | Params                                                                                                                                                                                     | Enables Tests                                                                    |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| S11 | `create_entry`      | `content: "Architecture decision: adopted event-driven design for webhook processing"`, `entry_type: "project_decision"`, `share_with_team: true`, `tags: ["architecture", "team-shared"]` | Cross-DB `search_entries` with `source` marker, team search, `architecture` FTS5 |
| S12 | `team_create_entry` | `content: "Team standup: discussed authorization flow improvements and deploy pipeline"`, `entry_type: "standup"`, `tags: ["standup", "auth", "deploy"]`                                   | Team-only search, cross-DB date range, `auth*` and `deploy` in team DB           |

### 0.4 Cross-Project Insights Seed

> [!IMPORTANT]
> `get_cross_project_insights` and `team_get_cross_project_insights` require a **minimum of 3 entries** sharing the same `project_number` before they appear in results (default `min_entries: 3`). S7 already has `project_number: 5` — add S13–S14 to reach the threshold in the personal journal. S15–S17 seed the team DB with project-linked entries.

**Personal journal — complete project #5 to 3 entries:**

| #   | Tool           | Params                                                                                                                                                                                               | Enables Tests                                                                     |
| --- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| S13 | `create_entry` | `content: "Completed sprint planning for project #5: scoped auth and deploy milestones"`, `entry_type: "planning"`, `project_number: 5`, `tags: ["planning", "sprint"]`                              | `project_number: 5` filter, `get_cross_project_insights` non-zero `project_count` |
| S14 | `create_entry` | `content: "Project #5 retrospective: identified bottlenecks in deployment pipeline and action items"`, `entry_type: "personal_reflection"`, `project_number: 5`, `tags: ["retrospective", "deploy"]` | `get_cross_project_insights` — 3rd entry to meet `min_entries: 3` for project 5   |

**Team DB — seed 3 project-linked entries:**

| #   | Tool                | Params                                                                                                                                                                                              | Enables Tests                                                                         |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| S15 | `team_create_entry` | `content: "Team kickoff for project #5: aligned on goals and delivery timeline"`, `entry_type: "standup"`, `project_number: 5`, `tags: ["kickoff", "project"]`                                      | `team_get_cross_project_insights` non-zero `project_count`                            |
| S16 | `team_create_entry` | `content: "Project #5 mid-sprint check-in: auth module ahead of schedule, deploy pipeline at risk"`, `entry_type: "standup"`, `project_number: 5`, `tags: ["standup", "project"]`                   | `team_get_cross_project_insights` — 2nd team entry for project 5                      |
| S17 | `team_create_entry` | `content: "Project #5 release review: all acceptance criteria met, feature flags enabled for rollout"`, `entry_type: "standup"`, `project_number: 5`, `tags: ["release", "project", "team-shared"]` | `team_get_cross_project_insights` — 3rd team entry to meet `min_entries: 3` threshold |

### 0.5 Post-Seed Verification

After creating all 17 entries, verify the seed data is searchable:

| Check                       | Command                                           | Expected                                                                                                            |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| FTS5 indexed                | `search_entries(query: "architecture")`           | ≥ 1 result (S1 or S11 depending on BM25 rank); use phrase `"authentication architecture"` to ensure S1 specifically |
| Filters work                | `search_entries(issue_number: 44)`                | ≥ 1 result (S7)                                                                                                     |
| Cross-DB merged             | `search_entries(query: "architecture")`           | At least 1 result includes `source: 'team'` (S11); use `auth*` for cross-DB results spanning both DBs               |
| Rebuild vector index        | `rebuild_vector_index`                            | `entriesIndexed` > 0                                                                                                |
| Semantic search             | `semantic_search(query: "improving performance")` | ≥ 1 result (S7, S10 should be semantically similar)                                                                 |
| Cross-project insights      | `get_cross_project_insights({})`                  | `project_count ≥ 1`, project 5 appears with `entry_count ≥ 3`                                                       |
| Team cross-project insights | `team_get_cross_project_insights({})`             | `project_count ≥ 1`, project 5 appears with `entry_count ≥ 3`                                                       |

---

## Success Criteria

- [ ] All 17 seed entries (S1–S17) created successfully
- [ ] FTS5 search returns results for `"architecture"` query
- [ ] Filter search returns results for `issue_number: 44`
- [ ] Cross-DB search includes `source: 'team'` entries
- [ ] Vector index rebuilt with `entriesIndexed > 0`
- [ ] Semantic search returns results for `"improving performance"`
- [ ] `get_cross_project_insights` returns `project_count ≥ 1` (project 5 with ≥ 3 entries)
- [ ] `team_get_cross_project_insights` returns `project_count ≥ 1` (project 5 with ≥ 3 entries)
