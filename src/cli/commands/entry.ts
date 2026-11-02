import type { Command } from 'commander'
import type { RelationshipType, CreateEntryInput } from '../../types/index.js'
import { z } from 'zod'
import { createEntryOptionsSchema, updateEntryOptionsSchema } from '../schemas.js'
import {
    getDb,
    parseContent,
    parseFrontmatter,
    parseRelatedTo,
    parseRelationships,
    parseMetadata,
    buildEntryPayload,
    type EntryPayload,
} from './entry-payload.js'

export const createEntrySchema = createEntryOptionsSchema
export const updateEntrySchema = updateEntryOptionsSchema

export {
    getDb,
    parseContent,
    parseFrontmatter,
    parseRelatedTo,
    parseRelationships,
    parseMetadata,
    buildEntryPayload,
    type EntryPayload,
}

type HealedEntryOptions = z.infer<typeof createEntrySchema> & {
    tag?: string
    contentFile?: string
    body?: string
}

function applyCliEntryFlagAliases(options: HealedEntryOptions, restArgs: unknown[]): void {
    if (options.tag !== undefined && options.tags === undefined) options.tags = options.tag
    if (options.contentFile !== undefined && options.file === undefined) {
        options.file = options.contentFile
    }
    if (options.body !== undefined && options.content === undefined) options.content = options.body
    if (options.validation !== undefined && options.validationStatus === undefined) {
        options.validationStatus = options.validation
    }
    if (options.validation_status !== undefined && options.validationStatus === undefined) {
        options.validationStatus = options.validation_status
    }
    if (options.workspace !== undefined && options.workspaceId === undefined) {
        options.workspaceId = options.workspace
    }
    if (options.summary !== undefined && options.title === undefined) {
        options.title = options.summary
    }

    if (
        restArgs.length > 0 &&
        typeof restArgs[0] === 'string' &&
        options.content === undefined
    ) {
        options.content = restArgs.map(String).join(' ')
    }
    if (options.description !== undefined && options.content === undefined) {
        options.content = options.description
    }
}

function handleCliEntryError(e: unknown, actionLabel: 'create' | 'update'): never {
    if (e instanceof z.ZodError) {
        const issues = e.issues
        if (issues.length > 0) {
            process.stderr.write(
                `Validation Error:\n${issues.map((err) => `- ${err.path.join('.')}: ${err.message}`).join('\n')}\n`
            )
        } else {
            process.stderr.write(`Validation Error:\n${e.message}\n`)
        }
    } else if (e instanceof Error && e.message.includes('FOREIGN KEY constraint failed')) {
        process.stderr.write(
            `🛠️ AUTONOMOUS HEALING: A FOREIGN KEY constraint failed. This usually means a target_id specified in relationships (or relatedIds) does not exist, or the project ID is invalid. Ensure you are passing a valid Entry ID (not a project ID) for relationships, and a valid project ID.\n`
        )
    } else {
        process.stderr.write(
            `Failed to ${actionLabel} entry: ${e instanceof Error ? e.message : String(e)}\n`
        )
    }
    process.exit(1)
}

