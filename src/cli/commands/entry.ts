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

function parseMetadata(metadataFile: unknown): Record<string, unknown> {
    if (typeof metadataFile !== 'string') return {}
    try {
        const str = readFileSync(metadataFile, 'utf-8')
        const parsed: unknown = JSON.parse(str)
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed as Record<string, unknown>
        }
    } catch (e) {
        process.stderr.write(`Warning: Failed to parse --metadata JSON: ${e instanceof Error ? e.message : String(e)}\n`)
    }
    return {}
}

interface EntryPayload {
    entryType: EntryType | undefined;
    tags: string[] | undefined;
    projectNumber: number | undefined;
    trustScore: number | undefined;
    impactScore: number | undefined;
    validationStatus: 'passed' | 'failed' | 'none' | undefined;
    sessionId: string | undefined;
    autoContextStr: string | undefined;
    relationships: { target_id: number; relation_type: string }[];
    relatedIds: number[];
}

function buildEntryPayload(options: Record<string, unknown>, metadata: Record<string, unknown>): EntryPayload {
    const entryTypeStr = options['type'] ?? metadata['type'] ?? metadata['entry_type'] ?? metadata['entryType']
    const entryType = entryTypeStr as EntryType | undefined

    const tagsStr = options['tags'] as string | undefined
    let tags: string[] | undefined
    if (tagsStr !== undefined) {
        tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean)
    } else if (metadata['tags'] !== undefined && metadata['tags'] !== null) {
        tags = Array.isArray(metadata['tags']) ? metadata['tags'].map(String) : undefined
    }

    const projectRaw = options['project'] ?? metadata['project'] ?? metadata['projectNumber'] ?? metadata['project_number']
    const projectNumber = projectRaw !== undefined ? Number(projectRaw) : undefined

    const trustRaw = options['trustScore'] ?? metadata['trust'] ?? metadata['trustScore'] ?? metadata['trust_score']
    const trustScore = trustRaw !== undefined ? Number(trustRaw) : undefined

    const impactRaw = options['impactScore'] ?? metadata['impact'] ?? metadata['impactScore'] ?? metadata['impact_score']
    const impactScore = impactRaw !== undefined ? Number(impactRaw) : undefined

    const valStatusRaw = options['validationStatus'] ?? metadata['validation_status'] ?? metadata['validationStatus']
    const validationStatus = valStatusRaw as 'passed' | 'failed' | 'none' | undefined

    const sessionIdRaw = options['sessionId'] ?? metadata['session_id'] ?? metadata['sessionId']
    const sessionId = sessionIdRaw as string | undefined

    let autoContextStr = options['autoContext'] as string | undefined
    const autoContextFile = options['autoContextFile'] as string | undefined
    if (autoContextFile) {
        try {
            autoContextStr = readFileSync(autoContextFile, 'utf-8')
        } catch (e) {
            process.stderr.write(`Warning: Failed to read --auto-context-file: ${e instanceof Error ? e.message : String(e)}\n`)
        }
    } else if (autoContextStr === undefined && metadata['auto_context'] !== undefined && metadata['auto_context'] !== null) {
        autoContextStr = typeof metadata['auto_context'] === 'string' ? metadata['auto_context'] : JSON.stringify(metadata['auto_context'])
    } else if (autoContextStr === undefined && metadata['autoContext'] !== undefined && metadata['autoContext'] !== null) {
        autoContextStr = typeof metadata['autoContext'] === 'string' ? metadata['autoContext'] : JSON.stringify(metadata['autoContext'])
    }

    let relationships: { target_id: number, relation_type: string }[]
    if (metadata['relationships'] !== undefined && metadata['relationships'] !== null && Array.isArray(metadata['relationships'])) {
        relationships = metadata['relationships'].map((r: unknown) => {
            const rec = r as Record<string, unknown> | null
            return {
                target_id: Number(rec?.['target_id']),
                relation_type: String(rec?.['relation_type'])
            }
        }).filter(r => !isNaN(r.target_id) && Boolean(r.relation_type) && r.relation_type !== 'undefined')
    } else {
        relationships = parseRelationships(options['relationships'], options['relFile'])
    }

    let relatedIds = parseRelatedTo(options['relatedTo'])
    if (relatedIds.length === 0 && Array.isArray(metadata['related_to'])) {
        relatedIds = metadata['related_to'].map(Number).filter(n => !isNaN(n))
    }

    return {
        entryType, tags, projectNumber, trustScore, impactScore, validationStatus, sessionId, autoContextStr, relationships, relatedIds
    }
}

