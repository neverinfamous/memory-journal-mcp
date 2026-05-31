---
name: adversarial-workflow-audit
description: |
  Multi-pass adversarial quality audit for flat markdown workflow files. 
  Combines structured evaluation (Agent A) with adversarial stress-testing (Agent B) 
  to assess sequential clarity, prerequisite validation, HITL (Human-in-the-loop) safety gates, 
  loop prevention, and formatting. Use when auditing workflow scripts (e.g., slash-commands like /bump-deploy),
  or when the user asks to review or improve operational playbooks.
---

# Adversarial Workflow Audit

A multi-pass quality auditing system adapted specifically for manual markdown workflows.
Unlike agent skills (which trigger automatically), workflows are manually invoked by users
and execute sequentially. This audit ensures they are deterministic, safe, and robust.

## When to Load

Load this skill when any of these apply:

- Auditing an entire workflows directory for quality and safety.
- Reviewing a new workflow before finalizing it.
- The user asks for a workflow quality check or playbook review.
- The user says "audit this workflow", "review this runbook", "check my playbook", or "review this slash command".

## Adversarial Protocol

This skill follows the standard dual-agent adversarial pattern (Agent A: The Evaluator, Agent B: The Adversarial Tester).
For the core pipeline rules, phase definitions, and agent switching protocols, read:
**[../adversarial-security/references/adversarial-base-protocol.md](../adversarial-security/references/adversarial-base-protocol.md)**

## Deep References

For the specific audit categories and rubric, read:

- **[Audit Categories Reference](references/audit-categories.md)**

## External Validation (Phase 4)

Phase 4 triggers an independent validation pass using the GitHub CLI (`gh copilot`).
The `copilot` subcommand is built into modern `gh` CLI — no separate extension is
needed. This provides a fundamentally different model's perspective on workflow
quality, catching ambiguous steps and missing safety gates that internal review
normalizes.

**Prerequisites:** `gh` CLI v2.x+ with `gh auth status` passing. If `gh copilot`
is not available, skip Phase 4 gracefully and note the skip in the journal entry.

Read [references/copilot-usage.md](references/copilot-usage.md) for critical non-interactive execution requirements.

## Feedback Loop

Every phase creates a journal entry for future retrieval. Ensure the `entry_type` and tags map to the protocol table above.

### Journal Opt-Out

See `../adversarial-security/references/journal-opt-out.md` for instructions on how to handle explicit opt-outs from journaling.

## Scripts

- `scripts/check-workflows.ps1`: Gathers baseline structural metrics across a workflows directory.

## Configuration

| Variable             | Default    | Description                                       |
| -------------------- | ---------- | ------------------------------------------------- |
| `MAX_AUDIT_PASSES`   | `2`        | Maximum stress-test cycles (phases 2–3 repeat)    |
| `AUDIT_DEPTH`        | `standard` | Depth: `surface`, `standard`, or `thorough`       |
| `COPILOT_VALIDATION` | `true`     | Enable/disable Copilot extension validation phase |

### Audit Depth Profiles

- **Surface**: Review structure, linear step numbering, and obvious prerequisites. Quick scan for workflow injection vectors.
- **Standard**: Full audit with all review dimensions and Phase 2 stress testing. Default for most workflows.
- **Thorough**: Full audit plus cross-workflow impact analysis, ecosystem comparisons, and rigorous infinite loop boundary testing.

## Synergies

| Skill/Workflow        | Relationship                                                                       |
| --------------------- | ---------------------------------------------------------------------------------- |
| `adversarial-planner` | Parent pattern; this skill adapts it for manual execution workflows.               |
| `/doc-audit`          | Audits documentation repositories, but not specifically executable workflow steps. |
