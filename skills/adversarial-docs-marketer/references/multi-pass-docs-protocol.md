# Multi-Pass Docs Marketing Protocol

Detailed reference for the documentation marketability audit pipeline. This
document defines the full review dimensions, scoring system, and output
templates for both standard (single-pass) and adversarial (dual-agent) modes.

## Phase 0 — Research (Agent A: The Marketer)

Before starting the audit, gather context:

0. **Target repository resolution** — determine which repository to audit:
   - If the user specified a repository, resolve its absolute path via
     workspace roots or `PROJECT_REGISTRY`.
   - If the user invoked the skill without specifying a target (e.g., via a
     slash command or "run the docs audit"), follow the resolution logic in
     `SKILL.md § Target Resolution`: check workspace context, infer from
     conversation, or ask the user.
   - Confirm the target path in your output before proceeding (e.g.,
     "Auditing: `C:\Users\chris\Desktop\memory-journal-mcp`").
   - `Set-Location` (or `cd`) to the target repository for all subsequent
     file reads and Copilot invocations.
1. **Documentation surface discovery** — identify all doc targets:
   - `README.md` (primary)
   - `DOCKER_README.md` (Docker Hub — 25,000 char limit)
   - Wiki clone (`.wiki/` directory — check `<repo>.wiki/` sibling path)
   - npm package README (may differ from repo README)
   - MCP Registry listing (`server.json`)
   - GitHub repository description and topics
2. **Source code capabilities** — enumerate features the project actually has:
   - Tool groups and tool counts (from `tool-filter.ts` or `tool-constants.ts`)
   - Environment variables (from CLI flags and `.env.example`)
   - Resources, prompts, transport modes
   - Security features (OAuth, rate limiting, CORS)
   - Unique differentiators (Code Mode, briefing system, etc.)
3. **Prior audits** — search the journal:
   ```
   search_entries({
     query: "docs marketing audit",
     entry_type: "docs_marketing_profile",
     tags: ["docs-marketer"]
   })
   ```
4. **Competitor landscape** — if the project has an MCP Registry listing,
   briefly research similar projects to understand competitive positioning.

---

## Phase 1 — Document Surface Inventory (Agent A: The Marketer)

### Inputs

For each discovered documentation surface, read its full content and evaluate
against all 10 audit categories.

### Per-Surface Scorecard

```markdown
### [Surface Name] (e.g., README.md)

**Size**: X lines, Y KB
**Last Modified**: [date if available]
**Platform Constraints**: [e.g., Docker Hub 25K char limit]

| Category                       | Score (1–5) | Notes |
| ------------------------------ | ----------- | ----- |
| 1. Feature Visibility          |             |       |
| 2. First Impression            |             |       |
| 3. Information Architecture    |             |       |
| 4. Visual Assets               |             |       |
| 5. Competitive Differentiation |             |       |
| 6. Onboarding Friction         |             |       |
| 7. Platform Presence           |             |       |
| 8. Cross-Document Consistency  |             |       |
| 9. Tone & Voice                |             |       |
| 10. SEO & Discoverability      |             |       |
| **Average**                    | **X.X**     |       |

**Top Opportunity**: [Single highest-impact marketing improvement]
**Grade**: [A–F]
```

### Feature Visibility Gap Analysis

Cross-reference discovered capabilities against documentation mentions:

```markdown
### Feature Visibility Gaps

| Capability                    | In Source? | In README? | In Wiki? | In Docker? | Marketing Status         |
| ----------------------------- | ---------- | ---------- | -------- | ---------- | ------------------------ |
| Code Mode (90% token savings) | ✅         | ✅         | ✅       | ❌         | Under-marketed in Docker |
| Hush Protocol flags           | ✅         | ✅         | ⚠️ Brief | ❌         | Under-marketed           |
| OAuth 2.1 (RFC 9728)          | ✅         | ✅         | ❌       | ❌         | Missing from Wiki/Docker |
```

### Scoring Guide

| Score | Meaning                                                          |
| ----- | ---------------------------------------------------------------- |
| 5     | Excellent — compelling, well-structured, clearly differentiating |
| 4     | Good — solid coverage, minor marketing opportunities missed      |
| 3     | Acceptable — features documented but not effectively marketed    |
| 2     | Poor — significant capabilities buried or poorly presented       |
| 1     | Failing — misleading, empty, or actively harmful to adoption     |

### Portfolio Overview

After scoring all surfaces individually, produce a portfolio-level overview:

