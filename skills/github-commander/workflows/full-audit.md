# Full Audit

Run a unified code quality + performance + security audit in a single pass with
cross-reference analysis. Use for codebases that are already in good shape.

> **When to use**: For established codebases that have likely passed individual
> audits before. This prevents the "fix cascade" where a security fix introduces
> a quality regression, or a performance optimization weakens validation.

> **Do not use for**: First-time audits on codebases with many known issues.
> Run the individual workflows (`code-quality-audit.md`, `perf-audit.md`,
> `security-audit.md`) separately and fix iteratively instead.

## Phase 1 — Collect Findings (Read-Only)

Run all three audits as **read-only analysis** — no fixes yet. Tag each finding
by its source domain.

### 1a. Code Quality Scan

Follow `code-quality-audit.md` categories 1–14. Tag every finding with `[CQ]`.

### 1b. Performance Scan

Follow `perf-audit.md` sections 1–6. Tag every finding with `[PERF]`.

### 1c. Security Scan

Follow `security-audit.md` phases 2–7. Tag every finding with `[SEC]`.

### 1d. Raw Findings Ledger

Produce **one** consolidated table sorted by severity:

| # | Tag | Severity | File | Lines | Finding | Suggested Fix |
|---|-----|----------|------|-------|---------|---------------|

**Do not apply any fixes yet.**

## Phase 2 — Cross-Reference Analysis

Review the raw ledger and identify findings that interact across domains.

### Conflict Types

| Type | Example |
|------|---------|
| **Security ↔ Quality** | A `[SEC]` fix (adding validation) could introduce duplication flagged by `[CQ]` |
| **Security ↔ Performance** | A `[SEC]` fix (parameterized queries, hashing) could degrade `[PERF]` |
| **Performance ↔ Quality** | A `[PERF]` fix (inlining, caching) could increase complexity flagged by `[CQ]` |
| **Performance ↔ Security** | A `[PERF]` fix (caching, skipping validation) could weaken a `[SEC]` boundary |
| **Shared Root Cause** | Multiple findings trace to the same underlying issue |
| **Fix Dependency** | One finding must be fixed before another |

### Cross-Reference Table

| Linked Findings | Conflict Type | Resolution Strategy |
|-----------------|---------------|---------------------|

If no cross-references are found, state that explicitly.

## Phase 3 — Prioritized Fix Plan

Produce an **ordered fix plan** that avoids cascading regressions:

### Ordering Rules

1. **Shared root causes first** — a single fix resolves multiple findings
2. **Fix dependencies next** — structural changes that unblock later fixes
3. **Security-critical** — critical/high `[SEC]` findings
4. **Cross-referenced fixes** — unified resolution strategies from Phase 2
5. **Remaining findings** — in severity order

### Fix Plan Table

| Order | Finding(s) | Fix Description | Domains Resolved |
|-------|------------|-----------------|------------------|

## HITL Gate — User Approval

**Stop here.** Present the Phase 2 cross-reference analysis and Phase 3 fix
plan to the human for review. Do not proceed until explicitly approved.

Journal the audit state:
```
create_entry({
  content: "Full audit complete. Findings: <N total> (<CQ count> CQ, <PERF count> PERF, <SEC count> SEC). Cross-references: <N>. Awaiting approval for fix plan.",
  entry_type: "audit_finding",
  tags: ["commander", "full-audit", "summary"],
})
```

## Phase 4 — Apply Fixes & Verify

Apply fixes in the approved order. After **all** fixes:

Run validation gates:
- Gate 1: Lint + Typecheck
- Gate 2: Build
- Gate 3: Tests

If any validation fails, identify which fix group caused it and revise.

## Phase 5 — Final Report

### Summary Table

| Domain | Score (A–F) | Findings | Critical | Cross-Referenced |
|--------|-------------|----------|----------|------------------|
| Code Quality | | | | |
| Performance | | | | |
| Security | | | | |

### Metrics

- **Total findings**: _N_
- **Cross-referenced findings**: _N_
- **Cascading fixes avoided**: _N_

### Overall Score

Assign an **overall health score (A–F)** considering all three domains.

## Post-Audit

1. Update changelog with fixes
2. Commit:
   ```bash
   git add <fixed files> <changelog>
   git diff --cached --stat
   git commit -m "chore: unified audit fixes"
   ```
