import type { Command } from 'commander'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { RelationshipType, CreateEntryInput, ToolHandlerConfig } from '../../types/index.js'
import { z } from 'zod'
import { ValidationError } from '../../types/errors.js'
import { activeProjectRegistry, pairStoredScope } from '../../utils/write-scope.js'
import { resolveWorkspaceId } from '../../utils/workspace-resolver.js'
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
import {
    applyCliEntryFlagAliases,
    type HealedEntryOptions,
} from './entry-payload-helpers.js'

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

async function loadCliEntryContentAndPayload(
    options: HealedEntryOptions,
    config: ToolHandlerConfig,
    fallbackContent?: string,
    fallbackWorkspaceId?: string
): Promise<{
    content: string
    metadata: Record<string, unknown>
    payload: EntryPayload
}> {
    const rawContent =
        options.file === undefined &&
        options.content === undefined &&
        fallbackContent !== undefined
            ? fallbackContent
            : await parseContent(options)
    const { frontmatter, body } = parseFrontmatter(rawContent)
    let content = body

    const title = options.title
    if (title && !content.startsWith('# ')) {
        content = `# ${title}\n\n${content}`
    }

    const metadata = { ...frontmatter, ...parseMetadata(options.metadata) }
    const payload = buildEntryPayload(
        options,
        metadata,
        config,
        content,
        fallbackWorkspaceId
    )
    return { content, metadata, payload }
}

function linkCliEntryRelationships(
    db: IDatabaseAdapter,
    entryId: number,
    payload: EntryPayload,
    workspaceId: string | undefined
): { target_id: number; error: string }[] {
    const linkFailures: { target_id: number; error: string }[] = []
    const linkRequests: { targetId: number; type: RelationshipType }[] = [
        ...payload.relatedIds.map((targetId) => ({ targetId, type: 'references' as const })),
        ...payload.relationships.map((rel) => ({
            targetId: rel.target_id,
            type: rel.relation_type,
        })),
    ]
    for (const request of linkRequests) {
        try {
            db.linkEntries(entryId, request.targetId, request.type, undefined, workspaceId)
        } catch (linkError) {
            linkFailures.push({
                target_id: request.targetId,
                error: linkError instanceof Error ? linkError.message : String(linkError),
            })
        }
    }
    return linkFailures
}

function writeCliEntryResult(
    entry: { id: number; version?: number | undefined },
    linkFailures: { target_id: number; error: string }[],
    jsonOutput: boolean | undefined,
    verb: 'created' | 'updated'
): void {
    if (linkFailures.length > 0) {
        process.exitCode = 1
    }

    if (jsonOutput === true) {
        process.stdout.write(
            JSON.stringify({
                status: linkFailures.length > 0 ? 'partial' : 'success',
                id: entry.id,
                version: entry.version,
                ...(linkFailures.length > 0 ? { entryPersisted: true, linkFailures } : {}),
            }) + '\n'
        )
    } else {
        const versionSuffix =
            verb === 'updated' && entry.version !== undefined ? ` to version ${entry.version}` : ''
        process.stderr.write(`Successfully ${verb} entry #${entry.id}${versionSuffix}\n`)
        for (const failure of linkFailures) {
            process.stderr.write(
                `Warning: entry #${entry.id} was ${verb}, but linking to #${failure.target_id} failed: ${failure.error}\n`
            )
        }
    }
}

