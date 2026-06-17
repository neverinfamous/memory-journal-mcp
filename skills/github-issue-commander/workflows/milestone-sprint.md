---
description: Work through open issues in a GitHub milestone sequentially, applying the issue-triage workflow to each
---

# Milestone Sprint

Work through open issues in a GitHub milestone sequentially, applying the
issue-triage workflow to each.

## Phase 1 — Load Milestone

1. Read `memory://briefing` for session context
2. Fetch milestone details:
   ```
   get_github_milestone({ milestone_number: <N> })
   ```
3. Read priority ordering directly from the centralized Project Control Board:
   ```
   read_resource("memory://kanban/{project_number}")
   ```
   Cross-reference this prioritized sequence with the open milestone issues:
   ```
   get_github_issues({ milestone: <N>, state: "open" })
   ```
4. Journal sprint start:
   ```
   create_entry({
     content: "Starting milestone sprint: <title>. Open issues: <count>. Completion: <percent>%.",
     entry_type: "milestone_sprint_start",
     tags: ["commander", "milestone"],
   })
   ```

## Phase 2 — Triage Issues

For each open issue in the milestone (in priority order):

1. **HITL checkpoint**: Present the next issue to the human:
   - Issue number, title, labels
   - Estimated complexity (based on description and labels)
   - Ask: "Proceed with this issue?" / "Skip?" / "Stop sprint?"

2. If human approves: run the full **issue-triage.md** workflow for this issue

3. After each issue is complete, update the sprint progress:

   ```
   get_github_milestone({ milestone_number: <N> })
   ```

   Report updated completion percentage.

4. Repeat for next issue until:
   - All issues are complete
   - Human chooses to stop
   - Session time/token limits are approached

## Phase 3 — Sprint Summary

After all issues are processed (or sprint is stopped):

1. Aggregate results across all triaged issues:
   - Issues attempted vs. completed
   - Gate results summary (total passes/fails)
   - Security findings across all issues
   - PRs submitted

2. Report milestone delta:

   ```
   get_github_milestone({ milestone_number: <N> })
   ```

   Show completion percentage before and after sprint.

3. Journal sprint summary:

   ```
   create_entry({
     content: "Milestone sprint complete: <title>. Issues fixed: <N>/<total>. Milestone: <before>% → <after>%. PRs: <list>.",
     entry_type: "milestone_sprint_start",
     tags: ["commander", "milestone", "summary"],
   })
   ```

4. Run `/session-summary` with:
   - All issues triaged in this sprint
   - Remaining issues for next session
   - Any blockers or findings requiring human attention
