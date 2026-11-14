# Core Operations
- **Workspace & Project Isolation**: Always pass explicit `workspace_id` and `project_number` on writes (read `memory://briefing/{+repo}` at session start or `memory://agent-context/{+repo}` mid-task). `mj.core.createEntry` / `create_entry` indexes HNSW vector embeddings and `anchors` immediately; set `share_with_team: true` on reusable cross-repo patterns.

### Session Summaries

Prefer `mj.core.createEntry` / `create_entry` (or `memory-journal-mcp entry create` in the terminal with `--type retrospective --tags session-summary`). Requirements:

- `entry_type: "retrospective"` and `tags: ["session-summary", ...]`
- Content MUST contain **only** these 4 exact H2 headers (no extra or duplicate H2 sections):
  - `## Accomplished`
  - `## Unfinished / Blocked`
  - `## Context for Next Session`
  - `## Commits`
- `workspace_id`, `project_number`, `session_id`, `impact_score`, `trust_score`, and `validation_status`
- `relationships: [{ targetId, relationType }]` (or `--related-to` / `--rel` in CLI) linking related tasks, decisions, or preceding summaries
- `auto_context: { commits: ["<sha>"] }` (`--auto-context` in CLI) **when commits occurred during the session**; **omit `auto_context` on zero-commit sessions**

Do NOT create session summaries for testing passes where everything passed and no code changes were made. Only summarize sessions with substantive work.

### Entry Type Selection

Choose the correct `entry_type` — do NOT default everything to `personal_reflection`:

- `retrospective` — Session summaries, certification reports, any "what was accomplished" recap
- `bug_fix` — Specific bug identification and/or resolution
- `project_decision` — Architecture decisions, pattern adoptions, technology choices
- `planning` — Roadmaps, sprint plans, project initialization
- `code_review` — Security audits, code quality reviews, copilot findings
- `technical_note` — Implementation notes, gotchas, reference documentation
- `feature_implementation` — New feature completions
- `research` — Investigation, benchmarking, evaluation of alternatives
- `meeting_notes` — Meeting minutes, sync notes, discussion summaries
- `learning` — Lessons learned, tutorials completed, skill acquisition
- `standup` — Daily standup notes, status updates
- `milestone` — Major project milestones, release checkpoints
- `technical_achievement` — Significant technical accomplishments
- `enhancement` — Incremental improvements, optimizations
- `development_note` — Day-to-day development context and progress
- `system_integration_test` — Full integration/e2e test results
- `test_entry` — Automated or manual test results
- `plan_draft` — Initial drafts of implementation plans
- `adversarial_review` — Reviews and critiques from adversarial subagents
- `plan_refinement` — Refinements to plans based on reviews
- `plan_finalized` — Finalized implementation plans after review
- `copilot_validation` — Validation of copilot suggestions
- `maintenance` — Scheduled or manual database optimization, CMS consolidation, and infrastructure healing reports
- `other` — Anything that doesn't fit the above categories
- `personal_reflection` — Only for genuinely personal notes that don't fit above

### Tag Taxonomy

Every entry MUST have at least one tag. Use kebab-case exclusively.
Tags are limited to a maximum of 100 characters. Journal entry content is limited to a maximum of 50,000 characters.

- _Activity_: `session-summary`, `certification`, `stress-test`, `bug-fix`, `release`, `audit`, `remediation`, `refactor`
- _Domain_: `security`, `performance`, `architecture`, `code-mode`, `documentation`, `ci-cd`, `github-integration`
- _Tool group_: Name of the tool group being worked on (e.g., `core`, `search`, `github`, `admin`)
- _Pattern_: `split-schema`, `zod`, `error-handling`, `dual-schema`

### Heuristic Scoring Criteria

ALL entries MUST define heuristic scores. Use these explicit thresholds:

- `validation_status`: 
  - `none`: Work completed but not yet explicitly tested/verified.
  - `passed`: Work explicitly validated via tests, manual confirmation, or peer review.
  - `failed`: Work that failed verification or was found to be hallucinatory.
