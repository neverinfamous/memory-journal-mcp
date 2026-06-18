import { z } from 'zod'
import {
    ValidationError,
    ResourceNotFoundError,
} from '../../../types/errors.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { TEAM_DB_ERROR_RESPONSE } from './helpers.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { getCallerIdentity } from './rbac.js'

// ============================================================================
// Schemas
// ============================================================================

const aliasNames = ['text', 'message', 'description', 'name', 'from', 'source'];
const canonicalNames = ['target', 'to', 'canonical', 'dest'];
const searchNames = ['q', 'query', 'search'];

const preprocessAlias = (val: unknown): unknown => {
    if (typeof val === 'object' && val !== null) {
        const obj = { ...(val as Record<string, unknown>) };
        let modified = false;
        
        for (const key of aliasNames) {
            if (key in obj && !('alias' in obj)) {
                obj['alias'] = obj[key];
                Reflect.deleteProperty(obj, key);
                modified = true;
                break;
            }
        }
        for (const key of canonicalNames) {
            if (key in obj && !('canonical_author' in obj)) {
                obj['canonical_author'] = obj[key];
                Reflect.deleteProperty(obj, key);
                modified = true;
                break;
            }
        }
        for (const key of searchNames) {
            if (key in obj) {
                if (!('canonical_author' in obj) && !('author' in obj) && !('alias' in obj)) {
                    // map q to canonical_author, author, or alias based on which schema it is
                    obj['canonical_author'] = obj[key];
                    obj['author'] = obj[key];
                    obj['alias'] = obj[key];
                }
                Reflect.deleteProperty(obj, key);
                modified = true;
                break;
            }
        }
        // fix 'author' vs 'canonical_author' confusion
        if ('author' in obj && !('canonical_author' in obj)) {
            obj['canonical_author'] = obj['author'];
        }
        return modified ? obj : val;
    }
    return val;
};

const AddAuthorAliasSchema = z.preprocess(preprocessAlias, z.object({
    alias: z.string().min(1).max(255).describe('The raw author name to map (e.g., "Chris" or "GitHub: neverinfamous")'),
    canonical_author: z.string().min(1).max(255).describe('The canonical author identity to map the alias to (e.g., "christopher")'),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
}))

const AddAuthorAliasOutputSchema = z.object({
    success: z.boolean(),
    alias: z.object({
        id: z.number(),
        alias: z.string(),
        canonicalAuthor: z.string(),
        createdAt: z.string(),
        createdBy: z.string().nullable().optional()
    }).optional(),
    error: z.string().optional(),
}).extend(ErrorFieldsMixin.shape)

const RemoveAuthorAliasSchema = z.preprocess(preprocessAlias, z.object({
    alias: z.string().min(1).max(255).describe('The alias mapping to remove'),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
}))

const RemoveAuthorAliasOutputSchema = z.object({
    success: z.boolean().optional(),
    error: z.string().optional()
}).extend(ErrorFieldsMixin.shape)

const ListAuthorAliasesSchema = z.preprocess(preprocessAlias, z.object({
    canonical_author: z.string().optional().describe('Optional canonical author to filter aliases by'),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
}))

const ListAuthorAliasesOutputSchema = z.object({
    success: z.boolean().default(true),
    aliases: z.array(z.object({
        id: z.number(),
        alias: z.string(),
        canonicalAuthor: z.string(),
        createdAt: z.string(),
        createdBy: z.string().nullable().optional()
    })).optional(),
    error: z.string().optional()
}).extend(ErrorFieldsMixin.shape)

const ResolveAuthorSchema = z.preprocess(preprocessAlias, z.object({
    author: z.string().min(1).describe('The raw author name to resolve'),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
}))

const ResolveAuthorOutputSchema = z.object({
    original_author: z.string().optional(),
    canonical_author: z.string().optional(),
    is_aliased: z.boolean().optional(),
    error: z.string().optional()
}).extend(ErrorFieldsMixin.shape)

const ConsolidateAuthorsSchema = z.preprocess(preprocessAlias, z.object({
    canonical_author: z.string().min(1).max(255).describe('The canonical author name. All entries matching any of this author\'s aliases will be updated to use this canonical name.'),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
}))

const ConsolidateAuthorsOutputSchema = z.object({
    success: z.boolean().optional(),
    updated_count: z.number().optional(),
    canonical_author: z.string().optional(),
    error: z.string().optional()
}).extend(ErrorFieldsMixin.shape)

// ============================================================================
// Handlers
// ============================================================================

function handleAddAuthorAlias(context: ToolContext) {
    return (params: unknown) => {
        try {
            const { teamDb } = context
            if (!teamDb) {
                return { ...TEAM_DB_ERROR_RESPONSE }
            }
            const { alias, canonical_author } = AddAuthorAliasSchema.parse(params)

            // Check if the alias is actually an existing canonical member role
            const role = teamDb.resolveTeamRole(alias)
            if (role) {
                throw new ValidationError(
                    `Cannot alias '${alias}' because it is an existing team member with a role`,
                    { alias }
                )
            }

            const createdAlias = teamDb.addAuthorAlias(alias, canonical_author, getCallerIdentity(params as Record<string, unknown>))
            
            return {
                success: true,
                alias: createdAlias,
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
            const { alias } = RemoveAuthorAliasSchema.parse(params)

            const success = teamDb.removeAuthorAlias(alias)
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
            const { canonical_author } = ListAuthorAliasesSchema.parse(params)

            const aliases = teamDb.listAuthorAliases(canonical_author)
            
            return {
                success: true,
                aliases,
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
            const { author } = ResolveAuthorSchema.parse(params)

            const resolved = teamDb.resolveAuthor(author)
            
            return {
                original_author: author,
                canonical_author: resolved,
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
            const { canonical_author } = ConsolidateAuthorsSchema.parse(params)

            const updatedCount = teamDb.consolidateAuthors(canonical_author)
            
            return {
                success: true,
                updated_count: updatedCount,
                canonical_author,
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
            inputSchema: AddAuthorAliasSchema,
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
            inputSchema: RemoveAuthorAliasSchema,
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
            inputSchema: ListAuthorAliasesSchema,
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
            inputSchema: ResolveAuthorSchema,
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
            inputSchema: ConsolidateAuthorsSchema,
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

