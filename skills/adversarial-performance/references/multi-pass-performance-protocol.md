# Multi-Pass Performance Protocol

Detailed reference for the 4-phase adversarial performance audit workflow.
Read this when executing the protocol for the full review dimensions, scoring
system, and output templates.

## Phase 1 — Profiling (Agent A: Profiler)

### Inputs

Before starting the profiling pass, gather context from these sources:

1. **Repository structure** — build tooling (tsc, tsup, esbuild, webpack,
   vite), test framework, output directory, entry points
2. **Existing performance documentation** — READMEs, benchmarks, prior audit
   results
3. **Prior audits** — search the journal for related performance entries:
   ```
   search_entries({
     query: "<repository name> performance",
     entry_type: "perf_profile",
     tags: ["adversarial-performance"]
   })
   ```
4. **Dependency manifest** — `package.json` (dependency count, scripts),
   `package-lock.json` (transitive depth)
5. **Project profile** — auto-detect or use the explicit `PROJECT_PROFILE`
   setting (see SKILL.md § Auto-Detection)

### Measurement Methods

If `RUN_COMMANDS` is `true`, execute these measurement commands. Otherwise,
perform static analysis only and note measurements as "estimated" rather than
"measured."

| Category     | Command                                   | What It Measures                   |
| ------------ | ----------------------------------------- | ---------------------------------- |
| Build        | `npx tsc --noEmit --diagnostics`          | Compile time, file count, memory   |
| Build        | `npm run build`                           | Bundle time, output size, warnings |
| Bundle       | `du -sh dist/` (or PowerShell equivalent) | Total output size                  |
| Dependencies | `npm ls --all --prod 2>$null`             | Dependency tree depth              |
| Tests        | `npm test -- --reporter=verbose`          | Suite duration, slow tests         |

### Profiling Structure

Produce a Markdown document with these sections:

```markdown
# Performance Profile — [Repository Name]

## Project Profile

- **Type**: [auto-detected: mcp-server, web-app, cli-tool, library]
- **Profiles**: [stacked: mcp-server + cli-tool + tested + containerized]
- **Language/Runtime**: [e.g., TypeScript/Node.js 24]
- **Build Tool**: [e.g., tsup, tsc, esbuild]
- **Test Framework**: [e.g., Vitest, Playwright]
- **Source Files**: [count]
- **Dependencies**: [direct count / transitive count]

## Baseline Measurements

| Metric                  | Value                   | Method            |
| ----------------------- | ----------------------- | ----------------- |
| TypeScript compile time | Xs                      | tsc --diagnostics |
| Bundle build time       | Xs                      | npm run build     |
| Output size (dist/)     | X KB/MB                 | file system       |
| Production dependencies | N direct / M transitive | npm ls            |
| Test suite duration     | Xs                      | npm test          |
| [etc.]                  |                         |                   |

## Category Assessment (per Category)

For each of the 7 audit categories (see audit-categories.md):

- Current state and measurements
- Existing optimizations in place
- Initial efficiency rating: excellent / good / acceptable / poor

## Hot Path Map

Identify the performance-critical code paths:

- Request handling pipeline (for servers)
- Database query paths (for data-layer projects)
- Build/compile pipeline
- Test execution pipeline
- Startup sequence

## Optimization Opportunities (Preliminary)

Initial hypotheses about where the biggest gains are. These are
preliminary — Agent B will validate or refute them with stress scenarios.
```

### Journal

```
create_entry({
  content: "<full profiling output>",
  entry_type: "perf_profile",
  tags: ["adversarial-performance", "profile"],
  project_number: <project number>
})
```

---

## Phase 2 — Stress Test Review (Agent B: Stress Tester)

Switch mental models. You are now a performance skeptic whose job is to find
every bottleneck the Profiler missed or underestimated. Don't trust the
baselines — probe their limits.

### Review Dimensions

Score each dimension on a 1–5 scale. Dimensions have different weights
reflecting their relative importance for performance:

| Dimension           | Weight | Focus Areas                                                                                                    |
| ------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| **Impact**          | 4      | User-facing latency, throughput degradation, memory pressure, token waste. How much does this actually matter? |
| **Frequency**       | 3      | How often does this hot path execute? Every request? Once at startup? Rare edge case?                          |
| **Effort**          | 2      | How hard is the fix? Quick config change vs. architectural refactor?                                           |
| **Regression Risk** | 1      | Could the optimization break existing behavior or introduce bugs?                                              |

### Severity Mapping

