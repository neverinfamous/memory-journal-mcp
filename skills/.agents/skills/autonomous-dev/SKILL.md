---
name: autonomous-dev
description: Harness for autonomous software development. Use when fixing or remediating known issues (including security vulnerabilities). Enforces lifecycle through alignment gates (PROJECT.md), adversarial generator/evaluator agents, and autonomous orchestration of project issues. NOT for setting up standalone CI/CD pipelines.
---

# Autonomous Development Workflow

This skill provides a deterministic software engineering harness, designed to wrap AI code generation with strict alignment gates, adversarial evaluations, CI/CD pipeline principles, and collaborative Git practices. Load this skill when designing or orchestrating multi-step architectural features, automating deployment workflows, or writing code inside a structured environment.

## 1. Project Alignment Gate (PROJECT.md)

Before beginning implementation, you MUST cross-reference the proposed feature against `PROJECT.md` at the repository root. If `PROJECT.md` is missing, ask the user to clarify the project goals or constraints before proceeding.

- **In-Scope**: Confirm the feature directly serves a goal in `PROJECT.md`. Proceed.
- **Out-of-Scope**: Hard block. Halt work immediately and inform the user.
- **Constraints**: Abide strictly by the constraints (language, architecture, dependencies) defined in the project file.

## 2. Security Safety Nets

- **Execution Sandboxing**: Never run unknown or unverified shell scripts directly. Execute isolated tasks within the `tmp/` scratch directory.
- **Secret Protection**: Check for exposed credentials or PII in diffs before committing. Never commit `.env`.
- **Command Gates**: Do not execute destructive commands (`rm -rf`, `git reset --hard`) without explicit Human-in-the-Loop approval.

## 3. Generator / Evaluator Pipeline

Features cannot simply be written and committed. They must navigate a rigid pipeline based on the adversarial evaluation pattern:

1. **Research**: Analyze local scope and external dependencies via parallel search strategies.
2. **Planning**: Formulate architecture and acceptance criteria (generator).
3. **Acceptance Tests FIRST**: Tests must be written before main implementation (TDD).
4. **Implementation**: Produce code.
   - _HARD GATE_: 0 test failures. You cannot proceed if tests fail. No stubs/placeholders allowed.
5. **Adversarial Review**: Self-evaluate the code as a skeptical reviewer (evaluator). Actively search for edge cases, security vulnerabilities, efficiency loss, and anti-patterns.
6. **Documentation**: Ensure docs stay tightly in sync with the codebase after the feature clears CI.

## 4. Workflow Orchestration

Follow strict version control (Conventional Commits, atomic commits) and CI/CD automation rules. Test code locally before creating PRs.

## 5. Context Management & Drift Prevention

As the context window fills up, context anxiety can degrade performance.

- Recognize when the session has spanned too many features or files (e.g., beyond 4-5 features).
- Use session summaries or persistent memories to bookmark state, clear the context, and resume with a fresh perspective.

## 6. Output Templates

**Generator Plan Output:**
```markdown
### Feature Plan: [Feature Name]
**Scope:** [In-Scope/Out-of-Scope based on PROJECT.md]
**Constraints:** [Key constraints to respect]
**Acceptance Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2
```

**Evaluator Review Output:**
```markdown
### Adversarial Review: [Feature Name]
**Pass/Fail:** [Result]
**Security Risks:** [Identified risks or "None"]
**Edge Cases Missed:** [Edge cases]
**Required Fixes:** [List of fixes before proceeding]
```

## Synergies

| Skill/Workflow | Relationship |
| --- | --- |
| `github-commander` | Complementary — handles issue orchestration while this handles the dev lifecycle |
| `adversarial-planner` | Can be used during the Planning phase of the Generator pipeline |
| `adversarial-security` | Can be used during the Evaluator phase |
