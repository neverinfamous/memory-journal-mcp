---
description: Audit and enrich UNRELEASED.md and CHANGELOG.md with Keep a Changelog standards and commit SHA traceability
---

# Changelog Audit & SHA Enrichment

> **Prerequisite**: Ensure your Git working directory is completely clean before starting. Stash or commit any unrelated changes.

Audit the target repository's `UNRELEASED.md` and optionally `CHANGELOG.md` for quality, standards compliance, and commit SHA traceability.

## 1. Audit Initialization

1. Ask the user for the target repository path.
2. Ask whether to audit `UNRELEASED.md` only, or both `UNRELEASED.md` and `CHANGELOG.md`.

---

## Phase 1: Standards & Quality Audit

### A. Keep a Changelog Compliance

Verify the file structure against [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/):

- Correct header hierarchy (`## [Unreleased]`, `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed`, `### Security`)
- Categories sorted in the standard order listed above
- No invented categories (e.g., `### Updated`, `### Improved`, `### Dependencies` as standalone — fold into `### Changed`)
- Compare link at the top pointing to the correct tag range
- No duplicate entries across categories

### B. Fluff Removal

Delete entries that describe **no concrete code or behavior change**:

- Audit/verification pass summaries (e.g., "Completed exhaustive test pass with no changes")
- Entries that merely restate what a tool already does (e.g., "Verified X works correctly")
- Redundant entries — if two entries describe the same change, merge into one
- Entries that describe intent rather than outcome (e.g., "Planned to refactor search module")
- Documentation-only entries unless they fix a user-facing inaccuracy

### C. Description Quality

Every surviving entry must be:

- **Concise** — one sentence, no filler words
- **Specific** — names the affected component, file, or behavior
- **Actionable** — a reader can understand what changed without reading the diff
- **Not a commit message copy** — changelog entries describe the *effect*, not the *action* ("Fixed X returning null" not "Changed line 47 in foo.ts")

---

## Phase 2: SHA Enrichment

For each entry that does **not** already have a commit SHA:

### A. Keyword Extraction

Extract 2–3 distinctive terms from the entry description (function names, file names, error codes, feature names).

### B. Git Log Search

Perform a deep, conservative search across the entire Git history rather than just recent commits. Since changelog entries can accrue over long periods, use combinations of keywords to ensure a 1-to-1 match without hallucinating.

1. Obtain the full history in memory or to a scratch file: `git log --all --oneline`.
2. Extract 2-4 distinctive terms (e.g., words inside backticks, long technical nouns) from the entry.
3. Filter the full commit list for commits that contain *all* selected terms.
4. If no single commit matches, test pairs or triplets of those terms until an unambiguous match is found.

### C. Confidence-Based Attachment

| Match Result | Action |
|---|---|
| **Exactly 1 commit** matches and the message aligns with the entry | Append `` (`<short_sha>`) `` to the entry |
| **2–3 commits** match and all relate to the same change | Append all SHAs comma-separated: `` (`abc1234`, `def5678`) `` |
| **Multiple unrelated commits** or **0 commits** | **Skip** — do not guess. Leave the entry without a SHA |

### D. SHA Format

- Use 7-character short SHA
- Wrap in backtick parentheses at end of line: `` (`a1b2c3d`) ``
- For multi-commit entries: `` (`a1b2c3d`, `e5f6g7h`) ``

> [!CAUTION]
> **Never fabricate a SHA.** If there is any ambiguity about which commit corresponds to an entry, leave it without a SHA. A missing SHA is always preferable to a wrong SHA.

---

## Phase 3: Consolidated Report

Produce a structured artifact before making changes:

1. **Entries removed** (with reason: fluff, redundant, no-change)
2. **Entries rewritten** (before/after with rationale)
3. **SHAs attached** (entry + matched commit message for verification)
4. **SHAs skipped** (entry + reason: ambiguous, no match, multiple candidates)
5. **Structural fixes** (category reordering, header corrections)

---

## Post-Audit Remediation

> [!IMPORTANT]
> **HITL Checkpoint**: STOP HERE. Present the full audit report to the user as an artifact. Wait for explicit approval before applying changes.

Once approved:

1. Apply all changes to `UNRELEASED.md` (and `CHANGELOG.md` if included in scope).
2. Commit with message: `chore: changelog audit — remove fluff, enrich SHAs`
