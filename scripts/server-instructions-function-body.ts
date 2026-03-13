/**
 * Generate dynamic instructions based on enabled tools, resources, prompts, and latest entry
 *
 * @param enabledTools - Set of enabled tool names
 * @param prompts - Available prompt definitions
 * @param latestEntry - Optional latest entry for context snapshot
 * @param level - Instruction detail level (default: 'standard')
 */
export function generateInstructions(
    enabledTools: Set<string>,
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
