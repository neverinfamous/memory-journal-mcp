---
name: adversarial-planner
description: |
  Multi-pass adversarial planning and review skill that improves agent-generated
  plans through structured critique stages. Combines an initial planning agent
  (structure, logic, task sequencing) with an adversarial review agent
  (performance, security, maintainability) and a final Copilot CLI validation
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
- The user says "plan this", "review my plan", "critique this plan", or
  "multi-pass plan"
- You want to reduce confirmation bias in your own planning output

## Agent Roles

This skill operates with two distinct mental models. You are both agents — you
switch perspectives at phase boundaries.

### Agent A — The Planner

**Mandate:** Produce a comprehensive, well-structured plan.

- Gather requirements from user request, code context, and prior work
- Structure the plan with clear scope, file changes, task ordering, and risk
  assessment
- Optimize for completeness and logical sequencing
- Reference prior planning sessions via journal search before starting

### Agent B — The Adversarial Reviewer

**Mandate:** Find every weakness the Planner missed.

- Switch to a skeptical senior reviewer mindset
- Challenge assumptions, flag gaps, and identify risks
- Score findings across weighted review dimensions (see protocol reference)
- Provide concrete, actionable remediation suggestions — not vague concerns

The reason for explicit role separation is that it counteracts the natural
tendency to defend your own output. By formally switching perspective, you
engage different evaluation criteria than the ones that guided the draft.

## The Multi-Pass Protocol

The protocol runs in 4 phases. Each phase produces a journaled artifact.

| Phase | Agent | Output | Entry Type | Tags |
|-------|-------|--------|------------|------|
| 1. Plan Draft | A (Planner) | Structured plan document | `plan_draft` | `adversarial-planner`, `plan-draft` |
| 2. Adversarial Review | B (Reviewer) | Critique table with severity ratings | `adversarial_review` | `adversarial-planner`, `review` |
| 3. Plan Refinement | A (Planner) | Refined plan with disposition notes | `plan_refinement` | `adversarial-planner`, `refinement` |
| 4. Copilot Validation | External | Independent architecture/security pass | `copilot_validation` | `adversarial-planner`, `copilot` |

For the full protocol with review dimensions, scoring weights, and output
templates, read [references/multi-pass-protocol.md](references/multi-pass-protocol.md).

## Copilot Integration

Phase 4 triggers an independent validation pass using the GitHub Copilot CLI.
This provides a fundamentally different model's perspective on the plan,
reducing confirmation bias that persists even after adversarial self-review.

For Copilot-specific prompt templates and integration details, read
[references/copilot-integration.md](references/copilot-integration.md).

**Prerequisites:** The `github-copilot-cli` skill must be available for CLI
setup and authentication. The `copilot-audit` workflow in `github-commander`
handles full repo audits — this skill focuses on plan-specific review.

## Feedback Loop & Documentation

Every phase creates a journal entry with structured tags and entry types. This
builds a searchable audit trail that informs future planning sessions.

For journal templates, tag conventions, cross-session learning patterns, and
retrospective templates, read
[references/feedback-loop.md](references/feedback-loop.md).

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_PLAN_PASSES` | `2` | Maximum refinement cycles (phases 2–3 repeat) |
| `PLAN_REVIEW_DEPTH` | `standard` | Review depth: `light`, `standard`, or `deep` |
| `COPILOT_VALIDATION` | `true` | Enable/disable the Copilot CLI validation phase |

### Review Depth Profiles

- **Light**: Focus on correctness and security only. Best for small, low-risk
  changes.
- **Standard**: Full 5-dimension review. Default for most planning tasks.
- **Deep**: Extended review with additional focus on long-term maintainability,
  API surface design, and migration safety. Use for architectural decisions.

## Synergies

| Skill/Workflow | Relationship |
|---------------|-------------|
| `autonomous-dev` | The Generator/Evaluator pipeline in `autonomous-dev` applies at the code level; this skill applies the same adversarial pattern at the planning level |
| `github-copilot-cli` | Provides the CLI setup and auth required for Phase 4 |
| `github-commander/copilot-audit` | Full repo/PR audit; this skill uses Copilot for plan-specific review instead |
| `skill-builder` | Use to refine this skill's instructions based on observed agent behavior |
