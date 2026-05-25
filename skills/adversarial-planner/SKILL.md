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
- The user says "plan this", "review my plan", "critique this plan", or
  "multi-pass plan"
- You want to reduce confirmation bias in your own planning output

## Agent Roles

This skill operates with two distinct mental models. You are both agents — you
switch perspectives at phase boundaries.

### Agent A — The Planner

**Mandate:** Establish ground truth via web research and local skill cross-referencing, then produce a comprehensive, well-structured plan.

- **Phase 0 (Research & Intel):** Use the `search_web` tool to find the absolute latest API documentation, community best practices, and deprecated features for the technologies involved.
- **Phase 0 (Ecosystem):** Use `grep_search` to find and read related standards in the local `skills/` directory (e.g., `react-best-practices`) before drafting.
- Gather requirements from user request, code context, and prior work
- Structure the plan with clear scope, file changes, task ordering, and risk
  assessment
- Optimize for completeness and logical sequencing
- Execute a `gh copilot` scan for performance and security vulnerabilities (incorporating your Phase 0 research findings into the prompt), embedding the results directly into the planning document
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

| Phase                 | Agent        | Output                                 | Entry Type           | Tags                                |
| --------------------- | ------------ | -------------------------------------- | -------------------- | ----------------------------------- |
| 0. Web Research & Intel| A (Planner) | Ground truth and cross-skill analysis | `plan_research`      | `adversarial-planner`, `research`   |
| 1. Plan Draft         | A (Planner)  | Structured plan document               | `plan_draft`         | `adversarial-planner`, `plan-draft` |
| 2. Adversarial Review | B (Reviewer) | Critique table with severity ratings   | `adversarial_review` | `adversarial-planner`, `review`     |
| 3. Plan Refinement    | A (Planner)  | Refined plan with disposition notes    | `plan_refinement`    | `adversarial-planner`, `refinement` |
| 4. Copilot Validation | External     | Independent architecture/security pass | `copilot_validation` | `adversarial-planner`, `copilot`    |

For the full protocol with review dimensions, scoring weights, and output
templates, read [references/multi-pass-protocol.md](references/multi-pass-protocol.md).

## External Validation (Phase 4)

Phase 4 triggers an independent validation pass using the GitHub CLI (`gh copilot`).
The `copilot` subcommand is built into modern `gh` CLI — no separate extension is
needed. This provides a fundamentally different model's perspective on the plan,
reducing confirmation bias that persists even after adversarial self-review.

For Copilot-specific prompt templates and integration details, read
[references/copilot-integration.md](references/copilot-integration.md).

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

> **⚠️ CRITICAL — No Fabrication**: You MUST actually execute `gh copilot`
> commands and include their real output. Do NOT fabricate, hallucinate, or
> predict what Copilot would say. The entire value of Phase 4 is that it
> provides a genuinely independent perspective. If you cannot run the command
> (permissions, network, quota), skip Phase 4 and document the skip reason
> instead of producing synthetic output.

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
