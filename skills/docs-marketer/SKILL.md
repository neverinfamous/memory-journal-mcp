---
name: docs-marketer
description: |
  Documentation marketability audit for repository README, Docker Hub README,
  Wiki, and registry listings. Evaluates feature visibility, first impressions,
  competitive differentiation, onboarding friction, and cross-document
  consistency. Use when improving README quality, surfacing under-marketed
  features, preparing docs for a launch, or when the user says "improve my
  README", "market my docs", "make my docs better", "README audit",
  "under-marketed features", "improve discoverability", or "README review".
  NOT for structural compliance or source-of-truth parity (use /doc-audit).
---

# Docs Marketer

A documentation marketability audit system that evaluates whether accurate
documentation is _effectively marketed_. While `/doc-audit` answers "are the
docs correct?", this skill answers "are the docs compelling?"

Surfaces under-promoted features, evaluates first impressions, identifies
onboarding friction, and scores competitive differentiation across all
documentation surfaces (README, Docker Hub, Wiki, MCP Registry, npm).

## When to Load

Load this skill when any of these apply:

- Improving documentation to better market a project's capabilities
- Preparing documentation for a product launch or major release
- Auditing whether powerful features are adequately surfaced in docs
- Evaluating README first impressions and competitive positioning
- Reviewing documentation tone, voice, and consistency across surfaces
- The user asks to "improve my README", "market my docs", "what features am
  I under-marketing", "make my docs more compelling", "README review",
  "audit my docs for marketing", or "improve discoverability"

**Do NOT load** for:

- Structural compliance checks (use `/doc-audit` instead)
- Source-of-truth parity against source code (use `/doc-audit` instead)
- Code quality audits (use `adversarial-performance` or `autonomous-dev`)

## Target Resolution

Before starting, resolve which repository to audit. If the user did not
specify a repository:

1. **Check workspace context** — look at the active workspace roots and any
   `PROJECT_REGISTRY` configuration. If there is exactly one candidate
   repository, use it.
2. **Infer from conversation** — if the user recently discussed a specific
   project or the briefing identifies an active repository, prefer that.
3. **Ask the user** — if the target is still ambiguous (e.g., multiple
   registered workspaces, no clear context), ask which repository to audit
   before proceeding. Do not guess.

Once resolved, confirm the target repository and its absolute path in your
first output so the user can verify before the audit begins.

## Audit Modes

### Standard Mode (Default)

Single-pass structured audit. Agent A (The Marketer) inventories all
documentation surfaces, scores each against 10 categories, and produces a
prioritized improvement plan. Fast and practical — best for routine docs
reviews.

### Adversarial Mode (`AUDIT_DEPTH: adversarial`)

Full dual-agent pipeline. After Agent A's baseline profile, Agent B (The
Skeptical Reader) simulates a developer discovering the project for the first
time — evaluating the 30-second impression, identifying friction, and
challenging marketing claims. Produces deeper insights at the cost of more
time and tokens.

## Audit Categories

The 10 marketability categories evaluated per document surface:

| #   | Category                    | Focus                                                     |
| --- | --------------------------- | --------------------------------------------------------- |
| 1   | Feature Visibility          | Are all capabilities discoverable in docs?                |
| 2   | First Impression            | Does the repo sell itself in the first 30 seconds?        |
| 3   | Information Architecture    | Heading hierarchy, scannability, progressive disclosure   |
| 4   | Visual Assets               | Mermaid diagrams, badges, screenshots, callouts           |
| 5   | Competitive Differentiation | Does the value proposition clearly stand out?             |
| 6   | Onboarding Friction         | Quick Start clarity, copy-paste readiness                 |
| 7   | Platform Presence           | Docker Hub, npm, MCP Registry, GitHub description/topics  |
| 8   | Cross-Document Consistency  | Feature counts, naming, version alignment across surfaces |
| 9   | Tone & Voice                | Confident, consistent, audience-appropriate               |
| 10  | SEO & Discoverability       | Keywords, GitHub topics, heading keyword density          |

