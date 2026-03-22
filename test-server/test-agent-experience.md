# Agent Experience Test — memory-journal-mcp

> **Purpose:** Validate that the server instructions (`essential`/`standard`/`full` tiers) and dynamic help resources are sufficient for an agent to operate the server cold — with **zero** tool checklists, parameter tables, or behavioral hints in the prompt.

## How to Run

Run **each pass** as a separate conversation with the corresponding `--tool-filter`. Each pass tests whether the agent can complete realistic tasks using only the tools + resources available under that filter. Instruction sections are **automatically gated** by the filter — e.g. Code Mode guidance only appears when `codemode` is enabled, GitHub patterns only when `github` is enabled.

| Pass   | `--tool-filter` | Groups                 | Tools | Scenarios |
| ------ | --------------- | ---------------------- | ----- | --------- |
| Pass 1 | `essential`     | core, codemode         | 7     | 1–6       |
| Pass 2 | `starter`       | core, search, codemode | 11    | 7–10      |
| Pass 3 | `full`          | All 10 groups          | 61    | 11–19     |
| Pass 4 | `codemode`      | codemode only          | 1     | 20–22     |

> **Important:** Do NOT combine passes. Each pass is a fresh conversation with a clean context. The agent has never used this server before.

## Rules

1. **Do NOT read** `test-tools.md`, `test-tools2.md`, `test-tools-codemode.md`, or any other test documentation before running these scenarios
2. **Do NOT read** test scripts (`test-filter-instructions.mjs`, `test-instruction-levels.mjs`, etc.)
3. **Do NOT read** source code files (`src/`) — you are a user, not a developer
4. **DO** use the MCP instructions you received during initialization
5. **DO** read `memory://briefing` as your first action (the instructions say to)
6. **DO** use `memory://health`, `memory://recent`, `memory://help`, and other resources for discovery
7. The server is already running and connected to a journal database with existing entries

## Success Criteria

| Symbol | Meaning                                                               |
| ------ | --------------------------------------------------------------------- |
| ✅     | Agent completed the task correctly without external help              |
| ⚠️     | Agent completed but needed multiple retries or used wrong tools first |
| ❌     | Agent failed or produced incorrect results                            |
| 📖     | Agent read a resource — note which ones                               |

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

> **What we're testing:** Can the agent discover `mj_execute_code` and the `mj.*` namespace from the instruction sections (which are present since `codemode` is enabled)? Does the agent discover Code Mode from the instructions and use it unprompted?

## Test Pass 1: `essential`

**Tool groups under test:** `core` (6 tools), `codemode` (1 tool) — 7 total
**Instruction sections present:** Core behaviors, Code Mode (namespace table)
**Instruction sections absent:** GitHub Integration, Copilot Review Patterns, `semantic_search` Quick Access

### Phase 1 — Session Start & Discovery

#### Scenario 1 — Cold start briefing

Start a new session. The instructions say to do something first — can the agent figure out what? Does it correctly present the briefing to the user?

> **What we're testing:** Does the agent follow the "REQUIRED: read `memory://briefing`" instruction without being told?

#### Scenario 2 — Server health check

Check if the server is healthy. What database backend is it using? How many entries exist? What tools are available?

#### Scenario 3 — Help resource discovery

Explore what tools are available using `memory://help`. Then look up a specific group's tool details via `memory://help/{group}`. Can the agent discover parameter signatures without instruction tables?

> **What we're testing:** Does the agent discover `memory://help` and use it for self-serve tool reference? Does it find `memory://help/gotchas`?

### Phase 2 — Core Entry Operations

#### Scenario 4 — Create and retrieve

Create a journal entry about "Evaluating new CI/CD pipeline options — comparing GitHub Actions vs GitLab CI". Then retrieve it by ID and verify all fields.

#### Scenario 5 — Recent context

What has the user been working on recently? Summarize the last few journal entries.

#### Scenario 6 — Code Mode quick workflow

Using `mj_execute_code`, create an entry and immediately retrieve it in a single call.

---

> **What we're testing:** Can the agent discover `create_github_issue_with_entry` and `close_github_issue_with_entry` without being told they exist? Can the agent find `get_vector_index_stats` (part of the `search` group) and interpret the results?

> **Note:** In scenario 18, the agent needs to discover `get_kanban_board` and figure out project numbers. This tests whether the instructions + `memory://help/github` are sufficient.

## Test Pass 2: `starter`

**Tool groups under test:** `core` (6 tools), `search` (4 tools), `codemode` (1 tool) — 11 total
**Instruction sections present:** Core behaviors, Code Mode, `semantic_search` Quick Access row
**Instruction sections absent:** GitHub Integration, Copilot Review Patterns

