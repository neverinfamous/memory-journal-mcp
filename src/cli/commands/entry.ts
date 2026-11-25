import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { RelationshipType, ToolHandlerConfig } from '../../types/index.js'
import { z } from 'zod'
import { ValidationError, AuthorizationError } from '../../types/errors.js'
import type { CliCommandLike } from '../../utils/config-resolver.js'
import { isRecord } from '../../utils/type-guards.js'
import { CliExitError } from './db-core.js'
import { resolveEntryAnchors } from '../../handlers/tools/core/entry-anchors.js'
import { linkRequestedRelationships } from '../../handlers/tools/relationship-linking.js'
import {
    extractUpdateEntryCliOptions,
    prepareCliEntryUpdate,
    validateCliUpdateArgsAndTarget,
} from './entry-update-helpers.js'
import { formatCliError } from './cli-output.js'
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
    extractHealedEntryOptions,
    firstNonBlankString,
    validateCliEntryContent,
    type HealedEntryOptions,
} from './entry-payload-helpers.js'
import {
    autoPopulateCliSuggestedLinks,
    handleCliDryRunLinks,
} from './entry-link-helpers.js'

export { getDb, parseContent, parseFrontmatter, buildEntryPayload, type EntryPayload }

function handleCliEntryError(e: unknown, actionLabel: 'create' | 'update'): number {
    if (e instanceof CliExitError) {
        return e.exitCode
    }
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
            `Failed to ${actionLabel} entry: ${formatCliError(e)}\n`
        )
    }
    return 1
}

async function loadCliEntryContentAndPayload(
    options: HealedEntryOptions,
    config: ToolHandlerConfig
): Promise<{
    content: string
    metadata: Record<string, unknown>
    payload: EntryPayload
}> {
    const rawContent = await parseContent(options)
    const { frontmatter, body } = parseFrontmatter(rawContent)
    let content = body

    const title = options.title
    if (title && !content.startsWith('# ')) {
        content = `# ${title}\n\n${content}`
    }
    validateCliEntryContent(content)

    const metadata = { ...frontmatter, ...parseMetadata(options.metadata) }
    const payload = buildEntryPayload(options, metadata, config, content)
    return { content, metadata, payload }
}

const LINK_WARNING_RE = /-> #(\d+) was not created: ([\s\S]+)$/

function linkCliEntryRelationships(
    db: IDatabaseAdapter,
    entryId: number,
    payload: EntryPayload,
    workspaceId: string | undefined,
    projectNumber: number | undefined
): { target_id: number; error: string }[] {
    const linkRequests: { targetId: number; relationType: RelationshipType }[] = [
        ...payload.relatedIds.map((targetId) => ({ targetId, relationType: 'references' as const })),
        ...payload.relationships.map((rel) => ({
            targetId: rel.target_id,
            relationType: rel.relation_type,
        })),
    ]
    if (linkRequests.length === 0) return []
    const warnings = linkRequestedRelationships(
        db,
        entryId,
        linkRequests,
        workspaceId,
        projectNumber
    )
    return warnings.map((msg, idx) => {
        const match = LINK_WARNING_RE.exec(msg)
        return {
            target_id:
                match?.[1] !== undefined
                    ? Number(match[1])
                    : (linkRequests[idx]?.targetId ?? 0),
            error: match?.[2] ?? msg,
        }
    })
}