| Weighted Score | Severity | Meaning                                                 |
| -------------- | -------- | ------------------------------------------------------- |
| 4.0–5.0        | Critical | High-frequency bottleneck with major user-facing impact |
| 3.0–3.9        | High     | Significant performance cost, noticeable in production  |
| 2.0–2.9        | Moderate | Measurable inefficiency but limited blast radius        |
| 1.0–1.9        | Low      | Optimization opportunity, defense-in-depth improvement  |

### Depth Profiles

The `AUDIT_DEPTH` configuration controls scrutiny level:

- **Scan**: Categories 1 (Build), 3 (Dependencies), 4 (Runtime) only. Quick
  bottleneck triage.
- **Standard**: All 7 categories at stated weights. Default.
- **Intensive**: All 7 categories + extended analysis:
  - Big-O complexity analysis on identified hot paths
  - Memory allocation pattern review (object churn in loops)
  - Cold start vs. warm execution divergence
  - Event loop blocking analysis (sync I/O, heavy computation)
  - Concurrency ceiling estimation (worker pools, connection pools)
  - Comparison against prior audit baselines (regression detection)

### Critique Output Format

```markdown
## Stress Test Review — [Repository Name]

**Overall Performance Score:** [weighted average] / 5.0
**Performance Grade:** [A–F]

### Grading Scale

| Grade | Score Range | Meaning                                                  |
| ----- | ----------- | -------------------------------------------------------- |
| A     | 4.5–5.0     | Excellent — well-optimized, minimal waste                |
| B     | 3.5–4.4     | Good — no critical bottlenecks, room for tuning          |
| C     | 2.5–3.4     | Acceptable — measurable inefficiencies, worth addressing |
| D     | 1.5–2.4     | Poor — significant bottlenecks impacting UX or cost      |
| F     | 1.0–1.4     | Failing — severe performance issues, unusable at scale   |

### Findings

| #   | Category     | Severity | Finding                   | File:Line         | Impact             | Optimization                   |
| --- | ------------ | -------- | ------------------------- | ----------------- | ------------------ | ------------------------------ |
| 1   | Runtime      | Critical | N+1 query in list handler | src/foo.ts:42     | +200ms per request | Batch query with single SELECT |
| 2   | Build        | High     | Dev deps in prod bundle   | tsup.config.ts:8  | +2MB output        | Add external[] config          |
| 3   | Dependencies | Moderate | Duplicate lodash versions | package-lock.json | +400KB install     | npm dedupe                     |
| ... |              |          |                           |                   |                    |                                |

### Dimension Scores

| Dimension       | Score | Weight | Weighted             |
| --------------- | ----- | ------ | -------------------- |
| Impact          | [1–5] | 4      | [score × 4]          |
| Frequency       | [1–5] | 3      | [score × 3]          |
| Effort          | [1–5] | 2      | [score × 2]          |
| Regression Risk | [1–5] | 1      | [score × 1]          |
| **Total**       |       | **10** | **[sum]/50 = [avg]** |

### Category Breakdown

| Category             | Findings | Worst Severity | Rating        |
| -------------------- | -------- | -------------- | ------------- |
| 1. Build Performance | 1        | High           | ⚠️ Needs work |
| 2. Bundle & Output   | 0        | —              | ✅ Good       |
| 3. Dependency Weight | 2        | Moderate       | ⚠️ Needs work |
| ...                  |          |                |               |

### Stress Scenarios

For each critical/high finding, describe the stress scenario that reveals it:

#### Scenario: [Finding Title]

- **Trigger condition**: [What causes worst-case behavior]
- **Scale factor**: [How performance degrades as N grows]
- **Measured/estimated impact**: [Quantified: +Xms, +XMB, +X tokens]
- **Breaking point**: [At what scale does this become unacceptable]
```

### Journal

```
create_entry({
  content: "<full stress test critique>",
  entry_type: "perf_stress_test",
  tags: ["adversarial-performance", "stress-test"],
  project_number: <project number>
})
```

---

## Phase 3 — Optimization Plan (Agent A: Profiler)

Switch back to the Profiler role. Address every finding from the stress test
review with an explicit disposition.

### Disposition Table

For each finding, record one of:

| Disposition | Meaning                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| **Accept**  | Implement the suggested optimization                                                                      |
| **Reject**  | Explain why the finding doesn't warrant optimization (acceptable cost, premature optimization, trade-off) |
| **Modify**  | Accept the finding but implement a different optimization                                                 |
| **Defer**   | Acknowledge the inefficiency but defer to a future milestone                                              |

### Optimization Plan Output

Produce the plan prioritized by impact × frequency (highest ROI first):

