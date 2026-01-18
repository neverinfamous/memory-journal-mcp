/**
 * Server instructions for Memory Journal MCP.
 *
 * These instructions are automatically sent to MCP clients during initialization,
 * providing guidance for AI agents on tool usage.
 *
 * v3.1.6: Optimized for token efficiency with tiered instruction levels.
 */

import type { ToolGroup } from '../types/index.js'
import { TOOL_GROUPS } from '../filtering/ToolFilter.js'

/**
 * Resource definition for instruction generation
 */
export interface ResourceDefinition {
    uri: string
    name: string
    description?: string
}

/**
 * Prompt definition for instruction generation
 */
export interface PromptDefinition {
    name: string
    description?: string
}

/**
 * Latest entry snapshot for initial briefing
 */
export interface LatestEntrySnapshot {
    id: number
    timestamp: string
    entryType: string
    content: string
}

/**
 * Instruction detail level for token efficiency
 * - essential: ~200 tokens - Core behaviors only (for token-constrained clients)
 * - standard: ~400 tokens - + GitHub patterns (default)
 * - full: ~600 tokens - + tool/resource listings
 */
export type InstructionLevel = 'essential' | 'standard' | 'full'

/**
 * Essential behavioral guidance (~200 tokens)
 * Core patterns every AI agent should follow.
 */
const ESSENTIAL_INSTRUCTIONS = `# memory-journal-mcp

## Session Start
1. Read \`memory://briefing\` for project context
2. **Show the \`userMessage\` to the user** (it contains a formatted summary of project context)
3. Proceed with the user's request

## Behaviors
- **Create entries for**: implementations, decisions, bug fixes, milestones, user requests to "remember"
- **Search before**: major decisions, referencing prior work, understanding project context
- **Link entries**: implementation→spec, bugfix→issue, followup→prior work

## Quick Access
| Purpose | Action |
|---------|--------|
| Session context | \`memory://briefing\` |
| Recent entries | \`memory://recent\` |
| Health/time | \`memory://health\` |
| Semantic search | \`semantic_search(query)\` |
| Full context | \`get-context-bundle\` prompt |
`

/**
 * GitHub integration patterns (~150 additional tokens)
 */
const GITHUB_INSTRUCTIONS = `
## GitHub Integration
- Include \`issue_number\`/\`pr_number\` in \`create_entry\` to auto-link
- After closing issue/merging PR → create summary entry with learnings
- CI failures → \`actions-failure-digest\` prompt or \`memory://actions/recent\`
- Kanban: \`get_kanban_board(project_number)\` → \`move_kanban_item\` → document completion
- GitHub tools auto-detect owner/repo from git context; specify explicitly if null
`

/**
 * Server access instructions - critical for AI agents to call tools correctly
 */
const SERVER_ACCESS_INSTRUCTIONS = `
## How to Access This Server

### Calling Tools
Use \`CallMcpTool\` with server name \`user-memory-journal-mcp\`:
\`\`\`
CallMcpTool(server: "user-memory-journal-mcp", toolName: "create_entry", arguments: {...})
\`\`\`

### Listing Resources
Use \`ListMcpResources\` with server name:
\`\`\`
ListMcpResources(server: "user-memory-journal-mcp")
\`\`\`
Do NOT try to browse filesystem paths for MCP tool/resource definitions - use the MCP protocol directly.

### Fetching Resources
Use \`FetchMcpResource\` with server name and \`memory://\` URI:
\`\`\`
FetchMcpResource(server: "user-memory-journal-mcp", uri: "memory://recent")
FetchMcpResource(server: "user-memory-journal-mcp", uri: "memory://kanban/1")
\`\`\`

## Quick Health Check
Fetch \`memory://health\` to verify server status, database stats, and tool availability.
`

/**
 * Tool parameter reference - essential for correct tool invocation
 */
