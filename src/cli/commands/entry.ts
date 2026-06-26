import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { EntryType, RelationshipType } from '../../types/index.js'
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

async function parseContent(options: Record<string, unknown>): Promise<string> {
    const file = options['file'] as string | undefined
    const contentStr = options['content'] as string | undefined

    if (file) {
        return readFileSync(file, 'utf-8')
    }
    if (contentStr !== undefined) {
        return contentStr
    }

    if (!process.stdin.isTTY) {
        let stdinStr = ''

        // Add a safety timeout for automated execution environments
        const timeout = setTimeout(() => {
            if (stdinStr.length === 0) {
                process.stderr.write('Error: Timed out waiting for stdin. You must provide --file or --content when running in a non-interactive shell.\n')
                process.exit(1)
            }
        }, 3000)

        for await (const chunk of process.stdin) {
            stdinStr += chunk
        }
        clearTimeout(timeout)

        if (stdinStr.trim().length > 0) {
            return stdinStr
        }
    }

    process.stderr.write('Error: Must provide either --file, --content, or pipe data to stdin\n')
    process.exit(1)
}

function parseRelatedTo(relatedToStr: unknown): number[] {
    if (typeof relatedToStr !== 'string') return []
    return relatedToStr.split(',').map((s) => s.trim()).filter(Boolean).map(Number)
}

function parseRelationships(relationshipsStr: unknown, relFileStr: unknown): { target_id: number, relation_type: string }[] {
    let str = relationshipsStr
    if (typeof relFileStr === 'string') {
        try {
            str = readFileSync(relFileStr, 'utf-8')
        } catch (e) {
            process.stderr.write(`Warning: Failed to read --rel-file: ${e instanceof Error ? e.message : String(e)}\n`)
        }
    }
    
    if (typeof str !== 'string') return []
    try {
        const parsed: unknown = JSON.parse(str)
        if (Array.isArray(parsed)) {
            return parsed.map((r: unknown) => {
                if (typeof r !== 'object' || r === null) return null;
                const rec = r as Record<string, unknown>;
                return {
                    target_id: Number(rec['target_id']),
                    relation_type: String(rec['relation_type'])
                };
            }).filter((r): r is {target_id: number, relation_type: string} => r !== null && !isNaN(r.target_id) && Boolean(r.relation_type))
        }
    } catch (e) {
        process.stderr.write(`Warning: Failed to parse relationships JSON: ${e instanceof Error ? e.message : String(e)}\n`)
    }
    return []
}

export async function createEntryAction(options: Record<string, unknown>, command: Command): Promise<void> {
    const db = await getDb(command.optsWithGlobals(), command)

    try {
        let content = await parseContent(options)
        
        const title = options['title'] as string | undefined
        if (title && !content.startsWith('# ')) {
            content = `# ${title}\n\n${content}`
        }

        const tagsStr = options['tags'] as string | undefined
        const tags = tagsStr !== undefined ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : undefined
        
        const projectNumber = options['project'] !== undefined ? Number(options['project']) : undefined
        const trustScore = options['trustScore'] !== undefined ? Number(options['trustScore']) : undefined
        const impactScore = options['impactScore'] !== undefined ? Number(options['impactScore']) : undefined
        
        let autoContextStr = options['autoContext'] as string | undefined
        const autoContextFile = options['autoContextFile'] as string | undefined
        if (autoContextFile) {
            try {
                autoContextStr = readFileSync(autoContextFile, 'utf-8')
            } catch (e) {
                process.stderr.write(`Warning: Failed to read --auto-context-file: ${e instanceof Error ? e.message : String(e)}\n`)
            }
        }

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

        const relationships = parseRelationships(options['relationships'], options['relFile'])
        for (const rel of relationships) {
            db.linkEntries(newEntry.id, rel.target_id, rel.relation_type as RelationshipType)
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

        let content = await parseContent(options)
        
        const title = options['title'] as string | undefined
        if (title && !content.startsWith('# ')) {
            content = `# ${title}\n\n${content}`
        }
        
        const tagsStr = options['tags'] as string | undefined
        const tags = tagsStr !== undefined ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : undefined
        const projectNumber = options['project'] !== undefined ? Number(options['project']) : undefined
        const trustScore = options['trustScore'] !== undefined ? Number(options['trustScore']) : undefined
        const impactScore = options['impactScore'] !== undefined ? Number(options['impactScore']) : undefined
        
        const updates: Partial<CreateEntryInput> & { expectedVersion: number } = { content, expectedVersion: version }
        if (options['type'] !== undefined) updates.entryType = options['type'] as EntryType
        if (tags !== undefined) updates.tags = tags
        if (projectNumber !== undefined) updates.projectNumber = projectNumber
        if (trustScore !== undefined) updates.trustScore = trustScore
        if (impactScore !== undefined) updates.impactScore = impactScore
        if (options['validationStatus'] !== undefined) updates.validationStatus = options['validationStatus'] as 'passed' | 'failed' | 'none'
        if (options['sessionId'] !== undefined) updates.sessionId = options['sessionId'] as string
        let autoContextStr = options['autoContext'] as string | undefined
        const autoContextFile = options['autoContextFile'] as string | undefined
        if (autoContextFile) {
            try {
                autoContextStr = readFileSync(autoContextFile, 'utf-8')
            } catch (e) {
                process.stderr.write(`Warning: Failed to read --auto-context-file: ${e instanceof Error ? e.message : String(e)}\n`)
            }
        }
        if (autoContextStr !== undefined) updates.autoContext = autoContextStr

        const result = db.updateEntry(entryId, updates)
        
        if (result === null) {
             process.stderr.write(`Error: Entry #${entryId} not found or version mismatch.\n`)
             process.exit(1)
        }

        const relatedIds = parseRelatedTo(options['relatedTo'])
        for (const targetId of relatedIds) {
            db.linkEntries(entryId, targetId, 'references')
        }

        const relationships = parseRelationships(options['relationships'], options['relFile'])
        for (const rel of relationships) {
            db.linkEntries(entryId, rel.target_id, rel.relation_type as RelationshipType)
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
