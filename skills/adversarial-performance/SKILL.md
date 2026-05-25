---
name: adversarial-performance
description: |
  Multi-pass adversarial performance audit for entire repositories. Combines
  structured profiling (Agent A) with adversarial stress-testing critique
  (Agent B) through iterative passes. Optimize repo/backend performance, hot-paths, 
  or bundle sizes (NOT page load metrics). Do NOT use for frontend page load metrics 
  or Lighthouse audits (use web-perf). NOT for frontend Core Web Vitals (use web-perf).
---

# Adversarial Performance

A multi-pass performance auditing system that produces high-confidence
optimization assessments by introducing structured adversarial critique
stages. Audits pass through an iterative pipeline of profiling,
stress-testing critique, optimization planning, and optional external
validation — producing output optimized for measurable impact, effort
efficiency, and regression safety.

## When to Load

Load this skill when any of these apply:

- Running a performance audit against an entire repository
- Profiling build times, runtime hot paths, or bundle size
- The user asks for an adversarial performance review or stress-test analysis
- The user says "perf audit", "performance review", "find bottlenecks",
  "adversarial performance", "optimize this repo", "make this faster", 
  "why is this slow", or "speed up my code"
- Preparing a performance baseline report before a major release
- You want to reduce blind spots in your own performance assessment

## Auto-Detection

Before starting, auto-detect the project profile by scanning the repository:

| Signal | Project Profile | Extra Categories |
| --- | --- | --- |
| MCP SDK imports, tool handlers, `tools/list` | `mcp-server` | Token & Context Efficiency (Category 7) — full depth |
| Express/Hono/Fastify, HTTP handlers, `listen()` | `web-app` | Runtime Performance (Category 4) — extra API latency focus |
| `bin` field, CLI arg parsing | `cli-tool` | Startup Cost analysis in Category 4 |
| Vitest/Jest/Playwright config | `tested` | Test Suite Performance (Category 5) — full depth |
| Dockerfile present | `containerized` | Build Performance (Category 1) — Docker layer analysis |
| Database imports (better-sqlite3, pg, mysql2) | `data-layer` | Database & I/O (Category 6) — full depth |

Profiles stack. A typical MCP server might be `mcp-server + cli-tool +
tested + containerized + data-layer`.

## Agent Roles

This skill operates with two distinct mental models. You are both agents —
you switch perspectives at phase boundaries.

### Agent A — The Profiler

**Mandate:** Establish baseline targets via web research, then measure, baseline, and catalog performance characteristics.

- **Phase 0 (Research & Benchmarks):** Use the `search_web` tool to find the latest performance benchmarks, Core Web Vitals thresholds, or engine-specific optimizations (e.g., V8) for the stack.
- **Phase 0 (Ecosystem):** Use `grep_search` to cross-reference related performance skills in the local `skills/` directory (e.g., `web-perf`, `sqlite`) to understand target thresholds before profiling.
- Profile build times, bundle output, dependency weight, and runtime patterns
- Establish quantitative baselines where possible (compile time, file count,
  dependency count, output size)
- Catalog existing optimizations (caching, lazy loading, tree-shaking, etc.)
- Identify the project profile and tailor the audit scope accordingly
- Reference prior performance audits via journal search before starting

