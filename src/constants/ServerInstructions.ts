/**
 * Server instructions for Memory Journal MCP.
 *
 * These instructions are automatically sent to MCP clients during initialization,
 * providing guidance for AI agents on tool usage.
 * 
 * v3.1.6: Optimized for token efficiency with tiered instruction levels.
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
 * Latest entry snapshot for initial briefing
 */
export interface LatestEntrySnapshot {
    id: number;
    timestamp: string;
    entryType: string;
    content: string;
}

/**
 * Instruction detail level for token efficiency
 * - essential: ~200 tokens - Core behaviors only (for token-constrained clients)
 * - standard: ~400 tokens - + GitHub patterns (default)
 * - full: ~600 tokens - + tool/resource listings
 */
export type InstructionLevel = 'essential' | 'standard' | 'full';

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
`;

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
`;

/**
 * Server name discovery note
 */
const SERVER_NAME_NOTE = `
## Server Name
Config name: \`memory-journal-mcp\`. Some clients prefix it (e.g., \`user-memory-journal-mcp\`). Use \`list_mcp_resources\` to discover.
`;

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
    resources: ResourceDefinition[],
    prompts: PromptDefinition[],
    latestEntry?: LatestEntrySnapshot,
    level: InstructionLevel = 'standard'
): string {
    let instructions = ESSENTIAL_INSTRUCTIONS;

    // Add latest entry snapshot for immediate context (compact format)
    if (latestEntry) {
        const preview = latestEntry.content.slice(0, 120);
        instructions += `\n**Latest**: #${String(latestEntry.id)} (${latestEntry.timestamp}) ${latestEntry.entryType}\n> ${preview}${latestEntry.content.length > 120 ? '...' : ''}\n`;
    }

    // Standard and full levels include GitHub patterns
    if (level === 'standard' || level === 'full') {
        instructions += GITHUB_INSTRUCTIONS;
    }

    // Full level includes tool/resource/prompt listings
    if (level === 'full') {
        instructions += SERVER_NAME_NOTE;

        // Add compact active tools section
        const activeGroups = getActiveToolGroups(enabledTools);
        if (activeGroups.length > 0) {
            instructions += `\n## Active Tools (${String(enabledTools.size)})\n`;
            for (const { group, tools } of activeGroups) {
                instructions += `**${group}**: ${tools.map(t => `\`${t}\``).join(', ')}\n`;
            }
        }

        // Add compact resources section
        if (resources.length > 0) {
            instructions += `\n## Resources (${String(resources.length)})\n`;
            // Only list high-priority resources
            const highPriority = resources.slice(0, 8);
            instructions += highPriority.map(r => `- \`${r.uri}\``).join('\n');
            if (resources.length > 8) {
                instructions += `\n- ...and ${String(resources.length - 8)} more`;
            }
            instructions += '\n';
        }

        // Add compact prompts section  
        if (prompts.length > 0) {
            instructions += `\n## Prompts (${String(prompts.length)})\n`;
            const promptNames = prompts.slice(0, 6).map(p => `\`${p.name}\``).join(', ');
            instructions += promptNames;
            if (prompts.length > 6) {
                instructions += `, ...+${String(prompts.length - 6)}`;
            }
            instructions += '\n';
        }
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
export const SERVER_INSTRUCTIONS = ESSENTIAL_INSTRUCTIONS + GITHUB_INSTRUCTIONS;
