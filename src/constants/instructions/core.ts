export const CORE_HELP = `# Core Operations
- **Workspace Isolation**: When creating or reading entries, consider the \`workspace_id\` parameter. If a default workspace is active, entries are automatically scoped to it unless explicitly overridden.

### Session Summaries

Use the \`memory-journal-mcp entry create\` terminal command to record session summaries. You MUST provide the markdown content via \`--content "<string>"\` or \`--file <path>\` (or pipe to stdin). Required fields:

- \`--type retrospective\`
- \`--tags session-summary\` (plus relevant domain/activity tags, comma-separated)
- \`--project\` from the briefing
- \`--impact-score\`, \`--trust-score\`, and \`--validation-status\` MUST be evaluated and populated.
- \`--related-to\` MUST be populated with IDs of related tasks, architectural plans, or preceding summaries.
- \`--auto-context\` MUST be populated with a concise JSON payload representing the context (e.g. \`{ "commits": ["abc1234", "def5678"] }\`)

Do NOT create session summaries for testing passes where everything passed and no code changes were made. Only summarize sessions with substantive work.

### Entry Type Selection

Choose the correct \`entry_type\` — do NOT default everything to \`personal_reflection\`:

- \`retrospective\` — Session summaries, certification reports, any "what was accomplished" recap
- \`bug_fix\` — Specific bug identification and/or resolution
- \`project_decision\` — Architecture decisions, pattern adoptions, technology choices
- \`planning\` — Roadmaps, sprint plans, project initialization
- \`code_review\` — Security audits, code quality reviews, copilot findings
- \`technical_note\` — Implementation notes, gotchas, reference documentation
- \`feature_implementation\` — New feature completions
- \`research\` — Investigation, benchmarking, evaluation of alternatives
- \`meeting_notes\` — Meeting minutes, sync notes, discussion summaries
- \`learning\` — Lessons learned, tutorials completed, skill acquisition
- \`standup\` — Daily standup notes, status updates
- \`milestone\` — Major project milestones, release checkpoints
- \`technical_achievement\` — Significant technical accomplishments
- \`enhancement\` — Incremental improvements, optimizations
- \`development_note\` — Day-to-day development context and progress
- \`system_integration_test\` — Full integration/e2e test results
- \`test_entry\` — Automated or manual test results
- \`plan_draft\` — Initial drafts of implementation plans
- \`adversarial_review\` — Reviews and critiques from adversarial subagents
- \`plan_refinement\` — Refinements to plans based on reviews
- \`copilot_validation\` — Validation of copilot suggestions
- \`other\` — Anything that doesn't fit the above categories
- \`personal_reflection\` — Only for genuinely personal notes that don't fit above

### Tag Taxonomy

Every entry MUST have at least one tag. Use kebab-case exclusively.
Tags are limited to a maximum of 100 characters. Journal entry content is limited to a maximum of 50,000 characters.

- _Activity_: \`session-summary\`, \`certification\`, \`stress-test\`, \`bug-fix\`, \`release\`, \`audit\`, \`remediation\`, \`refactor\`
- _Domain_: \`security\`, \`performance\`, \`architecture\`, \`code-mode\`, \`documentation\`, \`ci-cd\`, \`github-integration\`
- _Tool group_: Name of the tool group being worked on (e.g., \`core\`, \`search\`, \`github\`, \`admin\`)
- _Pattern_: \`split-schema\`, \`zod\`, \`error-handling\`, \`dual-schema\`

### Heuristic Scoring Criteria

ALL entries MUST define heuristic scores. Use these explicit thresholds:

- \`validation_status\`: 
  - \`none\`: Work completed but not yet explicitly tested/verified.
  - \`passed\`: Work explicitly validated via tests, manual confirmation, or peer review.
  - \`failed\`: Work that failed verification or was found to be hallucinatory.
- \`trust_score\` (Confidence):
  - \`0.0 - 0.2\`: Suspected hallucination or failed validation.
  - \`0.3 - 0.5\`: Unverified work, draft plans, or assumptions (Baseline for unverified work).
  - \`0.6 - 0.8\`: Partially verified or low-risk routine changes.
  - \`0.9 - 1.0\`: Rigorously verified via automated tests, peer review, or explicitly confirmed by the user.
  - *Note: \`trust_score\` acts as a multiplier on the entry's importance. Low trust entries will decay and be auto-pruned faster.*
- \`impact_score\` (Blast Radius):
  - \`0.0 - 0.2\`: Trivial changes, typos, minor doc updates.
  - \`0.3 - 0.5\`: Standard feature work, isolated bug fixes.
  - \`0.6 - 0.8\`: Major new features, cross-module changes.
  - \`0.9 - 1.0\`: Core architectural shifts, destructive operations, critical security patches.

### Significance Marking

Mark important entries with \`significance_type\`:

- \`release\` — Version deployments
- \`milestone\` — Major completions (full certification, security audit, feature launch)
- \`decision\` — Technology or process decisions
- \`architecture\` — Architecture decisions, pattern adoptions, structural changes
- \`blocker_resolved\` — Critical blockers that were resolved
- \`lesson_learned\` — Documented lessons from failures or unexpected outcomes
- \`breakthrough\` — Significant technical or conceptual breakthroughs
- \`security\` — Security audit completions, vulnerability remediations, hardening milestones

Do NOT mark routine session summaries or pass-only testing results as significant.

### Link Entries

Create relationships to build traversable context chains:

- \`implements\` — implementation→spec, remediation→audit findings
- \`resolved\` — bugfix→issue that reported the bug
- \`evolves_from\` — v2→v1, new iteration→prior version
- \`references\` — cross-project parity work, related entries
- \`clarifies\` — documentation→implementation it explains
- \`response_to\` — reply to a question or issue raised in another entry
- \`blocked_by\` — entry was blocked by another (blocker→resolution)
- \`caused\` — entry caused or led to another outcome

Only link truly related entries. Do NOT create bulk relationships between unrelated entries that happen to share tags.

### Git Commit Standards

When committing changes to the repository, you MUST use the \`commit.ts\` wrapper (e.g. \`bun .agents/scripts/commit.ts\`) rather than raw \`git commit\`. 

- **Automated Journaling**: ALWAYS append the \`--journal\` flag to your commit command. This automatically spins up the \`memory-journal-mcp\` CLI in the background to log your commit as a structured entry.
- **Scoring**: You must provide accurate scores: \`--impact <0.1-1.0>\` (blast radius) and \`--confidence <0.1-1.0>\` (verification level). **NEVER "rubber stamp" 1.0** without rigorous validation; accurately reflect verification.
- **Category & Validation**: Provide \`--category <Category>\` and \`--validation <passed|failed|none>\`.

Example:
\`bun .agents/scripts/commit.ts --msg "refactor(core): adhere to 500-line modularity rule" --category Changed --confidence 0.8 --impact 0.4 --validation passed --journal --add src/\`

## Available Tools

- **Entry Lifecycle**: \`create_entry\`, \`get_entry_by_id\`, \`get_recent_entries\`, \`get_entry_history\`
- **Taxonomy & Graph**: \`list_tags\`, \`mark_anchors_stale\`
- **Testing Tools**: \`test_simple\`, \`test_error_handling\`, \`trigger_progress\`

`;
