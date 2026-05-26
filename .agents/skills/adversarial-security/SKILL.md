---
name: adversarial-security
description: |
  Multi-pass adversarial security audit for entire repositories. Combines
  structured threat modeling (Agent A) with adversarial attack surface
  analysis (Agent B) through iterative passes. Merges the security-audit
  workflow's 10-category checklist with the adversarial-planner's
  structured critique methodology. Use when running security audits,
  threat modeling, or when the user says "security audit", "adversarial
  security", "threat model this repo", "red team this repo", or "find vulnerabilities". NOT for fixing or remediating known security issues (use autonomous-dev instead). NOT for supply chain dependency scanning. NOT for general workflow audits or code quality.
---

# Adversarial Security

A multi-pass security auditing system that produces high-confidence
vulnerability assessments by introducing structured adversarial critique
stages. Audits pass through an iterative pipeline of reconnaissance,
red-team attack, remediation planning, and optional external validation —
producing output optimized for exploitability, impact, and actionable
remediation.

## When to Load

Load this skill when any of these apply:

- Running a security audit against an entire repository
- Performing threat modeling for a new or existing codebase
- The user asks for an adversarial security review or red-team analysis
- The user says "security audit", "threat model", "find vulnerabilities",
  "adversarial security", or "red team this repo"
- Preparing a security posture report for a release or compliance review
- You want to reduce blind spots in your own security assessment

## Auto-Detection

Before starting, auto-detect the project type by scanning the repository:

| Signal | Project Type | Extra Categories |
| --- | --- | --- |
| MCP SDK imports (`@modelcontextprotocol/sdk`), `tools/list` handler, tool `description` fields | `mcp-server` | MCP-Specific Security (Category 10) — full depth |
| Express/Hono/Fastify imports, HTTP route handlers, `listen()` calls | `web-app` | Transport & Network (Category 5) — full depth |
| `bin` field in `package.json`, CLI arg parsing (`yargs`, `commander`, `meow`) | `cli-tool` | Input Validation (Category 3) — extra CLI focus |
| No server/CLI signals, only exports | `library` | Supply Chain (Category 9) — extra consumer focus |

The MCP-Specific Security category (Category 10) is **always evaluated with
graceful degradation**. If the target is not an MCP server, findings in this
category are reported as informational rather than skipped entirely. The
rationale: even non-MCP projects may expose tool-like interfaces, schema
descriptions, or configuration metadata that could be poisoned.

When signals overlap (e.g., an MCP server that is also a CLI tool), combine
the extra categories from all matching types.

## Adversarial Protocol

This skill follows the standard dual-agent adversarial pattern (Agent A: The Threat Modeler, Agent B: The Red Team).
For the core pipeline rules, phase definitions, and agent switching protocols, read:
**[references/adversarial-base-protocol.md](references/adversarial-base-protocol.md)**

For the security-specific protocol with review dimensions, scoring weights, and output templates, read:
**[references/multi-pass-security-protocol.md](references/multi-pass-security-protocol.md)**

## Audit Categories

The 10 security categories audited during Phase 1 (Reconnaissance) and
challenged during Phase 2 (Red Team) are:

1. Dependency Vulnerabilities
2. Secret & Credential Exposure
3. Input Validation & Injection
4. Authentication & Authorization
5. Transport & Network Security
6. Docker Security
7. CI/CD Pipeline Security
8. Error Handling & Information Disclosure
9. Supply Chain
10. MCP-Specific Security (graceful degradation for non-MCP targets)

For the full checklist with CWE IDs, vulnerable patterns, and secure
patterns, read
[references/audit-categories.md](references/audit-categories.md).

## External Validation (Phase 4)

Phase 4 triggers an independent validation pass using the GitHub CLI (`gh copilot`).
The `copilot` subcommand is built into modern `gh` CLI — no separate extension is
needed. This provides a fundamentally different model's perspective on the audit,
reducing confirmation bias that persists even after adversarial self-review.

For prompt templates and integration details, read
[references/copilot-security-prompts.md](references/copilot-security-prompts.md).

**Prerequisites:** `gh` CLI v2.x+ with `gh auth status` passing. If `gh copilot`
is not available, skip Phase 4 gracefully and note the skip in the journal entry.

Read [references/copilot-usage.md](references/copilot-usage.md) for critical non-interactive execution requirements.

## Feedback Loop & Documentation

Every phase creates a journal entry with structured tags and entry types.
This builds a searchable audit trail that informs future security reviews.

For journal templates, tag conventions, cross-session learning patterns, and
retrospective templates, read
[references/feedback-loop.md](references/feedback-loop.md).

### Journal Opt-Out

See [references/journal-opt-out.md](references/journal-opt-out.md) for instructions on how to handle explicit opt-outs from journaling.

### Consolidated Report

The final deliverable is a **single consolidated artifact** merging all four
phases into one document, following the template in
[references/multi-pass-security-protocol.md § Final Report Assembly](references/multi-pass-security-protocol.md).
Do NOT produce separate artifacts per phase — the user should receive one
comprehensive document with all findings, remediations, and external
validation results. Before sharing output outside the audit context, redact or generalize specific exploit details and avoid including live credentials or internal hostnames.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `MAX_AUDIT_PASSES` | `2` | Maximum red-team cycles (phases 2–3 repeat) |
| `AUDIT_DEPTH` | `standard` | Depth: `recon`, `standard`, or `paranoid` |
| `COPILOT_VALIDATION` | `true` | Enable/disable the external validation phase (Phase 4, `gh copilot`) |
| `PROJECT_TYPE` | `auto` | Auto-detect or explicit: `mcp-server`, `web-app`, `cli-tool`, `library` |

### Audit Depth Profiles

- **Recon**: Scan for critical and high-severity issues only (Categories 2,
  3, 4). Best for quick triage or low-risk utility repos.
- **Standard**: Full 10-category audit with all review dimensions. Default
  for most repositories.
- **Paranoid**: Extended audit with additional focus on:
  - Supply chain deep dive (lockfile integrity, install scripts, typosquatting)
  - Cross-project impact (shared dependencies, ecosystem blast radius)
  - Advanced attack vectors (prototype pollution chains, ReDoS, timing attacks)
  - Historical git analysis (secrets that were committed then removed)

## Synergies

| Skill/Workflow | Relationship |
| --- | --- |
| `adversarial-planner` | Applies adversarial pattern to plans; this skill applies it to security posture |
| `autonomous-dev` | Generator/Evaluator pipeline at code level; use after this skill to implement fixes |
| GitHub CLI (`gh`) | Built-in `copilot` subcommand used for Phase 4 external validation |
| `/security-audit` workflow | Provides the category checklist; this skill adds adversarial methodology on top |
| `skill-builder` | Use to refine this skill's instructions based on observed agent behavior |
