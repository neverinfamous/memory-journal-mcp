/**
 * Generate dynamic instructions based on enabled tools, resources, prompts, and latest entry.
 *
 * Sections are conditionally included based on which tool groups are enabled:
 * - Copilot Review Patterns → only with `github` group
 * - Code Mode → only with `codemode` group (namespace table only lists enabled groups)
 * - GitHub Integration → only with `github` group (standard+ level)
 * - Quick Access semantic_search row → only with `search` group
 *
 * @param enabledTools - Set of enabled tool names
 * @param prompts - Available prompt definitions
 * @param latestEntry - Optional latest entry for context snapshot
 * @param level - Instruction detail level (default: 'standard')
 * @param enabledGroups - Optional pre-computed enabled groups; derived from enabledTools if omitted
 */
export function generateInstructions(
    enabledTools: Set<string>,
    prompts: PromptDefinition[],
    latestEntry?: LatestEntrySnapshot,
    level: InstructionLevel = 'standard',
    enabledGroups?: Set<ToolGroup>
): string {
    // Derive enabled groups from enabled tools if not provided (backward compat)
    const groups = enabledGroups ?? getEnabledGroups(enabledTools)

    // Always start with core behavioral guidance
    let instructions = CORE_INSTRUCTIONS

    // Copilot Review Patterns — only when github group is enabled
    if (groups.has('github')) {
        instructions += COPILOT_REVIEW_INSTRUCTIONS
    }

    // Quick Access — always, but semantic_search row conditional on search group
    instructions += buildQuickAccess(groups)

    // Code Mode — only when codemode group is enabled
    if (groups.has('codemode')) {
        instructions += buildCodeModeInstructions(groups)
    }

    // Add latest entry snapshot for immediate context (compact format)
    if (latestEntry) {
        const preview = latestEntry.content.slice(0, 120)
        instructions += `\n**Latest**: #${String(latestEntry.id)} (${latestEntry.timestamp}) ${latestEntry.entryType}\n> ${preview}${latestEntry.content.length > 120 ? '...' : ''}\n`
    }

    // Standard and full levels include GitHub patterns + help pointers
    if (level === 'standard' || level === 'full') {
        if (groups.has('github')) {
            instructions += GITHUB_INSTRUCTIONS
        }
        instructions += HELP_POINTERS
    }

    // Full level includes server access instructions + active tools/prompts summary
    if (level === 'full') {
        instructions += SERVER_ACCESS_INSTRUCTIONS

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
export const SERVER_INSTRUCTIONS =
    CORE_INSTRUCTIONS +
    COPILOT_REVIEW_INSTRUCTIONS +
    buildQuickAccess(new Set(Object.keys(TOOL_GROUPS) as ToolGroup[])) +
    buildCodeModeInstructions(new Set(Object.keys(TOOL_GROUPS) as ToolGroup[])) +
    GITHUB_INSTRUCTIONS