```markdown
## Optimization Plan — [Repository Name]

### Disposition Summary

| #   | Finding            | Severity | Disposition | Rationale                               |
| --- | ------------------ | -------- | ----------- | --------------------------------------- |
| 1   | N+1 query          | Critical | Accept      | Will batch into single SELECT           |
| 2   | Dev deps in bundle | High     | Modify      | Using externals instead of tree-shaking |
| 3   | Duplicate lodash   | Moderate | Defer       | Awaiting lodash-es migration in Q3      |

### Quick Wins (< 1 hour, high impact)

| #   | Finding | Optimization | Expected Improvement       |
| --- | ------- | ------------ | -------------------------- |
| ... | ...     | ...          | -Xms latency / -XMB bundle |

### Targeted Improvements (1–4 hours)

| #   | Finding | Optimization | Files Affected | Expected Improvement |
| --- | ------- | ------------ | -------------- | -------------------- |
| ... | ...     | ...          | ...            | ...                  |

### Architectural Changes (requires design work)

| #   | Finding | Approach | Effort | Expected Improvement |
| --- | ------- | -------- | ------ | -------------------- |
| ... | ...     | ...      | ...    | ...                  |

### Accepted Trade-offs

Findings explicitly rejected or deferred with justification:

| #   | Finding | Disposition | Justification |
| --- | ------- | ----------- | ------------- |
| ... | ...     | ...         | ...           |

### Projected Improvement

| Metric                | Before | After (projected) | Improvement |
| --------------------- | ------ | ----------------- | ----------- |
| Build time            | Xs     | Xs                | -X%         |
| Bundle size           | XMB    | XMB               | -X%         |
| Request latency (p95) | Xms    | Xms               | -X%         |
| Test suite duration   | Xs     | Xs                | -X%         |

**Score**: Before [X]/5.0 (Grade [Y]) → After (projected) [X]/5.0 (Grade [Y])
```

### Iteration Control

After optimization planning, check: has `MAX_AUDIT_PASSES` been reached?

- **No** → return to Phase 2 for another stress test of the optimization
  plan (do the fixes introduce new bottlenecks? Are there second-order
  performance effects?)
- **Yes** → proceed to Phase 4

### Journal

```
create_entry({
  content: "<optimization plan with dispositions>",
  entry_type: "perf_optimization",
  tags: ["adversarial-performance", "optimization"],
  project_number: <project number>
})
```

---

## Phase 4 — Copilot Validation (External)

If `COPILOT_VALIDATION` is enabled and the Copilot CLI is available, invoke
it for an independent review.

See [copilot-performance-prompts.md](copilot-performance-prompts.md) for
prompt templates.

After the Copilot pass, any new findings follow the same disposition process
from Phase 3. The final audit report is then presented to the user.

If Copilot CLI is not available, skip this phase gracefully:

```markdown
> **Phase 4 skipped**: Copilot CLI not available. The audit completed with
> internal adversarial review only (Phases 1–3).
```

### Journal

```
create_entry({
  content: "<copilot findings + final dispositions>",
  entry_type: "perf_copilot",
  tags: ["adversarial-performance", "copilot"],
  project_number: <project number>
})
```

---

## Final Report Assembly

After all phases complete, produce a consolidated report artifact:

```markdown
# Adversarial Performance Audit — [Repository Name]

**Date**: [ISO date]
**Audit Depth**: [scan | standard | intensive]
**Project Profile**: [auto-detected profiles]
**Passes Completed**: [N]
**Copilot Validation**: [yes | skipped]
**Commands Executed**: [yes | static analysis only]

## Executive Summary

[2–3 sentence summary: overall performance posture, critical bottleneck
count, and top recommended optimization]

**Performance Score**: [X] / 5.0 — Grade [A–F]

## Baseline Measurements

[Key metrics from Phase 1]

## Findings Summary

| Category             | Critical | High | Moderate | Low | Total |
| -------------------- | -------- | ---- | -------- | --- | ----- |
| 1. Build Performance | ...      |      |          |     |       |
| ...                  |          |      |          |     |       |
| **Total**            |          |      |          |     |       |

## Top 3 Highest-Impact Optimizations

1. [Most impactful finding + optimization + expected improvement]
2. [Second most impactful]
3. [Third most impactful]

## Full Findings (by impact)

[All findings from Phase 2, grouped by severity descending]

## Optimization Plan

[From Phase 3 — disposition table + quick wins + targeted + architectural]

## Projected Improvement

[Before/after metrics table]

## Appendix: Profiling Data

[Condensed Phase 1 output — measurements, hot path map]
```
