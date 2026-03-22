/**
 * Memory Journal MCP Server - Graph Resource Definitions
 *
 * Resources: graph/recent, graph/actions, actions/recent
 */

import { ICON_GRAPH, ICON_GITHUB } from '../../constants/icons.js'
import { RAW_ENTRY_COLUMNS as ENTRY_COLUMNS } from '../../database/core/entry-columns.js'
import { MEDIUM_PRIORITY, ASSISTANT_FOCUSED } from '../../utils/resource-annotations.js'
import type { InternalResourceDef, ResourceContext } from './shared.js'
import { execQuery, transformEntryRow } from './shared.js'

/**
 * Get graph resource definitions
 */
export function getGraphResourceDefinitions(): InternalResourceDef[] {
    return [
        {
            uri: 'memory://graph/recent',
            name: 'Recent Relationship Graph',
            title: 'Live Mermaid Diagram',
            description: 'Live Mermaid diagram of recent relationships',
            mimeType: 'text/plain',
            icons: [ICON_GRAPH],
            annotations: MEDIUM_PRIORITY,
            handler: (_uri: string, context: ResourceContext) => {
                const relationships = execQuery(
                    context.db,
                    `
                    SELECT
                        r.id, r.from_entry_id, r.to_entry_id, r.relationship_type, r.description,
                        e1.content as from_content,
                        e2.content as to_content
                    FROM relationships r
                    JOIN memory_journal e1 ON r.from_entry_id = e1.id
                    JOIN memory_journal e2 ON r.to_entry_id = e2.id
                    WHERE e1.deleted_at IS NULL AND e2.deleted_at IS NULL
                    ORDER BY r.created_at DESC
                    LIMIT 20
                `
                ) as {
                    from_entry_id: number
                    to_entry_id: number
                    relationship_type: string
                    from_content: string
                    to_content: string
                }[]

                if (relationships.length === 0) {
                    return 'graph TD\n  NoData["No relationships found — use link_entries to create relationships"]'
                }

                // Build Mermaid graph
                const lines: string[] = ['graph TD']
                const seenNodes = new Set<number>()

                // Relationship type to arrow style mapping
                const arrowStyles: Record<string, string> = {
                    references: '-->',
                    evolves_from: '-->',
                    depends_on: '-->',
                    implements: '==>',
                    resolved: '==>',
                    clarifies: '-..->',
                    caused: '-.->',
                    related_to: '<-->',
                    response_to: '<-->',
                    blocked_by: '--x',
                }

                for (const rel of relationships) {
                    if (!seenNodes.has(rel.from_entry_id)) {
                        const label = rel.from_content
                            .slice(0, 30)
                            .replace(/[\]"'`[]]/g, ' ')
                            .trim()
                        lines.push(
                            `  E${String(rel.from_entry_id)}["#${String(rel.from_entry_id)}: ${label}..."]`
                        )
                        seenNodes.add(rel.from_entry_id)
                    }
                    if (!seenNodes.has(rel.to_entry_id)) {
                        const label = rel.to_content
                            .slice(0, 30)
                            .replace(/[\]"'`[]]/g, ' ')
                            .trim()
                        lines.push(
                            `  E${String(rel.to_entry_id)}["#${String(rel.to_entry_id)}: ${label}..."]`
                        )
                        seenNodes.add(rel.to_entry_id)
                    }

                    const arrow = arrowStyles[rel.relationship_type] ?? '-->'
                    lines.push(
                        `  E${String(rel.from_entry_id)} ${arrow}|${rel.relationship_type}| E${String(rel.to_entry_id)}`
                    )
                }

                return lines.join('\n')
            },
        },
        {
            uri: 'memory://graph/actions',
            name: 'Actions Graph',
            title: 'CI/CD Narrative Graph',
            description:
                'CI/CD narrative graph: commits → runs → failures → entries → fixes → deployments',
            mimeType: 'text/plain',
            icons: [ICON_GITHUB],
            annotations: MEDIUM_PRIORITY,
            handler: async (_uri: string, context: ResourceContext) => {
                if (!context.github) {
                    return 'graph LR\n  NoGitHub["GitHub integration not available — set GITHUB_TOKEN and GITHUB_REPO_PATH"]'
                }

                const repoInfo = await context.github.getRepoInfo()
                if (!repoInfo.owner || !repoInfo.repo) {
                    return 'graph LR\n  NoRepo["Repository not detected — set GITHUB_REPO_PATH in your config"]'
                }

                const workflowRuns = await context.github.getWorkflowRuns(
                    repoInfo.owner,
                    repoInfo.repo,
                    10
                )

                if (workflowRuns.length === 0) {
                    return 'graph LR\n  NoRuns["No GitHub Actions workflow runs found for this repository"]'
                }

                const lines: string[] = ['graph LR']

                const statusStyles: Record<string, string> = {
                    success: ':::success',
                    failure: ':::failure',
                    cancelled: ':::cancelled',
                    skipped: ':::skipped',
                }

                lines.push('  classDef success fill:#28a745,color:#fff')
                lines.push('  classDef failure fill:#dc3545,color:#fff')
                lines.push('  classDef cancelled fill:#6c757d,color:#fff')
                lines.push('  classDef skipped fill:#ffc107,color:#000')

                for (const run of workflowRuns) {
                    const shortSha = run.headSha.slice(0, 7)
                    const nodeId = `R${String(run.id)}`
                    const commitId = `C${shortSha}`
                    const style = statusStyles[run.conclusion ?? 'skipped'] ?? ''
                    const statusIcon =
                        run.conclusion === 'success'
                            ? '✓'
                            : run.conclusion === 'failure'
                              ? '✗'
                              : '○'

                    lines.push(`  ${commitId}["${shortSha}"]`)
                    lines.push(`  ${nodeId}["${statusIcon} ${run.name}"]${style}`)
                    lines.push(`  ${commitId} --> ${nodeId}`)
                }

                return lines.join('\n')
            },
        },
        {
            uri: 'memory://actions/recent',
            name: 'Recent Actions',
            title: 'Recent Workflow Runs',
            description: 'Recent workflow runs with CI status',
            mimeType: 'application/json',
            icons: [ICON_GITHUB],
            annotations: ASSISTANT_FOCUSED,
            handler: async (_uri: string, context: ResourceContext) => {
                if (context.github) {
                    try {
                        const repoInfo = await context.github.getRepoInfo()
                        if (repoInfo.owner && repoInfo.repo) {
                            const runs = await context.github.getWorkflowRuns(
                                repoInfo.owner,
                                repoInfo.repo,
                                10
                            )

                            const entries = runs.map((run) => ({
                                id: -1 * run.id,
                                entryType: 'tool_output',
                                content: `Workflow: ${run.name}\nStatus: ${run.status}\nConclusion: ${run.conclusion || 'pending'}\nBranch: ${run.headBranch}\nURL: ${run.url}`,
                                timestamp: run.createdAt,
                                isPersonal: false,
                                significanceType: null,
                                workflowRunId: run.id,
                                workflowName: run.name,
                                workflowStatus: run.conclusion || run.status,
                            }))

                            return { entries, count: entries.length, source: 'github_api' }
                        }
                    } catch {
                        // Fallback to DB if GitHub fails
                    }
                }

                const rows = execQuery(
                    context.db,
                    `
                    SELECT ${ENTRY_COLUMNS} FROM memory_journal
                    WHERE workflow_run_id IS NOT NULL
                    AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                    LIMIT 10
                `
                )
                const entries = rows.map(transformEntryRow)
                return { entries, count: entries.length, source: 'database' }
            },
        },
    ]
}
