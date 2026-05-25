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

## Agent Roles

### Agent A — The Evaluator
**Mandate:** Establish structural ground truth via web and local research, then systematically profile the workflow against the structural rubric.
- **Phase 0 (Web Research):** Use the `search_web` tool to find newly discovered workflow injection or prompt injection vectors to test against safety gates.
- **Phase 0 (Ecosystem):** Use `grep_search` to review `skill-builder` and other local workflows to calibrate what a robust safety gate and correct formatting looks like.
- Check for explicit prerequisites before step 1.
- Ensure linear step numbering.
- Look for token bloat or unneeded narrative.

### Agent B — The Adversarial Tester
**Mandate:** Try to break the workflow execution.
- If step 2 fails (e.g., tests fail), does the workflow explicitly define the fallback path?
- Are destructive actions (commits, deployments, deletes) guarded by explicit HITL (Human-in-the-Loop) pauses?
- Could a vague instruction cause an agent to infinite loop?

The reason for explicit role separation is that it counteracts the natural tendency to validate existing instructions. By formally switching to a stress-testing perspective, you push past surface steps to find where agents might loop or fail.

## The Multi-Pass Protocol

| Phase | Agent | Output | Entry Type | Tags |
| --- | --- | --- | --- | --- |
| 0. Web Standards Research | A (Evaluator) | Latest workflow injection vectors | `workflow_audit_research` | `adversarial-workflow-audit`, `research` |
| 1. Evaluator Pass | A (Evaluator) | Scorecards against Workflow Categories | `workflow_audit_profile` | `adversarial-workflow-audit`, `profile` |
| 2. Adversarial Pass | B (Adversarial) | Stress-test edge cases & loop vulnerabilities | `workflow_audit_stress` | `adversarial-workflow-audit`, `stress-test` |
| 3. Remediation | A (Evaluator) | Prioritized checklist of required fixes | `workflow_audit_remediation` | `adversarial-workflow-audit`, `remediation` |
| 4. Copilot Validation | External | Independent workflow quality review | `workflow_audit_copilot` | `adversarial-workflow-audit`, `copilot` |

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

## Scripts

- `scripts/check-workflows.ps1`: Gathers baseline structural metrics across a workflows directory.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `MAX_AUDIT_PASSES` | `2` | Maximum stress-test cycles (phases 2–3 repeat) |
| `AUDIT_DEPTH` | `standard` | Depth: `surface`, `standard`, or `thorough` |
| `COPILOT_VALIDATION` | `true` | Enable/disable Copilot extension validation phase |

### Audit Depth Profiles
- **Surface**: Review structure, linear step numbering, and obvious prerequisites. Quick scan for workflow injection vectors.
- **Standard**: Full audit with all review dimensions and Phase 2 stress testing. Default for most workflows.
- **Thorough**: Full audit plus cross-workflow impact analysis, ecosystem comparisons, and rigorous infinite loop boundary testing.

## Synergies
| Skill/Workflow | Relationship |
| --- | --- |
| `adversarial-planner` | Parent pattern; this skill adapts it for manual execution workflows. |
| `/doc-audit` | Audits documentation repositories, but not specifically executable workflow steps. |
