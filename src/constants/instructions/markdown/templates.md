# Content Templates

The `Session Summary` 4-section H2 structure below is schema-enforced when tag `session-summary` (`entry_type: "retrospective"`) is set. All other templates represent recommended conventions by `entry_type`.

## Session Summary (entry_type: "retrospective", tag: "session-summary")

```
## Accomplished
- [Concrete item: what was done, key files/PRs/entry IDs]
- [Another concrete item]

## Unfinished / Blocked
- [Item: why it's blocked or what remains — or "None" if complete]

## Context for Next Session
- [Key context the next agent/session needs: branch names, PR numbers, entry IDs, pending decisions]

## Commits
- `<sha>` — [Brief commit summary or "None"]
```

Do NOT add extra top-level H2 sections (no "## Summary", "## Overview", "## Notes").
Do NOT omit any of the four required sections.
Include `auto_context: { commits: ["<sha>"] }` when commits were made during the session; omit `auto_context` on zero-commit sessions.

## Project Decision (entry_type: "project_decision", significance_type: "architecture" | "decision")

```
## Context
[Problem statement, constraints, and alternatives considered]

## Decision
- [Chosen architecture or pattern and why]

## Consequences
- [Tradeoffs, invariants, and superseded entries via `evolves_from` / `resolved`]
```

## Feature Implementation (entry_type: "feature_implementation")

```
## Summary
[1-2 sentence description of the feature]

## Changes
- [File/module]: [what changed]

## Testing
- [How it was tested, results]

## Notes
- [Any gotchas, follow-ups, or related entries]
```

## Bug Fix (entry_type: "bug_fix")

```
## Problem
[What was broken and how it manifested]

## Root Cause
[Why it happened]

## Fix
- [What was changed to fix it]

## Verification
- [How the fix was verified]
```

## Planning (entry_type: "planning")

```
## Goal
[What this plan aims to achieve]

## Approach
- [Step or phase]: [description]

## Open Questions
- [Unresolved decisions or dependencies]
```

## Technical Note (entry_type: "technical_note")

```
## Topic
[What this note documents]

## Details
[Technical explanation, code patterns, configuration]

## References
- [Related entries, docs, or external links]
```

## General Rule

For any entry type not listed above, structure content with:
1. A clear `##` heading describing the main topic
2. Bullet points for discrete items
3. No invented sections beyond what the content actually covers