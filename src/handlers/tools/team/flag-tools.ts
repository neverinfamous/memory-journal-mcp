/**
 * Team Flag Tools — Hush Protocol - 2 tools
 *
 * Tools: team_pass_flag, team_resolve_flag
 *
 * Flags are team entries with entry_type: 'flag' and structured auto_context.
 * They replace communication noise with machine-actionable developer flags.
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { resolveAuthor } from '../../../utils/security-utils.js'
import { getAuthContext } from '../../../auth/auth-context.js'
import { TEAM_DB_ERROR_RESPONSE, fetchAuthor } from './helpers.js'
import {
    PassTeamFlagSchema,
    PassTeamFlagSchemaMcp,
    ResolveTeamFlagSchema,
    ResolveTeamFlagSchemaMcp,
    FlagOutputSchema,
    ResolveFlagOutputSchema,
    DEFAULT_FLAG_VOCABULARY,
} from './schemas.js'
import { parseFlagContext, type FlagContext } from '../../../types/auto-context.js'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the active flag vocabulary from context config or defaults.
 */
function getVocabulary(context: ToolContext): readonly string[] {
    const custom = context.config?.flagVocabulary
    return custom && custom.length > 0 ? custom : DEFAULT_FLAG_VOCABULARY
}

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamFlagTools(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_pass_flag',
            title: 'Pass Team Flag',
            description:
                'Create a machine-actionable flag in the team database. Flags replace communication noise with structured, searchable signals. Vocabulary: blocker, needs_review, help_requested, fyi (configurable via FLAG_VOCABULARY).',
            group: 'team',
            inputSchema: PassTeamFlagSchemaMcp,
            outputSchema: FlagOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const input = PassTeamFlagSchema.parse(params)
                    const vocabulary = getVocabulary(context)

                    // Validate flag_type against vocabulary
                    if (!vocabulary.includes(input.flag_type)) {
                        return {
                            success: false,
                            error: `Invalid flag type: "${input.flag_type}". Valid types: ${vocabulary.join(', ')}`,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: `Use one of: ${vocabulary.join(', ')}`,
                            recoverable: true,
                        }
                    }

                    // SEC-2.3: Bind authorship to the authenticated principal when OAuth is active.
                    const authCtx = getAuthContext()
                    if (authCtx?.authenticated && authCtx.claims?.sub && input.author !== undefined) {
                        if (input.author !== authCtx.claims.sub) {
                            return {
                                success: false,
                                error: `Author mismatch: supplied author "${input.author}" does not match authenticated principal "${authCtx.claims.sub}". Omit the author field to use your identity automatically.`,
                                code: 'PERMISSION_DENIED',
                                category: 'auth',
                                suggestion: 'Omit the author field to use your authenticated identity automatically.',
                                recoverable: false,
                            }
                        }
                    }
                    const author = authCtx?.claims?.sub ?? input.author ?? resolveAuthor()
                    const targetUser = input.target_user?.replace(/^@/, '') ?? null

                    // Build auto_context for structured flag metadata
                    const flagContext: FlagContext = {
                        flag_type: input.flag_type,
                        target_user: targetUser,
                        link: input.link ?? null,
                        resolved: false,
                        resolved_at: null,
                        resolution: null,
                        author,
                    }

                    // Build content with flag prefix
                    const contentPrefix = `flag:${input.flag_type}`
                    const targetSuffix = targetUser ? ` — @${targetUser}` : ''
                    const content = `${contentPrefix}${targetSuffix}: ${input.message}`

                    // Build tags
                    const tags = [`flag:${input.flag_type}`]
                    if (targetUser) {
                        tags.push(`@${targetUser}`)
                    }

                    const entry = teamDb.createEntry({
                        content,
                        entryType: 'flag',
                        tags,
                        isPersonal: false,
                        autoContext: JSON.stringify(flagContext),
                        projectNumber: input.project_number,
                        issueNumber: input.issue_number,
                        author,
                    })

                    teamDb.flushSave()

                    return {
                        success: true,
                        entry: { ...entry, author },
                        flag_type: input.flag_type,
                        target_user: targetUser,
                        resolved: false,
                        author,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_resolve_flag',
            title: 'Resolve Team Flag',
            description:
                'Mark a team flag as resolved with an optional resolution comment. Idempotent — resolving an already-resolved flag returns success with the existing state.',
            group: 'team',
            inputSchema: ResolveTeamFlagSchemaMcp,
            outputSchema: ResolveFlagOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const input = ResolveTeamFlagSchema.parse(params)
                    const entry = teamDb.getEntryById(input.flag_id)

                    if (!entry) {
                        return {
                            success: false,
                            error: `Flag entry ${String(input.flag_id)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the flag entry ID and try again',
                            recoverable: true,
                        }
                    }

                    // Verify this is actually a flag entry
                    if (entry.entryType !== 'flag') {
                        return {
                            success: false,
                            error: `Entry ${String(input.flag_id)} is not a flag (type: ${entry.entryType})`,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Use team_resolve_flag only on entries created by team_pass_flag',
                            recoverable: true,
                        }
                    }

                    const flagCtx = parseFlagContext(entry.autoContext)
                    if (!flagCtx) {
                        return {
                            success: false,
                            error: `Flag entry ${String(input.flag_id)} has invalid auto_context`,
                            code: 'INTERNAL_ERROR',
                            category: 'internal',
                            recoverable: false,
                        }
                    }

                    // Idempotent: already resolved
                    if (flagCtx.resolved) {
                        const author = fetchAuthor(teamDb, input.flag_id)
                        return {
                            success: true,
                            entry: { ...entry, author },
                            flag_type: flagCtx.flag_type,
                            resolved: true,
                            resolution: flagCtx.resolution,
                        }
                    }

                    // Update auto_context with resolution
                    const updatedContext: FlagContext = {
                        ...flagCtx,
                        resolved: true,
                        resolved_at: new Date().toISOString(),
                        resolution: input.resolution ?? null,
                    }

                    // Append resolution to content
                    const resolutionSuffix = input.resolution
                        ? ` [RESOLVED: ${input.resolution}]`
                        : ' [RESOLVED]'
                    const updatedContent = entry.content + resolutionSuffix

                    // Update auto_context and content
                    teamDb.updateEntry(input.flag_id, {
                        autoContext: JSON.stringify(updatedContext),
                        content: updatedContent,
                    })
                    teamDb.flushSave()

                    const updatedEntry = teamDb.getEntryById(input.flag_id)
                    const author = fetchAuthor(teamDb, input.flag_id)

                    return {
                        success: true,
                        entry: updatedEntry ? { ...updatedEntry, author } : undefined,
                        flag_type: flagCtx.flag_type,
                        resolved: true,
                        resolution: input.resolution ?? null,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
