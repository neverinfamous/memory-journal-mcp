---
name: adversarial-planner
description: |
  Multi-pass adversarial planning and review skill that improves agent-generated
  plans through structured critique stages. Combines an initial planning agent
  (structure, logic, task sequencing) with an adversarial review agent
  (performance, security, maintainability) and a final Copilot extension validation
  pass. Use when creating implementation plans, designing architecture, planning
  roadmaps or milestones, or when the user says "plan this", "review my plan",
  "adversarial review", or "multi-pass plan".
---

# Adversarial Planner

A multi-pass planning and review system that produces high-quality plans by
introducing structured adversarial critique stages. Plans pass through an
iterative pipeline of drafting, review, refinement, and optional external
validation — producing output optimized for correctness, performance, security,
and maintainability.

## When to Load

Load this skill when any of these apply:

- Creating an implementation plan for a new feature or architectural change
- Designing multi-file refactors or system migrations
- Planning project roadmaps, milestones, or sprint scopes
- The user asks for an adversarial or multi-pass review of a plan
- The user says "plan this", "review my plan", "critique this plan", 
  "multi-pass plan", "architect this", "design this system", or "how should I build"
- You want to reduce confirmation bias in your own planning output

## Adversarial Protocol

This skill follows the standard dual-agent adversarial pattern (Agent A: The Planner, Agent B: The Adversarial Reviewer).
For the core pipeline rules, phase definitions, and agent switching protocols, read:
**[../adversarial-security/references/adversarial-base-protocol.md](../adversarial-security/references/adversarial-base-protocol.md)**

For the planner-specific protocol with review dimensions, scoring weights, and output templates, read:
**[references/multi-pass-protocol.md](references/multi-pass-protocol.md)**

## External Validation (Phase 4)

Phase 4 triggers an independent validation pass using the GitHub CLI (`gh copilot`).
The `copilot` subcommand is built into modern `gh` CLI — no separate extension is
needed. This provides a fundamentally different model's perspective on the plan,
reducing confirmation bias that persists even after adversarial self-review.

For Copilot-specific prompt templates and integration details, read
[references/copilot-integration.md](references/copilot-integration.md).

**Prerequisites:** `gh` CLI v2.x+ with `gh auth status` passing. If `gh copilot`
is not available, skip Phase 4 gracefully and note the skip in the journal entry.

Read [references/copilot-usage.md](references/copilot-usage.md) for critical non-interactive execution requirements.

## Feedback Loop & Documentation

Every phase creates a journal entry with structured tags and entry types. This
builds a searchable audit trail that informs future planning sessions.

For journal templates, tag conventions, cross-session learning patterns, and
retrospective templates, read
[references/feedback-loop.md](references/feedback-loop.md).

## Configuration

| Variable             | Default    | Description                                     |
| -------------------- | ---------- | ----------------------------------------------- |
| `MAX_PLAN_PASSES`    | `2`        | Maximum refinement cycles (phases 2–3 repeat)   |
| `PLAN_REVIEW_DEPTH`  | `standard` | Review depth: `light`, `standard`, or `deep`    |
| `COPILOT_VALIDATION` | `true`     | Enable/disable the Copilot extension validation phase |

### Review Depth Profiles

- **Light**: Focus on correctness and security only. Best for small, low-risk
  changes.
- **Standard**: Full 5-dimension review. Default for most planning tasks.
- **Deep**: Extended review with additional focus on long-term maintainability,
  API surface design, and migration safety. Use for architectural decisions.

## Synergies

| Skill/Workflow                   | Relationship                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `autonomous-dev`                 | The Generator/Evaluator pipeline in `autonomous-dev` applies at the code level; this skill applies the same adversarial pattern at the planning level |
| GitHub CLI (`gh copilot`)        | Built-in `copilot` subcommand used for Phase 4 external validation                                                                                    |
| `github-commander/copilot-audit` | Full repo/PR audit; this skill uses Copilot for plan-specific review instead                                                                          |
| `skill-builder`                  | Use to refine this skill's instructions based on observed agent behavior                                                                              |