const TOOL_PARAMETER_REFERENCE = `
## Tool Parameter Reference

### Entry Operations
| Tool | Required Parameters | Optional Parameters |
|------|---------------------|---------------------|
| \`create_entry\` | \`content\` (string) | \`entry_type\`, \`tags\` (array), \`is_personal\` (bool) |
| \`create_entry_minimal\` | \`content\` (string) | none |
| \`get_entry_by_id\` | \`entry_id\` (number) | none |
| \`get_recent_entries\` | none | \`limit\` (default 10), \`is_personal\` (bool) |
| \`update_entry\` | \`entry_id\` (number) | \`content\`, \`tags\`, \`entry_type\`, \`is_personal\` |
| \`delete_entry\` | \`entry_id\` (number) | \`permanent\` (bool, default false) |
| \`list_tags\` | none | none |

### Search Tools
| Tool | Required Parameters | Optional Parameters |
|------|---------------------|---------------------|
| \`search_entries\` | \`query\` (string) | \`limit\`, \`entry_type\`, \`tags\` |
| \`search_by_date_range\` | \`start_date\`, \`end_date\` (YYYY-MM-DD) | \`tags\`, \`entry_type\` |
| \`semantic_search\` | \`query\` (string) | \`limit\`, \`similarity_threshold\` (default 0.3) |
| \`get_vector_index_stats\` | none | none |

### Relationship Tools
| Tool | Required Parameters | Notes |
|------|---------------------|-------|
| \`link_entries\` | \`from_entry_id\`, \`to_entry_id\` (numbers) | Types: \`evolves_from\`, \`references\`, \`implements\`, \`clarifies\`, \`response_to\`, \`blocked_by\`, \`resolved\`, \`caused\` |
| \`visualize_relationships\` | \`entry_id\` (number) | Optional \`depth\` (default 2). Returns Mermaid diagram. |

### GitHub Tools
| Tool | Required Parameters | Notes |
|------|---------------------|-------|
| \`get_github_context\` | none | Returns repo info, open issues/PRs |
| \`get_github_issues\` | none | Optional \`state\` (open/closed/all), \`limit\` |
| \`get_github_prs\` | none | Optional \`state\`, \`limit\` |
| \`get_github_issue\` | \`issue_number\` (number) | Fetches single issue details |
| \`get_github_pr\` | \`pr_number\` (number) | Fetches single PR details |

GitHub tools auto-detect owner/repo from GITHUB_REPO_PATH. If \`detectedOwner\`/\`detectedRepo\` are null in response, specify \`owner\` and \`repo\` parameters explicitly.

### Kanban Tools (GitHub Projects v2)
| Tool | Required Parameters | Notes |
|------|---------------------|-------|
| \`get_kanban_board\` | \`project_number\` (number) | Returns columns with items grouped by Status |
| \`move_kanban_item\` | \`project_number\`, \`item_id\` (string), \`target_status\` (string) | \`item_id\` is the GraphQL node ID from board items |

**Finding the right project**: User may have multiple projects. Use \`get_kanban_board\` with different project numbers (1, 2, 3...) to find the correct one by checking \`projectTitle\`.

**Default Status columns** (typical GitHub Projects v2):
- \`Backlog\` - Items not yet started
- \`Ready\` - Ready to be picked up
- \`In progress\` - Actively being worked on
- \`In review\` - In review
- \`Done\` - Completed

Note: Status columns are dynamic per project. The \`statusOptions\` in the response shows available statuses for that specific project.

Kanban resources:
- \`memory://kanban/{project_number}\` - JSON board data
- \`memory://kanban/{project_number}/diagram\` - Mermaid visualization

### Admin Tools
| Tool | Required Parameters | Notes |
|------|---------------------|-------|
| \`backup_journal\` | none | Optional \`backup_name\` |
| \`list_backups\` | none | Returns available backup files |
| \`restore_backup\` | \`backup_filename\`, \`confirm: true\` | Creates auto-backup before restore |
| \`add_to_vector_index\` | \`entry_id\` (single number) | Indexes one entry for semantic search |
| \`rebuild_vector_index\` | none | Re-indexes all entries |

### Export Tools
| Tool | Required Parameters | Notes |
|------|---------------------|-------|
| \`export_entries\` | none | Optional \`format\` (json/markdown), \`limit\`, \`tags\` |

## Entry Types
Valid values for \`entry_type\` parameter:
- \`personal_reflection\` (default) - Personal thoughts and notes
- \`technical_note\` - Technical documentation
- \`bug_fix\` - Bug fixes and resolutions
- \`progress_update\` - Project progress updates
- \`code_review\` - Code review notes
- \`deployment\` - Deployment records
- \`technical_achievement\` - Milestones and breakthroughs

## Field Notes
- **\`autoContext\`**: Reserved for future automatic context capture. Currently always \`null\`.
- **\`memory://tags\` vs \`list_tags\`**: Resource includes \`id\`, \`name\`, \`count\`; tool returns only \`name\`, \`count\`.
- **Tag naming**: Use lowercase with dashes (e.g., \`bug-fix\`, \`phase-2\`). Use \`merge_tags\` to consolidate duplicates (e.g., merge \`phase2\` into \`phase-2\`).
- **\`merge_tags\` behavior**: Only updates non-deleted entries. Deleted entries retain their original tags.
- **\`prStatus\` in entries**: Reflects PR state at entry creation time, not current state. Use \`get_github_pr\` for live status.
- **\`restore_backup\` behavior**: Restores entire database state. Any recent changes (new entries, tag merges via \`merge_tags\`, relationships) are reverted. A pre-restore backup is automatically created for safety.
- **Semantic search indexing**: Entries are auto-indexed on creation (fire-and-forget). If index count drifts from DB count, use \`rebuild_vector_index\` or enable \`AUTO_REBUILD_INDEX=true\` for automatic reconciliation on server startup.
- **\`semantic_search\` thresholds**: Default similarity threshold is 0.25. For broader matches, try 0.15-0.2. Higher values (0.4+) return only very close semantic matches.
- **Causal relationship types**: Use \`blocked_by\` (A was blocked by B), \`resolved\` (A resolved B), \`caused\` (A caused B) for decision tracing and failure analysis. Visualizations use distinct arrow styles for causal types.
- **Enhanced analytics**: \`get_statistics\` returns \`decisionDensity\` (significant entries per period), \`relationshipComplexity\` (avg relationships per entry), \`activityTrend\` (period-over-period growth %), and \`causalMetrics\` (counts for blocked_by/resolved/caused).
- **Importance scores**: \`get_entry_by_id\` returns an \`importance\` score (0.0-1.0) based on: significance type (30%), relationship count (35%), causal relationships (20%), and recency (15%). \`memory://significant\` sorts entries by importance.

## Key Resources
| URI | Description |
|-----|-------------|
| \`memory://health\` | Server health, DB stats, tool filter status |
| \`memory://briefing\` | Session context with userMessage to show user |
| \`memory://statistics\` | Entry counts by type and period |
| \`memory://recent\` | 10 most recent entries |
| \`memory://tags\` | All tags with usage counts |
| \`memory://significant\` | Entries marked as milestones/breakthroughs |
| \`memory://graph/recent\` | Mermaid diagram of recent relationships |
| \`memory://kanban/{n}\` | Kanban board for project number n |
`

