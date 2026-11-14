import type { Command } from 'commander'
import { type z } from 'zod'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { visualizeOptionsSchema } from '../schemas.js'
import { getCliCommandDb as getDb } from './db-helper.js'
import { resolveCliQueryScope } from '../../utils/workspace-resolver.js'
import * as fs from 'node:fs/promises'

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
            const arrow = REL_SYMBOLS[edge.type] ?? '-->'
            mermaidLines.push(`    E${String(edge.from)} ${arrow}|${edge.type}| E${String(edge.to)}`)
        }
        mermaidLines.push('', ...graph.nodes.map(renderMermaidStyle))
    }

    mermaidLines.push('```')
    return mermaidLines.join('\n')
}

export async function visualizeAction(options: z.infer<typeof visualizeSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    try {
        const { workspaceId, projectNumber } = resolveCliQueryScope(
            options.workspace,
            options.defaultProject,
            serverOptions
        )
        const graph = db.visualizeRelationships({
            depth: 3,
            limit: 200,
            ...(workspaceId !== undefined ? { workspaceId } : {}),
            ...(projectNumber !== undefined ? { projectNumber } : {}),
        })

        const mermaid = renderMermaid(graph)

        if (options.out) {
            await fs.writeFile(options.out, mermaid, 'utf8')
            process.stderr.write(`Visualization written to ${options.out}\n`)
        } else {
            process.stdout.write(mermaid + '\n')
        }
    } catch (e) {
        process.stderr.write("Visualize failed: " + (e instanceof Error ? e.message : String(e)) + '\n')
        process.exit(1)
    } finally {
        db.close()
    }
}
