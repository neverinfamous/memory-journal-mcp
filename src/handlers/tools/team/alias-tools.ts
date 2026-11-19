import { ValidationError, ResourceNotFoundError } from '../../../types/errors.js'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { TEAM_DB_ERROR_RESPONSE, triggerTeamNotifications, resolveTeamProjectNumber } from './helpers.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { sanitizeAuthor } from '../../../utils/security-utils.js'
import { getCallerIdentity } from './rbac.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'
import { activeProjectRegistry, alignedProjectFilter } from '../../../utils/write-scope.js'
import {
    AddAuthorAliasSchema,
    AddAuthorAliasSchemaMcp,
    AddAuthorAliasOutputSchema,
    RemoveAuthorAliasSchema,
    RemoveAuthorAliasSchemaMcp,
    RemoveAuthorAliasOutputSchema,
    ListAuthorAliasesSchema,
    ListAuthorAliasesSchemaMcp,
    ListAuthorAliasesOutputSchema,
    ResolveAuthorSchema,
    ResolveAuthorSchemaMcp,
    ResolveAuthorOutputSchema,
    ConsolidateAuthorsSchema,
    ConsolidateAuthorsSchemaMcp,
    ConsolidateAuthorsOutputSchema,
} from './alias-schemas.js'

// ============================================================================
// Handlers
// ============================================================================

function scopedWorkspace(
    workspaceId: string | undefined,
    projectNumber: number | undefined,
    context: ToolContext
): string {
    return resolveWorkspaceId(workspaceId, projectNumber, context.config)
}

function scopedWriteWorkspace(
    workspaceId: string | undefined,
    projectNumber: number | undefined,
    context: ToolContext
): string {
    return resolveWriteWorkspaceId(workspaceId, projectNumber, context.config)
}

function sanitizeAliasRecord<
    T extends { alias: string; canonicalAuthor: string; createdBy?: string | null },
>(record: T): T {
    return {
        ...record,
        alias: sanitizeAuthor(record.alias),
        canonicalAuthor: sanitizeAuthor(record.canonicalAuthor),
        ...(record.createdBy !== undefined
            ? { createdBy: record.createdBy !== null ? sanitizeAuthor(record.createdBy) : null }
            : {}),
    }
}

function handleAddAuthorAlias(context: ToolContext) {
    return (params: unknown) => {
        try {
            const { teamDb } = context
            if (!teamDb) {
                return { ...TEAM_DB_ERROR_RESPONSE }
            }
            const { alias, canonical_author, project_number, workspace_id } = AddAuthorAliasSchema.parse(params)
            const workspaceId = scopedWriteWorkspace(workspace_id, project_number, context)

            // Check if the alias is actually an existing canonical member
            const existingMember = teamDb.getTeamMember(alias)
            if (existingMember !== null) {
                throw new ValidationError(
                    `Cannot alias '${alias}' because it is an existing team member with a role`,
                    { alias }
                )
            }

            const caller = getCallerIdentity()
            const createdAlias = teamDb.addAuthorAlias(alias, canonical_author, caller, workspaceId)

            return {
                success: true,
                alias: sanitizeAliasRecord(createdAlias),
            }
        } catch (error) {
            return formatHandlerError(error)
        }
    }
}

function handleRemoveAuthorAlias(context: ToolContext) {
    return (params: unknown) => {
        try {
            const { teamDb } = context
            if (!teamDb) {
                return { ...TEAM_DB_ERROR_RESPONSE }
            }
            const { alias, project_number, workspace_id } = RemoveAuthorAliasSchema.parse(params)
            const workspaceId = scopedWriteWorkspace(workspace_id, project_number, context)

            const success = teamDb.removeAuthorAlias(alias, workspaceId)
            if (!success) {
                throw new ResourceNotFoundError('AuthorAlias', alias)
            }

            return {
                success: true,
            }
        } catch (error) {
            return formatHandlerError(error)
        }
    }
}

function handleListAuthorAliases(context: ToolContext) {
    return (params: unknown) => {
        try {
            const { teamDb } = context
            if (!teamDb) {
                return { ...TEAM_DB_ERROR_RESPONSE }
            }
            const { canonical_author, project_number, workspace_id } = ListAuthorAliasesSchema.parse(params)
            const workspaceId = scopedWorkspace(workspace_id, project_number, context)

            const aliases = teamDb.listAuthorAliases(canonical_author, workspaceId)

            return {
                success: true,
                aliases: aliases.map(sanitizeAliasRecord),
            }
        } catch (error) {
            return formatHandlerError(error)
        }
    }
}

