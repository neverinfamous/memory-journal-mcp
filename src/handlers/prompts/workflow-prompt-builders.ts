/**
 * Memory Journal MCP Server - Workflow Prompt Text & Context Builders
 *
 * Extracted from `workflow-helpers.ts` to keep that module under the 450-line ceiling
 * and keep every generator function <= 80 lines.
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { RELATIONSHIP_TYPES } from '../../types/entities.js'
import { logger } from '../../utils/logger.js'
import { markUntrustedContent, markUntrustedContentInline } from '../../utils/security-utils.js'
import { isRecord } from '../../utils/type-guards.js'

export function buildSummaryPromptText(params: {
    target: 'personal' | 'team'
    registryHint: string
    entrySummary: string
    attributionArgs: string
    cliFlags: string
}): string {
    const { target, registryHint, entrySummary, attributionArgs, cliFlags } = params
    return `Create a ${target === 'team' ? 'team ' : ''}session summary journal entry using EXACTLY this template:

**Required YAML Frontmatter:**
At the top of your markdown file, include a YAML frontmatter block with the following keys:
\`\`\`yaml
---
type: "retrospective"
tags: ["session-summary", "your-tag-1", "your-tag-2"]
workspace: <Repository name - OPTIONAL, auto-resolved from active workspace>
project: <Positive integer ID - OPTIONAL, auto-resolved from active workspace>
impact: <Decimal score analyzing blast radius (e.g., 0.9+ for core architecture, 0.1 for docs)>
trust: <Decimal score analyzing testing rigor. 0.3-0.5 for unverified, 0.8-1.0 if rigorously tested>
validation_status: "passed" # or "none", or "failed"
auto_context: 
  type: "session-commits"
  commits: ["<sha>"]
  branch: "<branch_name>"
  pr: <number>
relationships: 
  - target_id: 123
    relation_type: "resolved" # one of: ${RELATIONSHIP_TYPES.join(', ')}
---
\`\`\`

**Required Content Structure (use EXACTLY these section headers):**
\`\`\`
## Accomplished
- [List non-code strategic items, decisions, and research. Do NOT list routine code changes or commits, as those belong in Git]

## Unfinished / Blocked
- [List pending items, blockers, open questions — or "None" if everything is complete]

## Context for Next Session
- [List key context: relevant entry IDs, branch names, PR numbers, pending decisions]

## Commits
- \`<sha>\`: [Short commit summary or "None" if no commits were made]
\`\`\`

**Rules:**
- Do NOT add extra top-level sections (no "## Summary", "## Overview", "## Notes", etc.)
- Do NOT omit any of the four required sections
- Use bullet points within each section
- Reference specific entry IDs, file names, and PR numbers where relevant
- To populate \`auto_context.commits\`, call \`mj.git.getCommitHistory({ limit: 20 })\` inside \`mj_execute_code\` (or \`get_commit_history\`) to retrieve recent commit SHAs. Do NOT use raw \`git log\`.
- Note: \`workspace_id\` and \`project_number\` are automatically resolved from your active workspace context if omitted.
${registryHint}- If you lose track of your project number, workspace, or agent ID, read the \`memory://agent-context/{repo}\` resource to retrieve it instead of reloading the full briefing (which wastes tokens)

**Recent Entries (for context):**
${markUntrustedContent(entrySummary)}

**Execution:**
- **Option 1 (Code Mode / MCP Tool - Recommended):** Execute directly via \`mj.core.createEntry({ content: "...", entry_type: "retrospective", tags: ["session-summary"], auto_context: { commits: ["<sha>"] }${attributionArgs}${target === 'team' ? ', share_with_team: true' : ''} })\`.
- **Option 2 (CLI Scratch File):** Write markdown file (with YAML frontmatter) to your scratch directory (e.g. \`<appDataDir>\\brain\\<conversation-id>\\scratch\\\`) then execute: \`memory-journal-mcp entry create ${target === 'team' ? '--team ' : ''}${cliFlags}--file <scratch_dir>/session.md\``
}

export function fetchTargetEntryContext(
    targetDb: IDatabaseAdapter,
    workspaceId: string,
    projectNumber?: number
): string {
    try {
        const rawRes: unknown = targetDb.getRecentEntries(
            1,
            undefined,
            'timestamp',
            undefined,
            false,
            workspaceId,
            projectNumber
        )
        const recent: unknown = Array.isArray(rawRes)
            ? rawRes[0]
            : isRecord(rawRes) && Array.isArray(rawRes['entries'])
              ? rawRes['entries'][0]
              : undefined
        if (!isRecord(recent)) return ''
        return `
**Target Entry Details (Pre-fetched for your convenience):**
- **ID:** ${String(recent['id'])}
- **Version:** ${String(recent['version'])}
- **Type:** ${markUntrustedContentInline(String(recent['entryType']))}
- **Tags:** ${recent['tags'] !== null && recent['tags'] !== undefined ? markUntrustedContentInline(JSON.stringify(recent['tags'])) : '[]'}
- **Content:**
${markUntrustedContent(String(recent['content']))}
`
    } catch (err) {
        logger.debug('Target entry pre-fetch failed', {
            module: 'workflow-prompts',
            error: String(err),
        })
        return ''
    }
}

export function buildUpdateEntryPromptText(params: {
    target: 'personal' | 'team'
    entryContext: string
    registryHint: string
    updateApiCall: string
    attributionArgs: string
    cliFlags: string
}): string {
    const { target, entryContext, registryHint, updateApiCall, attributionArgs, cliFlags } = params
    return `Update an existing ${target === 'team' ? 'team ' : ''}journal entry safely.

**Step 1: Identify the Target Entry**
- The most recent entry has been pre-fetched below for your convenience. If the user did not specify an ID, you MUST update this pre-fetched entry.
- You do NOT need to fetch it using mj.core.getEntryById unless the user asks to update a DIFFERENT entry ID.
${entryContext}

**Step 2: Apply Conditional Formatting Rules**
Look at the tags and structure of the target entry:
- If it has the \`session-summary\` tag: You MUST preserve the exact 4-header structure (\`## Accomplished\`, \`## Unfinished / Blocked\`, \`## Context for Next Session\`, \`## Commits\`). Do not flatten the text; only append or modify the relevant bullet points.
- If it is a standard entry: Keep your modifications concise and under 150 words.

**Step 3: Execute the Update**
- You MUST pass the existing \`version\` as the \`expected_version\` parameter to prevent concurrent overwrites.
- Ensure you write the full updated \`content\` string to a markdown file in your scratch directory.
- If you want to modify fields like tags, trust, or impact, simply add a YAML frontmatter block (\`---\`... \`---\`) to the top of your markdown file. Otherwise, omit it to preserve existing values.

**Rules:**
${registryHint}- If you lose track of your project number, workspace, or agent ID, read the \`memory://agent-context/{repo}\` resource to retrieve it instead of reloading the full briefing (which wastes tokens)

**Execution:**
- **Option 1 (Code Mode / MCP Tool):** Execute via \`${updateApiCall}({ entry_id: <ENTRY_ID>, expected_version: <VERSION>, content: "..."${attributionArgs} })\`.
- **Option 2 (CLI Scratch File):** Write your updated markdown file to your scratch directory (e.g. \`<appDataDir>\\brain\\<conversation-id>\\scratch\\\`) to avoid shell quotes. Then execute: \`memory-journal-mcp entry update ${target === 'team' ? '--team ' : ''}${cliFlags}--id <ENTRY_ID> --expected-version <VERSION> --file <scratch_dir>/updated_entry.md\``
}
