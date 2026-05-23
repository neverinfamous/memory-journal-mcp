# Multi-Pass Skill Audit Protocol

Detailed reference for the 4-phase adversarial skill quality audit. Read
this for the full review dimensions, scoring system, and output templates.

## Phase 1 — Inventory & Profiling (Agent A: Evaluator)

### Inputs

Before starting, gather context:

1. **Skills directory listing** — enumerate all skill directories
2. **`skill-builder` standards** — read `skill-builder/SKILL.md` and
   `skill-builder/checklist.md` to calibrate quality expectations
3. **Prior audits** — search the journal:
   ```
   search_entries({
     query: "skill audit",
     entry_type: "skill_audit_profile",
     tags: ["adversarial-skill-audit"]
   })
   ```
4. **README inventory** — check if a `README.md` lists all skills and
   whether it's current

### Per-Skill Scorecard

For each skill, produce a scorecard:

```markdown
### [skill-name]

**Files**: SKILL.md (X lines, Y KB) + N reference files
**Description**: [first 100 chars of description]

| Category | Score (1–5) | Notes |
| --- | --- | --- |
| 1. Frontmatter & Triggering | | |
| 2. Instruction Clarity | | |
| 3. Structure & Progressive Disclosure | | |
| 4. Output Formats | | |
| 5. Edge Cases & Errors | | |
| 6. Security & Safety | | |
| 7. Token Efficiency | | |
| 8. Maintenance | | |
| **Average** | **X.X** | |

**Top Issue**: [Single most impactful improvement]
**Grade**: [A–F]
```

### Scoring Guide

| Score | Meaning |
| --- | --- |
| 5 | Excellent — meets or exceeds all skill-builder standards |
| 4 | Good — minor gaps, functional as-is |
| 3 | Acceptable — noticeable issues but usable |
| 2 | Poor — significant gaps affecting agent behavior |
| 1 | Failing — broken, misleading, or unusable |

### Directory-Level Assessment

After scoring all skills individually, produce a directory-level overview:

```markdown
## Directory Overview

**Total Skills**: N
**Average Quality Score**: X.X / 5.0
**Grade Distribution**: A: N, B: N, C: N, D: N, F: N

### Score Distribution

| Grade | Skills |
| --- | --- |
| A (4.5–5.0) | skill-a, skill-b |
| B (3.5–4.4) | skill-c, skill-d |
| C (2.5–3.4) | skill-e |
| D (1.5–2.4) | skill-f |
| F (1.0–1.4) | — |

### Cross-Skill Properties

- **Potential overlaps**: [skills that cover similar domains]
- **Coverage gaps**: [domains with no skill coverage]
- **Consistency issues**: [naming conventions, structure differences]
- **README accuracy**: [is the inventory table current?]
```

### Journal

```
create_entry({
  content: "<full inventory with all scorecards>",
  entry_type: "skill_audit_profile",
  tags: ["adversarial-skill-audit", "profile"],
  project_number: <project number>
})
```

---

## Phase 2 — Adversarial User Review (Agent B: Adversarial User)

Switch mental models. You are now a user who types imprecise, ambiguous
prompts. Your job is to find where the skills fail — wrong skill triggers,
no skill triggers, confusing output, or dangerous behavior.

### Review Dimensions

Score each dimension on a 1–5 scale:

| Dimension | Weight | Focus Areas |
| --- | --- | --- |
| **Trigger Reliability** | 4 | Does the skill load when it should? Does it avoid loading when it shouldn't? Are trigger keywords comprehensive? |
| **Instruction Fidelity** | 3 | Will an agent actually follow these instructions correctly? Are there ambiguous steps that invite hallucination? |
| **Failure Graceful** | 2 | What happens when prerequisites are missing, inputs are weird, or the project doesn't match assumptions? |
| **Token ROI** | 1 | Is the token cost justified by the value provided? Could the same effect be achieved with fewer tokens? |

### Trigger Testing

For each skill, construct 3 test prompts:

1. **Direct trigger** — a prompt that obviously should load this skill
2. **Oblique trigger** — a prompt that should load this skill but uses
   different phrasing than the description
3. **Anti-trigger** — a prompt that sounds related but should NOT load
   this skill

Evaluate each:

```markdown
### Trigger Test: [skill-name]

| # | Prompt | Should Trigger? | Would It? | Confidence |
| --- | --- | --- | --- | --- |
| 1 | "Build an MCP server" | Yes | Yes | High |
| 2 | "Connect my API to Claude" | Yes | Maybe | Medium |
| 3 | "Write a REST API" | No | Maybe | Low — description too broad |
```

### Trigger Collision Map

Identify prompts where multiple skills would compete to load:

```markdown
### Trigger Collisions

| Prompt | Competing Skills | Winner | Issue |
| --- | --- | --- | --- |
| "Set up CI/CD" | github-actions, docker, cloudflare | Unclear | All three claim CI/CD |
| "Deploy to production" | cloudflare, docker, workers-best-practices | Unclear | Ambiguous platform |
```

### Instruction Stress Tests

For each skill, identify instructions that an agent might:

- **Misinterpret** — ambiguous phrasing that could lead to wrong behavior
- **Skip** — low-priority-sounding steps that are actually critical
- **Over-execute** — instructions that could cause an agent to do too much
- **Hallucinate from** — vague instructions that invite fabrication

