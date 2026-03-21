# Resource Testing Prompt

**Step 1:** Read this file to understand the testing structure.

**Step 2:** Test all 22 `memory://` resources by reading each resource URI. For each resource, validate the output against the expected structure documented below.

## Static Resources (15)

| # | Resource URI | Expected Output Shape | Pass Criteria |
|---|---|---|---|
| 1 | `memory://briefing` | `{ userMessage, entries, teamEntries?, github?, milestones?, ... }` | `userMessage` non-empty string with key facts |
| 2 | `memory://instructions` | Markdown text | ≥8,000 chars; contains `## Tool Parameter Reference` |
| 3 | `memory://health` | `{ status, database, vectorIndex, github?, toolFilter?, ... }` | `status` is "healthy"; `database.sizeBytes` > 0 |
| 4 | `memory://recent` | `{ entries: [...] }` | Up to 10 entries; each has `id`, `content`, `timestamp` |
| 5 | `memory://significant` | `{ entries: [...] }` | Sorted by `importance` score descending |
| 6 | `memory://tags` | `{ tags: [{ id, name, count }] }` | Includes `id` field (unlike `list_tags` tool which omits it) |
| 7 | `memory://statistics` | `{ totalEntries, periodEntries, entryTypes, topTags }` | `totalEntries` ≥ 0; `entryTypes` is object |
| 8 | `memory://graph/recent` | Mermaid diagram text | Contains `graph` or `flowchart` directive, or empty if no relationships |
| 9 | `memory://graph/actions` | Mermaid diagram text | Requires CI/CD entries; may be empty |
| 10 | `memory://actions/recent` | `{ runs: [...] }` | Requires workflow-linked entries; may be empty |
| 11 | `memory://github/status` | `{ repository, openIssues, openPRs, ci, ... }` | Requires GITHUB_TOKEN; `repository` has `owner`, `name` |
| 12 | `memory://github/insights` | `{ stars, forks, traffic?, ... }` | Requires GITHUB_TOKEN; traffic requires push access |
| 13 | `memory://github/milestones` | `{ milestones: [...] }` | Open milestones with `completionPct`; may be empty |
| 14 | `memory://team/recent` | `{ entries: [...] }` | Requires TEAM_DB_PATH; returns error if unconfigured |
| 15 | `memory://team/statistics` | `{ totalEntries, entryTypes, authors, ... }` | Requires TEAM_DB_PATH; returns error if unconfigured |

## Template Resources (7)

Template resources require parameter substitution. Use known valid values from the journal or GitHub project.

| # | Resource URI Pattern | Parameter | Expected Output Shape | Pass Criteria |
|---|---|---|---|---|
| 16 | `memory://projects/{n}/timeline` | project_number | `{ entries: [...] }` | Entries linked to GitHub project; may be empty |
| 17 | `memory://issues/{n}/entries` | issue_number | `{ entries: [...] }` | Entries linked to issue; may be empty |
| 18 | `memory://prs/{n}/entries` | pr_number | `{ entries: [...] }` | Entries linked to PR; may be empty |
| 19 | `memory://prs/{n}/timeline` | pr_number | Markdown timeline text | PR lifecycle narrative; may be empty |
| 20 | `memory://kanban/{n}` | project_number | `{ projectTitle, columns: [...] }` | Requires GitHub Projects v2; `columns` has items by status |
| 21 | `memory://kanban/{n}/diagram` | project_number | Mermaid diagram text | Visual Kanban board; requires GitHub Projects v2 |
| 22 | `memory://milestones/{n}` | milestone_number | `{ title, state, openIssues, closedIssues, ... }` | Single milestone detail with completion % |

## How to Read Resources

Use the MCP resource reading mechanism. In AntiGravity, use `read_resource` with:
- **ServerName**: `memory-journal-mcp` (or whatever the server is named in your MCP config)
- **Uri**: The resource URI (e.g., `memory://briefing`)

Read each resource one at a time (or in parallel batches of 3-4) and validate the output.

## Prerequisites & Expected Limitations

These resources may return empty or error results depending on configuration — this is **expected** and should be noted but NOT reported as failures:

- **Unpopulated journal** — `memory://recent`, `memory://significant`, `memory://graph/*`, `memory://actions/recent` return empty arrays or empty diagrams.
- **No GITHUB_TOKEN / GITHUB_REPO_PATH** — `memory://github/status`, `memory://github/insights`, `memory://github/milestones`, both `memory://kanban/*`, and `memory://milestones/{n}` return errors or empty data.
- **No TEAM_DB_PATH** — Both `memory://team/*` resources return `{ success: false, error: "Team collaboration is not configured..." }`.
- **Template resources with invalid IDs** — Using nonexistent project/issue/PR/milestone numbers returns empty results, not errors.
- **`memory://github/insights` traffic** — Traffic data (views, clones, referrers, paths) requires push access to the repository.
- **`memory://prs/{n}/timeline`** — Returns a markdown narrative, not JSON. Validate it contains timeline formatting.

## Reporting Format

For each resource, report:
- ✅ **Pass**: Resource returns expected data shape with meaningful content
- ⚠️ **Partial**: Resource returns correct shape but some fields are empty/zero (note which fields and whether expected)
- ❌ **Fail**: Resource errors, returns wrong shape, or returns unexpectedly empty data

## Final Summary

Provide a summary table of all 22 resources with their pass/partial/fail status. List any issues that require code fixes (e.g., resource handler bugs, missing error handling) separately from infrastructure-dependent limitations.
