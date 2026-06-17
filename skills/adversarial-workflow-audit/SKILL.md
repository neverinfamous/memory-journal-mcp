---
name: adversarial-workflow-audit
description: |
  Multi-pass adversarial quality audit for flat markdown workflow files. 
  Combines structured evaluation with adversarial stress-testing. 
  Use for workflow scripts and playbooks, or when asked to "audit this workflow" or "review this playbook". 
  DO NOT use for code quality, performance profiling, or security audits.
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
fails (e.g., due to an empty quota allowance) or is not available, skip Phase 4 gracefully and proceed with the rest of the workflow.

Read [references/copilot-usage.md](references/copilot-usage.md) for critical non-interactive execution requirements.

## Execution Rules

1. **Continuous Prompt Improvement**: Whenever you see an opportunity to improve this skill's prompt or instructions, proactively update the prompt itself.
2. **No Journal Entries**: Do NOT instruct the agent to create entries in `memory-journal-mcp`.

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