export async function createEntryAction(options: Record<string, unknown>, command: Command): Promise<void> {
    const db = await getDb(command.optsWithGlobals(), command)

    try {
        let content = await parseContent(options)
        
        const title = options['title'] as string | undefined
        if (title && !content.startsWith('# ')) {
            content = `# ${title}\n\n${content}`
        }

        const metadata = parseMetadata(options['metadata'])
        const payload = buildEntryPayload(options, metadata)

        const entryInput: CreateEntryInput = {
            content,
            entryType: payload.entryType,
            tags: payload.tags,
            projectNumber: payload.projectNumber,
            trustScore: payload.trustScore,
            impactScore: payload.impactScore,
            validationStatus: payload.validationStatus,
            sessionId: payload.sessionId,
            autoContext: payload.autoContextStr
        }

        const newEntry = db.createEntry(entryInput)

        for (const targetId of payload.relatedIds) {
            db.linkEntries(newEntry.id, targetId, 'references')
        }

        for (const rel of payload.relationships) {
            db.linkEntries(newEntry.id, rel.target_id, rel.relation_type as RelationshipType)
        }

        db.flushSave()
        
        if (options['json'] === true) {
            process.stdout.write(JSON.stringify({ status: 'success', id: newEntry.id, version: newEntry.version }) + '\n')
        } else {
            process.stdout.write(`Successfully created entry #${newEntry.id}\n`)
        }
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
        
        const metadata = parseMetadata(options['metadata'])
        const payload = buildEntryPayload(options, metadata)
        
        const updates: Partial<CreateEntryInput> & { expectedVersion: number } = { content, expectedVersion: version }
        if (payload.entryType !== undefined) updates.entryType = payload.entryType
        if (payload.tags !== undefined) updates.tags = payload.tags
        if (payload.projectNumber !== undefined) updates.projectNumber = payload.projectNumber
        if (payload.trustScore !== undefined) updates.trustScore = payload.trustScore
        if (payload.impactScore !== undefined) updates.impactScore = payload.impactScore
        if (payload.validationStatus !== undefined) updates.validationStatus = payload.validationStatus
        if (payload.sessionId !== undefined) updates.sessionId = payload.sessionId
        if (payload.autoContextStr !== undefined) updates.autoContext = payload.autoContextStr

        const result = db.updateEntry(entryId, updates)
        
        if (result === null) {
             process.stderr.write(`Error: Entry #${entryId} not found or version mismatch.\n`)
             process.exit(1)
        }

        for (const targetId of payload.relatedIds) {
            db.linkEntries(entryId, targetId, 'references')
        }

        for (const rel of payload.relationships) {
            db.linkEntries(entryId, rel.target_id, rel.relation_type as RelationshipType)
        }

        db.flushSave()
        
        if (options['json'] === true) {
            process.stdout.write(JSON.stringify({ status: 'success', id: result.id, version: result.version }) + '\n')
        } else {
            process.stdout.write(`Successfully updated entry #${result.id} to version ${result.version}\n`)
        }
    } catch (e) {
        process.stderr.write("Failed to update entry: " + (e instanceof Error ? e.message : String(e)) + "\n")
        process.exit(1)
    } finally {
        db.close()
    }
}
