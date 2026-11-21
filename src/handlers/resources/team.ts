import { ICON_CLOCK, ICON_TEAM } from '../../constants/icons.js'
import {
    withPriority,
    ASSISTANT_FOCUSED,
    } from '../../utils/resource-annotations.js'
import type {
    InternalResourceDef,
    ResourceContext,
    ResourceResult,
} from './shared.js'
import { resourceProjectNumber, resourceWorkspace, withResourceTokenMeta } from './shared.js'
import { logger } from '../../utils/logger.js'
import { markUntrustedContent, sanitizeAuthor, sanitizeErrorForLogging } from '../../utils/security-utils.js'
import { activeProjectRegistry } from '../../utils/write-scope.js'
import { enforceTeamRbac, getCallerIdentity } from '../tools/team/rbac.js'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Enrich entries with author column from the team database
 */
function enrichWithAuthor<T extends { id: number }>(
    entries: T[],
    context: ResourceContext
): (T & { author: string | null })[] {
    const teamDb = context.teamDb
    if (!teamDb || entries.length === 0) return entries.map((e: T) => ({ ...e, author: null }))

    const ids = entries.map((e) => e.id)
    const authorMap = teamDb.getAuthorsForEntries(ids)

    return entries.map((e: T) => ({
        ...e,
        author: authorMap.get(e.id) ?? null,
    }))
}

// ============================================================================
// Resource Definitions
// ============================================================================

/**
 * Enforce active Team RBAC on team resource reads.
 */
export function enforceTeamResourceRbac(context: ResourceContext, wsId: string): void {
    const teamDb = context.teamDb
    if (teamDb?.isTeamRbacActive?.() !== true) return
    enforceTeamRbac(
        {
            db: teamDb,
            teamDb,
            config: {
                ...(context.briefingConfig?.defaultWorkspaceId !== undefined
                    ? { defaultWorkspaceId: context.briefingConfig.defaultWorkspaceId }
                    : {}),
                ...(context.briefingConfig?.defaultProjectNumber !== undefined
                    ? { defaultProjectNumber: context.briefingConfig.defaultProjectNumber }
                    : {}),
                ...(context.briefingConfig?.projectRegistry !== undefined
                    ? { projectRegistry: context.briefingConfig.projectRegistry }
                    : {}),
                teamDefaultRole: context.runtime?.teamDefaultRole ?? 'denied',
            },
        },
        getCallerIdentity(),
        'viewer',
        wsId
    )
}

/**
 * Get team resource definitions
 */
export function getTeamResourceDefinitions(): InternalResourceDef[] {
    const resources: InternalResourceDef[] = [
        {
            uri: 'memory://team/recent',
            name: 'Recent Team Entries',
            title: 'Recent Team-Shared Entries',
            description:
                'Recent entries from the team database. Requires TEAM_DB_PATH configuration.',
            mimeType: 'application/json',
            icons: [ICON_CLOCK],
            annotations: withPriority(0.7, ASSISTANT_FOCUSED),
            handler: (_uri: string, context: ResourceContext): ResourceResult => {
                if (!context.teamDb) {
                    return {
                        data: {
                            error: 'Team database not configured. Set TEAM_DB_PATH to enable.',
                            entries: [],
                            count: 0,
                            code: -32002,
                        },
                    }
                }

                const wsId = resourceWorkspace(context)
                const projectNumber = resourceProjectNumber(context, wsId)
                enforceTeamResourceRbac(context, wsId)
                if (projectNumber === undefined) {
                    return {
                        data: {
                            error: 'Missing project_number for team resource read. Configure DEFAULT_PROJECT_NUMBER, register the workspace in projectRegistry, or read memory://agent-context/{repo} first.',
                            entries: [],
                            count: 0,
                            code: -32602,
                        },
                    }
                }
                const { entries } = context.teamDb.getRecentEntries(
                    10,
                    undefined,
                    'timestamp',
                    undefined,
                    false,
                    wsId,
                    projectNumber
                )
                const lastModified = entries[0]?.timestamp ?? new Date().toISOString()
                const enriched = enrichWithAuthor(entries, context)

                const responseData = {
                    entries: enriched.map((e) => ({
                        ...e,
                        content: markUntrustedContent(e.content),
                        author: e.author ? sanitizeAuthor(e.author) : null,
                    })),
                    count: enriched.length,
                    source: 'team',
                }
                return {
                    data: withResourceTokenMeta(responseData),
                    annotations: { lastModified },
                }
            },
        },
        {
            uri: 'memory://team/statistics',
            name: 'Team Statistics',
            title: 'Team Database Statistics',
            description: 'Entry counts, types, and contributor breakdown for the team database.',
            mimeType: 'application/json',
            icons: [ICON_TEAM],
            annotations: withPriority(0.6, ASSISTANT_FOCUSED),
            handler: (_uri: string, context: ResourceContext): ResourceResult => {
                if (!context.teamDb) {
                    return {
                        data: {
                            error: 'Team database not configured. Set TEAM_DB_PATH to enable.',
                            configured: false,
                            code: -32002,
                        },
                    }
                }

                const wsId = resourceWorkspace(context)
                const projectNumber = resourceProjectNumber(context, wsId)
                enforceTeamResourceRbac(context, wsId)
                const resolvedRegistry = activeProjectRegistry(context.briefingConfig?.projectRegistry)
                const hasActiveRegistry =
                    resolvedRegistry !== undefined && Object.keys(resolvedRegistry).length > 0
                if ((wsId === '*' || hasActiveRegistry) && projectNumber === undefined) {
                    return {
                        data: {
                            error: 'Missing project_number for team statistics resource read. Configure DEFAULT_PROJECT_NUMBER, register the workspace in projectRegistry, or read memory://agent-context/{repo} first.',
                            code: -32602,
                        },
                    }
                }
                const stats = context.teamDb.getStatistics(
                    'week',
                    undefined,
                    undefined,
                    false,
                    wsId,
                    projectNumber
                )

                // Author breakdown
                let authors: { author: string; count: number }[] = []
                let authorStatsWarning: string | undefined
                try {
                    authors = context.teamDb.getAuthorStatistics(wsId, projectNumber)
                } catch (error: unknown) {
                    authorStatsWarning = sanitizeErrorForLogging(
                        error instanceof Error ? error.message : 'Failed to get team author statistics'
                    )
                    logger.warning('Failed to get team author statistics', {
                        module: 'ResourceHandler',
                        error: authorStatsWarning,
                    })
                }

                const sanitizedAuthors = authors.map((a) => ({
                    ...a,
                    author: sanitizeAuthor(a.author),
                }))
                const responseData = {
                    configured: true,
                    ...(stats as object),
                    authors: sanitizedAuthors,
                    source: 'team',
                    ...(authorStatsWarning !== undefined
                        ? { degraded: true, warning: authorStatsWarning }
                        : {}),
                }
                return {
                    data: withResourceTokenMeta(responseData),
                }
            },
        },

    ]

    return resources.map((resource) => ({
        ...resource,
        capabilities: {
            ...resource.capabilities,
            requiresTeamScope: true,
        },
    }))
}
