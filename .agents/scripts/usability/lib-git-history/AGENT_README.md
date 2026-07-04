# Usability Tests for lib-git-history

This directory contains Tier 2 usability testing prompts to fuzz and validate the `lib-git-history` package against its core single source of truth (SSoT). These prompts are intended to be executed by agent testers to verify the correctness, robustness, and fault-tolerance of the extraction mechanisms.

## Coverage

The testing prompts map directly to the core bounds defined in the SSoT (`ssot-mapping.md`) as well as the comprehensive schema definitions for `cliArgsSchema` and `entrySchema` in `schema.ts`, ensuring total coverage:

1. **CLI Flags & Filters:**
   - **Time Filters (Range):** `test-usability-git-history-cli-filters-range.md`
   - **Time Filters (Since):** `test-usability-git-history-cli-filters-since.md`
   - **Time Filters (Until):** `test-usability-git-history-cli-filters-until.md`
   - **Author Filters:** `test-usability-git-history-cli-filters-author.md`
   - **Category Filters:** `test-usability-git-history-cli-filters-category.md`
   - **Type Filters:** `test-usability-git-history-cli-filters-type.md`
   - **Impact Filters:** `test-usability-git-history-commits-by-impact.md`
   - **Confidence Filters:** `test-usability-git-history-commits-by-confidence.md`
   - **Breaking Filter:** `test-usability-git-history-cli-filters-breaking.md`
   - **Content Filters (Path):** `test-usability-git-history-cli-filters-path.md`
   - **Content Filters (Search):** `test-usability-git-history-cli-filters-search.md`
   - **Content Filters (Grep):** `test-usability-git-history-cli-filters-grep.md`
   - **Content Filters (Patch Search):** `test-usability-git-history-cli-filters-patch.md`
   - **Diff Filters:** `test-usability-git-history-cli-filters-diff-filter.md`
   - **Diff Context Flags:** `test-usability-git-history-cli-diff-context.md`
   - **Formatting (JSONL):** `test-usability-git-history-cli-formatting-jsonl.md`
   - **Formatting (JSON Format):** `test-usability-git-history-cli-formatting-format-json.md`
   - **Formatting (Markdown Format):** `test-usability-git-history-cli-formatting-format-markdown.md`
   - **Formatting (Slack Format):** `test-usability-git-history-cli-formatting-format-slack.md`
   - **Formatting (Custom Format):** `test-usability-git-history-cli-formatting-format-custom.md`
   - **Formatting (Changelog):** `test-usability-git-history-cli-formatting-changelog.md`
   - **Formatting (Include Patch):** `test-usability-git-history-cli-formatting-include-patch.md`
   - **Formatting (No Body):** `test-usability-git-history-cli-formatting-no-body.md`
   - **Limits (Limit):** `test-usability-git-history-cli-limits-limit.md`
   - **Limits (Max Body Length):** `test-usability-git-history-cli-limits-max-body-length.md`
   - **Limits (Max Patch Length):** `test-usability-git-history-cli-limits-max-patch.md`
   - **Traversal Flags (First Parent):** `test-usability-git-history-cli-traversal-first-parent.md`
   - **Traversal Flags (Include Merges):** `test-usability-git-history-cli-traversal-include-merges.md`
   - **Traversal Flags (All):** `test-usability-git-history-cli-traversal-all.md`
   - **Traversal Flags (Reverse):** `test-usability-git-history-cli-traversal-reverse.md`
   - **Integration Flags (Cache):** `test-usability-git-history-cli-integration-cache.md`
   - **Integration Flags (Help):** `test-usability-git-history-cli-integration-help.md`
   - **Integration Flags (Issue Tracker):** `test-usability-git-history-cli-integration-issue-tracker.md`
   - **Integration Flags (Issue Pattern):** `test-usability-git-history-cli-integration-issue-pattern.md`
   - **Integration Flags (Mailmap):** `test-usability-git-history-cli-integration-mailmap.md`
   - **Integration Flags (Slack Map):** `test-usability-git-history-cli-integration-slack-map.md`
   - **Integration Flags (Package Version):** `test-usability-git-history-cli-integration-package-version.md`
   - **Integration Flags (Stream to File):** `test-usability-git-history-cli-integration-stream-to-file.md`
   - **Summary Flag:** `test-usability-git-history-summary.md`
   - **Stats Flag:** `test-usability-git-history-cli-stats.md`
   - **Banned Commands:** `test-usability-git-history-banned-commands.md`
   - **WSL Payloads:** `test-usability-git-history-extraction-wsl-payload.md`
   - **Massive Input Scaling:** `test-usability-git-history-extraction-massive.md`

2. **Commit Record Semantics:**
   - **Reverts:** `test-usability-git-history-record-reverts.md`
   - **Rebased:** `test-usability-git-history-record-rebased.md`
   - **Breaking Changes (Trailer):** `test-usability-git-history-breaking-changes-trailer.md`
   - **Breaking Changes (Bang):** `test-usability-git-history-breaking-changes-bang.md`
   - **Issue References:** `test-usability-git-history-record-issues.md`
   - **Extended Attributes:** `test-usability-git-history-record-extended.md`
   - **Core Attributes:** `test-usability-git-history-record-core.md`
   - **Authorship Attributes:** `test-usability-git-history-record-authorship.md`
   - **Refs Attributes:** `test-usability-git-history-record-refs.md`
   - **Core Metadata Trailers:** `test-usability-git-history-metadata-core.md`
   - **Custom Trailers:** `test-usability-git-history-metadata-custom.md`
   - **Patch Truncation:** `test-usability-git-history-record-patch-truncated.md`
   - **isCorrupted Flag:** `test-usability-git-history-schema-is-corrupted.md`
   - **Malformed Inputs:** `test-usability-git-history-record-malformed.md`
   - **Schema Bounds:** `test-usability-git-history-schema-bounds.md`

3. **Metrics & File Context:**
   - **File Truncation:** `test-usability-git-history-record-files-truncated.md`
   - **File Renames & Changes:** `test-usability-git-history-metrics-renames.md`
   - **Commit Size Enum:** `test-usability-git-history-record-size.md`
   - **Binary & Language Flags:** `test-usability-git-history-metrics-binary.md`
   - **Weird Encodings (Nul/Spaces):** `test-usability-git-history-nul-bytes-spaces.md`

## Usage

Agents should be directed to run these fuzz tests inside scratch directories. Always read `ssot-mapping.md` for ground-truth schema rules before attempting remediation.
