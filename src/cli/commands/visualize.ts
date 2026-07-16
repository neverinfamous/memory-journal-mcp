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

        const mermaidLines: string[] = ['```mermaid', 'graph TD']
        
        // Add nodes
        for (const node of graph.nodes) {
            const safeLabel = node.label.replace(/"/g, "'").substring(0, 50)
            mermaidLines.push(`    E${node.id}["#${node.id}: ${safeLabel}"]`)
        }
        
        mermaidLines.push('')
        
        // Add edges
        for (const edge of graph.edges) {
            mermaidLines.push(`    E${edge.from} -->|${edge.label}| E${edge.to}`)
        }
        
        mermaidLines.push('')
        
        // Add styles
        for (const node of graph.nodes) {
            if (node.group === 'target') {
                mermaidLines.push(`    style E${node.id} fill:#E3F2FD`)
            } else {
                mermaidLines.push(`    style E${node.id} fill:#FFF3E0`)
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
