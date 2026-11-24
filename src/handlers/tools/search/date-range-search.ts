import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { PermissionError } from '../../../types/errors.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, alignedProjectFilter } from '../../../utils/write-scope.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { sanitizeAuthor } from '../../../utils/security-utils.js'
import { calcPerDbLimit, isTeamDbReady, mergeAndDedup, resolveAuthorizedIncludeTeam } from './helpers.js'
import { decodeCompoundCursor, encodeCompoundCursor } from './fts.js'
import { computeMergedCompoundCursor } from './merge-cursors.js'
import { SearchByDateRangeSchema, SearchByDateRangeSchemaMcp } from './schemas.js'
import { EntriesListOutputSchema } from '../schemas.js'

type DateRangeInput = ReturnType<typeof SearchByDateRangeSchema.parse>

function resolveDateRangeCursors(
    cursor: string | undefined,
    includeTeam: boolean,
    isPersonal: boolean | undefined
): {
    personalCursor: string | undefined
    teamCursor: string | undefined
    personalExhausted: boolean
    teamExhausted: boolean
} {
    if (cursor && includeTeam && isPersonal !== true) {
        const compound = decodeCompoundCursor(cursor)
        if (compound) {
            return {
                personalCursor: compound.p,
                teamCursor: compound.t,
                personalExhausted: compound.p === undefined,
                teamExhausted: compound.t === undefined,
            }
        }
    }
    return {
        personalCursor: cursor,
        teamCursor: cursor,
        personalExhausted: false,
        teamExhausted: false,
    }
}

function queryTeamDateRangeAndMerge(
    teamDb: NonNullable<ToolContext['teamDb']>,
    input: DateRangeInput,
    wsId: string,
    projectNumber: number | undefined,
    perDbLimit: number,
    cursorState: {
        personalCursor: string | undefined
        teamCursor: string | undefined
        teamExhausted: boolean
    },
    personalEntries: ReturnType<ToolContext['db']['searchByDateRange']>
): Record<string, unknown> {
    const emptyPage: ReturnType<ToolContext['db']['searchByDateRange']> = { entries: [] }
    const teamEntries = cursorState.teamExhausted
        ? emptyPage
        : teamDb.searchByDateRange(input.start_date, input.end_date, {
              entryType: input.entry_type,
              tags: input.tags,
              excludeTags: input.exclude_tags,
              projectNumber,
              issueNumber: input.issue_number,
              prNumber: input.pr_number,
              workflowRunId: input.workflow_run_id,
              limit: perDbLimit,
              sortBy: input.sort_by,
              cursor: cursorState.teamCursor,
              includeArchived: input.include_archived,
              workspaceId: wsId,
          })
    const merged = mergeAndDedup(
        personalEntries.entries.map((e) => ({ ...e, source: 'personal' as const })),
        teamEntries.entries.map((e) => ({
            ...e,
            ...('author' in e && typeof e.author === 'string'
                ? { author: sanitizeAuthor(e.author) }
                : {}),
            source: 'team' as const,
        })),
        input.limit,
        input.sort_by,
        teamDb
    )
    const compoundNextCursor = computeMergedCompoundCursor({
        merged,
        personalEntries: personalEntries.entries,
        teamEntries: teamEntries.entries,
        personalRawNextCursor: personalEntries.nextCursor,
        teamRawNextCursor: teamEntries.nextCursor,
        prevPersonalCursor: cursorState.personalCursor,
        prevTeamCursor: cursorState.teamCursor,
        useKeyset: input.sort_by !== 'importance',
        personalDegraded: false,
        teamDegraded: false,
        encodeCompound: encodeCompoundCursor,
    })
    return {
        success: true,
        entries: merged,
        count: merged.length,
        degraded: false,
        next_cursor: compoundNextCursor,
    }
}

function executeDateRangeSearch(
    params: unknown,
    context: ToolContext
): Record<string, unknown> {
    const { db, teamDb } = context
    const input = SearchByDateRangeSchema.parse(params)
    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
    const projectNumber = alignedProjectFilter(
        wsId,
        input.project_number,
        activeProjectRegistry(context.config?.projectRegistry)
    )
    const includeTeam = resolveAuthorizedIncludeTeam(
        'search_by_date_range',
        input.include_team,
        params,
        context.config?.runtime?.auditLogger,
        teamDb,
        context.config,
        wsId,
        projectNumber
    )
    if (input.start_date > input.end_date) {
        return {
            success: false,
            error: `Invalid date range: start_date (${input.start_date}) is after end_date (${input.end_date})`,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            suggestion: 'Ensure start_date is before or equal to end_date',
            recoverable: true,
        }
    }

    const hasReadyTeamDb = includeTeam && input.is_personal !== true && isTeamDbReady(teamDb)
    // [INVARIANT] A compound cursor with a missing side means that side is exhausted; never restart it at page 1.
    const { personalCursor, teamCursor, personalExhausted, teamExhausted } =
        resolveDateRangeCursors(input.cursor, includeTeam, input.is_personal)
    const perDbLimit = calcPerDbLimit(input.limit, hasReadyTeamDb)
    const emptyPage: ReturnType<typeof db.searchByDateRange> = { entries: [] }
    const personalEntries = personalExhausted
        ? emptyPage
        : db.searchByDateRange(input.start_date, input.end_date, {
              entryType: input.entry_type,
              tags: input.tags,
              excludeTags: input.exclude_tags,
              isPersonal: input.is_personal,
              projectNumber,
              issueNumber: input.issue_number,
              prNumber: input.pr_number,
              workflowRunId: input.workflow_run_id,
              limit: perDbLimit,
              sortBy: input.sort_by,
              cursor: personalCursor,
              includeArchived: input.include_archived,
              workspaceId: wsId,
          })

    if (hasReadyTeamDb && isTeamDbReady(teamDb)) {
        return queryTeamDateRangeAndMerge(
            teamDb,
            input,
            wsId,
            projectNumber,
            perDbLimit,
            { personalCursor, teamCursor, teamExhausted },
            personalEntries
        )
    }

    return {
        success: true,
        entries: personalEntries.entries.map((e) => ({ ...e, source: 'personal' as const })),
        count: personalEntries.entries.length,
        degraded: false,
        next_cursor: personalEntries.nextCursor,
    }
}

export function getDateRangeSearchTool(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'search_by_date_range',
            title: 'Search by Date Range',
            description: 'Search journal entries within a date range with optional filters',
            group: 'search',
            inputSchema: SearchByDateRangeSchemaMcp,
            outputSchema: EntriesListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    return Promise.resolve(executeDateRangeSearch(params, context))
                } catch (err) {
                    if (err instanceof PermissionError) return Promise.reject(err)
                    return Promise.resolve(formatHandlerError(err))
                }
            },
        },
    ]
}
