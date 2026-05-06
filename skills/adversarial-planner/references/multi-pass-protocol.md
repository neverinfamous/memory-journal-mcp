# Multi-Pass Protocol

Detailed reference for the 4-phase adversarial planning workflow. Read this
when executing the protocol for the full review dimensions, scoring system, and
output templates.

## Phase 1 — Initial Planning (Agent A: Planner)

### Inputs

Before drafting, gather context from these sources:

1. **User request** — the stated requirements, constraints, and preferences
2. **Codebase context** — existing architecture, patterns, and conventions
3. **Prior plans** — search the journal for related planning entries:
   ```
   search_entries({
     query: "<feature area>",
     entry_type: "plan_draft",
     tags: ["adversarial-planner"]
   })
   ```
4. **Linked issues/PRs** — any GitHub issues or PRs referenced in the request

### Draft Structure

Produce a Markdown plan document with these sections:

```markdown
# [Feature/Change Title]

## Scope

What is included and explicitly excluded.

## Context

Background, motivation, and dependencies on existing systems.

## Proposed Changes

Group by component. For each file:

- What changes and why
- New dependencies introduced
- Breaking changes (if any)

## Task Ordering

Numbered sequence with dependencies noted.
Which tasks can be parallelized.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |

## Open Questions

Anything requiring user input before proceeding.
```

### Journal

```
create_entry({
  content: "<full plan draft>",
  entry_type: "plan_draft",
  tags: ["adversarial-planner", "plan-draft"],
  issue_number: <if applicable>,
  project_number: <if applicable>
})
```

## Phase 2 — Adversarial Review (Agent B: Reviewer)

Switch mental models. You are now a skeptical senior reviewer whose job is to
find every weakness in the plan. Do not defend the Planner's decisions — your
job is to break them.

### Review Dimensions

Score each dimension on a 1–5 scale. Dimensions have different weights
reflecting their relative importance:

| Dimension           | Weight | Focus Areas                                                                                                  |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| **Correctness**     | 3      | Logic errors, edge cases, race conditions, error handling gaps, incorrect assumptions about existing APIs    |
| **Security**        | 3      | Injection vectors, auth/authz gaps, data boundary validation, secret handling, input sanitization            |
| **Performance**     | 2      | Algorithmic complexity, unnecessary allocations, N+1 queries, missing caching opportunities, hot-path impact |
| **Maintainability** | 2      | Coupling, cohesion, single-responsibility violations, naming clarity, testability, documentation debt        |
| **Completeness**    | 1      | Missing tests, missing docs, migration gaps, rollback strategy, monitoring/observability                     |

### Depth Profiles

The `PLAN_REVIEW_DEPTH` configuration controls which dimensions receive full
scrutiny:

- **Light**: Correctness + Security only (weights 3+3)
- **Standard**: All 5 dimensions at stated weights
- **Deep**: All 5 dimensions + extended analysis:
  - API surface backward compatibility
  - Long-term migration path (will this need to be redone in 6 months?)
  - Cross-project impact (does this affect other repos in the ecosystem?)

### Critique Output Format

```markdown
## Adversarial Review — [Feature/Change Title]

**Overall Score:** [weighted average] / 5.0

### Findings

| #   | Dimension   | Severity | Finding                             | Remediation                                       |
| --- | ----------- | -------- | ----------------------------------- | ------------------------------------------------- |
| 1   | Security    | Critical | API endpoint lacks auth middleware  | Add scope check using existing hasScope() pattern |
| 2   | Correctness | Moderate | Race condition in concurrent writes | Use DB transaction wrapping                       |
| 3   | Performance | Low      | Unnecessary full-table scan         | Add index on lookup column                        |

### Dimension Scores

| Dimension       | Score | Weight | Weighted         |
| --------------- | ----- | ------ | ---------------- |
| Correctness     | 4     | 3      | 12               |
| Security        | 2     | 3      | 6                |
| Performance     | 4     | 2      | 8                |
| Maintainability | 3     | 2      | 6                |
| Completeness    | 4     | 1      | 4                |
| **Total**       |       | **11** | **36/55 = 3.27** |

### Blocking Issues

List any findings that MUST be addressed before the plan can proceed.
```

### Journal

```
create_entry({
  content: "<full critique>",
  entry_type: "adversarial_review",
  tags: ["adversarial-planner", "review"],
  issue_number: <if applicable>
})
```

## Phase 3 — Plan Refinement (Agent A: Planner)

Switch back to the Planner role. Address every finding from the adversarial
review with an explicit disposition:

### Disposition Table

For each finding, record one of:

| Disposition | Meaning                                                             |
| ----------- | ------------------------------------------------------------------- |
| **Accept**  | Incorporate the suggestion into the refined plan                    |
| **Reject**  | Explain why the finding does not apply or is not worth addressing   |
| **Modify**  | Accept the spirit of the finding but implement a different solution |

### Refined Plan Output

Produce the refined plan as a delta against the original:

```markdown
## Plan Refinement — [Feature/Change Title]

### Disposition Summary

| #   | Finding         | Disposition | Rationale                                         |
| --- | --------------- | ----------- | ------------------------------------------------- |
| 1   | API lacks auth  | Accept      | Added scope check to proposed changes             |
| 2   | Race condition  | Modify      | Using optimistic locking instead of transactions  |
| 3   | Full-table scan | Reject      | Table has <100 rows, index overhead not justified |

### Updated Sections

[Only include sections that changed, with clear diff annotations]
```

### Iteration Control

After refinement, check: has `MAX_PLAN_PASSES` been reached?

- **No** → return to Phase 2 for another adversarial review of the refined plan
- **Yes** → proceed to Phase 4

The default of 2 passes means: 1 initial review + 1 review of the refinement.
For most plans this is sufficient. Increase for high-stakes architectural
decisions.

### Journal

```
create_entry({
  content: "<refinement with dispositions>",
  entry_type: "plan_refinement",
  tags: ["adversarial-planner", "refinement"],
  issue_number: <if applicable>
})
```

## Phase 4 — Copilot Validation (External)

If `COPILOT_VALIDATION` is enabled (default: `true`), invoke the Copilot CLI
for an independent review of the finalized plan.

See [copilot-integration.md](copilot-integration.md) for prompt templates and
parsing guidance.

After the Copilot pass, any new findings follow the same disposition process
from Phase 3. The final plan is then presented to the user for approval.

### Journal

```
create_entry({
  content: "<copilot findings + final dispositions>",
  entry_type: "copilot_validation",
  tags: ["adversarial-planner", "copilot"],
  issue_number: <if applicable>
})
```
