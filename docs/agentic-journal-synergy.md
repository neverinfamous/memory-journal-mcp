# Agentic Journal Synergy — Preliminary Plan

> **Status**: Concept / Future Exploration
> **Prerequisites**: Agentic workflows battle-tested, MCP server deployed in HTTP mode

## Overview

The memory-journal-mcp server currently serves as persistent memory for IDE agents. Separately, GitHub Copilot Coding Agent workflows (docs drift detection, CI health monitoring) run on the repository's CI infrastructure. These two systems operate independently — but there is a natural integration point where the agentic workflows could **write findings into the journal**, creating a persistent, searchable audit trail that IDE agents see at session start.

## Current State

```
┌──────────────────────┐     ┌──────────────────────┐
│  IDE Agent           │     │  Copilot Workflows   │
│  (AntiGravity/Cursor)│     │  (GitHub Actions)    │
│                      │     │                      │
│  Reads/writes        │     │  Posts PR comments   │
│  memory-journal-mcp  │     │  Creates issues      │
│                      │     │  Opens PRs           │
└──────────┬───────────┘     └──────────────────────┘
           │                          (no connection)
           ▼
   ┌───────────────┐
   │  SQLite DB    │
   │  (journal)    │
   └───────────────┘
```

## Proposed State

```
┌──────────────────────┐     ┌─────────────────────┐
│  IDE Agent           │     │  Copilot Workflows   │
│  (AntiGravity/Cursor)│     │  (GitHub Actions)    │
│                      │     │                      │
│  Reads/writes        │     │  Writes findings     │
│  memory-journal-mcp  │     │  via HTTP MCP calls  │
│                      │     │                      │
└──────────┬───────────┘     └──────────┬───────────┘
           │                            │
           ▼                            ▼
   ┌───────────────────────────────────────┐
   │  memory-journal-mcp (HTTP mode)       │
   │  SQLite DB (shared journal)           │
   └───────────────────────────────────────┘
```

## Concrete Use Cases

### 1. Documentation Drift Findings

**Workflow**: `docs-drift-detector.md`
**Tag**: `docs-drift`

When drift is detected, the agent writes a journal entry:

```javascript
create_entry({
  content:
    'PR #47: README.md tool count says 44 but tool-reference.md lists 46. DOCKER_README.md version badge says v5.1.2 but package.json is v5.2.0.',
  entry_type: 'documentation',
  tags: ['docs-drift', 'automated', 'readme'],
  pr_number: 47,
})
```

**IDE agent benefit**: Before updating docs, the agent searches `search_entries({ tags: ["docs-drift"] })` to see what patterns of drift recur — informing which sections are most fragile and need structural fixes (e.g., dynamic generation instead of hardcoded values).

### 2. CI Health Findings

**Workflow**: `ci-health-monitor.md`
**Tag**: `ci-health`

When CI deprecations or issues are found:

```javascript
create_entry({
  content:
    'actions/checkout@v5 deprecated — upgrade to v6. TruffleHog action still on Node 20 runtime. Dependabot missing Docker ecosystem.',
  entry_type: 'maintenance',
  tags: ['ci-health', 'automated', 'github-actions'],
})
```

**IDE agent benefit**: The agent can proactively fix CI issues before they become blocking, and track the health trend over time via `get_analytics`.

## Architecture Requirements

### Option A: Direct HTTP Calls (Simplest)

The agentic workflow `.md` prompts instruct Copilot to make HTTP requests to the journal's HTTP endpoint:

```bash
curl -X POST https://journal.example.com/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -d '{"method":"tools/call","params":{"name":"create_entry","arguments":{...}}}'
```

**Pros**: Zero changes to memory-journal-mcp code
**Cons**: Requires deployed HTTP instance, OAuth/token management in CI

### Option B: MCP Client in CI (Richer)

Add memory-journal-mcp as an MCP server available to the Copilot agent:

```yaml
# In the .md workflow frontmatter
tools:
  - name: memory-journal
    type: mcp
    command: npx -y memory-journal-mcp
    env:
      DB_PATH: ./memory-journal.db
```

**Pros**: Full MCP protocol, agent uses `create_entry` naturally
**Cons**: Requires `gh-aw` to support MCP tool sources (may not be available yet)

### Option C: GitHub API Proxy (Interim)

Use GitHub Issues or Discussions as the transport layer — the agentic workflow creates a labeled issue, and the IDE agent reads it via the existing GitHub integration:

```javascript
// Agentic workflow creates a GitHub issue
create - issue({ title: '[deps-audit] 2026-03-13', labels: ['deps-audit', 'automated'] })

// IDE agent sees it via memory-journal's GitHub integration
// Already built into memory://briefing
```

**Pros**: Works today with zero changes
**Cons**: Loses journal-specific features (tags, search, analytics, relationships)

## Implementation Phases

### Phase 1: Validate Concept (Option C)

Use GitHub Issues as the transport. No code changes needed. The workflows already create issues (fallback) and PRs. Add structured labels for filtering.

### Phase 2: Deploy HTTP Endpoint

Deploy memory-journal-mcp in HTTP mode (Docker or bare metal). Set up OAuth for CI authentication. Test with manual `curl` calls from GitHub Actions.

### Phase 3: Integrate Workflows

Update the 3 agentic workflow `.md` prompts to call the journal's HTTP endpoint after their primary task. Add a new `automated` entry type and corresponding `search_entries` filter.

### Phase 4: IDE Agent Awareness

Update `memory://briefing` to surface automated entries separately (e.g., "🤖 Automated Findings" section). Update server instructions to guide IDE agents on how to leverage automated findings.

## Open Questions

1. **Where to host the HTTP endpoint?** — Cloudflare Worker, VPS, or same machine as the dev environment?
2. **Authentication for CI?** — OAuth token in GitHub Secrets, or shared API key?
3. **Entry retention?** — Should automated entries expire after N days, or persist indefinitely?
4. **Entry deduplication?** — If the same drift pattern recurs across PRs, should entries be merged or kept separate for trend analysis?