```markdown
### Instruction Issues: [skill-name]

| Line/Section | Issue | Type | Example Failure |
| --- | --- | --- | --- |
| "Consider using caching" | Vague — agent may skip | Skip risk | Agent ignores caching entirely |
| "Set up the project" | No specifics | Hallucination | Agent invents project structure |
```

### Critique Output Format

```markdown
## Adversarial User Review — [Skills Directory]

**Overall Quality Score:** [weighted average] / 5.0
**Directory Grade:** [A–F]

### Findings

| # | Skill | Category | Severity | Finding | Remediation |
| --- | --- | --- | --- | --- | --- |
| 1 | mcp-builder | Triggering | High | "Connect AI to API" won't trigger | Add to description keywords |
| 2 | docker | Clarity | Medium | "Set up multi-stage" is ambiguous | Add concrete Dockerfile template |
| 3 | — (directory) | Collision | High | 3 skills fight over "deploy" | Add disambiguation in descriptions |

### Dimension Scores

| Dimension | Score | Weight | Weighted |
| --- | --- | --- | --- |
| Trigger Reliability | [1–5] | 4 | [score × 4] |
| Instruction Fidelity | [1–5] | 3 | [score × 3] |
| Failure Graceful | [1–5] | 2 | [score × 2] |
| Token ROI | [1–5] | 1 | [score × 1] |
| **Total** | | **10** | **[sum]/50 = [avg]** |

### Blocking Issues

Skills that are actively harmful, misleading, or security-risk.
```

### Journal

```
create_entry({
  content: "<full adversarial review>",
  entry_type: "skill_audit_stress",
  tags: ["adversarial-skill-audit", "stress-test"],
  project_number: <project number>
})
```

---

## Phase 3 — Improvement Plan (Agent A: Evaluator)

Switch back to the Evaluator. Address every finding with a disposition.

### Disposition Table

| Disposition | Meaning |
| --- | --- |
| **Accept** | Implement the improvement |
| **Reject** | Finding doesn't apply or trade-off isn't worth it |
| **Modify** | Accept the spirit but implement differently |
| **Defer** | Acknowledge but defer (document why) |

### Improvement Plan Output

```markdown
## Improvement Plan — [Skills Directory]

### Disposition Summary

| # | Skill | Finding | Disposition | Rationale |
| --- | --- | --- | --- | --- |
| 1 | mcp-builder | Missing trigger keywords | Accept | Add 5 alternative phrasings |
| 2 | docker | Ambiguous instruction | Modify | Add example instead of rewriting |
| 3 | — (directory) | Trigger collision on "deploy" | Accept | Add "NOT for..." clauses |

### Priority 1 — Quick Wins (per skill)

| Skill | Fix | Effort |
| --- | --- | --- |
| ... | ... | <15 min |

### Priority 2 — Structural Improvements

| Skill | Fix | Effort |
| --- | --- | --- |
| ... | ... | 30–60 min |

### Priority 3 — New Skills Needed

| Gap | Suggested Skill | Rationale |
| --- | --- | --- |
| ... | ... | ... |

### Skills to Deprecate or Merge

| Skill | Action | Rationale |
| --- | --- | --- |
| ... | Merge into X | 90% overlap with X |

### Projected Quality Improvement

| Metric | Before | After |
| --- | --- | --- |
| Average score | X.X | X.X |
| Skills graded A/B | N/M | N/M |
| Trigger collisions | N | N |
| Coverage gaps | N | N |
```

### Iteration Control

Check: has `MAX_AUDIT_PASSES` been reached?

- **No** → return to Phase 2 (stress-test the improvement plan itself)
- **Yes** → proceed to Phase 4

### Journal

```
create_entry({
  content: "<improvement plan with dispositions>",
  entry_type: "skill_audit_remediation",
  tags: ["adversarial-skill-audit", "remediation"],
  project_number: <project number>
})
```

---

## Phase 4 — Copilot Validation (External)

If available, invoke Copilot CLI. See
[copilot-skill-prompts.md](copilot-skill-prompts.md).

If unavailable, skip gracefully.

### Journal

```
create_entry({
  content: "<copilot findings + final dispositions>",
  entry_type: "skill_audit_copilot",
  tags: ["adversarial-skill-audit", "copilot"],
  project_number: <project number>
})
```

---

## Final Report Assembly

```markdown
# Adversarial Skill Audit — [Skills Directory]

**Date**: [ISO date]
**Audit Depth**: [surface | standard | thorough]
**Skills Audited**: N
**Passes Completed**: N
**Copilot Validation**: [yes | skipped]

## Executive Summary

[2–3 sentences: overall quality, critical issues, top recommendation]

**Directory Quality Score**: [X.X] / 5.0 — Grade [A–F]

## Skill Scoreboard

| Skill | Score | Grade | Top Issue |
| --- | --- | --- | --- |
| adversarial-planner | 4.5 | A | — |
| docker | 3.2 | C | Ambiguous multi-stage instructions |
| ... | | | |

## Top 5 Improvements (by impact)

1. [Highest-impact fix]
2. ...

## Trigger Collision Map

[From Phase 2]

## Coverage Gap Analysis

[Domains without skill coverage]

## Full Findings (by severity)

[All findings from Phase 2]

## Improvement Plan

[From Phase 3]

## Per-Skill Scorecards

[From Phase 1 — all individual scorecards]
```
