import type { Command } from 'commander'
import { type z } from 'zod'
import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ConfigResolver } from '../../utils/config-resolver.js'
import { buildServerOptions } from '../server-options-builder.js'
import { visualizeOptionsSchema } from '../schemas.js'
import type { ServerOptionsSchema } from '../schemas.js'
import type { ServerOptions } from '../../server/mcp-server/types.js'
import * as fs from 'node:fs/promises'

export const visualizeSchema = visualizeOptionsSchema

async function getDb(options: ServerOptionsSchema & { team?: boolean }, command: Command): Promise<{ db: IDatabaseAdapter, serverOptions: ServerOptions }> {
    let resolver: ConfigResolver
    const configPath = (options.config) ?? process.env['MEMORY_JOURNAL_CONFIG']
    const configErrors: string[] = []

    try {
        resolver = new ConfigResolver(command, options, configPath)
    } catch (err) {
        configErrors.push(err instanceof Error ? err.message : String(err))
        resolver = new ConfigResolver(command, {}, undefined)
    }

    const { serverOptions, teamDb } = buildServerOptions(resolver, options, command, configErrors)
    
    if (configErrors.length > 0) {
        process.stderr.write('Startup Configuration Errors:\n')
        configErrors.forEach((err) => process.stderr.write(` - ${err}\n`))
        process.exit(1)
    }

    const dbPath = options.team ? (teamDb ?? serverOptions.dbPath) : serverOptions.dbPath
    const db = await DatabaseAdapterFactory.create(dbPath, serverOptions)
    await db.initialize()
    return { db, serverOptions }
}

export async function visualizeAction(options: z.infer<typeof visualizeSchema>, command: Command): Promise<void> {
    const { db } = await getDb(options, command)
    try {
        const graph = db.visualizeRelationships({
            depth: 3,
            limit: 200
        })

        const MERMAID_CONTENT_PREVIEW_LENGTH = 40
        const mermaidLines: string[] = ['```mermaid', 'graph TD']

        if (graph.nodes.length === 0) {
            mermaidLines.push(
                '    NoData["No entries found with relationships matching your criteria"]'
            )
        } else {
            // Add nodes
            for (const node of graph.nodes) {
                const rawContent =
                    typeof node.metadata?.['content'] === 'string'
                        ? node.metadata['content']
                        : ''
                if (rawContent !== '') {
                    let contentPreview = rawContent
                        .slice(0, MERMAID_CONTENT_PREVIEW_LENGTH)
                        .replace(/\n/g, ' ')
                    if (rawContent.length > MERMAID_CONTENT_PREVIEW_LENGTH) {
                        contentPreview += '...'
                    }
                    contentPreview = contentPreview
                        .replace(/"/g, "'")
                        .replace(/\[/g, '(')
                        .replace(/\]/g, ')')
                    const entryTypeShort = node.group.slice(0, 20)
                    mermaidLines.push(
                        `    E${String(node.id)}["#${String(node.id)}: ${contentPreview}<br/>${entryTypeShort}"]`
                    )
                } else {
                    const safeLabel = node.label.replace(/"/g, "'").substring(0, 50)
                    mermaidLines.push(`    E${String(node.id)}["#${String(node.id)}: ${safeLabel}"]`)
                }
            }

            mermaidLines.push('')

            const relSymbols: Record<string, string> = {
                references: '-->',
                implements: '==>',
                clarifies: '-.->',
                evolves_from: '-->',
                response_to: '<-->',
                blocked_by: '--x',
                resolved: '==>',
                caused: '-.->',
            }

            // Add edges
            for (const edge of graph.edges) {
                const arrow = relSymbols[edge.type] ?? '-->'
                mermaidLines.push(
                    `    E${String(edge.from)} ${arrow}|${edge.type}| E${String(edge.to)}`
                )
            }

            mermaidLines.push('')

            // Add styles
            for (const node of graph.nodes) {
                const isPersonal =
                    node.metadata !== undefined && 'is_personal' in node.metadata
                        ? Boolean(node.metadata['is_personal'])
                        : node.group === 'target'
                if (isPersonal) {
                    mermaidLines.push(`    style E${String(node.id)} fill:#E3F2FD`)
                } else {
                    mermaidLines.push(`    style E${String(node.id)} fill:#FFF3E0`)
                }
            }
        }

        mermaidLines.push('```')
        const mermaid = mermaidLines.join('\n')

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