- `trust_score` (Confidence):
  - `0.0 - 0.2`: Suspected hallucination or failed validation.
  - `0.3 - 0.5`: Unverified work, draft plans, or assumptions (Baseline for unverified work).
  - `0.6 - 0.8`: Partially verified or low-risk routine changes.
  - `0.9 - 1.0`: Rigorously verified via automated tests, peer review, or explicitly confirmed by the user.
  - *Note: `trust_score` acts as a multiplier on the entry's importance. Low trust entries will decay and be auto-pruned faster.*
- `impact_score` (Blast Radius):
  - `0.0 - 0.2`: Trivial changes, typos, minor doc updates.
  - `0.3 - 0.5`: Standard feature work, isolated bug fixes.
  - `0.6 - 0.8`: Major new features, cross-module changes.
  - `0.9 - 1.0`: Core architectural shifts, destructive operations, critical security patches.

### Significance Marking

Mark important entries with `significance_type`:

- `release` — Version deployments
- `milestone` — Major completions (full certification, security audit, feature launch)
- `decision` — Technology or process decisions
- `architecture` — Architecture decisions, pattern adoptions, structural changes
- `blocker_resolved` — Critical blockers that were resolved
- `lesson_learned` — Documented lessons from failures or unexpected outcomes
- `breakthrough` — Significant technical or conceptual breakthroughs
- `security` — Security audit completions, vulnerability remediations, hardening milestones

Do NOT mark routine session summaries or pass-only testing results as significant.

### Link Entries

Create relationships via `relationships: [{ targetId, relationType }]` (prefer causal types `resolved`, `caused`, `blocked_by`, which carry 20% of the importance score; never use `'caused_by'` — invert source/target or use `'resolved'`/`'evolves_from'`):

- `implements` — implementation→spec, remediation→audit findings
- `resolved` — bugfix→issue that reported the bug
- `evolves_from` — v2→v1, new iteration→prior version
- `references` — cross-project parity work, related entries
- `clarifies` — documentation→implementation it explains
- `response_to` — reply to a question or issue raised in another entry
- `blocked_by` — entry was blocked by another (blocker→resolution)
- `caused` — entry caused or led to another outcome

Only link truly related entries. Do NOT create bulk relationships between unrelated entries that happen to share tags.
- **Opportunistic Superseding (Awake Contradiction Resolution)**: When creating a `project_decision`, `bug_fix`, or `technical_note` that invalidates or replaces an earlier entry surfaced in your briefing or search results, immediately link the new entry to the superseded entry via `evolves_from` or `resolved` so the knowledge graph reflects the superseding chain in real time.
- **File & Symbol Anchors**: Attach `anchors: [{ file_path, symbol_name?, commit_sha? }]` when entries document specific files or symbols, and manage stale anchors with `mark_anchors_stale({ updates: [{ id, status }] })`.

### Git Commit Standards

When committing changes to a repository:

- **Commit Journaling**: Record a corresponding `commit-narrative` journal entry containing `auto_context: { "commits": ["<sha>"] }` along with accurate heuristic scores (`impact_score`, `trust_score`, `validation_status`). If your workspace provides a `commit.ts` wrapper (e.g. `.agents/scripts/commit.ts`), append `--journal` to automate this step; otherwise use standard `git commit` and log the entry via `mj_execute_code`, `create_entry`, or `memory-journal-mcp entry create`.
- **Scoring**: Provide accurate scores (`0.1-1.0`) for blast radius (`impact_score`) and verification level (`trust_score`). **NEVER "rubber stamp" 1.0** without rigorous validation; accurately reflect verification.
- **Validation**: Provide `validation_status` (`passed`, `failed`, or `none`).

## Available Tools

- **Entry Lifecycle**: `create_entry`, `get_entry_by_id`, `get_recent_entries`, `get_entry_history`
- **Taxonomy & Graph**: `list_tags`, `mark_anchors_stale`
- **Testing Tools**: `test_simple`, `test_error_handling`, `trigger_progress`

