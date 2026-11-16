import type { Command } from 'commander'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { RelationshipType, CreateEntryInput, ToolHandlerConfig } from '../../types/index.js'
import { z } from 'zod'
import { AuthorizationError, ValidationError } from '../../types/errors.js'
import { enforceCliTeamRbac } from './db-helper.js'
import { canonicalizeTeamAuthor } from '../../handlers/tools/team/rbac.js'
import { resolveTeamCreateAuthor } from '../../handlers/tools/team/admin-tools/batch-create-helpers.js'
import { checkSingleTeamOwnership } from '../../handlers/tools/team/admin-tools/batch-delete-helpers.js'
import { createEntryOptionsSchema, updateEntryOptionsSchema } from '../schemas.js'
import {
    assertCliUpdateWorkspaceOwnership,
    buildCliEntryUpdateObject,
    validateCliUpdateArgsAndTarget,
    type UpdateEntryCliOptions,
} from './entry-update-helpers.js'
import {
    getDb,
    parseContent,
    parseFrontmatter,
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

export { getDb, parseContent, parseFrontmatter, buildEntryPayload, type EntryPayload }

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

        let resolvedAuthor: string | undefined
        if (options.team === true) {
            const authorResult = resolveTeamCreateAuthor(undefined, db, config, resolvedWs)
            if ('errorResponse' in authorResult) {
                throw new AuthorizationError(String(authorResult.errorResponse['error']))
            }
            resolvedAuthor = canonicalizeTeamAuthor(db, authorResult.author, resolvedWs)
        }

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
            ...(options.team === true && resolvedAuthor !== undefined
                ? { isPersonal: false, author: resolvedAuthor }
                : {}),
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

function buildUpdatedEntryPayload(
    options: HealedEntryOptions,
    config: ToolHandlerConfig,
    rawContent: string,
    trimmedTargetWs: string | undefined,
    existingWorkspaceId: string | undefined
): { content: string; payload: EntryPayload; metaSourceWs: string | undefined } {
    const { frontmatter, body } = parseFrontmatter(rawContent)
    let content = body
    if (options.title && !content.startsWith('# ')) {
        content = `# ${options.title}\n\n${content}`
    }
    const metadata = { ...frontmatter, ...parseMetadata(options.metadata) }
    const metaWs =
        typeof metadata['workspace_id'] === 'string'
            ? metadata['workspace_id'].trim()
            : typeof metadata['workspace'] === 'string'
              ? metadata['workspace'].trim()
              : undefined
    if (metaWs === '*') {
        throw new ValidationError(
            "workspace_id '*' cannot be used to update an entry. Pass a concrete workspace.",
            { workspaceId: '*' }
        )
    }
    const metaSourceWs = metaWs !== undefined && metaWs !== '' ? metaWs : undefined
    const effectiveOptions =
        trimmedTargetWs !== undefined
            ? {
                  ...options,
                  workspaceId: trimmedTargetWs,
                  workspace: trimmedTargetWs,
                  workspace_id: trimmedTargetWs,
              }
            : options
    const effectiveMetadata =
        trimmedTargetWs !== undefined
            ? { ...metadata, workspace_id: trimmedTargetWs, workspace: trimmedTargetWs }
            : metadata
    const payload = buildEntryPayload(
        effectiveOptions,
        effectiveMetadata,
        config,
        content,
        existingWorkspaceId
    )
    return { content, payload, metaSourceWs }
}

function enforceCliUpdateTeamPermissions(
    db: IDatabaseAdapter,
    config: ToolHandlerConfig,
    entryId: number,
    existingEntry: ReturnType<IDatabaseAdapter['getEntryById']>,
    trimmedTargetWs: string | undefined
): void {
    enforceCliTeamRbac(db, config, 'member', existingEntry?.workspaceId ?? trimmedTargetWs)
    if (
        trimmedTargetWs !== undefined &&
        existingEntry?.workspaceId !== undefined &&
        existingEntry.workspaceId.toLowerCase() !== trimmedTargetWs.toLowerCase()
    ) {
        enforceCliTeamRbac(db, config, 'member', trimmedTargetWs)
    }
    if (existingEntry !== null && existingEntry !== undefined) {
        const denied = checkSingleTeamOwnership(
            db,
            { db, teamDb: db, config },
            entryId,
            'modify',
            existingEntry.workspaceId
        )
        if (denied !== null) {
            throw new AuthorizationError(String(denied['error']))
        }
    }
}

export async function updateEntryAction(...args: unknown[]): Promise<void> {
    const command = args[args.length - 1] as Command
    const options = (args.length > 1 ? args[args.length - 2] : {}) as UpdateEntryCliOptions

    applyCliEntryFlagAliases(options, args.slice(0, args.length - 2))
    const { db, config } = await getDb(options, command)

    try {
        const { entryId, version, rawWorkspaceOpt, trimmedTargetWs } =
            validateCliUpdateArgsAndTarget(options)
        const existingEntry = db.getEntryById(entryId, '*')
        if (options.team === true) {
            enforceCliUpdateTeamPermissions(db, config, entryId, existingEntry, trimmedTargetWs)
        }
        const rawContent =
            options.file === undefined &&
            options.content === undefined &&
            existingEntry?.content !== undefined
                ? existingEntry.content
                : await parseContent(options)
        const { content, payload, metaSourceWs } = buildUpdatedEntryPayload(
            options,
            config,
            rawContent,
            trimmedTargetWs,
            existingEntry?.workspaceId
        )

        assertCliUpdateWorkspaceOwnership(
            entryId,
            existingEntry,
            rawWorkspaceOpt,
            payload,
            trimmedTargetWs,
            config,
            metaSourceWs
        )

        const updates = buildCliEntryUpdateObject(
            content,
            version,
            payload,
            existingEntry,
            trimmedTargetWs,
            config
        )
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
