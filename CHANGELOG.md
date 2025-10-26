# Changelog

All notable changes to Memory Journal MCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.2] - 2025-10-26

### Security
- **URL Parsing Vulnerability Fix (CodeQL #110, #111)** - Fixed incomplete URL substring sanitization in GitHub remote URL parsing
  - **Impact**: Prevented potential URL spoofing attacks where malicious URLs could bypass GitHub hostname checks
  - **Root Cause**: Used substring checks (`'github.com' in url`) instead of proper URL parsing
  - **Fix**: Implemented proper `urllib.parse.urlparse()` validation with exact hostname matching
  - **Details**:
    - SSH URLs: Explicit prefix validation with `startswith('git@github.com:')`
    - HTTPS/HTTP URLs: Parse with `urlparse()` and verify `hostname == 'github.com'`
    - Prevents bypasses like `http://evil.com/github.com/fake` or `http://github.com.evil.com/fake`
  - **Severity**: Medium (limited to Git remote URL parsing in local repository context)
  - **Reference**: [CWE-20: Improper Input Validation](https://cwe.mitre.org/data/definitions/20.html)

## [1.2.1] - 2025-10-26

### Fixed
- **Semantic search initialization** - Resolved async/lazy loading race condition that could cause semantic_search to hang on first use
  - Moved ML dependency imports to module-level initialization
  - Eliminated async lock deadlock during model loading
  - First semantic search call now completes in <1 second (previously could timeout)
- **Thread pool optimization** - Increased worker count from 2 to 4 to prevent contention during ML model loading

### Changed
- Improved initialization progress messages with step-by-step feedback (Step X/3)
- Added explicit stderr flushing for real-time progress updates

## [1.2.0] - 2025-10-26

### Added - Phase 3: Organization Support
- **Organization-Level GitHub Projects** - Full support for org-level projects alongside user projects
  - Automatic owner detection (user vs organization)
  - Dual project lookup showing both user and org projects
  - Separate `GITHUB_ORG_TOKEN` support for org-specific permissions
  - All Phase 2 analytics work with org projects
- **Enhanced Phase 2 Features for Organizations**
  - Cross-project insights spanning user and org projects
  - Status summaries for org project teams
  - Milestone tracking with org-level milestones
  - Smart caching (80%+ API reduction, 24hr owner type cache)

### Added - Phase 2: Advanced Project Analytics
- **New Tool:** `get_cross_project_insights` - Multi-project analysis and pattern detection
- **New Prompts:**
  - `project-status-summary` - Comprehensive GitHub Project status reports
  - `project-milestone-tracker` - Milestone progress with velocity tracking
- **New Resource:** `memory://projects/{number}/timeline` - Live activity feed combining journal + GitHub events
- **Enhanced:** `get_statistics` with `project_breakdown` parameter for per-project metrics
- **Smart Caching System** - GitHub API response caching with configurable TTLs (1hr projects, 15min items)

### Added - Phase 1: GitHub Projects Integration
- **GitHub Projects Support** - Connect journal entries with GitHub Projects (user & org)
  - Entry creation with `project_number`, `project_item_id`, `github_project_url` parameters
  - Automatic project detection from repository context
  - Search and filter entries by project
  - Project context in context bundles
- **New Database Columns:** `project_number`, `project_item_id`, `github_project_url`
- **Graceful Degradation:** Works without GitHub token (project features disabled)

### Fixed
- **FTS5 Search Query Escaping** - Special characters (hyphens, dots, colons) in search queries now handled correctly
  - Organization names like "my-company" now searchable
  - Version numbers like "v1.2.0" work properly
  - Implemented `escape_fts5_query()` function with quote wrapping

## [1.1.3] - 2025-10-04

### Fixed
- **Migration Logic** - Fixed schema migration check to properly handle fresh database installations

## [1.1.2] - 2025-10-04

### Security
- **CVE-2025-8869** - Mitigated pip symbolic link vulnerability by upgrading to pip >=25.0

## [1.1.1] - 2025-10-04

### Fixed
- **F-String Syntax** - Fixed Python syntax error preventing builds on clean environments

## [1.1.0] - 2025-10-04

### Added
- **Entry Relationships** - Link entries with typed relationships (references, implements, clarifies, evolves_from, response_to)
- **New Tool:** `link_entries` - Create relationships between entries
- **New Tool:** `visualize_relationships` - Generate Mermaid diagrams of entry connections
- **New Resource:** `memory://graph/recent` - Live relationship graph visualization
- **New Prompts:** `find-related`, `get-context-bundle`
- **Soft Delete** - Entries can be soft-deleted and recovered
- **Database Schema Enhancements** - `relationships` table, `deleted_at` column

### Fixed
- **Database Locking** - Eliminated race conditions in concurrent tag updates
- **Thread Safety** - Single-connection transactions prevent conflicts

### Changed
- **Performance:** 10x faster startup (14s → 2-3s) through lazy loading of ML dependencies
- **Optimized Database:** Removed expensive PRAGMA operations from startup

### Documentation
- Created comprehensive GitHub Wiki (17 pages)
- Enhanced README with feature overview
- Added Docker Hub README

## [1.0.2] - 2025-09-15

### Initial Beta Release
- 13 MCP tools for journal management
- Triple search system (FTS5, date range, semantic)
- 6 workflow prompts
- 2 MCP resources
- Git and GitHub CLI integration
- SQLite FTS5 full-text search
- Optional FAISS semantic search

[Unreleased]: https://github.com/neverinfamous/memory-journal-mcp/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/neverinfamous/memory-journal-mcp/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/neverinfamous/memory-journal-mcp/compare/v1.1.3...v1.2.0
[1.1.3]: https://github.com/neverinfamous/memory-journal-mcp/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/neverinfamous/memory-journal-mcp/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/neverinfamous/memory-journal-mcp/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/neverinfamous/memory-journal-mcp/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v1.0.2