export async function createEntryAction(...args: unknown[]): Promise<void> {
    const command = args[args.length - 1] as Command
    const options = (args.length > 1 ? args[args.length - 2] : {}) as HealedEntryOptions

    applyCliEntryFlagAliases(options, args.slice(0, args.length - 2))

    const { db, config } = await getDb(options, command)

    try {
        const { content, payload } = await loadCliEntryContentAndPayload(options, config)

        let resolvedWs = payload.workspaceId?.trim()
        // [INVARIANT] `*` is an admin read override and can never be a write target (H4).
        if (resolvedWs === '*') {
            throw new ValidationError(
                "workspace_id '*' cannot be used to create an entry. Pass a concrete workspace.",
                { workspaceId: '*' }
            )
        }
        if (resolvedWs === undefined || resolvedWs === '' || resolvedWs.toLowerCase() === 'test') {
            resolvedWs = undefined
        }

        z.object({
            workspace_id: z
                .string()
                .min(
                    1,
                    'workspace_id (repository name) is required. It could not be auto-resolved from project_number or current directory.'
                ),
            project_number: z
                .number({
                    message: 'project_number is required. Entries must be assigned to a valid project.',
                })
                .int()
                .positive('project_number must be a positive project id.'),
        }).parse({ workspace_id: resolvedWs, project_number: payload.projectNumber })

        const entryInput: CreateEntryInput = {
            content,
            entryType: payload.entryType,
            significanceType: payload.significanceType,
            tags: payload.tags,
            projectNumber: payload.projectNumber,
            workspaceId: resolvedWs,
            trustScore: payload.trustScore,
            impactScore: payload.impactScore,
            validationStatus: payload.validationStatus,
            sessionId: payload.sessionId,
            autoContext: payload.autoContextStr,
        }

        const newEntry = db.createEntry(entryInput)
        const linkFailures = linkCliEntryRelationships(
            db,
            newEntry.id,
            payload,
            resolvedWs
        )
        db.flushSave()
        writeCliEntryResult(newEntry, linkFailures, options.json, 'created')
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

        if (options.workspace?.trim() === '*') {
            throw new ValidationError(
                "workspace_id '*' cannot be used to update an entry. Pass a concrete workspace.",
                { workspaceId: '*' }
            )
        }

        const existingEntry = db.getEntryById(entryId, '*')
        const implicitWorkspace =
            options.workspace === undefined
                ? resolveWorkspaceId(undefined, undefined, {
                      runtime: null,
                      ...(config.defaultWorkspaceId !== undefined
                          ? { defaultWorkspaceId: config.defaultWorkspaceId }
                          : {}),
                      ...(config.projectRegistry !== undefined
                          ? { projectRegistry: config.projectRegistry }
                          : {}),
                  })
                : undefined
        if (
            existingEntry !== null &&
            implicitWorkspace !== undefined &&
            implicitWorkspace !== 'default' &&
            existingEntry.workspaceId !== undefined &&
            existingEntry.workspaceId.toLowerCase() !== implicitWorkspace.toLowerCase()
        ) {
            throw new ValidationError(
                `Entry #${String(entryId)} belongs to workspace '${existingEntry.workspaceId}', not active workspace '${implicitWorkspace}'. Pass --workspace '${existingEntry.workspaceId}' explicitly to update it.`,
                {
                    entryId,
                    entryWorkspaceId: existingEntry.workspaceId,
                    activeWorkspaceId: implicitWorkspace,
                }
            )
        }
        const { content, payload } = await loadCliEntryContentAndPayload(
            options,
            config,
            existingEntry?.content,
            existingEntry?.workspaceId
        )

        if (payload.workspaceId?.trim() === '*') {
            throw new ValidationError(
                "workspace_id '*' cannot be used to update an entry. Pass a concrete workspace.",
                { workspaceId: '*' }
            )
        }

        const updates: Omit<Partial<CreateEntryInput>, 'projectNumber'> & {
            projectNumber?: number | null
            expectedVersion: number
            targetWorkspaceId?: string
        } = {
            content,
            expectedVersion: version,
        }
        if (payload.entryType !== undefined) updates.entryType = payload.entryType
        if (payload.tags !== undefined) updates.tags = payload.tags
        // [INVARIANT] A cwd-derived project number is only backfilled onto an unnumbered entry
        // that lives in a non-`default` workspace and stays in that workspace; `default` entries
        // stay unnumbered unless the caller passed an explicit project (C2).
        const existingIsDefault = existingEntry?.workspaceId?.toLowerCase() === 'default'
        if (
            payload.projectNumber !== undefined &&
            (payload.hasExplicitProject === true ||
                (!existingIsDefault &&
                    (existingEntry?.projectNumber == null || existingEntry.projectNumber === 0) &&
                    payload.workspaceId === existingEntry?.workspaceId))
        ) {
            updates.projectNumber = payload.projectNumber
        }
        const canReassignWorkspace =
            payload.workspaceId !== undefined &&
            payload.workspaceId !== '*' &&
            payload.hasExplicitWorkspace === true
        if (canReassignWorkspace && payload.workspaceId !== undefined) {
            if (existingEntry !== null && existingEntry.workspaceId !== payload.workspaceId) {
                updates.workspaceId = '*'
                updates.targetWorkspaceId = payload.workspaceId
                if (payload.hasExplicitProject !== true) {
                    updates.projectNumber = payload.projectNumber ?? null
                }
            } else {
                updates.workspaceId = payload.workspaceId
            }
        } else if (existingEntry?.workspaceId !== undefined) {
            if (payload.hasExplicitProject === true && payload.projectNumber !== undefined) {
                pairStoredScope(
                    existingEntry.workspaceId,
                    payload.projectNumber,
                    activeProjectRegistry(config.projectRegistry)
                )
            }
            updates.workspaceId = existingEntry.workspaceId
        } else if (payload.workspaceId !== undefined) {
            updates.workspaceId = payload.workspaceId
        }
        if (payload.trustScore !== undefined) updates.trustScore = payload.trustScore
        if (payload.impactScore !== undefined) updates.impactScore = payload.impactScore
        if (payload.validationStatus !== undefined) {
            updates.validationStatus = payload.validationStatus
        }
        if (payload.significanceType !== undefined) {
            updates.significanceType = payload.significanceType
        }
        if (payload.sessionId !== undefined) updates.sessionId = payload.sessionId
        if (payload.autoContextStr !== undefined) updates.autoContext = payload.autoContextStr

        const result = db.updateEntry(entryId, updates)

        if (result === null) {
            process.stderr.write(`Error: Entry #${entryId} not found or version mismatch.\n`)
            process.exit(1)
        }

        const linkFailures = linkCliEntryRelationships(
            db,
            entryId,
            payload,
            result.workspaceId ?? payload.workspaceId
        )
        db.flushSave()
        writeCliEntryResult(result, linkFailures, options.json, 'updated')
    } catch (e) {
        handleCliEntryError(e, 'update')
    } finally {
        db.close()
    }
}
