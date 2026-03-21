# Agent Experience Test — memory-journal-mcp

> **Purpose:** Validate that the server instructions (`essential`/`standard` tiers) are sufficient for an agent to operate the server cold — with **zero** tool checklists, parameter tables, or behavioral hints in the prompt.

## How to Run

Run **each pass** as a separate conversation with the corresponding `--tool-filter`. Each pass tests whether the agent can complete realistic tasks using only the tools + resources available under that filter.

| Pass | `--tool-filter` | Tools | Scenarios |
|------|-----------------|-------|-----------|
| Pass 1 | `essential` | Core, Search, Analytics, Relationships (~22) | 1–8 |
| Pass 2 | `standard` | Essential + Export, Admin, Backup (~28) | 9–13 |
| Pass 3 | `full` | Standard + GitHub, Team (~62) | 14–21 |
| Pass 4 | `codemode` | Code Mode only (1) | 22–24 |

> **Important:** Do NOT combine passes. Each pass is a fresh conversation with a clean context. The agent has never used this server before.

## Rules

1. **Do NOT read** `test-tools.md`, `test-tools2.md`, `test-tools-codemode.md`, or any other test documentation before running these scenarios
2. **Do NOT read** source code files (`src/`) — you are a user, not a developer
3. **DO** use the MCP instructions you received during initialization
4. **DO** read `memory://briefing` as your first action (the instructions say to)
5. **DO** use `memory://health`, `memory://recent`, and other resources for discovery
6. The server is already running and connected to a journal database with existing entries

## Success Criteria

| Symbol | Meaning |
|--------|---------|
| ✅ | Agent completed the task correctly without external help |
| ⚠️ | Agent completed but needed multiple retries or used wrong tools first |
| ❌ | Agent failed or produced incorrect results |
| 📖 | Agent read a resource — note which ones |

Track **every** resource read and whether it provided what was needed. Gaps are the actionable finding.

## Reporting Format

For each scenario, report:

```
### Scenario N: [title]
**Result:** ✅/⚠️/❌
**Resources read:** memory://briefing, memory://health (or "none beyond instructions")
**Tools used:** create_entry, search_entries, ...
**Issues:** (any gaps in instructions, confusing tool names, missing guidance)
```

---

## Pass 1: `essential`

**Tool groups under test:** `core`, `search`, `analytics`, `relationships`, `codemode`

### Phase 1 — Session Start & Discovery

#### Scenario 1 — Cold start briefing
Start a new session. The instructions say to do something first — can the agent figure out what? Does it correctly present the briefing to the user?

> **What we're testing:** Does the agent follow the "REQUIRED: read `memory://briefing`" instruction without being told?

#### Scenario 2 — Server health check
Check if the server is healthy. What database backend is it using? How many entries exist? What tools are available?

#### Scenario 3 — Recent context
What has the user been working on recently? Summarize the last few journal entries.

### Phase 2 — Core Entry Operations

#### Scenario 4 — Create and retrieve
Create a journal entry about "Evaluating new CI/CD pipeline options — comparing GitHub Actions vs GitLab CI". Then retrieve it by ID and verify all fields.

#### Scenario 5 — Search by text
Search for entries about "performance" or "optimization". Try both keyword search and semantic search. Which returns better results?

#### Scenario 6 — Date-range search
Find all entries from the last 7 days. Filter to only `bug_fix` or `feature_implementation` types if any exist.

### Phase 3 — Relationships & Analytics

#### Scenario 7 — Link entries
Create two related entries: a decision entry ("Decided to use PostgreSQL for the new service") and an implementation entry ("Implemented PostgreSQL connection pooling"). Link them with the appropriate relationship type.

#### Scenario 8 — Analyze patterns
Get journal statistics. What entry types are most common? What's the activity trend? What's the relationship complexity?

---

## Pass 2: `standard`

**Tool groups under test:** Essential groups + `export`, `admin`, `backup`

