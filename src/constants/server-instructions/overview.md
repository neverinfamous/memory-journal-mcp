# memory-journal-mcp

## Quick Access

| Purpose         | Action                      |
| --------------- | --------------------------- |
| Session context | `memory://briefing`         |
| Recent entries  | `memory://recent`           |
| Health/time     | `memory://health`           |
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

- **Strict Validation**: The `project_number` parameter is STRICTLY REQUIRED for almost all core and team tool operations (e.g., `create_entry`, `search_entries`, `team_update_entry`). You will receive a `VALIDATION_ERROR` if you omit it.
- **Personal vs Team**: **ALWAYS use the personal journal** (e.g., `create_entry`) by default. ONLY save to the team journal (e.g., `team_create_entry`) if the user explicitly requests it.
- **Create entries for**: implementations, decisions, bug fixes, milestones, user requests to "remember"
- **Search before**: major decisions, referencing prior work, understanding project context. Use `sort_by: "importance"` on `search_entries`, `get_recent_entries`, or `search_by_date_range` to surface structurally significant entries (decisions, milestones, highly-connected nodes) over simply recent ones.
- **Analyze insights**: Use cross-project insights (`get_cross_project_insights`) before defining architectures. Use `team_get_collaboration_matrix` to evaluate team health, cross-author activity patterns, and collaboration impact. Use repo insights (`memory://github/insights`) to gauge traction. View `memory://insights/digest` and `memory://insights/team-collaboration` for automated analytics snapshots.

### Session Summaries

Use `create_entry` to record session summaries. Required fields:

- `entry_type: "retrospective"`
- `tags: ["session-summary"]` (plus relevant domain/activity tags)
- `project_number` from the briefing

Structure content with these sections:

- `## Accomplished` — What was done this session
- `## Unfinished / Blocked` — What remains or what's blocked
- `## Context for Next Session` — Key context the next agent needs

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
