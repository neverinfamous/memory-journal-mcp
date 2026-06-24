/**
 * Server instructions for Memory Journal MCP.
 *
 * Slim instructions are sent to MCP clients during initialization.
 * Detailed help is available on-demand via memory://help resources.
 * Instructions are dynamically generated based on enabled tool groups.
 */

import type { ToolGroup } from '../types/index.js'
import { getEnabledGroups } from '../filtering/tool-filter.js'
import { TOOL_GROUPS } from '../filtering/tool-constants.js'

import { CORE_INSTRUCTIONS, CODE_MODE_INSTRUCTIONS } from './instructions/base.js';
import { CORE_HELP } from './instructions/core.js';
import { SEARCH_HELP } from './instructions/search.js';
import { ADMIN_HELP } from './instructions/admin.js';
import { CODEMODE_HELP } from './instructions/codemode.js';
import { GIT_HELP } from './instructions/git.js';
import { GITHUB_HELP } from './instructions/github.js';
import { GOTCHAS_HELP } from './instructions/gotchas.js';
import { TEMPLATES_HELP } from './instructions/templates.js';
import { TEAM_HELP } from './instructions/team.js';
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

// =============================================================================
// Composable Instruction Segments
// =============================================================================

/**
 * All help keys that have content (for dynamic help pointer generation).
 */
const HELP_GROUP_KEYS: readonly string[] = ["core", "search", "admin", "codemode","github","git","templates","team"]

/**
 * Build dynamic help pointers listing only the enabled groups.
 */
function buildHelpPointers(groups: Set<ToolGroup>): string {
    const enabledHelpGroups = HELP_GROUP_KEYS.filter((k) => {
        return groups.has(k as ToolGroup)
    })
    if (enabledHelpGroups.length === 0) {
        return '\n\nRead `memory://help` for gotchas and critical usage patterns.'
    }
    return '\n\n## Available Help\n\n' +
        'Read `memory://help` for gotchas and critical usage patterns.\n' +
        'Read `memory://help/{group}` for: ' + enabledHelpGroups.join(', ') + '.'
}

/**
 * Build active groups summary listing enabled group names with tool counts.
 */
function buildActiveGroupsSummary(enabledTools: Set<string>): string {
    const activeGroups: { group: ToolGroup; tools: string[] }[] = []

    for (const [group, allTools] of Object.entries(TOOL_GROUPS) as [ToolGroup, string[]][]) {
        const enabledInGroup = allTools.filter((tool) => enabledTools.has(tool))
        if (enabledInGroup.length > 0) {
            activeGroups.push({ group, tools: enabledInGroup })
        }
    }

    if (activeGroups.length === 0) return ''

    let summary = `\n\n## Active Tools (${String(enabledTools.size)})\n`
    for (const { group, tools } of activeGroups) {
        summary += `**${group}**: ${tools.map((t) => `\`${t}\``).join(', ')}\n`
    }
    return summary
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Generate dynamic instructions based on enabled tool groups and instruction level.
 *
 * Sections are conditionally included based on which tool groups are enabled:
 *
 * @param enabledTools - Set of enabled tool names
 * @param prompts - Available prompt definitions
 * @param latestEntry - Optional latest entry for context snapshot
 * @param enabledGroups - Optional pre-computed enabled groups; derived from enabledTools if omitted
 * @param config - Server configuration for context
 */
export function generateStandardInstructions(
    enabledTools: Set<string>,
    prompts: PromptDefinition[],
    latestEntry?: LatestEntrySnapshot,
    enabledGroups?: Set<ToolGroup>,
    config?: { defaultWorkspaceId?: string }
): string {
    // Derive enabled groups from enabled tools if not provided (backward compat)
    const groups = enabledGroups ?? getEnabledGroups(enabledTools)

    // Always start with core instructions (overview + behaviors)
    let instructions = CORE_INSTRUCTIONS

    if (config?.defaultWorkspaceId) {
        instructions += `\n\n### Multi-Tenancy\n**Active Workspace:** \`${config.defaultWorkspaceId}\`\nAll entries and searches are isolated to this workspace by default. Include \`workspace_id\` parameter in tool calls if you need to override this.`
    }

    // Code Mode snippet — only when codemode group is enabled
    if (groups.has('codemode')) {
        instructions += CODE_MODE_INSTRUCTIONS
    }

    // Add latest entry snapshot for immediate context (compact format)
    if (latestEntry) {
        const preview = latestEntry.content.slice(0, 120)
        instructions += `\n**Latest**: #${String(latestEntry.id)} (${latestEntry.timestamp}) ${latestEntry.entryType}\n> ${preview}${latestEntry.content.length > 120 ? '...' : ''}\n`
    }

    // Always include help pointers, active groups summary, and prompts
    instructions += buildHelpPointers(groups)
    instructions += buildActiveGroupsSummary(enabledTools)

    // Add prompts section
    if (prompts.length > 0) {
        instructions += `\n## Prompts (${String(prompts.length)})\n`
        instructions += 'Pre-built templates and guided workflows:\n'
        for (const prompt of prompts) {
            instructions += `- \`${prompt.name}\` - ${prompt.description ?? ''}\n`
        }
    }

    return instructions
}

/**
 * Generate instructions optimized for Code Mode (consolidated API reference).
 */
export function generateCodeModeInstructions(
    enabledTools: Set<string>,
    prompts: PromptDefinition[],
    latestEntry?: LatestEntrySnapshot,
    enabledGroups?: Set<ToolGroup>,
    config?: { defaultWorkspaceId?: string }
): string {
    const standard = generateStandardInstructions(enabledTools, prompts, latestEntry, enabledGroups, config)
    return standard + '\n\n' + HELP_CONTENT.get('codemode')
}

/**
 * Static instructions for backward compatibility.
 * @deprecated Use generateStandardInstructions() instead for dynamic content
 */
export const SERVER_INSTRUCTIONS = CORE_INSTRUCTIONS

/**
 * Help content keyed by group name.
 * 'gotchas' is the always-available help (memory://help).
 * Other keys are feature-specific help (memory://help/{key}).
 */
export const HELP_CONTENT: ReadonlyMap<string, string> = new Map([
  ["core", CORE_HELP],
  ["search", SEARCH_HELP],
  ["admin", ADMIN_HELP],
  ["codemode", CODEMODE_HELP],
  ["git", GIT_HELP],
  ["github", GITHUB_HELP],
  ["gotchas", GOTCHAS_HELP],
  ["templates", TEMPLATES_HELP],
  ["team", TEAM_HELP]
])