```markdown
## Documentation Portfolio Overview

**Surfaces Audited**: N
**Average Marketing Score**: X.X / 5.0
**Portfolio Grade**: [A–F]

### Score Distribution

| Grade       | Surfaces         |
| ----------- | ---------------- |
| A (4.5–5.0) | README.md        |
| B (3.5–4.4) | Wiki Home        |
| C (2.5–3.4) | DOCKER_README.md |
| D (1.5–2.4) | —                |
| F (1.0–1.4) | —                |

### Cross-Surface Properties

- **Feature gaps**: [capabilities missing from specific surfaces]
- **Consistency issues**: [conflicting counts, outdated version numbers]
- **Platform violations**: [Docker Hub char limit, npm README truncation]
- **Strongest surface**: [which document best markets the project]
- **Weakest surface**: [which needs the most marketing improvement]
```

### Journal (Phase 1)

```
create_entry({
  content: "<full inventory with all scorecards + gap analysis>",
  entry_type: "docs_marketing_profile",
  tags: ["docs-marketer", "profile"],
  project_number: <project number>
})
```

### Standard Mode: Skip to Phase 3

In **standard mode** (`AUDIT_DEPTH: standard`), skip Phase 2 entirely and
proceed directly to Phase 3 (Improvement Plan) using the Phase 1 findings.

---

## Phase 2 — Skeptical Reader Review (Agent B: The First-Time Evaluator)

> **Only runs in adversarial mode** (`AUDIT_DEPTH: adversarial`).

Switch mental models. You are now a developer who has never seen this project
before. You have 5 minutes to decide whether to adopt it or move on. Your job
is to find where the documentation fails to sell the project.

### Review Dimensions

Score each dimension on a 1–5 scale:

| Dimension                | Weight | Focus Areas                                                                                                                    |
| ------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **30-Second Test**       | 4      | Can someone understand the value proposition in 30 seconds of scanning? Is the tagline clear? Does the badge row convey trust? |
| **Competitive Survival** | 3      | If choosing between this and an alternative, what would make you leave? What claims feel weak?                                 |
| **Onboarding Friction**  | 3      | Follow the Quick Start literally — where do you get stuck, confused, or need to context-switch?                                |
| **Feature Discovery**    | 2      | What powerful capabilities are buried? What would surprise a user who only read the first 3 sections?                          |
| **Trust Signals**        | 2      | Test coverage badges, security claims, maintenance signals — do they feel authentic?                                           |

### The 30-Second Test

Read only the first screen (~40 lines) of the README. Answer:

1. What does this project do?
2. Why should I use it instead of alternatives?
3. How do I get started?

If any answer is unclear, that's a finding.

### Competitive Evaluation

```markdown
### Competitive Survival Test

| Question                                                | Answer | Score (1–5) |
| ------------------------------------------------------- | ------ | ----------- |
| Is the value prop clear in the tagline?                 |        |             |
| Does the feature table differentiate or just list?      |        |             |
| Are comparisons to alternatives explicit or implied?    |        |             |
| Would a skeptic find the claims credible?               |        |             |
| Is there social proof (stars, downloads, testimonials)? |        |             |
```

### Under-Marketed Features Audit

Identify capabilities that exist in source code but are:

- **Buried**: Mentioned only deep in the README (below fold)
- **Understated**: Mentioned briefly without explaining impact
- **Missing**: Not documented at all in any surface
- **Poorly positioned**: Documented but framed as technical detail instead of
  user benefit

### Oversold Features Audit

Identify claims that:

- Use superlatives without evidence ("best", "fastest", "most comprehensive")
- Quote metrics without context (e.g., "90% token savings" — compared to what?)
- Claim features that are opt-in or require significant setup as defaults

### Critique Output Format

```markdown
## Skeptical Reader Review — [Repository Name]

**Overall Marketing Score:** [weighted average] / 5.0
**Portfolio Grade:** [A–F]

### Findings

| #   | Surface | Category           | Severity | Finding                            | Recommendation                            |
| --- | ------- | ------------------ | -------- | ---------------------------------- | ----------------------------------------- |
| 1   | README  | First Impression   | High     | Value prop unclear in tagline      | Rewrite tagline to lead with user benefit |
| 2   | Docker  | Feature Visibility | Critical | Missing Code Mode section entirely | Add condensed Code Mode section           |
| 3   | Wiki    | Onboarding         | Medium   | Quick Start assumes GitHub token   | Add minimal non-GitHub path               |

### Dimension Scores

| Dimension            | Score | Weight | Weighted             |
| -------------------- | ----- | ------ | -------------------- |
| 30-Second Test       | [1–5] | 4      | [score × 4]          |
| Competitive Survival | [1–5] | 3      | [score × 3]          |
| Onboarding Friction  | [1–5] | 3      | [score × 3]          |
| Feature Discovery    | [1–5] | 2      | [score × 2]          |
| Trust Signals        | [1–5] | 2      | [score × 2]          |
| **Total**            |       | **14** | **[sum]/70 = [avg]** |

### Blocking Issues

Findings that are actively hurting adoption or creating misleading impressions.
```

### Journal (Phase 2)

