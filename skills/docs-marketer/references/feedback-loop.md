# Feedback Loop & Documentation

Reference for journaling, cross-session learning, and retrospective patterns
used throughout the documentation marketing audit protocol.

## Journal Entry Templates

### Phase 1 — Document Surface Inventory

```
create_entry({
  content: "# Docs Marketing Profile: [Repository]\n\nSurfaces audited: N\nAverage score: X.X/5.0\n\n[per-surface scorecards + feature visibility gap analysis + portfolio overview]",
  entry_type: "docs_marketing_profile",
  tags: ["docs-marketer", "profile"],
  project_number: <project number>
})
```

### Phase 2 — Skeptical Reader Review

```
create_entry({
  content: "# Skeptical Reader Review: [Repository]\n\nOverall Score: X/5.0 — Grade Y\n\n[30-second test + competitive evaluation + under-marketed features + findings]",
  entry_type: "docs_marketing_critique",
  tags: ["docs-marketer", "critique"],
  project_number: <project number>
})
```

### Phase 3 — Improvement Plan

```
create_entry({
  content: "# Docs Improvement Plan: [Repository]\n\n[disposition table + priority tiers + projected improvements]",
  entry_type: "docs_marketing_remediation",
  tags: ["docs-marketer", "remediation"],
  project_number: <project number>
})
```

### Phase 4 — Copilot Validation

```
create_entry({
  content: "# Copilot Docs Validation: [Repository]\n\n[copilot findings + dispositions]",
  entry_type: "docs_marketing_copilot",
  tags: ["docs-marketer", "copilot"],
  project_number: <project number>
})
```

### Final Summary

```
create_entry({
  content: "# Docs Marketing Audit Complete: [Repository]\n\nPortfolio Score: X.X/5.0 (Grade Y)\nSurfaces audited: N\nGrade distribution: A: N, B: N, C: N, D: N, F: N\n\n## Key Findings\n- [top 3 findings]\n\n## Improvements Planned\n- [accepted dispositions]\n\n## Feature Visibility Gaps\n- [gap summary]",
  entry_type: "docs_marketing_complete",
  tags: ["docs-marketer", "audit-complete", "session-summary"],
  project_number: <project number>
})
```

## Linking Entries

```
link_entries({
  from_entry_id: <critique_entry_id>,
  to_entry_id: <profile_entry_id>,
  relationship_type: "references",
  description: "Skeptical reader review of documentation inventory"
})

link_entries({
  from_entry_id: <remediation_entry_id>,
  to_entry_id: <critique_entry_id>,
  relationship_type: "evolves_from",
  description: "Improvement plan based on marketing critique"
})

link_entries({
  from_entry_id: <current_audit_id>,
  to_entry_id: <prior_audit_id>,
  relationship_type: "evolves_from",
  description: "Follow-up audit tracking documentation marketing evolution"
})
```

## Cross-Session Learning

### Find Prior Docs Marketing Audits

```
search_entries({
  query: "docs marketing audit",
  entry_type: "docs_marketing_profile",
  tags: ["docs-marketer"]
})
```

### Track Marketing Quality Trends

Compare scores across audits to measure improvement:

```
search_entries({
  query: "docs marketing audit complete",
  entry_type: "docs_marketing_complete",
  tags: ["docs-marketer", "audit-complete"]
})
```

### Find Recurring Marketing Issues

```
search_entries({
  query: "<issue type, e.g., 'feature visibility gap'>",
  entry_type: "docs_marketing_critique",
  tags: ["docs-marketer"]
})
```

## Session Retrospective

```
create_entry({
  content: "# Docs Marketing Audit Retrospective: [Repository]\n\n## Key Insights\n- [Under-marketed features the audit surfaced]\n- [First impression weaknesses that surprised us]\n- [Cross-surface consistency patterns]\n\n## Metrics\n- Initial average score: X.X/5.0\n- Projected average score: X.X/5.0\n- Feature visibility gaps: N\n- Surfaces needing major work: N\n- Quick wins identified: N\n\n## Process Improvements\n- [Categories to emphasize next time]\n- [New evaluation prompts to add]",
  entry_type: "retrospective",
  tags: ["docs-marketer", "retrospective", "session-summary"],
  project_number: <project number>
})
```

## Tag Convention

| Tag | Purpose |
| --- | --- |
| `docs-marketer` | All entries from this skill (primary filter) |
| `profile` | Phase 1 output |
| `critique` | Phase 2 output (adversarial mode only) |
| `remediation` | Phase 3 output |
| `copilot` | Phase 4 output |
| `audit-complete` | Final consolidated summary |
| `retrospective` | Post-cycle review |
| `session-summary` | Enables retrieval via session summary searches |

## Entry Type Reference

| Entry Type | Phase | Description |
| --- | --- | --- |
| `docs_marketing_profile` | 1 | Per-surface scorecards and feature visibility gaps |
| `docs_marketing_critique` | 2 | Skeptical reader review (adversarial mode only) |
| `docs_marketing_remediation` | 3 | Improvement plan with dispositions |
| `docs_marketing_copilot` | 4 | Copilot validation findings |
| `docs_marketing_complete` | Final | Consolidated audit summary |
| `retrospective` | Post | Session retrospective with metrics |
