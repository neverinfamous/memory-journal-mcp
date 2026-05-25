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
| 0. Web Standards Research | A (Evaluator) | Latest workflow injection vectors and formatting baselines |
| 1. Evaluator Pass | A (Evaluator) | Scorecards against the 5 Workflow Categories |
| 2. Adversarial Pass | B (Adversarial) | Stress-test edge cases, missing gates, and loop vulnerabilities |
| 3. Remediation | A (Evaluator) | Prioritized checklist of required fixes |
| 4. Copilot Validation | External | Independent workflow quality review |

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

## External Validation (Phase 4)

Phase 4 triggers an independent validation pass using the GitHub CLI (`gh copilot`).
The `copilot` subcommand is built into modern `gh` CLI — no separate extension is
needed. This provides a fundamentally different model's perspective on workflow
quality, catching ambiguous steps and missing safety gates that internal review
normalizes.

**Prerequisites:** `gh` CLI v2.x+ with `gh auth status` passing. If `gh copilot`
is not available, skip Phase 4 gracefully and note the skip in the journal entry.

> **⚠️ CRITICAL — Non-Interactive Mode**: The `gh copilot` CLI must be run in
> non-interactive mode using the `-p` (or `--prompt`) flag. Interactive mode
> will hang indefinitely in an automated agent context. Use:
> ```
> gh copilot -p "Considering these standards from Phase 0 research: [insert findings]. <prompt>" --allow-tool "shell(find,cat,head,grep)"
> ```
> The `--allow-tool` flag grants Copilot read access to the repository files.
> Always `Set-Location` (or `cd`) to the target repository before invoking.
> 
> **⚠️ TIMEOUT GUIDANCE**: Expect 60–120 seconds per prompt. In environments with hard synchronous timeouts (like Antigravity's 10s `WaitMsBeforeAsync` limit), allow the command to naturally fall into the background. Use the `schedule` tool or wait for the system notification to retrieve the results. Do not skip execution due to timeout constraints.

> **⚠️ CRITICAL — No Fabrication**: You MUST actually execute `gh copilot`
> commands and include their real output. Do NOT fabricate, hallucinate, or
> predict what Copilot would say. The entire value of Phase 4 is that it
> provides a genuinely independent perspective. If you cannot run the command
> (permissions, network, quota), skip Phase 4 and document the skip reason
> instead of producing synthetic output.

## Deep References

For the specific audit categories and rubric, read:
- **[Audit Categories Reference](references/audit-categories.md)**

## Helper Scripts

- `scripts/check-workflows.ps1`: Gathers baseline structural metrics across a workflows directory.
