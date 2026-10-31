import type { InternalResourceDef, ResourceContext } from './shared.js'
import { getTools } from '../tools/index.js'

export function getToolsCatalogResourceDefinitions(): InternalResourceDef[] {
    return [
        {
            uri: 'memory://tools/available',
            name: 'Tools Catalog',
            title: 'Tools Catalog',
            description: 'Discover all available tools and their current enabled/disabled state.',
            mimeType: 'text/markdown',
            icons: [
                {
                    src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iY3VycmVudENvbG9yIiBkPSJNMjIuNyAxNC4zTDIxLjcgMTUuM0wxOS43IDEzLjNMMjAuNyAxMi4zQzIwLjggMTIuMiAyMC45IDEyLjEgMjEuMSAxMi4xQzIxLjIgMTIuMSAyMS40IDEyLjIgMjEuNSAxMi4zTDIyLjggMTMuNkMyMi45IDEzLjggMjIuOSAxNC4xIDIyLjcgMTQuM00xMyAxOS45VjIySDE1LjFMMjEuMiAxNS45TDE5LjIgMTMuOUwxMyAxOS45TTExLjYgMTQuM0wxMi41IDEzLjRCOC4xIDlMNy4yIDkuOUM2LjggMTAuMyA2LjggMTAuOSA3LjIgMTEuM0wxMC4yIDE0LjNDMTAuNiAxNC43IDExLjIgMTQuNyAxMS42IDE0LjNNMTUuNCA3LjVMMTQuNSA4LjRMMTAuMSA0TDExIDMuMUMxMS40IDIuNyAxMiAyLjcgMTIuNCAzLjFMMTUuNCA2LjFDMTUuOCA2LjUgMTUuOCA3LjEgMTUuNCA3LjVNOCA2QzggNC45IDcuMSA0IDYgNFM0IDQuOSA0IDZTNC45IDggNiA4IDggNy4xIDggNk02IDFDOC44IDEgMTEgMy4yIDExIDZTMi44IDExIDYgMTEgMSA4LjggMSA2IDMuMiAxIDYgMU01IDVIN1Y3SDVWNU0yMCAyQzIxLjEgMiAyMiAyLjkgMjIgNFMyMS4xIDYgMjAgNiAxOCA1LjEgMTggNCAxOC45IDIgMjAgMk0yMCAxQzE4LjMgMSAxNyAyLjMgMTcgNFMxOC4zIDcgMjAgNyAyMyA1LjcgMjMgNCAyMS43IDEgMjAgMU0xOSAzSDIxVjVIMTlWM1oiLz48L3N2Zz4=',
                    mimeType: 'image/svg+xml',
                },
            ],
            annotations: {
                audience: ['assistant'],
                priority: 0.8,
            },
            handler: (_uri: string, context: ResourceContext) => {
                const { db, vectorManager, github, teamDb, filterConfig } = context

                // Pass null for filterConfig to get ALL tools regardless of active filter.
                // We use type casting for teamVectorManager and config since they aren't directly on ResourceContext.
                const allTools = getTools(
                    db,
                    null,
                    vectorManager,
                    github ?? undefined,
                    undefined,
                    teamDb,
                    undefined
                )

                const activeFilterRaw = filterConfig?.raw ?? 'full'
                
                // Group tools
                const toolsByGroup: Record<string, typeof allTools> = {}
                for (const tool of allTools) {
                    // Extract group from icon title as a fallback if needed
                    const group = tool.icons?.title?.toLowerCase().replace('journal ', '') ?? 'other'
                    
                    toolsByGroup[group] ??= []
                    toolsByGroup[group]?.push(tool)
                }

                const groups = Object.keys(toolsByGroup).sort()

                let md = `## Available Tools\n\n`
                md += `### Currently Enabled\n`
                md += `Active filter: \`${activeFilterRaw}\`\n\n`

                for (const group of groups) {
                    const toolsInGroup = toolsByGroup[group] ?? []
                    
                    // Determine how many tools in this group are enabled
                    let enabledCount = 0
                    for (const tool of toolsInGroup) {
                        if (!filterConfig || filterConfig.enabledTools.has(tool.name)) {
                            enabledCount++
                        }
                    }

                    const isGroupEnabled = enabledCount > 0
                    const statusEmoji = isGroupEnabled ? '✅ enabled' : '❌ disabled'
                    
                    md += `### ${group} (${toolsInGroup.length} tools) ${statusEmoji}\n`
                    
                    for (const tool of toolsInGroup) {
                        const isEnabled = !filterConfig || filterConfig.enabledTools.has(tool.name)
                        const toolStatus = isEnabled ? '' : ' (disabled)'
                        md += `- ${tool.name}: ${tool.description}${toolStatus}\n`
                    }
                    md += '\n'
                }

                md += `### Quick Reference\n`
                md += `To enable specific tools: \`update_configuration({ tool_filter: "starter,+get_github_issues,+get_github_prs" })\`\n`
                md += `To enable a group: \`update_configuration({ tool_filter: "starter,github" })\`\n`
                md += `To switch to minimal: \`update_configuration({ tool_filter: "create_entry,search_entries" })\`\n`

                return md
            },
        },
    ]
}