/**
 * Generate dynamic instructions based on enabled tools, resources, prompts, and latest entry
 *
 * @param enabledTools - Set of enabled tool names
 * @param resources - Available resource definitions
 * @param prompts - Available prompt definitions
 * @param latestEntry - Optional latest entry for context snapshot
 * @param level - Instruction detail level (default: 'standard')
 */
export function generateInstructions(
    enabledTools: Set<string>,
    _resources: ResourceDefinition[],
    prompts: PromptDefinition[],
    latestEntry?: LatestEntrySnapshot,
    level: InstructionLevel = 'standard'
): string {
    let instructions = ESSENTIAL_INSTRUCTIONS

    // Add latest entry snapshot for immediate context (compact format)
    if (latestEntry) {
        const preview = latestEntry.content.slice(0, 120)
        instructions += `\n**Latest**: #${String(latestEntry.id)} (${latestEntry.timestamp}) ${latestEntry.entryType}\n> ${preview}${latestEntry.content.length > 120 ? '...' : ''}\n`
    }

    // Standard and full levels include GitHub patterns
    if (level === 'standard' || level === 'full') {
        instructions += GITHUB_INSTRUCTIONS
    }

    // Full level includes server access instructions and tool parameter reference
    if (level === 'full') {
        instructions += SERVER_ACCESS_INSTRUCTIONS
        instructions += TOOL_PARAMETER_REFERENCE

        // Add active tools summary
        const activeGroups = getActiveToolGroups(enabledTools)
        if (activeGroups.length > 0) {
            instructions += `\n## Active Tools (${String(enabledTools.size)})\n`
            for (const { group, tools } of activeGroups) {
                instructions += `**${group}**: ${tools.map((t) => `\`${t}\``).join(', ')}\n`
            }
        }

        // Add prompts section
        if (prompts.length > 0) {
            instructions += `\n## Prompts (${String(prompts.length)})\n`
            instructions += 'Pre-built templates and guided workflows:\n'
            for (const prompt of prompts) {
                instructions += `- \`${prompt.name}\` - ${prompt.description ?? ''}\n`
            }
        }
    }

    return instructions
}

/**
 * Get active tool groups with their enabled tools
 */
function getActiveToolGroups(enabledTools: Set<string>): { group: ToolGroup; tools: string[] }[] {
    const activeGroups: { group: ToolGroup; tools: string[] }[] = []

    for (const [group, allTools] of Object.entries(TOOL_GROUPS) as [ToolGroup, string[]][]) {
        const enabledInGroup = allTools.filter((tool) => enabledTools.has(tool))
        if (enabledInGroup.length > 0) {
            activeGroups.push({ group, tools: enabledInGroup })
        }
    }

    return activeGroups
}

/**
 * Static instructions for backward compatibility
 * @deprecated Use generateInstructions() instead for dynamic content
 */
export const SERVER_INSTRUCTIONS = ESSENTIAL_INSTRUCTIONS + GITHUB_INSTRUCTIONS