### Phase 3 — Search Operations

#### Scenario 7 — Search by text

Search for entries about "performance" or "optimization". Try both keyword search and semantic search. Which returns better results?

> **What we're testing:** Does the `semantic_search` Quick Access row in the instructions guide the agent to try semantic search alongside FTS5?

#### Scenario 8 — Date-range search

Find all entries from the last 7 days. Filter to only `bug_fix` or `feature_implementation` types if any exist.

#### Scenario 9 — Vector index awareness

Check the vector index stats. Is the index count matching the entry count?

#### Scenario 10 — Combined search + Code Mode

Using a single `mj_execute_code` call: search for entries, then summarize findings as a new entry. Compare the experience to doing it with individual tools.

---

> **What we're testing:** Can the agent discover the 20 team tools and compose a cross-tool workflow? Does `memory://help/team` provide enough parameter guidance?

## Test Pass 3: `full`

**Tool groups under test:** All 10 groups — 61 tools total
**Instruction sections present:** All sections (Core, Code Mode, GitHub Integration, Copilot Review Patterns, `semantic_search` Quick Access, Help Pointers)

### Phase 4 — Relationships & Analytics

#### Scenario 11 — Link entries

Create two related entries: a decision entry ("Decided to use PostgreSQL for the new service") and an implementation entry ("Implemented PostgreSQL connection pooling"). Link them with the appropriate relationship type.

#### Scenario 12 — Analyze patterns

Get journal statistics. What entry types are most common? What's the activity trend? What's the relationship complexity?

### Phase 5 — Export, Backup & Admin

#### Scenario 13 — Export entries

Export the most recent 20 entries in JSON format. Then export again in markdown. Which format is more useful for sharing?

#### Scenario 14 — Backup lifecycle

Create a backup of the journal. List existing backups. How would you restore one? (Don't actually restore unless the agent confirms it understands the consequences.)

#### Scenario 15 — Tag management & cleanup

List all tags in use. Are there any that look like duplicates or inconsistencies (e.g., `bug` vs `bug-fix`)? If so, how would you consolidate them? Find and soft-delete any test entries created during this session.

### Phase 6 — GitHub Integration

#### Scenario 16 — Repository context

Get the GitHub context. What repo is connected? How many open issues and PRs are there? What's the CI status?

#### Scenario 17 — Issue lifecycle

Create a GitHub issue titled "Improve error handling in webhook processor" with labels `bug` and `priority:high`. Create a linked journal entry documenting the decision. Then close the issue with a resolution note.

#### Scenario 18 — Kanban board

Find the user's GitHub project boards. Display the Kanban board and describe the workflow state.

### Phase 7 — Team & Cross-Feature Workflows

#### Scenario 19 — Team knowledge sharing

Create a team entry about a design decision. Search the team database for related entries. Check team statistics to see the contributor breakdown. Export this week's team entries as markdown.

---

## Test Pass 4: `codemode`

**Tool groups under test:** `codemode` (1 tool)
**Instruction sections present:** Core behaviors, Code Mode (namespace table)
**Instruction sections absent:** GitHub Integration, Copilot Review Patterns, `semantic_search` Quick Access

### Phase 8 — Code Mode as Sole Interface

#### Scenario 20 — Cold-start Code Mode

Using only `mj_execute_code`, discover what API groups are available (`mj.help()`). List the groups and pick one to explore.

#### Scenario 21 — Multi-step workflow

Using a single `mj_execute_code` call: search for entries about "deployment", get statistics, and create a summary entry linking findings. Compare token efficiency vs individual tool calls.

#### Scenario 22 — Read-only mode

Execute code with `readonly: true`. Verify that write operations fail gracefully. What error message does the agent get?

---

## Post-Test Summary

Compile findings across all passes into:

1. **Instruction gaps** — scenarios where the instructions were missing, incomplete, or misleading
2. **Help resource sufficiency** — did `memory://help/{group}` provide enough parameter detail to replace the old instruction tables?
3. **Filter gating accuracy** — did the absent instruction sections (e.g. no GitHub in Pass 1–2) cause confusion, or was the agent unaware of those tools (correctly)?
4. **Discovery friction** — cases where the agent struggled to find the right tool or resource
5. **Resource sufficiency** — were `memory://briefing`, `memory://health`, `memory://help`, etc. enough context?
6. **Suggested improvements** — specific additions to instruction tiers or resource content

> **Key metric:** How many of the 22 scenarios did the agent complete on the first try with ≤1 resource read? This measures whether the tiered instructions + dynamic help resources are self-sufficient.