function writeCliEntryResult(
    entry: { id: number; version?: number | undefined },
    linkFailures: { target_id: number; error: string }[],
    jsonOutput: boolean | undefined,
    verb: 'created' | 'updated',
    mutateProcessExitCode = true
): void {
    if (linkFailures.length > 0 && mutateProcessExitCode) {
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

const CLI_CREATE_SCOPE_SCHEMA = z.object({
    workspace_id: z
        .string()
        .min(
            1,
            'workspace_id (repository name) is required. It could not be auto-resolved from project_number or current directory.'
        )
        .max(255, 'workspace_id must be 255 characters or fewer.'),
    project_number: z
        .number({
            message: 'project_number is required. Entries must be assigned to a valid project.',
        })
        .int()
        .positive('project_number must be a positive project id.'),
})

async function resolveCliCreateScopeAndAuthor(
    options: HealedEntryOptions,
    payload: EntryPayload,
    db: IDatabaseAdapter,
    config: ToolHandlerConfig
): Promise<{ resolvedWs: string; resolvedAuthor: string | undefined }> {
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
    const parsedScope = CLI_CREATE_SCOPE_SCHEMA.parse({
        workspace_id: resolvedWs,
        project_number: payload.projectNumber,
    })
    let resolvedAuthor: string | undefined
    if (options.team === true) {
        const [{ resolveTeamCreateAuthor }, { canonicalizeTeamAuthor }] = await Promise.all([
            import('../../handlers/tools/team/admin-tools/create-author-helper.js'),
            import('../../handlers/tools/team/rbac.js'),
        ])
        const authorResult = resolveTeamCreateAuthor(undefined, db, config, parsedScope.workspace_id)
        if ('errorResponse' in authorResult) {
            throw new AuthorizationError(String(authorResult.errorResponse['error']))
        }
        resolvedAuthor = canonicalizeTeamAuthor(db, authorResult.author, parsedScope.workspace_id)
    }
    return { resolvedWs: parsedScope.workspace_id, resolvedAuthor }
}

async function runCreateEntry(
    options: HealedEntryOptions,
    command: CliCommandLike,
    inProcess = false
): Promise<number | undefined> {
    let db: IDatabaseAdapter | undefined
    let exitCode: number | undefined

    try {
        const loaded = await getDb(options, command, { throwOnExit: inProcess })
        db = loaded.db
        const { config } = loaded
        const { content, payload } = await loadCliEntryContentAndPayload(options, config)
        const { resolvedWs, resolvedAuthor } = await resolveCliCreateScopeAndAuthor(options, payload, db, config)
        const resolvedAnchors = await resolveEntryAnchors(
            payload.anchors,
            payload.autoContextStr,
            resolvedWs,
            { db, config }
        )

        if (options.dryRunLinks === true) {
            handleCliDryRunLinks({
                db,
                workspaceId: resolvedWs,
                projectNumber: payload.projectNumber,
                sessionId: payload.sessionId,
                anchors: resolvedAnchors,
                json: options.json,
            })
            return undefined
        }

        const newEntry = db.createEntry({
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
            ...(resolvedAnchors !== undefined ? { anchors: resolvedAnchors } : {}),
            ...(options.team === true && resolvedAuthor !== undefined
                ? { isPersonal: false, author: resolvedAuthor }
                : {}),
        })
        await autoPopulateCliSuggestedLinks({
            db, entry: newEntry, workspaceId: resolvedWs, projectNumber: payload.projectNumber,
            sessionId: payload.sessionId, relationships: payload.relationships,
            relatedIds: payload.relatedIds, autoLink: payload.autoLink, isTeam: options.team,
        })
        const effectiveProjectNumber =
            typeof newEntry.projectNumber === 'number' && newEntry.projectNumber > 0
                ? newEntry.projectNumber
                : payload.projectNumber
        const linkFailures = linkCliEntryRelationships(db, newEntry.id, payload, resolvedWs, effectiveProjectNumber)
        db.flushSave()
        writeCliEntryResult(newEntry, linkFailures, options.json, 'created', !inProcess)
        if (linkFailures.length > 0) exitCode = 1
    } catch (e) {
        exitCode = handleCliEntryError(e, 'create')
    } finally {
        db?.close()
    }
    return exitCode
}

function isCliCommandLike(val: unknown): val is CliCommandLike {
    return (
        isRecord(val) &&
        typeof val['name'] === 'function' &&
        typeof val['getOptionValueSource'] === 'function'
    )
}

function extractCliCommandAndRawOptions(
    args: unknown[],
    fallbackName: string
): { command: CliCommandLike; rawOptions: unknown; restArgs: unknown[] } {
    const rawCommand = args.length > 0 ? args[args.length - 1] : undefined
    const command: CliCommandLike = isCliCommandLike(rawCommand)
        ? rawCommand
        : { name: () => fallbackName, getOptionValueSource: () => undefined }
    const rawOptions = args.length > 1 ? args[args.length - 2] : {}
    const restArgs = args.length > 2 ? args.slice(0, args.length - 2) : []
    return { command, rawOptions, restArgs }
}

export async function createEntryAction(...args: unknown[]): Promise<void> {
    const { command, rawOptions, restArgs } = extractCliCommandAndRawOptions(args, 'create')
    const options = extractHealedEntryOptions(rawOptions)
    applyCliEntryFlagAliases(options, restArgs)
    const exitCode = await runCreateEntry(options, command)
    if (exitCode !== undefined) process.exit(exitCode)
}

export async function createEntryFromFileInProcess(options: {
    file: string
    dryRunLinks?: boolean | undefined
}): Promise<number> {
    if (options.file.trim().length === 0) {
        process.stderr.write('Error: Must provide a non-empty --file path for in-process entry creation.\n')
        return 1
    }
    const healedOptions: HealedEntryOptions = {
        file: options.file,
        ...(options.dryRunLinks === true ? { dryRunLinks: true } : {}),
    }
    const stubCommand: CliCommandLike = {
        name: () => 'create',
        getOptionValueSource: (key: string) =>
            Object.hasOwn(healedOptions, key) ? 'cli' : 'default',
    }
    const exitCode = await runCreateEntry(healedOptions, stubCommand, true)
    return exitCode ?? 0
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
    validateCliEntryContent(content)
    const metadata = { ...frontmatter, ...parseMetadata(options.metadata) }
    const metaSourceWs = firstNonBlankString(
        metadata['workspace_id'],
        metadata['workspaceId'],
        metadata['workspace']
    )
    if (metaSourceWs === '*') {
        throw new ValidationError(
            "workspace_id '*' cannot be used to update an entry. Pass a concrete workspace.",
            { workspaceId: '*' }
        )
    }
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

async function enforceCliUpdateTeamPermissions(
    db: IDatabaseAdapter,
    config: ToolHandlerConfig,
    entryId: number,
    existingEntry: ReturnType<IDatabaseAdapter['getEntryById']>,
    trimmedTargetWs: string | undefined,
    rawWorkspaceOpt: string | undefined
): Promise<void> {
    const [{ enforceCliTeamRbac }, { checkSingleTeamOwnership }] = await Promise.all([
        import('./db-helper.js'),
        import('../../handlers/tools/team/admin-tools/ownership-helper.js'),
    ])
    enforceCliTeamRbac(db, config, 'member', existingEntry?.workspaceId ?? trimmedTargetWs ?? rawWorkspaceOpt)
    if (
        trimmedTargetWs !== undefined &&
        existingEntry?.workspaceId !== undefined &&
        existingEntry.workspaceId.toLowerCase() !== trimmedTargetWs.toLowerCase()
    ) {
        enforceCliTeamRbac(db, config, 'member', trimmedTargetWs)
    }
    if (existingEntry !== null && existingEntry !== undefined) {
        const denied = checkSingleTeamOwnership(db, { db, teamDb: db, config }, entryId, 'modify', existingEntry.workspaceId)
        if (denied !== null) throw new AuthorizationError(String(denied['error']))
    }
}

export async function updateEntryAction(...args: unknown[]): Promise<void> {
    const { command, rawOptions, restArgs } = extractCliCommandAndRawOptions(args, 'update')
    const options = extractUpdateEntryCliOptions(rawOptions)
    applyCliEntryFlagAliases(options, restArgs)
    const { db, config } = await getDb(options, command)
    let exitCode: number | undefined
    try {
        const { entryId, version, rawWorkspaceOpt, trimmedTargetWs } = validateCliUpdateArgsAndTarget(options)
        const existingEntry = db.getEntryById(entryId, '*')
        if (options.team === true) {
            await enforceCliUpdateTeamPermissions(db, config, entryId, existingEntry, trimmedTargetWs, rawWorkspaceOpt)
        }
        if (existingEntry === null) {
            process.stderr.write(`Error: Entry #${entryId} not found or version mismatch.\n`)
            throw new CliExitError(1)
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
        const updates = await prepareCliEntryUpdate({
            entryId,
            version,
            existingEntry,
            rawWorkspaceOpt,
            trimmedTargetWs,
            metaSourceWs,
            content,
            payload,
            config,
            db,
            isTeam: Boolean(options.team),
        })
        const result = db.updateEntry(entryId, updates)
        if (result === null) {
            process.stderr.write(`Error: Entry #${entryId} not found or version mismatch.\n`)
            throw new CliExitError(1)
        }
        const effectiveProjectNumber =
            typeof result.projectNumber === 'number' && result.projectNumber > 0
                ? result.projectNumber
                : payload.projectNumber
        const linkFailures = linkCliEntryRelationships(
            db,
            entryId,
            payload,
            result.workspaceId ?? payload.workspaceId,
            effectiveProjectNumber
        )
        db.flushSave()
        writeCliEntryResult(result, linkFailures, options.json, 'updated')
    } catch (e) {
        exitCode = handleCliEntryError(e, 'update')
    } finally {
        db.close()
    }
    if (exitCode !== undefined) process.exit(exitCode)
}
