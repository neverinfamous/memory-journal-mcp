# Feedback Loop & Documentation

Reference for journaling, cross-session learning, and retrospective patterns
used throughout the adversarial skill audit protocol.

## Journal Entry Templates

### Phase 1 — Inventory & Profiling

```
create_entry({
  content: "# Skill Audit Profile: [Directory]\n\nSkills audited: N\nAverage score: X.X/5.0\n\n[per-skill scorecards + directory overview]",
  entry_type: "skill_audit_profile",
  tags: ["adversarial-skill-audit", "profile"],
  project_number: <project number>
})
```

### Phase 2 — Adversarial User Review

```
create_entry({
  content: "# Adversarial User Review: [Directory]\n\nOverall Score: X/5.0 — Grade Y\n\n[trigger tests + collision map + findings]",
  entry_type: "skill_audit_stress",
  tags: ["adversarial-skill-audit", "stress-test"],
  project_number: <project number>
})
```

### Phase 3 — Improvement Plan

```
create_entry({
  content: "# Skill Improvement Plan: [Directory]\n\n[disposition table + priority tiers]",
  entry_type: "skill_audit_remediation",
  tags: ["adversarial-skill-audit", "remediation"],
  project_number: <project number>
})
```

### Phase 4 — Copilot Validation

```
create_entry({
  content: "# Copilot Skill Validation: [Directory]\n\n[copilot findings + dispositions]",
  entry_type: "skill_audit_copilot",
  tags: ["adversarial-skill-audit", "copilot"],
  project_number: <project number>
})
```

### Final Summary

```
create_entry({
  content: "# Skill Audit Complete: [Directory]\n\nDirectory Score: X.X/5.0 (Grade Y)\nSkills audited: N\nGrade distribution: A: N, B: N, C: N, D: N, F: N\n\n## Key Findings\n- [top 3 findings]\n\n## Improvements Planned\n- [accepted dispositions]\n\n## Trigger Collisions\n- [collision summary]",
  entry_type: "skill_audit_complete",
  tags: ["adversarial-skill-audit", "audit-complete", "session-summary"],
  project_number: <project number>
})
```

## Linking Entries

```
link_entries({
  from_entry_id: <stress_test_entry_id>,
  to_entry_id: <profile_entry_id>,
  relationship_type: "references",
  description: "Adversarial user review of skill inventory"
})

link_entries({
  from_entry_id: <remediation_entry_id>,
  to_entry_id: <stress_test_entry_id>,
  relationship_type: "evolves_from",
  description: "Improvement plan based on adversarial findings"
})

link_entries({
  from_entry_id: <current_audit_id>,
  to_entry_id: <prior_audit_id>,
  relationship_type: "evolves_from",
  description: "Follow-up audit tracking skill quality evolution"
})
```

## Cross-Session Learning

### Find Prior Skill Audits

```
search_entries({
  query: "skill audit",
  entry_type: "skill_audit_profile",
  tags: ["adversarial-skill-audit"]
})
```

### Track Quality Trends

Compare scores across audits to measure improvement:

```
search_entries({
  query: "skill audit complete",
  entry_type: "skill_audit_complete",
  tags: ["adversarial-skill-audit", "audit-complete"]
})
```

### Find Recurring Skill Issues

```
search_entries({
  query: "<issue type, e.g., 'trigger collision'>",
  entry_type: "skill_audit_stress",
  tags: ["adversarial-skill-audit"]
})
```

## Session Retrospective

```
create_entry({
  content: "# Skill Audit Retrospective: [Directory]\n\n## Key Insights\n- [What the Evaluator missed that the Adversarial User caught]\n- [Trigger collisions that surprised us]\n- [Patterns worth applying to all skills]\n\n## Metrics\n- Initial average score: X.X/5.0\n- Projected average score: X.X/5.0\n- Skills needing major work: N\n- Trigger collisions resolved: N/M\n- Coverage gaps identified: N\n\n## Process Improvements\n- [Categories to emphasize next time]\n- [New trigger test prompts to add]",
  entry_type: "retrospective",
  tags: ["adversarial-skill-audit", "retrospective", "session-summary"],
  project_number: <project number>
})
```

## Tag Convention

| Tag | Purpose |
| --- | --- |
| `adversarial-skill-audit` | All entries from this skill (primary filter) |
| `profile` | Phase 1 output |
| `stress-test` | Phase 2 output |
| `remediation` | Phase 3 output |
| `copilot` | Phase 4 output |
| `audit-complete` | Final consolidated summary |
| `retrospective` | Post-cycle review |
| `session-summary` | Enables retrieval via session summary searches |

## Entry Type Reference

| Entry Type | Phase | Description |
| --- | --- | --- |
| `skill_audit_profile` | 1 | Per-skill scorecards and directory overview |
| `skill_audit_stress` | 2 | Trigger tests, collisions, instruction stress tests |
| `skill_audit_remediation` | 3 | Improvement plan with dispositions |
| `skill_audit_copilot` | 4 | Copilot validation findings |
| `skill_audit_complete` | Final | Consolidated audit summary |
| `retrospective` | Post | Session retrospective with metrics |
