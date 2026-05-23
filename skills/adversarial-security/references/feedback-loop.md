# Feedback Loop & Documentation

Reference for journaling, cross-session learning, and retrospective patterns
used throughout the adversarial security protocol.

## Journal Entry Templates

Each phase of the protocol creates a journal entry using `create_entry`. The
structured entry types and tags enable precise retrieval in future sessions.

### Phase 1 — Reconnaissance

```
create_entry({
  content: "# Security Reconnaissance: [Repository Name]\n\n[full recon content]",
  entry_type: "security_recon",
  tags: ["adversarial-security", "recon"],
  project_number: <project number>
})
```

### Phase 2 — Red Team Review

```
create_entry({
  content: "# Red Team Review: [Repository Name]\n\nOverall Score: X/5.0 — Grade Y\n\n[findings table and scores]",
  entry_type: "security_redteam",
  tags: ["adversarial-security", "redteam"],
  project_number: <project number>
})
```

### Phase 3 — Remediation Plan

```
create_entry({
  content: "# Remediation Plan: [Repository Name]\n\n[disposition table + quick wins + architectural changes]",
  entry_type: "security_remediation",
  tags: ["adversarial-security", "remediation"],
  project_number: <project number>
})
```

### Phase 4 — Copilot Validation

```
create_entry({
  content: "# Copilot Security Validation: [Repository Name]\n\n[copilot findings + final dispositions]",
  entry_type: "security_copilot",
  tags: ["adversarial-security", "copilot"],
  project_number: <project number>
})
```

### Final Report

The consolidated final report is written as a user-facing artifact, not a
journal entry. However, a summary entry should be created to enable future
retrieval:

```
create_entry({
  content: "# Security Audit Complete: [Repository Name]\n\nScore: X/5.0 (Grade Y)\nCritical: N, High: N, Medium: N, Low: N\n\n## Key Findings\n- [top 3 findings summary]\n\n## Remediations Applied\n- [accepted remediations]\n\n## Accepted Risks\n- [deferred items with justification]",
  entry_type: "security_audit_complete",
  tags: ["adversarial-security", "audit-complete", "session-summary"],
  project_number: <project number>
})
```

## Linking Entries

Connect audit entries to each other and to related work using relationships:

```
link_entries({
  from_entry_id: <redteam_entry_id>,
  to_entry_id: <recon_entry_id>,
  relationship_type: "references",
  description: "Red team review of reconnaissance findings"
})

link_entries({
  from_entry_id: <remediation_entry_id>,
  to_entry_id: <redteam_entry_id>,
  relationship_type: "evolves_from",
  description: "Remediation plan based on red team findings"
})

link_entries({
  from_entry_id: <implementation_entry_id>,
  to_entry_id: <remediation_entry_id>,
  relationship_type: "implements",
  description: "Security fix implementing remediation plan"
})

link_entries({
  from_entry_id: <audit_entry_id>,
  to_entry_id: <prior_audit_entry_id>,
  relationship_type: "evolves_from",
  description: "Follow-up audit after prior remediation cycle"
})
```

## Cross-Session Learning

Before starting a new audit, search for prior security work to track
progress and avoid re-discovering known issues.

### Find Prior Audits for the Same Repository

```
search_entries({
  query: "<repository name>",
  entry_type: "security_recon",
  tags: ["adversarial-security"]
})
```

### Find Recurring Vulnerability Patterns

If the same vulnerability type appears across multiple audits, it signals a
systemic pattern worth addressing at the architecture level:

```
search_entries({
  query: "<vulnerability type, e.g., 'missing auth check'>",
  entry_type: "security_redteam",
  tags: ["adversarial-security", "redteam"]
})
```

### Find Cross-Project Security Patterns

Use cross-project insights to identify shared vulnerabilities across the
ecosystem:

```
get_cross_project_insights({
  query: "security vulnerability",
  tags: ["adversarial-security"]
})
```

### Find Audits for a Specific Issue

```
search_entries({
  query: "security",
  issue_number: <issue_number>,
  tags: ["adversarial-security"]
})
```

### Track Remediation Progress

Compare the current audit's findings against prior accepted risks and
deferred items:

```
search_entries({
  query: "<repository name> accepted risk",
  entry_type: "security_remediation",
  tags: ["adversarial-security", "remediation"]
})
```

## Session Retrospective

After completing a full audit cycle (all 4 phases), create a retrospective
entry summarizing key insights. This is the primary mechanism for building
institutional security knowledge.

### Retrospective Template

```
create_entry({
  content: "# Security Audit Retrospective: [Repository Name]\n\n## Key Insights\n- [What the Threat Modeler missed that the Red Team caught]\n- [What Copilot caught that internal review missed]\n- [Vulnerability patterns worth institutionalizing as CI checks]\n- [Defenses that proved effective under adversarial review]\n\n## Metrics\n- Initial security score: X/5.0 (Grade Y)\n- Final security score: X/5.0 (Grade Y)\n- Red team passes: N\n- Critical findings: N (addressed: N, deferred: N)\n- High findings: N (addressed: N, deferred: N)\n- New CWEs identified: [list]\n\n## Process Improvements\n- [Adjustments for future audit cycles]\n- [New patterns to add to audit-categories.md]\n- [Categories that need deeper scrutiny next time]",
  entry_type: "retrospective",
  tags: ["adversarial-security", "retrospective", "session-summary"],
  project_number: <project number>
})
```

## Tag Convention

| Tag | Purpose |
| --- | --- |
| `adversarial-security` | All entries from this skill (primary filter) |
| `recon` | Phase 1 output |
| `redteam` | Phase 2 output |
| `remediation` | Phase 3 output |
| `copilot` | Phase 4 output |
| `audit-complete` | Final consolidated summary |
| `retrospective` | Post-cycle review |
| `session-summary` | Enables retrieval via session summary searches |

## Entry Type Reference

| Entry Type | Phase | Description |
| --- | --- | --- |
| `security_recon` | 1 | Reconnaissance and threat model |
| `security_redteam` | 2 | Red team findings with scores |
| `security_remediation` | 3 | Remediation plan with dispositions |
| `security_copilot` | 4 | Copilot validation findings |
| `security_audit_complete` | Final | Consolidated audit summary |
| `retrospective` | Post | Session retrospective with metrics |
