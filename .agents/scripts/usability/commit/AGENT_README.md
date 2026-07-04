# Usability Tests: Commit CLI Wrapper

This directory contains usability and fuzzing testing prompts for `commit.ts`, the repository's strict commit validation wrapper.

## Purpose
The tests verify that `commit.ts` strictly enforces:
- **Conventional Commits**: Message format (`type(scope): subject`).
- **Metadata Trailers**: `impact`, `confidence` score constraints (0.0 - 1.0), and `category` enum.
- **Validation Constraints**: Required `validation` status (`passed`).
- **Edge Cases**: Empty staging areas, escaping quotes.
- **Anti-Hallucination**: Preventing the use of non-existent MCP tools for committing.

## Test Files
- `test-usability-commit-cli-empty-staging.md` -> Validates rejection when no files are staged.
- `test-usability-commit-cli-escaping.md` -> Tests parsing of unescaped quotes/symbols.
- `test-usability-commit-cli-validation-bounds-confidence.md` -> Validates bounds for the confidence flag (0.0 to 1.0).
- `test-usability-commit-cli-validation-bounds-impact.md` -> Validates bounds for the impact flag (0.0 to 1.0).
- `test-usability-commit-cli-validation-bounds-trust.md` -> Validates bounds for the trust flag (0.0 to 1.0).
- `test-usability-commit-cli-validation-category.md` -> Tests category enum validation.
- `test-usability-commit-cli-validation-flags-confidence.md` -> Tests error handling when `--confidence` is missing.
- `test-usability-commit-cli-validation-flags-impact.md` -> Tests error handling when `--impact` is missing.
- `test-usability-commit-cli-validation-flags-msg.md` -> Tests error handling when `--msg` is missing.
- `test-usability-commit-cli-validation-format-invalid.md` -> Tests parsing of an invalid conventional commit message.
- `test-usability-commit-cli-validation-format-missing-scope.md` -> Tests parsing of a conventional commit missing the scope.
- `test-usability-commit-cli-validation-format-breaking.md` -> Tests parsing of the breaking change indicator in the commit message.
- `test-usability-commit-cli-validation-format-breaking-no-scope.md` -> Tests parsing of the breaking change indicator without a scope.
- `test-usability-commit-cli-validation-status-invalid.md` -> Tests validation status enum rejecting invalid inputs like 'foo'.
- `test-usability-commit-cli-validation-status-banned.md` -> Tests validation status enum rejecting explicitly banned inputs like 'skipped'.
- `test-usability-commit-cli-validation-status-alternative.md` -> Tests accepting valid alternative statuses like 'none' and 'failed'.
- `test-usability-commit-cli-validation-flags-validation.md` -> Tests error handling when `--validation` flag is missing.
- `test-usability-commit-cli-validation-types-confidence.md` -> Tests invalid types passed to `--confidence`.
- `test-usability-commit-cli-validation-types-impact.md` -> Tests invalid types passed to `--impact`.
- `test-usability-commit-cli-validation-types-trust.md` -> Tests invalid types passed to `--trust`.
- `test-usability-commit-cli-validation-types-journal-project.md` -> Tests invalid types passed to `--journal-project`.
- `test-usability-commit-cli-validation-types-category.md` -> Tests invalid types passed to `--category`.
- `test-usability-commit-hallucination.md` -> Anti-hallucination for fake MCP endpoints.
- `test-usability-commit-banned-commands.md` -> Anti-hallucination for raw git commits and changelog edits.
- `test-usability-commit-bypass-interceptor.md` -> Verifies the git interceptor blocks raw git commits.
- `test-usability-commit-cli-add.md` -> Verifies staging specific files directly with `--add`.
- `test-usability-commit-cli-add-multiple.md` -> Verifies parsing of multiple `--add` flags.
- `test-usability-commit-cli-add-invalid-path.md` -> Verifies error handling when `--add` is given an invalid path.
- `test-usability-commit-cli-msg-alias-message.md` -> Verifies parsing of `--message` alias.
- `test-usability-commit-cli-msg-alias-positional.md` -> Verifies parsing of positional message args.
- `test-usability-commit-cli-msg-alias-short.md` -> Verifies parsing of `-m` alias.
- `test-usability-commit-cli-msg-alias-duplicate.md` -> Verifies rejection when multiple message inputs are provided.
- `test-usability-commit-cli-journal.md` -> Tests parsing and embedding of memory journal flags.
- `test-usability-commit-cli-help.md` -> Tests outputting help information without executing a commit.
- `test-usability-commit-cli-history-inline.md` -> Verifies parsing of `--history` flag.
- `test-usability-commit-cli-history-file.md` -> Verifies parsing of `--history-file` flag.
- `test-usability-commit-cli-history-skip.md` -> Verifies parsing of `--no-history` flag.
- `test-usability-commit-cli-metadata-significance.md` -> Verifies parsing of `--significance`.
- `test-usability-commit-cli-metadata-trust.md` -> Verifies parsing of `--trust`.
- `test-usability-commit-cli-metadata-cwd.md` -> Verifies parsing of `--cwd`.
- `test-usability-commit-cli-metadata-journal-project.md` -> Verifies parsing of `--journal-project`.
- `test-usability-commit-cli-category-optional.md` -> Verifies that the `--category` flag is optional.
- `test-usability-commit-cli-category-fallback.md` -> Verifies fallback category extraction from commit type.
- `test-usability-commit-cli-history-category-parse.md` -> Verifies category prefix parsing from inline history narrative.
- `test-usability-commit-cli-merge-state.md` -> Tests rejection of commits when repository is in MERGE_HEAD state.
- `test-usability-commit-cli-parseargs-errors.md` -> Tests handling of unknown options or invalid parseargs constraints.
- `test-usability-commit-cli-history-missing-fallback.md` -> Tests autonomous fallback to --no-history when history flags are absent.
- `test-usability-commit-cli-metadata-cwd-invalid.md` -> Tests error handling when --cwd points to a non-existent path.

## Execution Rules
> [!IMPORTANT]
> **STRICT PROTOCOL**: When running these tests, you MUST NEVER mutate the repository's actual git history.
> ALWAYS use a mock repository (e.g., `git init` in a scratch directory) when fuzzing commits, as specified in the individual testing prompts.
