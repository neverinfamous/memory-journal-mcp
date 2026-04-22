# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.6.0...HEAD)

### Changed
- Verified memory-journal-mcp Code Mode IO namespace (`mj.io.*`) stability. Confirmed full compatibility for legacy JSON/Markdown `exportEntries`, successful file-system execution for `exportMarkdown` and `importMarkdown`, and strict blocking of directory path traversal attacks.
