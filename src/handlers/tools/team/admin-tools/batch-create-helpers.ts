/**
 * Team Admin Batch Create Helpers
 *
 * Author/RBAC validation and batch creation workflow for `team_create_entry`
 * and `team_batch_create_entries`.
 */

import type { z } from 'zod'
import type { ToolContext, ToolHandlerConfig } from '../../../../types/index.js'
import { getAuthContext } from '../../../../auth/auth-context.js'
import { resolveAuthor, resolveAuthenticatedAuthor } from '../../../../utils/security-utils.js'
import {
    findCanonicalRegistryKey,
    resolveProjectContext,
} from '../../../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../../../utils/write-scope.js'
import { sendProgress } from '../../../../utils/progress-utils.js'
import { collectIndexWorkspaces, indexBatchEntries } from '../../batch-indexing.js'
import { linkRequestedRelationships } from '../../relationship-linking.js'
import { resolveWriteWorkspaceId } from '../../write-workspace.js'
import { triggerTeamNotifications } from '../helpers.js'
import { canonicalizeTeamAuthor, getCallerIdentity, resolveScopedTeamRole } from '../rbac.js'
import type { TeamBatchCreateEntriesSchema } from '../schemas.js'
import type { TeamDbInstance } from './batch-delete-helpers.js'

type TeamBatchCreateInput = z.infer<typeof TeamBatchCreateEntriesSchema>
type TeamBatchCreateItem = TeamBatchCreateInput['entries'][number]

interface ResolvedBatchCreateItem {
    e: TeamBatchCreateItem
    author: string
    projectNumber: number
    workspaceId: string
}

function sanitizeAuthorClaim(raw: string): string {
    return raw.replace(/\p{Cc}+/gu, ' ').trim()
}

function unknownIdentityError(): Record<string, unknown> {
    return {
        success: false,
        error: 'Identity cannot be resolved securely. In non-OAuth environments, you must set the TEAM_AUTHOR environment variable to claim an identity.',
        code: 'PERMISSION_DENIED',
        category: 'auth',
        suggestion: 'Set the TEAM_AUTHOR environment variable or enable OAuth.',
        recoverable: false,
    }
}

/**
 * Resolve and authorize the author claim for team entry creation.
 * Enforces OAuth identity binding and non-OAuth RBAC non-admin impersonation checks (H8).
 */
export function resolveTeamCreateAuthor(
    inputAuthor: string | undefined,
    teamDb: TeamDbInstance,
    config: ToolHandlerConfig | undefined,
    workspaceId?: string
): { author: string } | { errorResponse: Record<string, unknown> } {
    const sanitized = inputAuthor !== undefined ? sanitizeAuthorClaim(inputAuthor) : undefined
    if (sanitized !== undefined && (sanitized === '' || sanitized.toLowerCase() === 'unknown')) {
        return {
            errorResponse: {
                success: false,
                error: 'Invalid author: author cannot be empty or "unknown". Omit author to use your resolved identity.',
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Provide a non-empty author name or omit the author field.',
                recoverable: true,
            },
        }
    }

    const authCtx = getAuthContext()
    if (authCtx?.authenticated) {
        const authId = resolveAuthenticatedAuthor()
        if (authId === 'unknown') {
            return { errorResponse: unknownIdentityError() }
        }
        if (sanitized !== undefined && sanitized !== authId) {
            return {
                errorResponse: {
                    success: false,
                    error: `Author mismatch: supplied author "${sanitized}" does not match authenticated principal "${authId}". Omit the author field to use your identity automatically.`,
                    code: 'PERMISSION_DENIED',
                    category: 'auth',
                    suggestion: 'Omit the author field to use your authenticated identity automatically.',
                    recoverable: false,
                },
            }
        }
        return { author: authId }
    }

    if (
        sanitized !== undefined &&
        typeof teamDb.isTeamRbacActive === 'function' &&
        teamDb.isTeamRbacActive()
    ) {
        const callerIdentity = getCallerIdentity()
        const callerRole = resolveScopedTeamRole(
            teamDb,
            callerIdentity,
            config?.teamDefaultRole ?? 'denied',
            workspaceId
        )
        const canonicalCaller = canonicalizeTeamAuthor(teamDb, callerIdentity, workspaceId)
        if (sanitized !== callerIdentity && sanitized !== canonicalCaller && callerRole !== 'admin') {
            return {
                errorResponse: {
                    success: false,
                    error: `Author mismatch: caller "${callerIdentity}" (role "${callerRole ?? 'denied'}") cannot author team entries as "${sanitized}".`,
                    code: 'PERMISSION_DENIED',
                    category: 'auth',
                    suggestion: 'Omit the author field or authenticate as a team admin.',
                    recoverable: false,
                },
            }
        }
    }

    const resolvedAuthor = sanitized ?? resolveAuthor()
    if (resolvedAuthor === 'unknown') {
        return { errorResponse: unknownIdentityError() }
    }
    return { author: resolvedAuthor }
}

