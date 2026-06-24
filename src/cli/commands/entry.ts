import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { EntryType } from '../../types/index.js'
import { ConfigResolver } from '../../utils/config-resolver.js'
import { buildServerOptions } from '../server-options-builder.js'
import type { CreateEntryInput } from '../../database/core/schema.js'

async function getDb(options: Record<string, unknown>, command: Command): Promise<IDatabaseAdapter> {
    let resolver: ConfigResolver
    const configPath = (options['config'] as string | undefined) ?? process.env['MEMORY_JOURNAL_CONFIG']
    const configErrors: string[] = []

    try {
        resolver = new ConfigResolver(command, options, configPath)
    } catch (err) {
        configErrors.push(err instanceof Error ? err.message : String(err))
        resolver = new ConfigResolver(command, {}, undefined)
    }

    const { serverOptions } = buildServerOptions(resolver, options, command, configErrors)
    
    if (configErrors.length > 0) {
        process.stderr.write('Startup Configuration Errors:\n')
        configErrors.forEach((err) => process.stderr.write(` - ${err}\n`))
        process.exit(1)
    }

    const useTeamDb = options['team'] === true

    if (useTeamDb && typeof serverOptions.teamDbPath !== 'string') {
        process.stderr.write('Error: Cannot use --team flag because no team database is configured.\n')
        process.exit(1)
    }

    const dbPath = useTeamDb ? String(serverOptions.teamDbPath) : serverOptions.dbPath
    const db = await DatabaseAdapterFactory.create(dbPath)
    await db.initialize()
    return db
}

function parseContent(options: Record<string, unknown>): string {
    const file = options['file'] as string | undefined
    const contentStr = options['content'] as string | undefined

    if (file) {
        return readFileSync(file, 'utf-8')
    }
    if (contentStr !== undefined) {
        return contentStr
    }

    process.stderr.write('Error: Must provide either --file or --content\n')
    process.exit(1)
}

function parseRelatedTo(relatedToStr: unknown): number[] {
    if (typeof relatedToStr !== 'string') return []
    return relatedToStr.split(',').map((s) => s.trim()).filter(Boolean).map(Number)
}

export async function createEntryAction(options: Record<string, unknown>, command: Command): Promise<void> {
    const db = await getDb(command.optsWithGlobals(), command)

    try {
        const content = parseContent(options)
        
        const tagsStr = options['tags'] as string | undefined
        const tags = tagsStr !== undefined ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : undefined
        
        const projectNumber = options['project'] !== undefined ? Number(options['project']) : undefined
        const trustScore = options['trustScore'] !== undefined ? Number(options['trustScore']) : undefined
        const impactScore = options['impactScore'] !== undefined ? Number(options['impactScore']) : undefined
        
        const autoContextStr = options['autoContext'] as string | undefined

        const entryInput: CreateEntryInput = {
            content,
            entryType: options['type'] as EntryType | undefined,
            tags,
            projectNumber,
            trustScore,
            impactScore,
            validationStatus: options['validationStatus'] as 'passed' | 'failed' | 'none' | undefined,
            sessionId: options['sessionId'] as string | undefined,
            autoContext: autoContextStr
        }

        const newEntry = db.createEntry(entryInput)

        const relatedIds = parseRelatedTo(options['relatedTo'])
        for (const targetId of relatedIds) {
            db.linkEntries(newEntry.id, targetId, 'references')
        }

        db.flushSave()
        process.stdout.write(`Successfully created entry #${newEntry.id}\n`)
    } catch (e) {
        process.stderr.write("Failed to create entry: " + (e instanceof Error ? e.message : String(e)) + "\n")
        process.exit(1)
    } finally {
        db.close()
    }
}

export async function updateEntryAction(options: Record<string, unknown>, command: Command): Promise<void> {
    const db = await getDb(command.optsWithGlobals(), command)

    try {
        const entryId = options['id'] !== undefined ? Number(options['id']) : undefined
        if (entryId === undefined || isNaN(entryId)) {
            process.stderr.write('Error: Must provide a valid --id\n')
            process.exit(1)
        }

        const version = options['expectedVersion'] !== undefined ? Number(options['expectedVersion']) : undefined
        if (version === undefined || isNaN(version)) {
            process.stderr.write('Error: Must provide a valid --expected-version (expected version) to prevent concurrent overwrites\n')
            process.exit(1)
        }

        const content = parseContent(options)
        
        const result = db.updateEntry(entryId, { content, expectedVersion: version })
        
        if (result === null) {
             process.stderr.write(`Error: Entry #${entryId} not found or version mismatch.\n`)
             process.exit(1)
        }

        const relatedIds = parseRelatedTo(options['relatedTo'])
        for (const targetId of relatedIds) {
            db.linkEntries(entryId, targetId, 'references')
        }

        db.flushSave()
        process.stdout.write(`Successfully updated entry #${result.id} to version ${result.version}\n`)
    } catch (e) {
        process.stderr.write("Failed to update entry: " + (e instanceof Error ? e.message : String(e)) + "\n")
        process.exit(1)
    } finally {
        db.close()
    }
}
