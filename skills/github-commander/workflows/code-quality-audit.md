# Code Quality Audit

Run a comprehensive code quality audit as a static analysis pass. No code
changes are made until the human approves the findings.

## Prompt

Perform a comprehensive code quality audit of the target project. For each
finding, report the file path, line range, severity (critical / moderate / low),
and a concrete fix suggestion. Group findings by category:

1. **Dead & unreachable code** — unused exports, unreachable branches, vestigial
   feature flags
2. **Duplication** — repeated logic that should be extracted into shared helpers
3. **Import hygiene** — unused imports, missing imports, circular dependencies
4. **Type safety** — `any` usage, loose type assertions (`as`), missing return
   types on exported functions
5. **Error handling** — typed error classes with descriptive messages including
   context. Propagate with stack traces; never silently swallow exceptions
6. **Logging** — centralized logger with structured payloads. Module-prefixed
   codes. Severity: error | warning | info
7. **Complexity** — functions exceeding ~40 lines, files exceeding ~500 lines,
   high branching depth. Large files should be split into subdirectories with
   barrel re-exports
8. **Naming & consistency** — files/folders should follow project conventions.
   Flag unclear variable names and inconsistent naming
9. **Magic values** — hardcoded strings, numbers, or timeouts that should be
   named constants
10. **Stale markers** — TODO, FIXME, HACK, XXX comments; outdated JSDoc;
    comments that contradict the code
11. **Security** — unsanitized input, missing validation, overly permissive
    schemas
12. **Performance** — unnecessary allocations in hot paths, missing early
    returns, redundant queries
13. **Dependency hygiene** — unused dependencies, unlisted peer dependencies
14. **Accessibility** — if any UI/HTML output exists, verify proper labeling,
    semantic structure, keyboard operability, contrast, and ARIA attributes

## Execution

1. Scan the project source directory systematically
2. Journal each finding:
   ```
   create_entry({
     content: "Code quality finding: [<category>] <severity> — <description>. File: <path>:<lines>.",
     entry_type: "audit_finding",
     tags: ["commander", "code-quality", "<category>"],
   })
   ```
3. Produce a summary table:
   | Category | Findings | Critical | Moderate | Low |
   |---|---|---|---|---|
4. Assign an overall quality score (A–F)

## HITL Checkpoint

Present findings to the human:
- Summary table with counts per category
- Overall quality score
- Top critical findings with fix suggestions

Wait for approval before applying any fixes.

## Apply Fixes

After human approval:
1. Fix critical issues first, then moderate, then low
2. Run validation gates after all fixes:
   - Gate 1: Lint + Typecheck
   - Gate 2: Build
   - Gate 3: Tests
3. Update changelog with audit fixes
4. Commit with descriptive message:
   ```bash
   git add <fixed files> <changelog>
   git diff --cached --stat
   git commit -m "chore: code quality audit fixes"
   ```