function resolveBatchItemProjectNumber(
    namedWorkspace: string | undefined,
    effectiveProject: number | undefined,
    config: ToolHandlerConfig | undefined
): number | undefined {
    const callerWorkspace =
        namedWorkspace !== undefined && namedWorkspace !== '*' ? namedWorkspace : undefined
    const callerRegistry = activeProjectRegistry(config?.projectRegistry)
    const canonicalCaller =
        callerWorkspace !== undefined
            ? (findCanonicalRegistryKey(callerWorkspace, callerRegistry) ?? callerWorkspace)
            : undefined
    return (
        effectiveProject ??
        (canonicalCaller !== undefined ? callerRegistry?.[canonicalCaller]?.project_number : undefined)
    )
}

function validateTeamBatchCreateEntries(
    input: TeamBatchCreateInput,
    teamDb: TeamDbInstance,
    config: ToolHandlerConfig | undefined
): { errorResponse: Record<string, unknown> } | { resolvedEntries: ResolvedBatchCreateItem[] } {
    const resolvedEntries: ResolvedBatchCreateItem[] = []
    for (const e of input.entries) {
        if (e.workspace_id === '*' || input.workspace_id === '*') {
            return {
                errorResponse: {
                    success: false,
                    error: "workspace_id '*' is a read-only wildcard and cannot be used to create team entries.",
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Pass a concrete workspace_id or a project_number.',
                    recoverable: true,
                },
            }
        }
        const namedWorkspace = e.workspace_id ?? input.workspace_id
        const itemNamesOtherWorkspace =
            e.workspace_id !== undefined &&
            input.workspace_id !== undefined &&
            e.workspace_id.trim().toLowerCase() !== input.workspace_id.trim().toLowerCase()
        const effectiveProject =
            e.project_number ?? (!itemNamesOtherWorkspace ? input.project_number : undefined)
        const resolved = resolveProjectContext(
            { workspace_id: namedWorkspace, project_number: effectiveProject },
            config
        )
        const projectNumber = resolveBatchItemProjectNumber(namedWorkspace, effectiveProject, config)
        if (projectNumber === undefined || projectNumber === null) {
            return {
                errorResponse: {
                    success: false,
                    error: 'Missing project_number. Each entry in the batch MUST provide a valid project_number or name a registered workspace.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Specify the project_number for every entry, or name a registered workspace whose project is already known.',
                    recoverable: true,
                },
            }
        }
        const explicitDefault = namedWorkspace?.trim().toLowerCase() === 'default'
        const workspaceId = resolveWriteWorkspaceId(
            explicitDefault ? 'default' : resolved.workspaceId !== 'default' ? resolved.workspaceId : namedWorkspace,
            projectNumber,
            config
        )
        const paired = pairStoredScope(workspaceId, projectNumber, activeProjectRegistry(config?.projectRegistry))
        const targetWorkspaceId = paired.workspaceId ?? workspaceId
        const authorResult = resolveTeamCreateAuthor(e.author, teamDb, config, targetWorkspaceId)
        if ('errorResponse' in authorResult) return authorResult

        resolvedEntries.push({
            e,
            author: authorResult.author,
            projectNumber: paired.projectNumber ?? projectNumber,
            workspaceId: targetWorkspaceId,
        })
    }
    return { resolvedEntries }
}