export async function createEntryAction(...args: unknown[]): Promise<void> {
    const command = args[args.length - 1] as Command
    const options = (args.length > 1 ? args[args.length - 2] : {}) as HealedEntryOptions

    applyCliEntryFlagAliases(options, args.slice(0, args.length - 2))

    const { db, config } = await getDb(options, command)

    try {
        const rawContent = await parseContent(options)
        const { frontmatter, body } = parseFrontmatter(rawContent)
        let content = body

        const title = options.title
        if (title && !content.startsWith('# ')) {
            content = `# ${title}\n\n${content}`
        }

        const metadata = { ...frontmatter, ...parseMetadata(options.metadata) }
        const payload = buildEntryPayload(options, metadata, config)

        let resolvedWs = payload.workspaceId
        if (resolvedWs === 'default' && config.defaultWorkspaceId !== 'default') {
            const optsRec = z.record(z.string(), z.unknown()).parse(options)
            const explicitWs =
                optsRec['workspaceId'] ??
                optsRec['workspace_id'] ??
                metadata['workspaceId'] ??
                metadata['workspace_id']
            if (explicitWs !== 'default') {
                resolvedWs = undefined
            }
        }

        z.object({
            workspace_id: z
                .string()
                .min(
                    1,
                    'workspace_id (repository name) is required. It could not be auto-resolved from project_number or current directory.'
                ),
            project_number: z.number({
                message: 'project_number is required. Entries must be assigned to a valid project.',
            }),
        }).parse({ workspace_id: resolvedWs, project_number: payload.projectNumber })

        const entryInput: CreateEntryInput = {
            content,
            entryType: payload.entryType,
            tags: payload.tags,
            projectNumber: payload.projectNumber,
            workspaceId: payload.workspaceId,
            trustScore: payload.trustScore,
            impactScore: payload.impactScore,
            validationStatus: payload.validationStatus,
            sessionId: payload.sessionId,
            autoContext: payload.autoContextStr,
        }

        const newEntry = db.createEntry(entryInput)

        for (const targetId of payload.relatedIds) {
            db.linkEntries(newEntry.id, targetId, 'references')
        }

        for (const rel of payload.relationships) {
            db.linkEntries(newEntry.id, rel.target_id, rel.relation_type as RelationshipType)
        }

        db.flushSave()

        if (options.json === true) {
            process.stdout.write(
                JSON.stringify({ status: 'success', id: newEntry.id, version: newEntry.version }) +
                    '\n'
            )
        } else {
            process.stderr.write(`Successfully created entry #${newEntry.id}\n`)
        }
    } catch (e) {
        handleCliEntryError(e, 'create')
    } finally {
        db.close()
    }
}

export async function updateEntryAction(...args: unknown[]): Promise<void> {
    const command = args[args.length - 1] as Command
    const options = (args.length > 1 ? args[args.length - 2] : {}) as z.infer<
        typeof updateEntrySchema
    > & { tag?: string; contentFile?: string; body?: string }

    applyCliEntryFlagAliases(options, args.slice(0, args.length - 2))

    const { db, config } = await getDb(options, command)

    try {
        const entryId = options.id
        if (entryId === undefined || isNaN(entryId)) {
            process.stderr.write('Error: Must provide a valid --id\n')
            process.exit(1)
        }

        const version = options.expectedVersion
        if (version === undefined || isNaN(version)) {
            process.stderr.write(
                'Error: Must provide a valid --expected-version (expected version) to prevent concurrent overwrites\n'
            )
            process.exit(1)
        }

        const rawContent = await parseContent(options)
        const { frontmatter, body } = parseFrontmatter(rawContent)
        let content = body

        const title = options.title
        if (title && !content.startsWith('# ')) {
            content = `# ${title}\n\n${content}`
        }

        const metadata = { ...frontmatter, ...parseMetadata(options.metadata) }
        const payload = buildEntryPayload(options, metadata, config)

        const updates: Partial<CreateEntryInput> & { expectedVersion: number } = {
            content,
            expectedVersion: version,
        }
        if (payload.entryType !== undefined) updates.entryType = payload.entryType
        if (payload.tags !== undefined) updates.tags = payload.tags
        if (payload.projectNumber !== undefined) updates.projectNumber = payload.projectNumber
        if (payload.workspaceId !== undefined) updates.workspaceId = payload.workspaceId
        if (payload.trustScore !== undefined) updates.trustScore = payload.trustScore
        if (payload.impactScore !== undefined) updates.impactScore = payload.impactScore
        if (payload.validationStatus !== undefined) {
            updates.validationStatus = payload.validationStatus
        }
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

        if (options.json === true) {
            process.stdout.write(
                JSON.stringify({ status: 'success', id: result.id, version: result.version }) + '\n'
            )
        } else {
            process.stderr.write(
                `Successfully updated entry #${result.id} to version ${result.version}\n`
            )
        }
    } catch (e) {
        handleCliEntryError(e, 'update')
    } finally {
        db.close()
    }
}
