# Usability Test — Git History Mining

**Scope:** Evaluate the developer experience (DX) and heuristic fallbacks for Git tools.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- **Required Tool Groups:** `git`, `codemode`
- Execute through `mj_execute_code` or direct tool calls as you prefer.

**Tests:**

1. **Schema Nuance**: Ensure `search_commits` handles missing parameters gracefully and errors are descriptive.
2. **Path sanitization**: Ensure `simple-git` never leaks absolute paths in error messages or responses. Pass an invalid or extremely long path for `repo` to trigger an error and inspect the response payload.

---

## Success Criteria

- Descriptive errors are returned for malformed queries.
- No absolute paths leaked from `simple-git` operations.
