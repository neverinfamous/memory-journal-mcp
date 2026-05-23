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

## The Multi-Pass Protocol

| Phase | Agent | Output |
| --- | --- | --- |
| 1. Evaluator Pass | A (Evaluator) | Scorecards against the 5 Workflow Categories |
| 2. Adversarial Pass | B (Adversarial) | Stress-test edge cases, missing gates, and loop vulnerabilities |
| 3. Remediation | A (Evaluator) | Prioritized checklist of required fixes |

## Agent Roles

### Agent A — The Evaluator
**Mandate:** Systematically profile the workflow against the structural rubric.
- Check for explicit prerequisites before step 1.
- Ensure linear step numbering.
- Look for token bloat or unneeded narrative.

### Agent B — The Adversarial Tester
**Mandate:** Try to break the workflow execution.
- If step 2 fails (e.g., tests fail), does the workflow explicitly define the fallback path?
- Are destructive actions (commits, deployments, deletes) guarded by explicit HITL (Human-in-the-Loop) pauses?
- Could a vague instruction cause an agent to infinite loop?

## Deep References

For the specific audit categories and rubric, read:
- **[Audit Categories Reference](references/audit-categories.md)**

## Helper Scripts

- `scripts/check-workflows.ps1`: Gathers baseline structural metrics across a workflows directory.
