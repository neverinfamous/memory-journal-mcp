# memory-journal-mcp

## Quick Access

| Purpose         | Action                      |
| --------------- | --------------------------- |
| Session context | `memory://briefing`         |
| Recent entries  | `memory://recent`           |
| Health/time     | `memory://health`           |
| Metrics/Summary | `memory://metrics/summary`  |
| Metrics/Latency | `memory://metrics/latency`  |
| Resource reads  | `memory://metrics/resources`|
| Report history  | `memory://insights/reports` |
| Full context    | `get-context-bundle` prompt |

## Help Resources

Read `memory://help` for tool group index and available help resources.
Read `memory://help/{group}` for per-group tool reference (parameters, annotations, examples).
Only help resources for your enabled tool groups are registered.

## Behaviors

### Essential Session Start

1. You **MUST** read the `memory://briefing/{repo_name}` at the start of each chat!
2. Use the standard MCP `read_resource` tool for this (do NOT use Code Mode/execute_code).
3. Infer the `repo_name` from the user's prompt or your active workspace context.
4. **RENDER BRIEFING**: The briefing resource returns a pre-formatted Markdown string containing any active flags and a dense 2-column context table. You MUST output this exact string as your response without any modifications.
5. **REVIEW ALERTS**: Pay special attention to any active flags listed at the top of the briefing. Do NOT truncate any summaries or issues.
6. **STOP & WAIT**: Do NOT autonomously resume past tasks or start work on new issues. The briefing is strictly for context.

- **AntiGravity**: Tools are `mcp_{name}_{tool}` → server name = `memory-journal-mcp`
- **Cursor**: Tools are `user-{name}-{tool}` → server name = `user-memory-journal-mcp`
- **Other clients**: Use configured name exactly. Use tool-prefix discovery if unsure.

### Journal Behaviors

- **Strict Validation**: The `project_number` parameter is STRICTLY REQUIRED for all mutation operations (Create, Update, Delete). You must always explicitly provide it to prevent accidental miscategorization. You will receive a `VALIDATION_ERROR` if it is omitted.
- **Personal vs Team**: **ALWAYS use the personal journal** (e.g., `create_entry`) by default. ONLY save to the team journal (e.g., `team_create_entry`) if the user explicitly requests it.
- **Entry History**: Every modification to an entry creates a revision. Use `get_entry_history` to view past versions and changes of an entry. When updating entries, consider passing `expected_version` to use optimistic locking and avoid overwriting concurrent edits.
- **Soft-Delete & Recovery**: Entries can be soft-deleted and restored via `restore_entry` or `team_restore_entry`. Use `list_deleted_entries` or `team_list_deleted_entries` to discover soft-deleted entries. Entries can also be archived (`is_archived = 1`) to preserve them in history while excluding them from normal search queries.
- **Batch Operations**: Use `batch_create_entries`, `batch_update_entries`, and `batch_delete_entries` (or team equivalents) to process bulk data up to 50 entries per transaction. Use `auto_index` to rebuild the vector index for these entries.
- **External Imports**: Use `import_external` and `team_import_external` to ingest knowledge management exports from Notion, Obsidian, or Logseq. These tools normalize wikilinks, YAML frontmatter, and block hierarchies seamlessly. Use `dry_run` to preview the parsed structure.
- **Admin & Telemetry**: Use `update_configuration` to dynamically change the server's instruction level, tool filters, or briefing preferences without restarting. Use `search_audit_log` to query operational telemetry and investigate incidents across all active and rotated JSONL audit files. You can filter by `tool_name`, `user`, `date_range`, `status`, or `category`. Both the audit logs and the `memory://metrics/summary` resource reflect precise, content-type-aware token consumption estimates.
- **Create entries for**: implementations, decisions, bug fixes, milestones, user requests to "remember"
- **Search before**: major decisions, referencing prior work, understanding project context. Use `sort_by: "importance"` on `search_entries`, `get_recent_entries`, or `search_by_date_range` to surface structurally significant entries. Use the `mode` parameter (`auto`, `fts`, `semantic`, `hybrid`) to control search strategy. The `fts` and `hybrid` modes include Levenshtein distance typo-tolerance fallback (via `fuzzy_match` and `auto_correct`), making searches more resilient to misspellings.
- **Analyze insights**: Use cross-project insights (`get_cross_project_insights`) and cross-team search (`cross_team_search`) before defining architectures spanning multiple teams or DBs. Use `team_get_collaboration_matrix` to evaluate team health, cross-author activity patterns, and collaboration impact. Use repo insights (`memory://github/insights`) to gauge traction. View `memory://insights/digest` and `memory://insights/team-collaboration` for automated analytics snapshots. Access aggregate server metrics via `memory://metrics/summary`, per-tool telemetry and latency percentiles via `memory://metrics/latency`, and resource read frequency via `memory://metrics/resources`.

### Auto-Prune

