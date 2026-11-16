/**
 * Team IO Tools — 2 tools
 *
 * Tools: team_export_markdown, team_import_markdown
 *
 * Team equivalents of export_markdown and import_markdown that operate
 * on the team database and preserve the author field.
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'
import { AggregateMcpError } from '../../../types/errors.js'
import { exportEntriesToMarkdown } from '../../../markdown/index.js'
import { importMarkdownEntries, processImportBatch } from '../../../markdown/index.js'
import type { ExportableEntry } from '../../../markdown/index.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { batchFetchAuthors, triggerTeamNotifications, resolveTeamProjectNumber } from './helpers.js'
import {
    TEAM_IO_NOT_CONFIGURED,
    missingTeamIoProjectNumberError,
    resolveTeamImportScope,
    readAndConvertExternalMarkdownFiles,
    resolveTeamImportContextAuthor,
} from './io-scope-helpers.js'
import {
    DATE_FORMAT_REGEX,
    DATE_FORMAT_MESSAGE,
    DATE_MIN_SENTINEL,
    DATE_MAX_SENTINEL,
    relaxedNumber,
    StrictProjectNumberSchema,
    ENTRY_TYPES,
    SOURCE_FORMATS,
} from '../schemas.js'

// ============================================================================
// Schemas
// ============================================================================

const TeamExportMarkdownSchema = z
    .object({
        output_dir: z.string().min(1),
        start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
        end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
        tags: z.array(z.string()).optional(),
        project_number: StrictProjectNumberSchema.optional(),
        limit: z.number().int().min(1).max(500).optional().default(100),
        workspace_id: z.string().optional(),
    })
    .strict()

const TeamExportMarkdownSchemaMcp = z.object({
    output_dir: z.string().optional().describe('Target directory for .md files'),
    start_date: z.string().optional().describe('Start date filter (YYYY-MM-DD)'),
    end_date: z.string().optional().describe('End date filter (YYYY-MM-DD)'),
    tags: z.array(z.string()).optional().describe('Filter by tags'),
    project_number: relaxedNumber().optional().describe('Numeric project ID to filter entries by.'),
    limit: relaxedNumber()
        .optional()
        .default(100)
        .describe('Max entries to export (default: 100, max: 500)'),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
})

const TeamExportMarkdownOutputSchema = z
    .object({
        success: z.boolean().optional(),
        exported_count: z.number().optional(),
        output_dir: z.string().optional(),
        files: z.array(z.string()).optional(),
        skipped: z.number().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

const TeamImportMarkdownSchema = z
    .object({
        source_dir: z.string().min(1),
        dry_run: z.boolean().optional().default(false),
        project_number: StrictProjectNumberSchema.optional(),
        limit: z.number().int().min(1).max(500).optional().default(100),
        workspace_id: z.string().optional(),
    })
    .strict()

const TeamImportMarkdownSchemaMcp = z.object({
    source_dir: z.string().optional().describe('Directory containing .md files to import'),
    dry_run: z
        .boolean()
        .optional()
        .default(false)
        .describe('Parse and validate without writing to database'),
    project_number: relaxedNumber().optional().describe('Numeric project ID for workspace resolution.'),
    limit: relaxedNumber()
        .optional()
        .default(100)
        .describe('Max files to process (default: 100, max: 500)'),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
})

const TeamImportMarkdownOutputSchema = z
    .object({
        success: z.boolean().optional(),
        created: z.number().optional(),
        updated: z.number().optional(),
        skipped: z.number().optional(),
        relationshipsLinked: z.number().optional(),
        vectorsIndexed: z.number().optional(),
        errors: z.array(z.object({ file: z.string(), error: z.string() })).optional(),
        dry_run: z.boolean().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Team Import External Schemas
// ============================================================================

const TeamImportExternalSchema = z
    .object({
        source_dir: z.string().min(1),
        source_format: z.enum(SOURCE_FORMATS),
        dry_run: z.boolean().optional().default(false),
        project_number: StrictProjectNumberSchema.optional(),
        limit: z.number().int().min(1).max(500).optional().default(100),
        default_entry_type: z.enum(ENTRY_TYPES).optional(),
        workspace_id: z.string().optional(),
    })
    .strict()

const TeamImportExternalSchemaMcp = z.object({
    source_dir: z.string().optional().describe('Directory containing files to import'),
    source_format: z.string().optional().describe('Source format (notion, obsidian, logseq)'),
    dry_run: z
        .boolean()
        .optional()
        .default(false)
        .describe('Parse and validate without writing to database'),
    project_number: relaxedNumber().optional().describe('Numeric project ID for workspace resolution.'),
    limit: relaxedNumber()
        .optional()
        .default(100)
        .describe('Max files to process (default: 100, max: 500)'),
    default_entry_type: z
        .string()
        .optional()
        .describe('Fallback entry type if heuristics cannot determine one'),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
})

const TeamImportExternalOutputSchema = TeamImportMarkdownOutputSchema

// ============================================================================
// Tool Definitions
// ============================================================================

/* resolveTeamImportContextAuthor moved to ./io-scope-helpers.ts */