function buildTeamBatchCreateInputs(
    resolvedEntries: ResolvedBatchCreateItem[]
): Parameters<TeamDbInstance['createEntries']>[0] {
    return resolvedEntries.map(({ e, author, projectNumber, workspaceId }) => ({
        content: e.content,
        entryType: e.entry_type,
        tags: e.tags,
        significanceType: e.significance_type,
        autoContext: e.auto_context,
        projectNumber,
        projectOwner: e.project_owner,
        issueNumber: e.issue_number,
        issueUrl: e.issue_url,
        prNumber: e.pr_number,
        prUrl: e.pr_url,
        prStatus: e.pr_status,
        workflowRunId: e.workflow_run_id,
        workflowName: e.workflow_name,
        workflowStatus: e.workflow_status,
        isPersonal: false,
        author,
        impactScore: e.impact_score,
        trustScore: e.trust_score,
        validationStatus: e.validation_status,
        sessionId: e.session_id,
        workspaceId,
        ...(e.anchors !== undefined
            ? {
                  anchors: e.anchors.map((a) => ({
                      anchorPath: a.anchor_path,
                      anchorType: a.anchor_type,
                      ...(a.status !== undefined ? { status: a.status } : {}),
                  })),
              }
            : {}),
    }))
}

function linkBatchCreatedRelationships(
    teamDb: TeamDbInstance,
    results: ReturnType<TeamDbInstance['createEntries']>['created'],
    createdSourceIndices: number[],
    rawEntries: TeamBatchCreateItem[],
    inputs: Parameters<TeamDbInstance['createEntries']>[0]
): string[] {
    const relationshipWarnings: string[] = []
    for (let i = 0; i < results.length; i++) {
        const createdEntry = results[i]
        const sourceIdx = createdSourceIndices[i] ?? i
        if (createdEntry) {
            relationshipWarnings.push(
                ...linkRequestedRelationships(
                    teamDb,
                    createdEntry.id,
                    rawEntries[sourceIdx]?.relationships,
                    inputs[sourceIdx]?.workspaceId,
                    inputs[sourceIdx]?.projectNumber
                )
            )
        }
    }
    return relationshipWarnings
}

/** Validate and execute `team_batch_create_entries` with shallow control flow. */
export async function executeTeamBatchCreate(
    context: ToolContext,
    teamDb: TeamDbInstance,
    input: TeamBatchCreateInput
): Promise<Record<string, unknown>> {
    await sendProgress(context.progress, 0, 2, 'Creating team entries...')
    const validation = validateTeamBatchCreateEntries(input, teamDb, context.config)
    if ('errorResponse' in validation) return validation.errorResponse

    const inputs = buildTeamBatchCreateInputs(validation.resolvedEntries)
    const { created: results, errors } = teamDb.createEntries(inputs)
    const failedIndices = new Set(errors.map((err) => err.index))
    const createdSourceIndices = inputs.flatMap((_, idx) => (failedIndices.has(idx) ? [] : [idx]))

    const relationshipWarnings = linkBatchCreatedRelationships(
        teamDb,
        results,
        createdSourceIndices,
        input.entries,
        inputs
    )
    const entries = results.map((r, i) => ({
        ...r,
        author: inputs[createdSourceIndices[i] ?? i]?.author,
    }))
    await sendProgress(context.progress, 1, 2, `Created ${String(entries.length)} team entries...`)

    const { indexStatuses, indexErrors } = await indexBatchEntries({
        progress: context.progress,
        vectorManager: context.teamVectorManager,
        db: teamDb,
        autoIndex: input.auto_index,
        entryIds: entries.map((e) => e.id),
        errorPrefix: 'Team entry',
        doneMessage: 'Team batch create complete',
        workspaceByEntryId: collectIndexWorkspaces(entries),
    })

    const allErrors = [
        ...errors.map((e) => new Error(`Item at index ${e.index} failed: ${e.error.message}`)),
        ...indexErrors,
    ]
    if (allErrors.length > 0) {
        throw new AggregateError(
            allErrors,
            `Team batch create partially failed: ${allErrors.length} operations failed`
        )
    }

    triggerTeamNotifications(context)
    const failedVectorCount = indexStatuses.filter((s) => s === 'failed').length
    const warnings: string[] = [
        ...(failedVectorCount > 0
            ? [`Vector indexing failed for ${String(failedVectorCount)} team entry(ies).`]
            : []),
        ...relationshipWarnings,
    ]

    return {
        success: true,
        count: entries.length,
        entries,
        indexStatuses,
        ...(relationshipWarnings.length > 0 ? { relationshipWarnings } : {}),
        ...(warnings.length > 0 ? { warning: warnings.join('; ') } : {}),
    }
}
