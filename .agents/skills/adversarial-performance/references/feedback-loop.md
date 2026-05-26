# Feedback Loop & Documentation

Reference for journaling, cross-session learning, and retrospective patterns
used throughout the adversarial performance protocol.

## Journal Entry Templates

Each phase creates a journal entry using `create_entry`. The structured
entry types and tags enable precise retrieval and performance trend tracking
across releases.

### Phase 1 — Profiling

```
create_entry({
  content: "# Performance Profile: [Repository Name]\n\n[full profiling content with baselines]",
  entry_type: "perf_profile",
  tags: ["adversarial-performance", "profile"],
  project_number: <project number>
})
```

### Phase 2 — Stress Test Review

```
create_entry({
  content: "# Stress Test Review: [Repository Name]\n\nOverall Score: X/5.0 — Grade Y\n\n[findings table and scores]",
  entry_type: "perf_stress_test",
  tags: ["adversarial-performance", "stress-test"],
  project_number: <project number>
})
```

### Phase 3 — Optimization Plan

```
create_entry({
  content: "# Optimization Plan: [Repository Name]\n\n[disposition table + projected improvements]",
  entry_type: "perf_optimization",
  tags: ["adversarial-performance", "optimization"],
  project_number: <project number>
})
```

### Phase 4 — Copilot Validation

```
create_entry({
  content: "# Copilot Performance Validation: [Repository Name]\n\n[copilot findings + final dispositions]",
  entry_type: "perf_copilot",
  tags: ["adversarial-performance", "copilot"],
  project_number: <project number>
})
```

### Final Summary

```
create_entry({
  content: "# Performance Audit Complete: [Repository Name]\n\nScore: X/5.0 (Grade Y)\nCritical: N, High: N, Moderate: N, Low: N\n\n## Baselines\n- Build: Xs\n- Bundle: XMB\n- Dependencies: N direct / M transitive\n- Tests: Xs\n\n## Key Findings\n- [top 3 findings]\n\n## Projected Improvements\n- [accepted optimizations with estimates]",
  entry_type: "perf_audit_complete",
  tags: ["adversarial-performance", "audit-complete", "session-summary"],
  project_number: <project number>
})
```

## Linking Entries

```
link_entries({
  from_entry_id: <stress_test_entry_id>,
  to_entry_id: <profile_entry_id>,
  relationship_type: "references",
  description: "Stress test review of profiling baselines"
})

link_entries({
  from_entry_id: <optimization_entry_id>,
  to_entry_id: <stress_test_entry_id>,
  relationship_type: "evolves_from",
  description: "Optimization plan based on stress test findings"
})

link_entries({
  from_entry_id: <implementation_entry_id>,
  to_entry_id: <optimization_entry_id>,
  relationship_type: "implements",
  description: "Performance optimization implementation"
})

link_entries({
  from_entry_id: <current_audit_id>,
  to_entry_id: <prior_audit_id>,
  relationship_type: "evolves_from",
  description: "Follow-up audit tracking performance evolution"
})
```

## Cross-Session Learning

### Find Prior Audits

```
search_entries({
  query: "<repository name>",
  entry_type: "perf_profile",
  tags: ["adversarial-performance"]
})
```

### Track Performance Trends

Compare baseline measurements across audits to detect regressions:

```
search_entries({
  query: "<repository name> baseline",
  entry_type: "perf_audit_complete",
  tags: ["adversarial-performance", "audit-complete"]
})
```

### Find Recurring Bottleneck Patterns

```
search_entries({
  query: "<pattern, e.g., 'N+1 query'>",
  entry_type: "perf_stress_test",
  tags: ["adversarial-performance"]
})
```

### Cross-Project Performance Patterns

```
get_cross_project_insights({
  query: "performance bottleneck",
  tags: ["adversarial-performance"]
})
```

## Session Retrospective

### Retrospective Template

```
create_entry({
  content: "# Performance Audit Retrospective: [Repository Name]\n\n## Key Insights\n- [What the Profiler missed that the Stress Tester caught]\n- [What Copilot caught that internal review missed]\n- [Optimization patterns worth institutionalizing]\n- [Baselines that proved accurate vs. misleading]\n\n## Metrics\n- Initial performance score: X/5.0 (Grade Y)\n- Final performance score: X/5.0 (Grade Y)\n- Stress test passes: N\n- Critical findings: N (optimized: N, deferred: N)\n- Projected total improvement: [summary]\n\n## Baseline Comparison (vs. prior audit)\n- Build time: Xs → Ys (Δ Z%)\n- Bundle size: XMB → YMB (Δ Z%)\n- Test duration: Xs → Ys (Δ Z%)\n\n## Process Improvements\n- [Categories to emphasize next time]\n- [New measurement methods to add]",
  entry_type: "retrospective",
  tags: ["adversarial-performance", "retrospective", "session-summary"],
  project_number: <project number>
})
```

## Tag Convention

| Tag | Purpose |
| --- | --- |
| `adversarial-performance` | All entries from this skill (primary filter) |
| `profile` | Phase 1 output |
| `stress-test` | Phase 2 output |
| `optimization` | Phase 3 output |
| `copilot` | Phase 4 output |
| `audit-complete` | Final consolidated summary |
| `retrospective` | Post-cycle review |
| `session-summary` | Enables retrieval via session summary searches |

## Entry Type Reference

| Entry Type | Phase | Description |
| --- | --- | --- |
| `perf_profile` | 1 | Baselines and existing optimizations |
| `perf_stress_test` | 2 | Stress test findings with scores |
| `perf_optimization` | 3 | Optimization plan with dispositions |
| `perf_copilot` | 4 | Copilot validation findings |
| `perf_audit_complete` | Final | Consolidated audit summary |
| `retrospective` | Post | Session retrospective with metrics |
