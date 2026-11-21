import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Command } from 'commander'
import { type z } from 'zod'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { visualizeOptionsSchema } from '../schemas.js'
import {
    assertSafeCliOutputFile,
    getCliCommandDb as getDb,
    resolveCliReadScope,
} from './db-helper.js'
import { formatCliError } from './cli-output.js'

export const visualizeSchema = visualizeOptionsSchema

type RelationshipGraph = ReturnType<IDatabaseAdapter['visualizeRelationships']>
type GraphNode = RelationshipGraph['nodes'][number]

const MERMAID_CONTENT_PREVIEW_LENGTH = 40

const REL_SYMBOLS: Record<string, string> = {
    references: '-->',
    implements: '==>',
    clarifies: '-.->',
    evolves_from: '-->',
    response_to: '<-->',
    blocked_by: '--x',
    resolved: '==>',
    caused: '-.->',
}

function renderMermaidNode(node: GraphNode): string {
    const rawContent =
        typeof node.metadata?.['content'] === 'string' ? node.metadata['content'] : ''
    if (rawContent === '') {
        const safeLabel = node.label.replace(/"/g, "'").substring(0, 50)
        return `    E${String(node.id)}["#${String(node.id)}: ${safeLabel}"]`
    }
    let contentPreview = rawContent.slice(0, MERMAID_CONTENT_PREVIEW_LENGTH).replace(/\n/g, ' ')
    if (rawContent.length > MERMAID_CONTENT_PREVIEW_LENGTH) {
        contentPreview += '...'
    }
    contentPreview = contentPreview.replace(/"/g, "'").replace(/\[/g, '(').replace(/\]/g, ')')
    const entryTypeShort = node.group.slice(0, 20)
    return `    E${String(node.id)}["#${String(node.id)}: ${contentPreview}<br/>${entryTypeShort}"]`
}

function renderMermaidStyle(node: GraphNode): string {
    const isPersonal =
        node.metadata !== undefined && 'is_personal' in node.metadata
            ? Boolean(node.metadata['is_personal'])
            : node.group === 'target'
    return `    style E${String(node.id)} fill:${isPersonal ? '#E3F2FD' : '#FFF3E0'}`
}

/** Render a relationship graph as a fenced Mermaid `graph TD` block. */
function renderMermaid(graph: RelationshipGraph): string {
    const mermaidLines: string[] = ['```mermaid', 'graph TD']

    if (graph.nodes.length === 0) {
        mermaidLines.push('    NoData["No entries found with relationships matching your criteria"]')
    } else {
        mermaidLines.push(...graph.nodes.map(renderMermaidNode), '')
        for (const edge of graph.edges) {
            const arrow = Object.hasOwn(REL_SYMBOLS, edge.type) ? REL_SYMBOLS[edge.type] : '-->'
            mermaidLines.push(`    E${String(edge.from)} ${arrow}|${edge.type}| E${String(edge.to)}`)
        }
        mermaidLines.push('', ...graph.nodes.map(renderMermaidStyle))
    }

    mermaidLines.push('```')
    return mermaidLines.join('\n')
}

export async function visualizeAction(options: z.infer<typeof visualizeSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    let failed = false
    try {
        const { workspaceId, projectNumber } = resolveCliReadScope(db, serverOptions, options)
        const graph = db.visualizeRelationships({
            depth: 3,
            limit: 200,
            ...(workspaceId !== undefined ? { workspaceId } : {}),
            ...(projectNumber !== undefined ? { projectNumber } : {}),
        })

        const mermaid = renderMermaid(graph)

        if (options.out !== undefined) {
            const outPath = await assertSafeCliOutputFile(options.out, '--out')
            await fs.mkdir(path.dirname(outPath), { recursive: true })
            await fs.writeFile(outPath, mermaid, 'utf8')
            if (options.json === true) {
                process.stdout.write(
                    JSON.stringify(
                        {
                            status: 'success',
                            path: outPath,
                            nodeCount: graph.nodes.length,
                            edgeCount: graph.edges.length,
                            mermaid,
                        },
                        null,
                        2
                    ) + '\n'
                )
            } else {
                process.stderr.write(`Visualization written to ${outPath}\n`)
            }
        } else if (options.json === true) {
            process.stdout.write(
                JSON.stringify(
                    {
                        status: 'success',
                        nodeCount: graph.nodes.length,
                        edgeCount: graph.edges.length,
                        nodes: graph.nodes,
                        edges: graph.edges,
                        mermaid,
                    },
                    null,
                    2
                ) + '\n'
            )
        } else {
            process.stdout.write(mermaid + '\n')
        }
    } catch (e) {
        failed = true
        process.stderr.write(`Visualize failed: ${formatCliError(e)}\n`)
    } finally {
        db.close()
    }
    if (failed) {
        process.exit(1)
    }
}