For the full rubric with scoring guides, checklists, and anti-patterns, read
[references/audit-categories.md](references/audit-categories.md).

## Adversarial Protocol

This skill follows the standard dual-agent adversarial pattern (Agent A: The
Marketer, Agent B: The Skeptical Reader) when `AUDIT_DEPTH` is set to
`adversarial`.

For the core pipeline rules, phase definitions, and agent switching protocols,
read:
**[../adversarial-security/references/adversarial-base-protocol.md](../adversarial-security/references/adversarial-base-protocol.md)**

For the docs-marketer-specific protocol with scoring, templates, and the
Skeptical Reader review dimensions, read:
**[references/multi-pass-docs-protocol.md](references/multi-pass-docs-protocol.md)**

## External Validation (Phase 4)

Phase 4 triggers an independent validation pass using the GitHub CLI
(`gh copilot`). The `copilot` subcommand is built into modern `gh` CLI — no
separate extension is needed. This provides a fundamentally different model's
perspective on documentation quality, catching marketing blind spots that
internal review normalizes.

For prompts, read
[references/copilot-docs-prompts.md](references/copilot-docs-prompts.md).

**Prerequisites:** `gh` CLI v2.x+ with `gh auth status` passing. If
`gh copilot` is not available, skip Phase 4 gracefully and note the skip in
the journal entry.

Read [references/copilot-usage.md](references/copilot-usage.md) for critical
non-interactive execution requirements.

## Feedback Loop

Every phase creates a journal entry for future retrieval. For templates and
tag conventions, read
[references/feedback-loop.md](references/feedback-loop.md).

## Prompt Improvement

If during any phase you notice an opportunity to improve the audit — a
category checklist that missed an important signal, a Copilot prompt that
produced weak results, or a scoring rubric that didn't capture real quality
differences — note it as a `### Prompt Improvement Opportunity` in your
journal entry for that phase. Include:

- **What happened**: The specific gap or weak result
- **Suggested fix**: Concrete wording change, new checklist item, or
  revised prompt
- **Category affected**: Which of the 10 categories or Copilot prompts

These observations accumulate in the journal and inform future skill
refinement cycles via `skill-builder`.

## Configuration

| Variable             | Default    | Description                                                                |
| -------------------- | ---------- | -------------------------------------------------------------------------- |
| `AUDIT_DEPTH`        | `standard` | Depth: `standard` (single-pass) or `adversarial` (dual-agent)              |
| `MAX_AUDIT_PASSES`   | `2`        | Maximum adversarial cycles (phases 2–3 repeat). Ignored in standard mode.  |
| `COPILOT_VALIDATION` | `true`     | Enable/disable Copilot extension validation phase                          |
| `TARGET_DOCS`        | `auto`     | Auto-detect surfaces or explicit list (e.g., `README.md,DOCKER_README.md`) |

### Audit Depth Profiles

- **Standard**: All 10 categories scored per surface. Agent A only. Best for
  routine checks and quick improvement passes. Produces a prioritized
  improvement plan directly.
- **Adversarial**: Full dual-agent pipeline with Skeptical Reader stress
  testing. Agent B simulates first-time discovery, competitive evaluation,
  and friction audits. Best for launch preparation, major releases, or when
  you want the deepest analysis.

## Synergies

| Skill/Workflow                   | Relationship                                                                |
| -------------------------------- | --------------------------------------------------------------------------- |
| `/doc-audit`                     | Structural compliance — run first, then `docs-marketer` for marketing       |
| `skill-builder`                  | Defines quality standards for skill docs; this skill applies marketing lens |
| `adversarial-planner`            | Parent adversarial pattern — plan-level review                              |
| `adversarial-skill-audit`        | Sibling — audits skill quality; this audits doc marketability               |
| MCP Documentation Standards (KI) | Badge standards, wiki structure, release notes patterns                     |
