---
name: adversarial-skill-audit
description: |
  Multi-pass adversarial quality audit for agent skill directories. Combines
  structured evaluation with adversarial stress-testing to assess skill completeness,
  instruction clarity, trigger accuracy, and security. Use when auditing a skills directory. DO NOT load for single-skill reviews unless a specific target is specified.
---

# Adversarial Skill Audit

A multi-pass quality auditing system for agent skill directories. Evaluates
each skill against the `skill-builder` quality standards through structured
profiling and adversarial stress-testing — finding gaps in trigger coverage,
instruction clarity, progressive disclosure, security, and cross-skill
coherence.

## When to Load

Load this skill when any of these apply:

- Auditing an entire skills directory for quality and consistency
- Reviewing a batch of skills before publishing or distributing
- The user asks for skill quality review, audit, or improvement suggestions
- The user says "audit my skills", "skill quality check", "review these
  skills", "check my skills", "how good are my skills", "validate these skills",
  "evaluate skills", "score my skills", or "grade these skills"
- Preparing a skills directory for npm packaging or distribution
- You want to identify redundant, incomplete, or poorly triggered skills

## Execution Entry Point

1. Read `references/multi-pass-skill-protocol.md`.
2. Run `scripts/check-skills.ps1` to inventory the directory.
3. Proceed to Phase 1 in the protocol.

## Adversarial Protocol

This skill follows the standard dual-agent adversarial pattern (Agent A: The Evaluator, Agent B: The Adversarial User).
For the core pipeline rules, phase definitions, and agent switching protocols, read:
**[../adversarial-security/references/adversarial-base-protocol.md](../adversarial-security/references/adversarial-base-protocol.md)**
*(If `adversarial-base-protocol.md` is unavailable, use this embedded summary: You must switch between a baseline documenter (Agent A) and an adversarial stress-tester (Agent B) across 4 defined phases: Profile, Review, Remediation, and Validation.)*

For the skill audit-specific protocol with scoring and templates, read:
**[references/multi-pass-skill-protocol.md](references/multi-pass-skill-protocol.md)**

## Audit Categories

The 8 quality categories evaluated per skill:

1. Frontmatter & Triggering
2. Instruction Clarity
3. Structure & Progressive Disclosure
4. Output Formats & Templates
5. Edge Cases & Error Handling
6. Security & Safety
7. Token Efficiency
8. Maintenance & Versioning

Additionally, 4 **directory-level** categories assess the collection:

9. Cross-Skill Coherence
10. Trigger Collision Detection
11. Coverage Gap Analysis
12. Ecosystem Consistency

For the full checklist, read
[references/audit-categories.md](references/audit-categories.md).

## External Validation (Phase 4)

Phase 4 triggers an independent validation pass using the GitHub CLI (`gh copilot`).
The `copilot` subcommand is built into modern `gh` CLI — no separate extension is
needed. This provides a fundamentally different model's perspective on skill
quality, catching issues that internal review normalizes.

For prompts, read
[references/copilot-skill-prompts.md](references/copilot-skill-prompts.md).

**Prerequisites:** `gh` CLI v2.x+ with `gh auth status` passing. If `gh copilot`
fails (e.g., due to an empty quota allowance) or is not available, skip Phase 4 gracefully and proceed with the rest of the workflow.

Read [references/copilot-usage.md](references/copilot-usage.md) for critical non-interactive execution requirements.

## Execution Rules

1. **Continuous Prompt Improvement**: Whenever you see an opportunity to improve this skill's prompt or instructions, proactively update the prompt itself.
2. **No Journal Entries**: Do NOT instruct the agent to create entries in `memory-journal-mcp`.

## Scripts

This skill includes automated helper scripts located in the `scripts/` directory:

- `scripts/check-skills.ps1`: Automated Phase 1 metric gathering (token count, trigger detection).
- `scripts/run-copilot.ps1`: Automated Phase 4 Copilot validation pipeline.

## Configuration

| Variable             | Default    | Description                                       |
| -------------------- | ---------- | ------------------------------------------------- |
| `MAX_AUDIT_PASSES`   | `2`        | Maximum stress-test cycles (phases 2–3 repeat)    |
| `AUDIT_DEPTH`        | `standard` | Depth: `surface`, `standard`, or `thorough`       |
| `COPILOT_VALIDATION` | `true`     | Enable/disable Copilot extension validation phase |
| `INCLUDE_REFERENCES` | `true`     | Whether to read and evaluate reference files too  |

### Audit Depth Profiles

- **Surface**: Frontmatter + structure only (Categories 1, 3, 7). Quick
  scan for obvious issues. Best for large directories (30+ skills).
- **Standard**: All 8 per-skill categories + 4 directory-level categories.
  Default for most audits.
- **Thorough**: Full audit + extended analysis:
  - Read every reference file and evaluate its quality
  - Construct 3 test prompts per skill and evaluate trigger likelihood
  - Analyze description keyword coverage against real user phrasing
  - Compare against `skill-builder/checklist.md` item by item
  - Check for stale content (outdated API references, deprecated tools)

## Synergies
Complements `skill-builder` (standards source), `adversarial-security`, and `adversarial-performance`.
