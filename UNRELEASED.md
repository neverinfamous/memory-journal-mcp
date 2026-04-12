# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.4.0...HEAD)

### Added
- **Skills**: Integrated the `github-copilot-cli` agent skill to provide interactive terminal-native adversarial code reviews.
- **Workflows**: Added the `copilot-audit` GitHub Commander workflow to establish a pre-push review loop evaluating uncommitted local diffs via Copilot.
- **Hush Protocol**: Added `pass_team_flag` and `resolve_team_flag` tools for machine-actionable team communication via structured `flag` entries.
- **Hush Protocol**: Added `memory://flags` resource surfacing active (unresolved) flags as a dashboard.
- **Hush Protocol**: Added `memory://flags/vocabulary` resource exposing the server-wide flag vocabulary.
- **Hush Protocol**: Added configurable flag vocabulary via `--flag-vocabulary` CLI flag and `FLAG_VOCABULARY` env var (defaults: blocker, needs_review, help_requested, fyi).
- **Briefing**: Integrated active flags summary into the briefing payload and user message table.
- **Briefing**: Added `localTime` field for chronological grounding in the briefing JSON payload.
- **Types**: Added `'flag'` to the `EntryType` union and `ENTRY_TYPES` constant.
- **Icons**: Added `ICON_FLAG` (alert triangle) for flag-related resources.

### Fixed
- **Types**: Added `importanceScore` formally to `JournalEntry` interface for stronger bounds ranking sorting.
- **Search**: Fixed early `.slice()` truncation executing before semantic importance `.sort()`, dropping high-relevance low-semantic edge cases.
- **Analytics**: Fixed SQLite `%Y-Q` grouping calculation bug by injecting explicit month-derivation syntax.
- **Constraints**: Enforced `MAX_QUERY_LIMIT` cap (500) against over-fetching from tag-broadened Team Searches instead of relying on a 1000 literal.
- **Consistency**: Hardened `teamCollaborationResource` returning `{ success: true, matrix: <object> }` rigidly. 
- **Briefings**: Rebranded the ambiguous `Matrix Density` insight label to `Relationship density`.
- **Hush Protocol**: Fixed SQLite parameter mapping bug where `autoContext` JSON strings were erroneously being cast to boolean integers (`1`/`0`) in `crud.ts`.

### Verification
- **Code Mode Validation**: Certified 100% test-pass rate across all Phase 27 tag management (`mergeTags`, `listTags`) and backup/restore (`backupJournal`, `restoreBackup`, `cleanupBackups`) functional bounds without remediation.
- **Code Mode Validation**: Certified 100% test-pass rate across all Phase 17 API Discoverability functional bounds (`mj.help()`, group help, aliases, positional arguments) without remediation.
- **Code Mode Validation**: Certified 100% test-pass rate across all Phase 20 Core CRUD functional bounds (`createEntry`, `getEntryById`, `updateEntry`, `deleteEntry`, etc.) including correct bridging of all metadata parameters and structural validation schemas without remediation.
- **Code Mode Validation**: Certified 100% test-pass rate across all Phase 29 Error Matrix and Zod Sweeps, validating that all 10 API groups (including the new Hush Protocol flags) return structured `{ success: false }` for empty parameters, type mismatches, domain bounds, and security violations without crashing the sandbox.
- **Code Mode Validation**: Certified 100% test-pass rate across all Phase 25 GitHub integrations (16 tools). Validated read-only lookups, structured error paths, Kanban operations, issue and milestone lifecycles, and Copilot reviews mapped to Code Mode implementations without regressions.
- [x] **Code Mode Validation**: Certified 100% test-pass rate across all Phase 26 IO & Interoperability functional bounds (`exportEntries`, `exportMarkdown`, `importMarkdown`), validating raw JSON/Markdown generation, filesystem-bound orchestration mapping, and safe path traversal halts (returning structured `{ success: false }`) without remediation.
- [x] **Code Mode Validation**: Certified 100% test-pass rate across all Phase 23 Cross-Group Orchestration bounds, proving robust pipeline execution (journal health dashboards, GitHub-journal coverage mappings, tag analyses, relationship graph summaries, create→index→search flows) sequentially entirely within sandbox contexts without remediation.
- [x] **Code Mode Validation**: Certified 100% test-pass rate across all Phase 24 Relationships & Visualization bounds (`linkEntries`, `visualizeRelationships`), verifying all five relationship types, validation mapping for duplicates/reversals/nonexistent targets, parameter reflection (descriptions), and topological graphing with Mermaid outputs without remediation.
- [x] **Code Mode Validation**: Certified 100% test-pass rate across all Phase 18 Readonly Mode bounds (`mj_execute_code` with `readonly: true` vs `readonly: false`), confirming write operations are strictly blocked while read and default mode operations execute successfully without remediation.
- [x] **Code Mode Validation**: Certified 100% test-pass rate across all Phase 16 Sandbox Basics bounds (`mj_execute_code`), confirming simple expression resolution, async/await bindings, robust global built-in injections, `metrics` timing propagation, and custom test timeouts alongside infinite loop truncation protection without remediation.
- [x] **Code Mode Validation**: Certified 100% test-pass rate across all Phase 21 Search & Semantics bounds, including FTS5 behaviors (phrase/prefix/boolean/filters), timestamp/importance bounds sorting, cross-database searching, analytics integration, date range edge cases, and semantic vector lifecycle queries entirely driven within Code Mode orchestrations without remediation.
- [x] **Code Mode Validation**: Certified 100% test-pass rate across all Phase 19 Error Handling & Security bounds, confirming input validation, blocked patterns, runtime error handling, and nulled globals without remediation.
- [x] **Code Mode Validation**: Certified 100% test-pass rate across all Phase 28 Team Admin & Collaboration bounds, including team operations (`teamUpdateEntry`, `teamDeleteEntry`, `teamMergeTags`), integrated analytics (`teamGetStatistics`), linking mechanisms (`teamLinkEntries`, `teamVisualizeRelationships`), localized IO handling (`teamExportEntries`, `teamExportMarkdown`, `teamImportMarkdown`), and independent administrative safeguards (`teamBackup`, `teamListBackups`, `teamGetCollaborationMatrix`), validating 100% boundary mapping into Code Mode execution targets without remediation.
- [x] **Code Mode Validation**: Certified 100% test-pass rate across all Phase 28.1-28.3 Team CRUD & Search bounds, covering `teamCreateEntry`, `teamGetRecent`, `teamSearch`, `teamGetEntryById`, `teamListTags`, and `teamSearchByDateRange`, including their respective structural schemas, required date formats, and error constraint paths without remediation.
- [x] **Code Mode Validation**: Certified 100% test-pass rate across all Phase 28.12-28.15 Team Flag Tools bounds, verifying `passTeamFlag` and `resolveTeamFlag` vocabulary execution, resolution lifecycles, structured error returns, search, and idempotency, after resolving the `autoContext` typing defect in the SQLite adapter.
- [x] **Code Mode Validation**: Certified 100% test-pass rate across all Phase 28.9-28.10 Team Vector, Insights & Cross-Tool Errors bounds, verifying `teamRebuildVectorIndex`, `teamGetCrossProjectInsights`, vector semantic search, and structured error boundary consistency for all cross-tool 404/invalid constraint paths without remediation.
