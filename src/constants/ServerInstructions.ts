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

## Server Identity

- **Server Name**: This server is identified as \`user-memory-journal-mcp\` in MCP client configurations.
- **Tool Invocation**: When calling tools via MCP, they are prefixed with the server name (e.g., \`user-memory-journal-mcp-create_entry\`, \`user-memory-journal-mcp-search_entries\`).
- **Resources**: 
  - Resources use the \`memory://\` URI scheme (e.g., \`memory://recent\`, \`memory://statistics\`).
  - When listing or fetching resources, use server name \`user-memory-journal-mcp\` (e.g., \`list_mcp_resources(server: "user-memory-journal-mcp")\`).

## Core Concepts

Memory Journal MCP provides persistent project context management for AI-assisted development:
- **Entries**: Timestamped journal entries with content, tags, and metadata
- **Relationships**: Link entries together (evolves_from, references, implements, clarifies, response_to)
- **Vector Search**: Semantic search using AI embeddings (Xenova/all-MiniLM-L6-v2)
- **GitHub Integration**: Track issues, PRs, and project context

## GitHub Tools

GitHub tools auto-detect repository from the configured GITHUB_REPO_PATH environment variable.
- If owner/repo are detected, they appear in \`detectedOwner\`/\`detectedRepo\` in responses
- If not detected (null), specify \`owner\` and \`repo\` parameters explicitly
- Leave owner/repo parameters empty to use auto-detection

## Entry Types

Supported entry types for categorization:
- \`personal_reflection\` - Personal thoughts and notes (default)
- \`technical_note\` - Technical documentation
- \`bug_fix\` - Bug fixes and resolutions
- \`progress_update\` - Project progress updates
- \`code_review\` - Code review notes
- \`deployment\` - Deployment records
- \`technical_achievement\` - Milestones and breakthroughs

## Backup & Restore

- Use \`backup_journal\` to create timestamped backups before major changes
- Use \`list_backups\` to see available backup files
- Use \`restore_backup\` with \`confirm: true\` to restore (creates auto-backup first)
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
