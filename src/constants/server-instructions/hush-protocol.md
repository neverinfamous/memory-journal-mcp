# Hush Protocol (Team Flags)

Flags are machine-actionable signals stored in the team database. They replace Slack/Teams noise with structured, searchable entries that surface automatically in the briefing.

**When to create a flag** (`team_pass_flag` — accepts required `flag_type`, `message`, `project_number`, and optional `target_user`, `link`, `issue_number`):

- `blocker` — work is blocked and requires another person's action
- `needs_review` — code, document, or decision needs peer review
- `help_requested` — stuck and need guidance or pairing
- `fyi` — non-blocking awareness signal (completed migration, config change, etc.)

**When to resolve** (`team_resolve_flag`): After the blocking condition is cleared. Include a brief resolution comment describing what was done. Resolving is idempotent — safe to call on already-resolved flags.

**Briefing integration**: The `memory://briefing` payload includes `activeFlags` when unresolved flags exist. The user's agent rules may instruct you to render these prominently. Always check for and acknowledge active flags at session start.

**Dashboard**: Read `memory://flags` to see all active (unresolved) flags. Read `memory://flags/vocabulary` to see the configured flag types.

**Triage prompt**: Use the `flag-dashboard` prompt to triage active flags with priority assessment, staleness detection, and resolution guidance.

**Code Mode**: `mj.team.passTeamFlag({ project_number: 1, flag_type, message, target_user })` and `mj.team.resolveTeamFlag({ flag_id })`.
