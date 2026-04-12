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
