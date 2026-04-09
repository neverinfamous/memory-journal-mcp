---
description: Translate an approved epic implementation plan into an agent-actionable GitHub Kanban structure via Milestones and tracked Issues.
---

# /roadmap-kickoff

**Objective**: Translate an approved architectural or implementation plan into an agent-actionable GitHub Kanban structure. This establishes an **Agent Coordination Center** where large epics are safely chunked into distinct, trackable threads.

## Context & Rationale

When an implementation plan requires multiple agent sessions (e.g., crossing token limits, context constraints, or independent phase checkpoints), we use the GitHub Kanban board + Memory Journal MCP as the synchronization layer. 

By anchoring every implementation task to a Milestone and throwing it in the Project Backlog:
1. **Context Integrity**: A fresh agent session can pull down `memory://kanban/{project_number}` or `memory://github/milestones` and immediately know what is up next. 
2. **Parallel Work**: The user can spin up parallel agents operating on distinct project columns/issues.
3. **Decoupling**: The central plan remains the source of truth, while GitHub acts as the execution layer.

---

## Prerequisites
- An agreed-upon **Implementation Plan** or Epic (e.g. `docs/epic-implementation-plan.md`).
- A `gh` CLI token verified to possess the `project` scope (req. for adding to Projects v2 columns). If missing, the user runs: `gh auth refresh -s project`.

---

## Workflow Steps

### 1. Establish the Milestone
Determine the version tag or epic codename from the implementation plan. Create the milestone to anchor the issues.
```bash
// turbo
gh api repos/{owner}/{repo}/milestones -F title="Epic Name (vX.X.X)" -F state="open" -F description="Implementation roadmap..."
```

### 2. Actionable Issue Formulation
Break the implementation plan down into discrete, atomic tracking issues based on the deliverables/phases.
- Each issue body **must** contain enough context (deliverables, acceptance rules, scope) so that an entirely new agent session could pick it up blindly and succeed.

### 3. Generate Tracking Issues
Use the explicit Milestone Title (not the ID) to tie all created issues firmly to the Epic.
```bash
// turbo
gh issue create --repo {owner}/{repo} --title "Feat: Phase X - ..." --body "Full context..." --milestone "Epic Name (vX.X.X)"
```

### 4. Backlog Placement (Crucial)
By default, newly created issues might land unmapped in a Project's "No Status" bucket. You must explicitly move them into the `Backlog`.

**A. Retrieve Node IDs:**
```bash
// turbo
gh project view {project_number} --owner {owner} --format json -q .id
gh project field-list {project_number} --owner {owner} --format json
gh project item-list {project_number} --owner {owner} --format json
```
*Identify the: (1) Project ID, (2) Status Field ID, (3) 'Backlog' Option ID, and (4) The newly created Item Node IDs.*

**B. Update Item Status:** 
```bash
// turbo
gh project item-edit --id {ITEM_NODE_ID} --project-id {PROJECT_NODE_ID} --field-id {STATUS_FIELD_ID} --single-select-option-id {BACKLOG_OPTION_ID}
```

### 5. Orchestration Handoff
- Use the **memory-journal-mcp** server to record a `create_entry` (or `team_create_entry`). Include the milestone link, total breakdown of GitHub issues, and explicitly record the `roadmap_anchored` state, storing the newly registered Project and Board Node IDs.
- Daisy-chain launch (or notify the human to launch) the Sprint Orchestrator by issuing the command: `"Run /milestone-sprint targeting Milestone <X>"`. The orchestration node will pull directly from the initialized Kanban backlog based on the anchored Project Board metrics.
