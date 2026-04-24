# Copilot Integration

Reference for Phase 4 of the adversarial planning protocol — the independent
external validation pass using the GitHub Copilot CLI.

## Why Copilot?

After self-adversarial review (Phases 2–3), confirmation bias can still persist
because the same model produced both the plan and the critique. The Copilot CLI
invokes a fundamentally different model with a separate context window, catching
blind spots that internal review misses.

## Prerequisites

1. **Copilot CLI installed**: `npm list -g @github/copilot`
2. **Authenticated**: `copilot auth` (requires browser approval)
3. **Skill dependency**: The `github-copilot-cli` skill documents setup details

If Copilot CLI is not available, skip Phase 4 gracefully and note the skip in
the journal entry.

## Plan-Specific Prompt Templates

These prompts differ from the full codebase/PR audit prompts in
`github-commander/workflows/copilot-audit.md` — they focus on architectural
decisions rather than code diffs.

### Architecture Review

```bash
echo "You are a senior systems architect. Review this implementation plan for a software project. Focus on:
1. Architectural soundness — are the proposed abstractions appropriate?
2. Security gaps — are there missing auth checks, injection vectors, or data boundary issues?
3. Performance risks — will this scale? Are there N+1 queries or hot-path allocations?
4. Missing considerations — what did the planner forget?
5. Task ordering — are dependencies correctly sequenced?

Here is the plan:

$(cat plan.md)

Output a Markdown table of findings with columns: #, Category, Severity (Critical/Moderate/Low), Finding, Suggestion." | copilot
```

### Roadmap/Milestone Review

```bash
echo "You are a technical program manager reviewing a project roadmap. Evaluate:
1. Scope creep — are the milestones focused and achievable?
2. Risk distribution — are high-risk items front-loaded for early feedback?
3. Dependency chains — are there single points of failure in the timeline?
4. Resource assumptions — are the estimates realistic?
5. Missing milestones — what validation checkpoints are missing?

Here is the roadmap:

$(cat roadmap.md)

Output a structured assessment with recommendations." | copilot
```

### Targeted Security Review

For plans that touch authentication, data access, or external integrations:

```bash
echo "You are a security engineer. This implementation plan proposes changes to a system. Review it exclusively for security implications:
1. New attack surfaces introduced
2. Auth/authz gaps
3. Data validation boundaries
4. Secret management
5. Supply chain risks from new dependencies

Plan:

$(cat plan.md)

List each finding with severity and a concrete mitigation." | copilot
```

## Parsing Copilot Output

Copilot returns unstructured Markdown. To integrate findings into the protocol:

1. **Extract findings** — parse the Markdown for tables or numbered lists
2. **Map to dimensions** — classify each finding against the 5 review dimensions
   (Correctness, Security, Performance, Maintainability, Completeness)
3. **Deduplicate** — compare against Phase 2 findings; skip items already
   addressed in the refinement
4. **Disposition** — apply the same Accept/Reject/Modify framework from Phase 3

## Cross-References

- **`github-copilot-cli` skill** — CLI installation, authentication, and
  non-interactive piping patterns
- **`github-commander/workflows/copilot-audit.md`** — Full repo and PR-level
  audits; use that workflow for post-implementation validation rather than
  plan review
