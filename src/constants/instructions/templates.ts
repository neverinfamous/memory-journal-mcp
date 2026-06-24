export const TEMPLATES_HELP = `# Content Templates

These templates define the REQUIRED structure for journal entry content by type. Do NOT invent additional top-level sections. Do NOT omit required sections.

## Session Summary (entry\\_type: "retrospective", tag: "session-summary")

\`\`\`
## Accomplished
- [Concrete item: what was done, key files/PRs/entry IDs]
- [Another concrete item]

## Commits
- [list of short commit SHAs generated this session]

## Unfinished / Blocked
- [Item: why it's blocked or what remains — or "None" if complete]

## Context for Next Session
- [Key context the next agent/session needs: branch names, PR numbers, entry IDs, pending decisions]
\`\`\`

Do NOT add extra top-level sections (no "## Summary", "## Overview", "## Notes").
Do NOT omit any of the four required sections.
Always remember to populate the \`auto_context\` payload parameter with the session's commit SHAs.

## Feature Implementation (entry\\_type: "feature\\_implementation")

\`\`\`
## Summary
[1-2 sentence description of the feature]

## Changes
- [File/module]: [what changed]

## Testing
- [How it was tested, results]

## Notes
- [Any gotchas, follow-ups, or related entries]
\`\`\`

## Bug Fix (entry\\_type: "bug\\_fix")

\`\`\`
## Problem
[What was broken and how it manifested]

## Root Cause
[Why it happened]

## Fix
- [What was changed to fix it]

## Verification
- [How the fix was verified]
\`\`\`

## Planning (entry\\_type: "planning")

\`\`\`
## Goal
[What this plan aims to achieve]

## Approach
- [Step or phase]: [description]

## Open Questions
- [Unresolved decisions or dependencies]
\`\`\`

## Technical Note (entry\\_type: "technical\\_note")

\`\`\`
## Topic
[What this note documents]

## Details
[Technical explanation, code patterns, configuration]

## References
- [Related entries, docs, or external links]
\`\`\`

## General Rule

For any entry type not listed above, structure content with:
1. A clear \`##\` heading describing the main topic
2. Bullet points for discrete items
3. No invented sections beyond what the content actually covers`;
