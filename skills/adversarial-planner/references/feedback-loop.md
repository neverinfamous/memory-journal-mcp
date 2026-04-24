# Feedback Loop & Documentation

Reference for journaling, cross-session learning, and retrospective patterns
used throughout the adversarial planning protocol.

## Journal Entry Templates

Each phase of the protocol creates a journal entry using `create_entry`. The
structured entry types and tags enable precise retrieval in future sessions.

### Phase 1 — Plan Draft

```
create_entry({
  content: "# Plan Draft: [Title]\n\n[full plan content]",
  entry_type: "plan_draft",
  tags: ["adversarial-planner", "plan-draft"],
  issue_number: <GitHub issue if applicable>,
  project_number: <project number if applicable>
})
```

### Phase 2 — Adversarial Review

```
create_entry({
  content: "# Adversarial Review: [Title]\n\nOverall Score: X/5.0\n\n[critique table and scores]",
  entry_type: "adversarial_review",
  tags: ["adversarial-planner", "review"],
  issue_number: <same issue>
})
```

### Phase 3 — Plan Refinement

```
create_entry({
  content: "# Plan Refinement: [Title]\n\n[disposition table + updated sections]",
  entry_type: "plan_refinement",
  tags: ["adversarial-planner", "refinement"],
  issue_number: <same issue>
})
```

### Phase 4 — Copilot Validation

```
create_entry({
  content: "# Copilot Validation: [Title]\n\n[copilot findings + final dispositions]",
  entry_type: "copilot_validation",
  tags: ["adversarial-planner", "copilot"],
  issue_number: <same issue>
})
```

## Linking Entries

Connect planning entries to each other and to related work using relationships:

```
link_entries({
  from_entry_id: <review_entry_id>,
  to_entry_id: <draft_entry_id>,
  relationship_type: "references",
  description: "Adversarial review of plan draft"
})

link_entries({
  from_entry_id: <refinement_entry_id>,
  to_entry_id: <review_entry_id>,
  relationship_type: "evolves_from",
  description: "Refined plan based on adversarial review findings"
})

link_entries({
  from_entry_id: <implementation_entry_id>,
  to_entry_id: <refinement_entry_id>,
  relationship_type: "implements",
  description: "Implementation of approved adversarial plan"
})
```

## Cross-Session Learning

Before starting a new plan, search for prior planning sessions to avoid
repeating past mistakes and to reuse successful patterns.

### Find Prior Plans in the Same Domain

```
search_entries({
  query: "<feature area or component name>",
  entry_type: "plan_draft",
  tags: ["adversarial-planner"]
})
```

### Find Recurring Review Findings

If the same critique comes up repeatedly across plans, it signals a systemic
pattern worth addressing at the architecture level:

```
search_entries({
  query: "<recurring issue, e.g., 'missing auth check'>",
  entry_type: "adversarial_review",
  tags: ["adversarial-planner", "review"]
})
```

### Find Plans for a Specific Issue

```
search_entries({
  query: "plan",
  issue_number: <issue_number>,
  tags: ["adversarial-planner"]
})
```

## Session Retrospective

After completing a full planning cycle (all 4 phases), create a retrospective
entry summarizing key insights from both agents and Copilot. This is the
primary mechanism for building institutional knowledge about planning quality.

### Retrospective Template

```
create_entry({
  content: "# Adversarial Planning Retrospective: [Title]\n\n## Key Insights\n- [What the planner missed that the reviewer caught]\n- [What Copilot caught that internal review missed]\n- [Patterns worth institutionalizing]\n\n## Metrics\n- Initial plan score: X/5.0\n- Final plan score: Y/5.0\n- Refinement passes: N\n- Critical findings addressed: M\n\n## Process Improvements\n- [Adjustments for future planning cycles]",
  entry_type: "retrospective",
  tags: ["adversarial-planner", "retrospective", "session-summary"],
  project_number: <project number>
})
```

## Tag Convention

| Tag | Purpose |
|-----|---------|
| `adversarial-planner` | All entries from this skill (primary filter) |
| `plan-draft` | Phase 1 output |
| `review` | Phase 2 output |
| `refinement` | Phase 3 output |
| `copilot` | Phase 4 output |
| `retrospective` | Post-cycle summary |
| `session-summary` | Enables retrieval via session summary searches |