Think like a **performance engineer** documenting the current state. Your job
is accurate measurement and complete coverage, not finding problems (that's
Agent B's job).

### Agent B — The Stress Tester

**Mandate:** Find every bottleneck the Profiler missed or underestimated.

- Switch to a pessimistic, worst-case mindset — assume every hot path is
  slower than measured
- Challenge baseline measurements with adversarial scenarios (large inputs,
  concurrent load, cold starts, memory pressure)
- Quantify the real-world impact of each finding (latency added, memory
  wasted, tokens burned)
- Score findings by impact and effort using weighted dimensions
- Provide concrete optimization suggestions with expected improvement
  estimates, not vague concerns

The reason for explicit role separation is that it counteracts the natural
tendency to accept reasonable-looking performance as "good enough." By
formally switching to a stress-testing perspective, you push past surface
metrics to find where things actually break.

## The Multi-Pass Protocol

The protocol runs in 4 phases. Each phase produces a journaled artifact.

| Phase | Agent | Output | Entry Type | Tags |
| --- | --- | --- | --- | --- |
| 0. Baseline Web Research | A (Profiler) | Live benchmark targets and optimization standards | `perf_research` | `adversarial-performance`, `research` |
| 1. Profiling | A (Profiler) | Baseline measurements + existing optimizations | `perf_profile` | `adversarial-performance`, `profile` |
| 2. Stress Test Review | B (Stress Tester) | Findings table with impact ratings | `perf_stress_test` | `adversarial-performance`, `stress-test` |
| 3. Optimization Plan | A (Profiler) | Prioritized improvements with disposition | `perf_optimization` | `adversarial-performance`, `optimization` |
| 4. Copilot Validation | External | Independent performance review pass | `perf_copilot` | `adversarial-performance`, `copilot` |

For the full protocol with review dimensions, scoring weights, and output
templates, read
[references/multi-pass-performance-protocol.md](references/multi-pass-performance-protocol.md).

## Audit Categories

The 7 performance categories audited during Phase 1 (Profiling) and
challenged during Phase 2 (Stress Test) are:

1. Build Performance
2. Bundle & Output Analysis
3. Dependency Weight
4. Runtime Performance
5. Test Suite Performance
6. Database & I/O Performance
7. Token & Context Efficiency (MCP servers — graceful degradation)

For the full checklist with measurement methods, anti-patterns, and
optimization patterns, read
[references/audit-categories.md](references/audit-categories.md).

## External Validation (Phase 4)

Phase 4 triggers an independent validation pass using the GitHub CLI (`gh copilot`).
This provides a fundamentally different model's perspective on the audit,
catching performance patterns that internal review normalizes.

For Copilot-specific prompt templates, read
[references/copilot-performance-prompts.md](references/copilot-performance-prompts.md).

**Prerequisites:** `gh` CLI v2.x+ with `gh auth status` passing. If `gh copilot`
is not available, skip Phase 4 gracefully and note the skip in the journal entry.

Read [references/copilot-usage.md](references/copilot-usage.md) for critical non-interactive execution requirements.

## Feedback Loop & Documentation

Every phase creates a journal entry with structured tags and entry types.
This builds a searchable audit trail that tracks performance evolution
across releases.

For journal templates, tag conventions, and retrospective templates, read
[references/feedback-loop.md](references/feedback-loop.md).

### Journal Opt-Out

See [references/journal-opt-out.md](references/journal-opt-out.md) for instructions on how to handle explicit opt-outs from journaling.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `MAX_AUDIT_PASSES` | `2` | Maximum stress-test cycles (phases 2–3 repeat) |
| `AUDIT_DEPTH` | `standard` | Depth: `scan`, `standard`, or `intensive` |
| `COPILOT_VALIDATION` | `true` | Enable/disable the Copilot extension validation phase |
| `PROJECT_PROFILE` | `auto` | Auto-detect or explicit profile list |
| `RUN_COMMANDS` | `false` | Whether to execute measurement commands (`tsc --diagnostics`, `npm test`, etc.) or perform static analysis only |

### Audit Depth Profiles

- **Scan**: Quick triage — Categories 1, 3, 4 only. Focus on the most
  impactful bottlenecks. Best for small repos or time-constrained reviews.
- **Standard**: Full 7-category audit with all review dimensions. Default
  for most repositories.
- **Intensive**: Extended audit with additional focus on:
  - Algorithmic complexity analysis (Big-O) on hot paths
  - Memory allocation profiling patterns
  - Cold start vs. warm path divergence
  - Concurrency bottleneck analysis (event loop blocking, worker saturation)
  - Historical regression tracking (compare against prior audit baselines)

## Synergies

| Skill/Workflow | Relationship |
| --- | --- |
| `adversarial-security` | Sibling skill — applies adversarial pattern to security; this applies it to performance |
| `adversarial-planner` | Parent pattern — plan-level adversarial review; this and security extend it to audits |
| `autonomous-dev` | Generator/Evaluator pipeline at code level; use after this skill to implement optimizations |
| `/perf-audit` workflow | Provides the category checklist; this skill adds adversarial methodology on top |
| `web-perf` | Web-specific performance skill; use alongside for frontend-heavy projects |
