---
name: autonomous-dev
description: Harness for autonomous software development. Enforces lifecycle through alignment gates (PROJECT.md), adversarial generator/evaluator agents, CI/CD pipeline automation, and strict Git workflows (Conventional Commits, Branching).
---

# Autonomous Development Workflow

This skill provides a deterministic software engineering harness, designed to wrap AI code generation with strict alignment gates, adversarial evaluations, CI/CD pipeline principles, and collaborative Git practices. Load this skill when designing or orchestrating multi-step architectural features, automating deployment workflows, or writing code inside a structured environment.

## 1. Project Alignment Gate (PROJECT.md)
Before beginning implementation, you MUST cross-reference the proposed feature against `PROJECT.md` at the repository root.
- **In-Scope**: Proceed with confidence.
- **Out-of-Scope**: Hard block. Halt work immediately and inform the user.
- **Constraints**: Abide strictly by the constraints (language, architecture, dependencies) defined in the project file.

## 2. Generator / Evaluator Pipeline
Features cannot simply be written and committed. They must navigate a rigid pipeline based on the adversarial evaluation pattern:
1. **Research**: Analyze local scope and external dependencies via parallel search strategies.
2. **Planning**: Formulate architecture and acceptance criteria (generator).
3. **Acceptance Tests FIRST**: Tests must be written before main implementation (TDD).
4. **Implementation**: Produce code.
   - *HARD GATE*: 0 test failures. You cannot proceed if tests fail. No stubs/placeholders allowed.
5. **Adversarial Review**: Self-evaluate the code as a skeptical reviewer (evaluator). Actively search for edge cases, security vulnerabilities, efficiency loss, and anti-patterns.
6. **Documentation**: Ensure docs stay tightly in sync with the codebase after the feature clears CI.

## 3. Git Workflow & Versioning
Enforce strict version control standards on all changes:
- **Branching**: Use feature branches (`feature/my-feature`), bugfix branches (`fix/bug-name`), or standard trunk-based branching flows depending on the repository context.
- **Atomic Commits**: Group distinct changes into smaller, logical, single-purpose commits. Do not lump refactoring with new logic.
- **Conventional Commits**: You MUST format all commits according to the Conventional Commits specification:
  - `feat: <description>` for new features (MINOR bump)
  - `fix: <description>` for bug fixes (PATCH bump)
  - `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, `chore:` for specific maintenance scopes.
  - Suffix `!` for breaking changes (e.g., `feat!: remove API v1`) (MAJOR bump).

## 4. Continuous Integration/Deployment (CI/CD)
When designing automation and pipelines:
- **GitHub Actions First**: Prioritize GitHub Actions for CI/CD pipeline orchestration, favoring Reusable Workflows and matrix builds.
- **Validation Blocks**: Every PR or merge MUST require passing lint, test, and type-check gates.
- **Automation Constraints**: Automate Semantic Versioning (using conventional commits) to power automated release notes and changelog generation.
- **Security Scans**: Mandate security scanning (e.g. CodeQL, Trivy) on standard PR flows.

## 5. Context Management & Drift Prevention
As the context window fills up, context anxiety can degrade performance.
- Recognize when the session has spanned too many features or files (e.g., beyond 4-5 features).
- Use session summaries or persistent memories to bookmark state, clear the context, and resume with a fresh perspective.
