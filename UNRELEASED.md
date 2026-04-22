# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.6.0...HEAD)

### Verified

- **Phase 19 (Code Mode Security):** Validated all security boundaries for the sandbox via `mj_execute_code`, including validation of empty code payloads, blocking of sensitive keywords (`require`, `process`, `eval`, `import`, `Function`, `__proto__`, `child_process`), structured propagation of runtime errors (SyntaxError, ReferenceError, TypeError), and correct nullification of system globals (`process`, `require`, `setTimeout`, `globalThis`).

### Added