On server startup, the auto-prune system implements a graduated data lifecycle (Active → Archived → Soft-Deleted → Hard-Deleted) for old entries with low significance scores.
- **Configurable Thresholds**: Controlled via `--archive-older-than-days`, `--prune-older-than-days` (soft-delete), `--hard-delete-older-than-days`, and `--prune-importance-threshold`.
- **Exclusion Rules**: Specific tags can be exempted from auto-pruning using `--prune-exclude-tags <tags>` (e.g. `architecture`, `never-prune`).
- **Dry Run**: Server administrators can preview what would be processed without mutating the database by using the `--prune-dry-run` flag.

### Scheduled Reports

When deployed in HTTP mode with `--report-interval <minutes>` and `--report-webhook-url <url>`, the server periodically generates digest reports and delivers them to the configured webhook. Reports include activity trends, significance highlights, stale project warnings, and top-importance entries.

- **Formats**: `slack` (default, `{"text":"<markdown>"}`), `discord` (`{"content":"<markdown>"}`), or `json` (raw DigestSnapshot payload).
- **Report history**: Read `memory://insights/reports` to view the last 5 generated reports and their delivery status.
- **Independent from digest**: The `report` job is separate from the `digest` analytics job. You can run one without the other.

### Real-Time Subscriptions

The server supports the standard MCP `resources/subscribe` capability. You can subscribe to team resources (e.g., `memory://team/recent`, `memory://flags`, and `memory://briefing`) to receive real-time `notifications/resources/updated` notifications when other agents or team members mutate shared data. Note that subscriptions are scope-authorized; your session must possess the required scope (e.g., `team` or `admin`) for the target resource, or the subscription will be rejected with a `PermissionError`.

### Team RBAC & Access Control

The team database features a Role-Based Access Control (RBAC) system for team members:
- **Roles**: 
  - `viewer`: Read-only access to all team data.
  - `member`: Read all, Create/Edit/Delete *own* entries, resolve own flags.
  - `admin`: Read/Write/Delete *all* entries and flags, manage team members, rebuild vector indexes, backup data.
- **Bootstrap Workflow**: The RBAC system is inactive until the first member is added. The first time `team_add_member` is called, the caller is automatically registered as an `admin`. Alternatively, the server can be bootstrapped via the `TEAM_ADMIN` environment variable or `--team-admin` CLI flag. Unregistered authors fall back to the configured `TEAM_DEFAULT_ROLE`.
- **Managing Members**: Admins can manage members using `team_add_member`, `team_remove_member`, `team_update_member_role`, `team_list_members`, and `team_get_member`. 
- **Author Aliases**: Admins can manage author aliases to consolidate attribution for team analytics when one person uses multiple usernames using `team_add_author_alias`, `team_list_author_aliases`, `team_resolve_author`, `team_remove_author_alias`, and `team_consolidate_authors`.
- **OAuth Scopes**: OAuth scopes (read/write/admin) govern broad HTTP endpoint access. RBAC roles govern fine-grained internal tool capabilities. Both must be satisfied when OAuth is active.

### Session Summaries

Use `create_entry` to record session summaries. Required fields:

- `entry_type: "retrospective"`
- `tags: ["session-summary"]` (plus relevant domain/activity tags)
- `project_number` from the briefing

Content MUST follow this EXACT structure (no extra top-level sections):

```
## Accomplished
- [concrete items done this session]

## Unfinished / Blocked
- [remaining items or "None"]

## Context for Next Session
- [entry IDs, branch names, PR numbers, pending decisions]
```

Do NOT add sections like "## Summary", "## Overview", "## Notes", or any other
top-level headers. Do NOT omit any of the three required sections.

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
- `adversarial_review` — Adversarial audit findings, red-team results
- `plan_draft` — Draft plans awaiting review or refinement
- `plan_refinement` — Iterated plan revisions based on feedback
- `copilot_validation` — Copilot review validation results
- `system_integration_test` — Integration test runs and results
- `test_entry` — Test data or test-related entries
- `flag` — Auto-assigned by Hush Protocol tools (`team_pass_flag`). Do NOT set manually.
- `other` — Anything that doesn't fit the above categories
- `personal_reflection` — Only for genuinely personal notes that don't fit above

### Tag Taxonomy

Every entry MUST have at least one tag. Use kebab-case exclusively.

- _Activity_: `session-summary`, `certification`, `stress-test`, `bug-fix`, `release`, `audit`, `remediation`, `refactor`
- _Domain_: `security`, `performance`, `architecture`, `code-mode`, `documentation`, `ci-cd`, `github-integration`
- _Tool group_: Name of the tool group being worked on (e.g., `core`, `search`, `github`, `admin`)
- _Pattern_: `split-schema`, `zod`, `error-handling`, `dual-schema`

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

Create relationships to build traversable context chains:

- `implements` — implementation→spec, remediation→audit findings
- `resolved` — bugfix→issue that reported the bug
- `evolves_from` — v2→v1, new iteration→prior version
- `references` — cross-project parity work, related entries
- `clarifies` — documentation→implementation it explains
- `response_to` — reply to a question or issue raised in another entry
- `blocked_by` — entry was blocked by another (blocker→resolution)
- `caused` — entry caused or led to another outcome

Only link truly related entries. Do NOT create bulk relationships between unrelated entries that happen to share tags.