function handleResolveAuthor(context: ToolContext) {
    return (params: unknown) => {
        try {
            const { teamDb } = context
            if (!teamDb) {
                return { ...TEAM_DB_ERROR_RESPONSE }
            }
            const { author, project_number, workspace_id } = ResolveAuthorSchema.parse(params)
            if (workspace_id?.trim() === '*') {
                throw new ValidationError("workspace_id '*' is not valid for team_resolve_author; pass a specific workspace_id.")
            }
            const workspaceId = scopedWorkspace(workspace_id, project_number, context)

            const resolved = teamDb.resolveAuthor(author, workspaceId)

            return {
                success: true,
                original_author: sanitizeAuthor(author),
                canonical_author: sanitizeAuthor(resolved),
                is_aliased: resolved !== author,
            }
        } catch (error) {
            return formatHandlerError(error)
        }
    }
}

function handleConsolidateAuthors(context: ToolContext) {
    return (params: unknown) => {
        try {
            const { teamDb } = context
            if (!teamDb) {
                return { ...TEAM_DB_ERROR_RESPONSE }
            }
            const { canonical_author, project_number, workspace_id } = ConsolidateAuthorsSchema.parse(params)
            if (workspace_id?.trim() === '*') {
                throw new ValidationError(
                    "Wildcard workspace_id '*' is not supported for team_consolidate_authors. Specify a concrete workspace_id."
                )
            }
            const workspaceId = scopedWriteWorkspace(workspace_id, project_number, context)
            const scopedProject = resolveTeamProjectNumber(
                context,
                workspaceId,
                project_number,
                workspace_id
            )
            const effectiveProject = alignedProjectFilter(
                workspaceId,
                scopedProject ?? undefined,
                activeProjectRegistry(context.config?.projectRegistry)
            )

            const updatedCount =
                effectiveProject !== undefined
                    ? teamDb.consolidateAuthors(canonical_author, workspaceId, effectiveProject)
                    : teamDb.consolidateAuthors(canonical_author, workspaceId)

            if (updatedCount > 0) {
                triggerTeamNotifications(context)
            }

            return {
                success: true,
                updated_count: updatedCount,
                canonical_author: sanitizeAuthor(canonical_author),
            }
        } catch (error) {
            return formatHandlerError(error)
        }
    }
}

// ============================================================================
// Tool Registration
// ============================================================================

export function getTeamAliasTools(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'team_add_author_alias',
            title: 'Add Author Alias',
            description: 'Map a raw author name to a canonical identity. Requires admin role. Used to consolidate attribution for team analytics when one person uses multiple usernames.',
            group: 'team',
            inputSchema: AddAuthorAliasSchemaMcp,
            outputSchema: AddAuthorAliasOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: handleAddAuthorAlias(context),
            capabilities: { requiresAdminScope: true },
        },
        {
            name: 'team_remove_author_alias',
            title: 'Remove Author Alias',
            description: 'Remove an author alias mapping. Requires admin role.',
            group: 'team',
            inputSchema: RemoveAuthorAliasSchemaMcp,
            outputSchema: RemoveAuthorAliasOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: handleRemoveAuthorAlias(context),
            capabilities: { requiresAdminScope: true },
        },
        {
            name: 'team_list_author_aliases',
            title: 'List Author Aliases',
            description: 'List all registered author aliases. Requires admin role.',
            group: 'team',
            inputSchema: ListAuthorAliasesSchemaMcp,
            outputSchema: ListAuthorAliasesOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: handleListAuthorAliases(context),
            capabilities: { requiresAdminScope: true },
        },
        {
            name: 'team_resolve_author',
            title: 'Resolve Author',
            description: 'Resolve a raw author name to its canonical identity using registered aliases. Requires admin role.',
            group: 'team',
            inputSchema: ResolveAuthorSchemaMcp,
            outputSchema: ResolveAuthorOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: handleResolveAuthor(context),
            capabilities: { requiresAdminScope: true },
        },
        {
            name: 'team_consolidate_authors',
            title: 'Consolidate Authors',
            description: 'Retroactively rewrite all past entries matching an author\'s aliases to the canonical author name. Requires admin role. This operation modifies database entries.',
            group: 'team',
            inputSchema: ConsolidateAuthorsSchemaMcp,
            outputSchema: ConsolidateAuthorsOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: handleConsolidateAuthors(context),
            capabilities: { requiresAdminScope: true },
        },
    ]
}