### Phase 4 — Export & Backup

#### Scenario 9 — Export entries
Export the most recent 20 entries in JSON format. Then export again in markdown. Which format is more useful for sharing?

#### Scenario 10 — Backup lifecycle
Create a backup of the journal. List existing backups. How would you restore one? (Don't actually restore unless the agent confirms it understands the consequences.)

#### Scenario 11 — Tag management
List all tags in use. Are there any that look like duplicates or inconsistencies (e.g., `bug` vs `bug-fix`)? If so, how would you consolidate them?

### Phase 5 — Admin Operations

#### Scenario 12 — Vector index management
Check the vector index stats. Is the index count matching the entry count? If not, what should be done?

#### Scenario 13 — Cleanup
Find and soft-delete any test entries created during this session. Verify they're gone from search results but could be recovered.

---

## Pass 3: `full`

**Tool groups under test:** Standard groups + `github`, `team`

### Phase 6 — GitHub Integration

#### Scenario 14 — Repository context
Get the GitHub context. What repo is connected? How many open issues and PRs are there? What's the CI status?

#### Scenario 15 — Issue lifecycle
Create a GitHub issue titled "Improve error handling in webhook processor" with labels `bug` and `priority:high`. Create a linked journal entry documenting the decision. Then close the issue with a resolution note.

> **What we're testing:** Can the agent discover `create_github_issue_with_entry` and `close_github_issue_with_entry` without being told they exist?

#### Scenario 16 — PR tracking
List recent PRs. Pick one and check if any journal entries are linked to it via `memory://prs/{n}/entries`.

#### Scenario 17 — Kanban board
Find the user's GitHub project boards. Display the Kanban board and describe the workflow state. Move an item if appropriate.

> **Note:** The agent needs to discover `get_kanban_board` and figure out project numbers. This tests whether the instructions are sufficient.

#### Scenario 18 — Milestone tracking
List milestones. What's the completion percentage? Are any overdue?

### Phase 7 — Cross-Feature Workflows

#### Scenario 19 — End-of-day summary
Simulate an end-of-day workflow: review today's entries, summarize accomplishments, check GitHub for any CI failures or new issues, and create a retrospective entry.

#### Scenario 20 — Team knowledge sharing
Create a team entry about a design decision. Search the team database for related entries. Check team statistics to see the contributor breakdown. Export this week's team entries as markdown.

> **What we're testing:** Can the agent discover the expanded team tools (`team_get_statistics`, `team_export_entries`, `team_search_by_date_range`, `team_semantic_search`, `team_get_cross_project_insights`) and compose a cross-tool workflow?

#### Scenario 21 — Context bundle
Use the `get-context-bundle` prompt to pull together full session context. Is it comprehensive?

---

## Pass 4: `codemode`

**Tool groups under test:** `codemode` (1)

### Phase 8 — Code Mode Discovery

#### Scenario 22 — Cold-start Code Mode
Using only `mj_execute_code`, discover what API groups are available (`mj.help()`). List the groups and pick one to explore.

#### Scenario 23 — Multi-step workflow
Using a single `mj_execute_code` call: search for entries about "deployment", get statistics, and create a summary entry linking findings. Compare token efficiency vs individual tool calls.

#### Scenario 24 — Read-only mode
Execute code with `readonly: true`. Verify that write operations fail gracefully. What error message does the agent get?

---

## Post-Test Summary

Compile findings across all passes into:

1. **Instruction gaps** — scenarios where the instructions were missing, incomplete, or misleading
2. **Discovery friction** — cases where the agent struggled to find the right tool or resource
3. **Resource sufficiency** — were `memory://briefing`, `memory://health`, etc. enough context?
4. **Suggested improvements** — specific additions to instruction tiers or resource content

> **Key metric:** How many of the 24 scenarios did the agent complete on the first try with ≤1 resource read? This measures whether the tiered instructions + tool descriptions are self-sufficient.
