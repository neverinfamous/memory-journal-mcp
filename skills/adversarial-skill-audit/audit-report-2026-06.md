# Adversarial Skill Audit — memory-journal-mcp/skills

**Date**: 2026-06-17
**Audit Depth**: standard
**Skills Audited**: 14
**Passes Completed**: 1
**Copilot Validation**: Completed

## Executive Summary

The `memory-journal-mcp/skills` directory contains a robust, highly-structured set of agent instructions. The implementation of the adversarial pattern across multiple domains (security, performance, code quality, etc.) is consistent and well-documented. Phase 4 validation (Copilot) identified several critical structural issues, including broken relative paths, copy-paste errors between PR and Issue commanders, and missing `When to Load` sections in key skills.

**Directory Quality Score**: 4.1 / 5.0 — Grade B+

## Skill Scoreboard

| Skill | Score | Grade | Top Issue |
| --- | --- | --- | --- |
| adversarial-code-quality | 4.0 | B | Missing `When to Load` section |
| adversarial-docs-marketer | 4.8 | A | Outstanding structure and clear anti-triggers |
| adversarial-github-actions | 3.5 | C | **Broken relative path** to adversarial-base-protocol.md |
| adversarial-performance | 4.6 | A | Auto-detection logic is well defined |
| adversarial-planner | 4.5 | A | Missing inline audit categories |
| adversarial-security | 4.7 | A | Graceful degradation for non-MCP targets is a strong feature |
| adversarial-seo | 3.0 | C | Lacks standard adversarial skill structure |
| adversarial-skill-audit | 4.8 | A | Very meta, exceptionally detailed execution entry points |
| adversarial-skill-builder | 4.9 | A | Clean, concise, sets a great standard for the repository |
| adversarial-workflow-audit | 4.2 | B+ | Thin trigger coverage in description |
| github-issue-commander | 4.0 | B | Potential trigger collisions with PR commander |
| github-pr-commander | 3.0 | C | **Copy-paste error** in triggers; broken workflow paths |
| mj-mcp-heal | 3.8 | B- | Missing `When to Load`; breaks progressive disclosure |
| mj-mcp-optimize | 4.2 | B+ | Very long SKILL.md (210 lines); could utilize progressive disclosure more |

## Top 3 Improvements (by impact)

1. **Fix Critical Broken Paths**: `adversarial-github-actions` points to an invalid protocol path. `github-pr-commander` points to external `adamic` workflows that do not exist locally.
2. **Resolve Trigger Collisions & Copy-Paste Errors**: `github-pr-commander` incorrectly uses issue triage keywords in its description and `When to Load` sections.
3. **Enforce `When to Load` Sections**: Add explicit `When to Load` sections to `adversarial-code-quality`, `adversarial-seo`, and `mj-mcp-heal`.

## Trigger Collision Map

| Prompt | Competing Skills | Winner | Issue |
| --- | --- | --- | --- |
| "audit this repo" | adversarial-security, adversarial-performance, adversarial-code-quality | Unclear | All use the "audit" keyword, though they attempt to specify "DO NOT use for...". |
| "triage this issue" | github-issue-commander, github-pr-commander | github-issue-commander | PR commander also triggers on "triage". |

## Full Findings (by severity)

| # | Skill | Category | Severity | Finding | Remediation |
| --- | --- | --- | --- | --- | --- |
| 1 | adversarial-github-actions | Execution | Critical | Broken relative path: `../../adversarial-security/references/adversarial-base-protocol.md`. | Change to `../adversarial-security/references/adversarial-base-protocol.md`. |
| 2 | github-pr-commander | Triggering | Critical | Copy-paste error from issue commander ("fix a GitHub issue"). | Rewrite `When to Load` for PRs. |
| 3 | github-pr-commander | Execution | Critical | Broken external paths (`../../adamic/.agents/workflows/...`). | Bundle workflows locally or document explicitly. |
| 4 | adversarial-seo | Structure | Medium | Misses the adversarial pattern (no `When to Load`, config table, etc.). | Standardize to match other adversarial skills. |
| 5 | mj-mcp-heal | Structure | Medium | Internals block breaks progressive disclosure. | Move lines 48-110 to `references/codemode-internals.md`. |
| 6 | adversarial-code-quality | Clarity | Medium | Missing `When to Load` section. | Add explicit `When to Load` block. |

## Improvement Plan

### Priority 1 — Quick Wins
| Skill | Fix | Effort |
| --- | --- | --- |
| adversarial-github-actions | Fix broken `../` relative path in protocol link. | < 5 min |
| github-pr-commander | Rewrite `When to Load` and description to strictly scope to PRs. Fix broken workflow links. | 15 min |
| adversarial-code-quality | Add `When to Load` block. | < 5 min |
| mj-mcp-heal | Add "Use when..." to description and create `When to Load` section. | < 5 min |

### Priority 2 — Structural Improvements
| Skill | Fix | Effort |
| --- | --- | --- |
| mj-mcp-heal | Move internals block to `references/codemode-internals.md`. | 15 min |
| mj-mcp-optimize | Extract Workflow 1-6 detailed steps into `references/optimizer-workflows.md`. | 30 min |
| adversarial-seo | Restructure to follow standard adversarial pattern. | 45 min |

## Per-Skill Scorecards

*(Condensed for brevity. See main scoreboard for grades.)*

- **Frontmatter & Triggering**: Discovered critical copy-paste errors in `github-pr-commander`.
- **Instruction Clarity**: High fidelity across the board, though `adversarial-seo` suffers from too many all-caps MUST/NEVER statements.
- **Security & Safety**: Excellent usage of HITL gates and backups before destructive operations.
- **Token Efficiency**: Average. Skills like `mj-mcp-heal` and `mj-mcp-optimize` need further progressive disclosure refactoring to shrink `SKILL.md` payload size.