export function getTeamIoTools(context: ToolContext): ToolDefinition[] {
    const { teamDb, progress } = context

    return [
        {
            name: 'team_export_markdown',
            title: 'Team Export to Markdown',
            description:
                'Export team journal entries as individual frontmattered Markdown files (.md). ' +
                'Includes author field in frontmatter. Files can be re-imported via team_import_markdown.',
            group: 'team',
            inputSchema: TeamExportMarkdownSchemaMcp,
            outputSchema: TeamExportMarkdownOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_IO_NOT_CONFIGURED }
                    const input = TeamExportMarkdownSchema.parse(params)
                    if (input.workspace_id?.trim() === '*') {
                        // [BOUNDARY] Per-file export cannot attribute a mixed-workspace batch to one output tree.
                        return {
                            success: false,
                            error: "workspace_id '*' is not supported by team_export_markdown. Export each workspace separately.",
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Pass a concrete workspace_id or project_number.',
                            recoverable: true,
                        }
                    }
                    const wsId = resolveWriteWorkspaceId(input.workspace_id, input.project_number, context.config)
                    const projectNumber =
                        resolveTeamProjectNumber(context, wsId, input.project_number, input.workspace_id) ?? undefined
                    if (projectNumber === undefined) {
                        return missingTeamIoProjectNumberError(input.workspace_id)
                    }

                    const allowedRoots = context.config?.allowedIoRoots ?? []
                    await sendProgress(progress, 0, 3, 'Fetching team entries...')

                    const limit = input.limit ?? 100
                    const entries =
                        input.start_date || input.end_date
                            ? teamDb.searchByDateRange(
                                  input.start_date ?? DATE_MIN_SENTINEL,
                                  input.end_date ?? DATE_MAX_SENTINEL,
                                  { tags: input.tags, limit, projectNumber, workspaceId: wsId }
                              ).entries
                            : teamDb.searchEntries('', {
                                  tags: input.tags,
                                  limit,
                                  projectNumber,
                                  workspaceId: wsId,
                              }).entries

                    await sendProgress(progress, 1, 3, `Exporting ${String(entries.length)} team entries...`)

                    const authorMap = batchFetchAuthors(
                        teamDb,
                        entries.map((e) => e.id)
                    )
                    const exportable: ExportableEntry[] = entries.map((e) => ({
                        id: e.id,
                        content: e.content,
                        entryType: e.entryType,
                        timestamp: e.timestamp,
                        tags: e.tags,
                        significance: e.significanceType ?? undefined,
                        author: authorMap.get(e.id) ?? undefined,
                        ...(e.workspaceId !== undefined ? { workspaceId: e.workspaceId } : {}),
                        ...(e.projectNumber !== undefined && e.projectNumber !== null
                            ? { projectNumber: e.projectNumber }
                            : {}),
                    }))

                    await sendProgress(progress, 2, 3, 'Writing markdown files...')
                    const result = await exportEntriesToMarkdown(
                        exportable,
                        input.output_dir,
                        teamDb,
                        allowedRoots
                    )
                    await sendProgress(progress, 3, 3, 'Team export complete')
                    return result
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_import_markdown',
            title: 'Team Import from Markdown',
            description:
                'Import frontmattered Markdown files (.md) into the team journal. ' +
                'Author is set from authenticated user identity, falling back to TEAM_AUTHOR env or git config. ' +
                'Use dry_run: true to preview without writing.',
            group: 'team',
            inputSchema: TeamImportMarkdownSchemaMcp,
            outputSchema: TeamImportMarkdownOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_IO_NOT_CONFIGURED }
                    const input = TeamImportMarkdownSchema.parse(params)
                    const { wsId, projectNumber, lockedWsId } = resolveTeamImportScope(
                        input.source_dir,
                        input.workspace_id,
                        input.project_number,
                        context
                    )
                    if (projectNumber === undefined) {
                        return missingTeamIoProjectNumberError(input.workspace_id)
                    }

                    const allowedRoots = context.config?.allowedIoRoots ?? []
                    await sendProgress(progress, 0, 2, 'Reading markdown files...')
                    await sendProgress(progress, 1, 2, 'Importing team entries...')

                    const authorCtx = resolveTeamImportContextAuthor(context, wsId)
                    if ('errorResponse' in authorCtx) {
                        return authorCtx.errorResponse
                    }
                    const result = await importMarkdownEntries(
                        input.source_dir,
                        teamDb,
                        {
                            dry_run: input.dry_run,
                            limit: input.limit,
                            author: authorCtx.author,
                            enforceStrictTeamOwnership: authorCtx.enforceStrictTeamOwnership,
                            allowAdminAuthorOverride: authorCtx.allowAdminAuthorOverride,
                            project_number: projectNumber,
                            ...(lockedWsId !== undefined ? { workspaceId: lockedWsId } : {}),
                            ...(context.config !== undefined ? { config: context.config } : {}),
                        },
                        context.teamVectorManager,
                        allowedRoots
                    )

                    if (!result.success && result.errors.length > 0) {
                        const successCount = result.created + result.updated + result.skipped
                        const total = successCount + result.errors.length
                        const message = `Importing ${total} entries: ${successCount} succeeded, ${result.errors.length} failed.`
                        throw new AggregateMcpError(
                            message,
                            result.errors.map((e) => ({ message: e.error, file: e.file })),
                            { result }
                        )
                    }

                    if (!input.dry_run && (result.created > 0 || result.updated > 0)) {
                        triggerTeamNotifications(context)
                    }
                    await sendProgress(progress, 2, 2, 'Team import complete')
                    return result
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_import_external',
            title: 'Team Import from External Tools',
            description:
                'Import knowledge management exports (Notion, Obsidian, Logseq) into the team journal. ' +
                'Normalizes wikilinks, YAML frontmatter, and block hierarchies automatically. ' +
                'Author is set from authenticated user identity. Use dry_run: true to preview without writing.',
            group: 'team',
            inputSchema: TeamImportExternalSchemaMcp,
            outputSchema: TeamImportExternalOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_IO_NOT_CONFIGURED }
                    const input = TeamImportExternalSchema.parse(params)
                    const { wsId, projectNumber, lockedWsId } = resolveTeamImportScope(
                        input.source_dir,
                        input.workspace_id,
                        input.project_number,
                        context
                    )
                    if (projectNumber === undefined) {
                        return missingTeamIoProjectNumberError(input.workspace_id)
                    }

                    const allowedRoots = context.config?.allowedIoRoots ?? []
                    await sendProgress(progress, 0, 3, 'Reading files...')

                    const { parsedFiles, errors } = await readAndConvertExternalMarkdownFiles(
                        input.source_dir,
                        input.limit,
                        input.source_format,
                        input.default_entry_type,
                        allowedRoots,
                        progress
                    )

                    await sendProgress(progress, 2, 3, 'Importing entries...')
                    const authorCtx = resolveTeamImportContextAuthor(context, wsId)
                    if ('errorResponse' in authorCtx) {
                        return authorCtx.errorResponse
                    }
                    const result = await processImportBatch(
                        parsedFiles,
                        teamDb,
                        {
                            dry_run: input.dry_run,
                            limit: input.limit,
                            author: authorCtx.author,
                            enforceStrictTeamOwnership: authorCtx.enforceStrictTeamOwnership,
                            allowAdminAuthorOverride: authorCtx.allowAdminAuthorOverride,
                            project_number: projectNumber,
                            ...(lockedWsId !== undefined ? { workspaceId: lockedWsId } : {}),
                            ...(context.config !== undefined ? { config: context.config } : {}),
                        },
                        context.teamVectorManager
                    )

                    if (errors.length > 0) {
                        result.success = false
                        result.errors.push(...errors)
                    }

                    if (!result.success && result.errors.length > 0) {
                        const successCount = result.created + result.updated + result.skipped
                        const total = successCount + result.errors.length
                        const message = `Importing ${total} entries: ${successCount} succeeded, ${result.errors.length} failed.`
                        throw new AggregateMcpError(
                            message,
                            result.errors.map((e) => ({ message: e.error, file: e.file })),
                            { result }
                        )
                    }

                    if (!input.dry_run && (result.created > 0 || result.updated > 0)) {
                        triggerTeamNotifications(context)
                    }
                    await sendProgress(progress, 3, 3, 'Team import complete')
                    return result
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}