```
create_entry({
  content: "<full skeptical reader review>",
  entry_type: "docs_marketing_critique",
  tags: ["docs-marketer", "critique"],
  project_number: <project number>
})
```

---

## Phase 3 — Improvement Plan (Agent A: The Marketer)

Switch back to the Marketer. Address every finding with a disposition.

### Disposition Table

| Disposition | Meaning                                           |
| ----------- | ------------------------------------------------- |
| **Accept**  | Implement the improvement                         |
| **Reject**  | Finding doesn't apply or trade-off isn't worth it |
| **Modify**  | Accept the spirit but implement differently       |
| **Defer**   | Acknowledge but defer (document why)              |

### Improvement Plan Output

```markdown
## Improvement Plan — [Repository Name]

### Disposition Summary

| #   | Surface | Finding           | Disposition | Rationale                         |
| --- | ------- | ----------------- | ----------- | --------------------------------- |
| 1   | README  | Tagline unclear   | Accept      | Rewrite to lead with user benefit |
| 2   | Docker  | Missing Code Mode | Accept      | Add condensed section             |
| 3   | Wiki    | Assumes GitHub    | Modify      | Add note instead of full rewrite  |

### Priority 1 — Quick Wins (<15 minutes per fix)

| Surface | Fix                     | Impact           |
| ------- | ----------------------- | ---------------- |
| README  | Update stale badge URLs | Trust            |
| GitHub  | Add missing topics      | SEO              |
| README  | Strengthen tagline      | First Impression |

### Priority 2 — Structural Improvements (30–60 minutes)

| Surface | Fix                                         | Impact             |
| ------- | ------------------------------------------- | ------------------ |
| README  | Reorder sections for progressive disclosure | IA                 |
| Docker  | Add Code Mode summary section               | Feature Visibility |
| Wiki    | Create comparison table vs. alternatives    | Differentiation    |

### Priority 3 — Strategic Improvements (1–2 hours)

| Surface | Fix                                                | Impact          |
| ------- | -------------------------------------------------- | --------------- |
| README  | Rewrite "What Sets Us Apart" with concrete metrics | Differentiation |
| Wiki    | Create onboarding guide for non-GitHub users       | Onboarding      |
| All     | Unify tone and voice across all surfaces           | Consistency     |

### Projected Marketing Improvement

| Metric                        | Before | After |
| ----------------------------- | ------ | ----- |
| Average marketing score       | X.X    | X.X   |
| Surfaces graded A/B           | N/M    | N/M   |
| Feature visibility gaps       | N      | N     |
| Cross-surface inconsistencies | N      | N     |
```

### Iteration Control

Check: has `MAX_AUDIT_PASSES` been reached?

- **No** → return to Phase 2 (stress-test the improvement plan itself)
- **Yes** → proceed to Phase 4

### Journal (Phase 3)

```
create_entry({
  content: "<improvement plan with dispositions>",
  entry_type: "docs_marketing_remediation",
  tags: ["docs-marketer", "remediation"],
  project_number: <project number>
})
```

---

## Phase 4 — Copilot Validation (External)

If available, invoke Copilot CLI. See
[copilot-docs-prompts.md](copilot-docs-prompts.md).

If unavailable, skip gracefully.

### Journal (Phase 4)

```
create_entry({
  content: "<copilot findings + final dispositions>",
  entry_type: "docs_marketing_copilot",
  tags: ["docs-marketer", "copilot"],
  project_number: <project number>
})
```

---

## Final Report Assembly

```markdown
# Documentation Marketing Audit — [Repository Name]

**Date**: [ISO date]
**Audit Depth**: [standard | adversarial]
**Surfaces Audited**: N
**Passes Completed**: N
**Copilot Validation**: [yes | skipped]

## Executive Summary

[2–3 sentences: overall marketing quality, critical gaps, top recommendation]

**Portfolio Marketing Score**: [X.X] / 5.0 — Grade [A–F]

## Surface Scoreboard

| Surface          | Score | Grade | Top Opportunity                     |
| ---------------- | ----- | ----- | ----------------------------------- |
| README.md        | 4.2   | B     | Strengthen competitive positioning  |
| DOCKER_README.md | 3.0   | C     | Missing Code Mode and Hush Protocol |
| Wiki Home        | 3.8   | B     | Improve onboarding flow             |

## Feature Visibility Gap Map

[From Phase 1 — capabilities vs. documentation coverage]

## Top 5 Marketing Improvements (by impact)

1. [Highest-impact improvement]
2. ...

## Cross-Surface Consistency Issues

[Conflicting information across surfaces]

## Full Findings (by severity)

[All findings from Phases 1–2]

## Improvement Plan

[From Phase 3 — prioritized with dispositions]

## Per-Surface Scorecards

[From Phase 1 — all individual scorecards]
```
