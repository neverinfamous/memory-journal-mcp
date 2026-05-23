---
name: adversarial-skill-audit
description: |
  Multi-pass adversarial quality audit for agent skill directories. Combines
  structured evaluation (Agent A) with adversarial stress-testing (Agent B)
  to assess skill completeness, instruction clarity, trigger accuracy,
  token efficiency, and security. Use when auditing a skills directory,
  reviewing skill quality, or when the user says "audit my skills",
  "skill quality check", "review these skills", or "are my skills any good".
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
  skills", or "are my skills any good"
- Preparing a skills directory for npm packaging or distribution
- You want to identify redundant, incomplete, or poorly triggered skills

## Agent Roles

### Agent A — The Evaluator

**Mandate:** Systematically profile every skill against quality standards.

- Read each `SKILL.md` and its reference files
- Score against the 8 audit categories (derived from `skill-builder`)
- Catalog the directory's cross-skill properties (overlaps, gaps, coherence)
- Establish a baseline quality inventory

Think like a **QA lead** doing a thorough review. Your job is accurate
assessment, not criticism — Agent B will find what you missed.

### Agent B — The Adversarial User

**Mandate:** Break every skill by simulating edge-case user prompts.

- Switch to a confused, ambiguous, or adversarial user mindset
- For each skill, construct prompts that should trigger it but might not
- Find skills that would fight over the same prompt (trigger collisions)
- Identify instructions that an agent would misinterpret or skip
- Probe for security issues, token waste, and stale content

The reason for explicit role separation: the Evaluator naturally grades
generously because they understand the skill author's intent. The
Adversarial User has no such sympathy — they only care whether the skill
actually works when a real person types a real prompt.

## The Multi-Pass Protocol

| Phase | Agent | Output | Entry Type | Tags |
| --- | --- | --- | --- | --- |
| 1. Inventory & Profiling | A (Evaluator) | Per-skill scorecards + directory overview | `skill_audit_profile` | `adversarial-skill-audit`, `profile` |
| 2. Adversarial User Review | B (Adversarial User) | Trigger tests, collision map, failure scenarios | `skill_audit_stress` | `adversarial-skill-audit`, `stress-test` |
| 3. Improvement Plan | A (Evaluator) | Prioritized fixes with disposition | `skill_audit_remediation` | `adversarial-skill-audit`, `remediation` |
| 4. Copilot Validation | External | Independent quality review | `skill_audit_copilot` | `adversarial-skill-audit`, `copilot` |

For the full protocol with scoring and templates, read
[references/multi-pass-skill-protocol.md](references/multi-pass-skill-protocol.md).

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
is not available, skip Phase 4 gracefully and note the skip in the journal entry.

> **⚠️ CRITICAL — Non-Interactive Mode**: The `gh copilot` CLI must be run in
> non-interactive mode using the `-p` (or `--prompt`) flag. Interactive mode
> will hang indefinitely in an automated agent context. Use:
> ```
> gh copilot -p "<prompt>" --allow-tool "shell(find,cat,head,grep)"
> ```
> The `--allow-tool` flag grants Copilot read access to the repository files.
> Always `Set-Location` (or `cd`) to the target repository before invoking.

> **⚠️ CRITICAL — No Fabrication**: You MUST actually execute `gh copilot`
> commands and include their real output. Do NOT fabricate, hallucinate, or
> predict what Copilot would say. The entire value of Phase 4 is that it
> provides a genuinely independent perspective. If you cannot run the command
> (permissions, network, quota), skip Phase 4 and document the skip reason
> instead of producing synthetic output.

## Feedback Loop

Every phase creates a journal entry for future retrieval. For templates and
tag conventions, read
[references/feedback-loop.md](references/feedback-loop.md).

## Scripts

This skill includes automated helper scripts located in the `scripts/` directory:
- `scripts/check-skills.ps1`: Automated Phase 1 metric gathering (token count, trigger detection).
- `scripts/run-copilot.ps1`: Automated Phase 4 Copilot validation pipeline.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `MAX_AUDIT_PASSES` | `2` | Maximum stress-test cycles (phases 2–3 repeat) |
| `AUDIT_DEPTH` | `standard` | Depth: `surface`, `standard`, or `thorough` |
| `COPILOT_VALIDATION` | `true` | Enable/disable Copilot extension validation phase |
| `INCLUDE_REFERENCES` | `true` | Whether to read and evaluate reference files too |

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

| Skill/Workflow | Relationship |
| --- | --- |
| `skill-builder` | Defines the quality standards this skill audits against |
| `adversarial-planner` | Parent pattern — plan-level adversarial review |
| `adversarial-security` | Sibling — audits security posture; this audits skill quality |
| `adversarial-performance` | Sibling — audits performance; this audits skill quality |
