# Memory Journal MCP v2.1.0 - GitHub Actions & Complete Type Safety

*Released: November 26, 2025*

## 🎉 Major Release Highlights

Memory Journal v2.1.0 brings comprehensive GitHub Actions integration and true Pyright strict compliance:

1. **🔧 Complete GitHub Actions Integration** - CI/CD visibility with 5 new resources
2. **🔗 GitHub Issues & Pull Requests** - Auto-detection and linking
3. **✅ True Pyright Strict Compliance** - 700+ type issues fixed, zero exclusions
4. **📊 Actions Visual Graph** - CI/CD narrative visualization with Mermaid diagrams

**What this means for you:**
- ✅ **CI status in context** - AI sees your build status in every conversation
- ✅ **Workflow debugging** - Failure analysis with `actions-failure-digest` prompt
- ✅ **Better IDE support** - Complete type coverage means better autocomplete
- ✅ **Issue/PR auto-linking** - Entries automatically linked from branch names
- ✅ **No breaking changes** - Simply upgrade and restart

---

## 🔧 GitHub Actions Integration

### CI Status in Context Bundle

Memory Journal now automatically captures GitHub Actions workflow status:

```json
{
  "ci_status": "passing",
  "github_workflow_runs": [
    {
      "id": 12345678,
      "name": "CI Tests",
      "status": "completed",
      "conclusion": "success"
    }
  ]
}
```

**CI Status Values:**
- `passing` - All recent workflow runs succeeded
- `failing` - At least one recent workflow run failed
- `pending` - Workflow runs are in progress or queued
- `unknown` - No recent workflow runs found

### Linking Entries to Workflow Runs

```javascript
create_entry({
  content: "Fixed flaky test - mocked external API calls",
  entry_type: "bug_fix",
  tags: ["ci", "testing"],
  workflow_run_id: 12345678,
  workflow_name: "CI Tests",
  workflow_status: "completed"
})
```

### 5 New GitHub Actions Resources

1. **`memory://graph/actions`** - CI/CD narrative graph visualization
   - Shows: Commits → Workflow Runs → Failures → Entries → Fixes → Deployments
   - Query params: `?branch=X&workflow=Y&limit=15`

2. **`memory://actions/recent`** - Recent workflow runs (JSON)
   - Query params: `?branch=X&workflow=Y&commit=SHA&pr=N&limit=10`

3. **`memory://actions/workflows/{name}/timeline`** - Workflow-specific timeline
   - Blends: workflow runs, journal entries, PR events

4. **`memory://actions/branches/{branch}/timeline`** - Branch CI timeline
   - Blends: workflow runs, journal entries, PR lifecycle events

5. **`memory://actions/commits/{sha}/timeline`** - Commit-specific timeline
   - Blends: workflow runs for commit, related journal entries

### Actions Failure Digest Prompt

New prompt for comprehensive CI/CD failure analysis:

```
/actions-failure-digest days_back:7 limit:5
```

**Output includes:**
- Failing jobs summary with failed steps
- Linked journal entries
- Recent code/PR changes
- Previous similar failures (semantic search)
- Possible root causes
- Actionable next steps

---

## 🔗 GitHub Issues & Pull Requests Integration

### Auto-Detection

Issue and PR numbers are automatically detected from branch names:
- `issue-123`, `issue/123`, `fix/issue-456`
- `#123` (shorthand)
- `/123-` or `/123/` patterns

### Manual Linking

```javascript
create_entry({
  content: "Fixed authentication bug",
  entry_type: "bug_fix",
  issue_number: 123,
  pr_number: 456
})
```

### 3 PR Workflow Prompts

1. **`pr-summary`** - Journal activity summary for a PR
2. **`code-review-prep`** - Comprehensive PR review preparation
3. **`pr-retrospective`** - Completed PR analysis with learnings

### 3 New Resources

1. **`memory://issues/{issue_number}/entries`** - All entries linked to an issue
2. **`memory://prs/{pr_number}/entries`** - All entries linked to a PR
3. **`memory://prs/{pr_number}/timeline`** - Combined PR + journal timeline

---

## ✅ True Pyright Strict Compliance

### What Changed

- **700+ type issues fixed** - Complete strict mode compliance
- **All exclusions removed** from `pyrightconfig.json`:
  - Removed `reportMissingTypeStubs` exclusion
  - Removed `reportUnknownVariableType` exclusion
  - Removed `reportUnknownMemberType` exclusion
  - Removed `reportUnknownArgumentType` exclusion
  - Removed `reportUnknownParameterType` exclusion
  - Removed `reportUnknownLambdaType` exclusion
- **All `Any` types replaced** with proper TypedDicts and explicit annotations

### Benefits

- **Type safety badge now accurate** - `Pyright-Strict` reflects true compliance
- **Better IDE support** - Enhanced autocomplete and error detection
- **Improved maintainability** - Complete type coverage catches bugs early

---

## 📦 Updated Statistics

| Metric | v2.0.0 | v2.1.0 |
|--------|--------|--------|
| MCP Tools | 16 | 16 |
| Workflow Prompts | 11 | 14 (+3 PR + Actions) |
| MCP Resources | 8 | 13 (+5 Actions) |
| Pyright Issues | 700+ exclusions | 0 |

---

## 🔧 Database Changes

New columns added (automatic migration):
- `workflow_run_id` - GitHub Actions workflow run ID
- `workflow_name` - Workflow name for quick reference
- `workflow_status` - Workflow status (queued/in_progress/completed)

New index:
- `idx_memory_journal_workflow_run_id`

---

## 📚 Documentation Updates

- Updated all wiki pages with v2.1.0 references
- Added comprehensive GitHub Actions documentation
- Updated prompts guide with `actions-failure-digest`
- Updated visualization guide with `memory://graph/actions`

---

## ⬆️ Upgrade Instructions

### PyPI

```bash
pip install --upgrade memory-journal-mcp
```

### Docker

```bash
docker pull writenotenow/memory-journal-mcp:latest
```

**No configuration changes required!** Database migrations run automatically on startup.

---

## 🔗 Links

- **Compare Changes**: https://github.com/neverinfamous/memory-journal-mcp/compare/v2.0.1...v2.1.0
- **Full Changelog**: [CHANGELOG.md](../CHANGELOG.md)
- **Wiki**: https://github.com/neverinfamous/memory-journal-mcp/wiki
- **Docker Hub**: https://hub.docker.com/r/writenotenow/memory-journal-mcp
- **PyPI**: https://pypi.org/project/memory-journal-mcp/

---

**Built by developers, for developers.** 🚀
