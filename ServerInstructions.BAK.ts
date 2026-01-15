/**
 * Server instructions for Memory Journal MCP.
 *
 * These instructions are automatically sent to MCP clients during initialization,
 * providing guidance for AI agents on tool usage.
 */

import type { ToolGroup } from '../types/index.js';
import { TOOL_GROUPS } from '../filtering/ToolFilter.js';

/**
 * Resource definition for instruction generation
 */
export interface ResourceDefinition {
    uri: string;
    name: string;
    description?: string;
}

/**
 * Prompt definition for instruction generation
 */
export interface PromptDefinition {
    name: string;
    description?: string;
}

/**
 * Base instructions that are always included
 */
const BASE_INSTRUCTIONS = `# memory-journal-mcp Usage Instructions

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
| \`semantic_search\` | \`query\` (string) | \`limit\` (default 10) |
| \`get_vector_index_stats\` | none | none |

### Relationship Tools
| Tool | Required Parameters | Notes |
|------|---------------------|-------|
| \`link_entries\` | \`from_entry_id\`, \`to_entry_id\` (numbers), \`relationship_type\` | Types: \`evolves_from\`, \`references\`, \`implements\`, \`clarifies\`, \`response_to\` |
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

## Key Resources
| URI | Description |
|-----|-------------|
| \`memory://health\` | Server health, DB stats, tool filter status |
| \`memory://statistics\` | Entry counts by type and period |
| \`memory://recent\` | 10 most recent entries |
| \`memory://tags\` | All tags with usage counts |
| \`memory://significant\` | Entries marked as milestones/breakthroughs |
| \`memory://graph/recent\` | Mermaid diagram of recent relationships |
| \`memory://kanban/{n}\` | Kanban board for project number n |
`;

/**
 * Generate dynamic instructions based on enabled tools, resources, and prompts
 */
export function generateInstructions(
    enabledTools: Set<string>,
    resources: ResourceDefinition[],
    prompts: PromptDefinition[]
): string {
    let instructions = BASE_INSTRUCTIONS;

    // Add active tools section
    const activeGroups = getActiveToolGroups(enabledTools);
    if (activeGroups.length > 0) {
        instructions += '\n## Active Tools\n\n';
        instructions += `This server instance has ${enabledTools.size} tools enabled across ${activeGroups.length} groups:\n\n`;
        
        for (const { group, tools } of activeGroups) {
            instructions += `### ${group} (${tools.length} tools)\n`;
            instructions += tools.map(t => `- \`${t}\``).join('\n');
            instructions += '\n\n';
        }
    }

    // Add resources section
    if (resources.length > 0) {
        instructions += `## Active Resources (${resources.length})\n\n`;
        instructions += 'Read-only resources for journal data and metadata:\n\n';
        for (const resource of resources) {
            instructions += `- \`${resource.uri}\` - ${resource.description ?? resource.name}\n`;
        }
        instructions += '\n';
    }

    // Add prompts section
    if (prompts.length > 0) {
        instructions += `## Active Prompts (${prompts.length})\n\n`;
        instructions += 'Pre-built templates and guided workflows:\n\n';
        for (const prompt of prompts) {
            instructions += `- \`${prompt.name}\` - ${prompt.description ?? ''}\n`;
        }
        instructions += '\n';
    }

    return instructions;
}

/**
 * Get active tool groups with their enabled tools
 */
function getActiveToolGroups(enabledTools: Set<string>): { group: ToolGroup; tools: string[] }[] {
    const activeGroups: { group: ToolGroup; tools: string[] }[] = [];
    
    for (const [group, allTools] of Object.entries(TOOL_GROUPS) as [ToolGroup, string[]][]) {
        const enabledInGroup = allTools.filter(tool => enabledTools.has(tool));
        if (enabledInGroup.length > 0) {
            activeGroups.push({ group, tools: enabledInGroup });
        }
    }
    
    return activeGroups;
}

/**
 * Static instructions for backward compatibility
 * @deprecated Use generateInstructions() instead for dynamic content
 */
export const SERVER_INSTRUCTIONS = BASE_INSTRUCTIONS;
