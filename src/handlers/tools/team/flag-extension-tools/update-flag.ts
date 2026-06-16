import type { ToolDefinition, ToolContext } from '../../../../types/index.js'
import { formatHandlerError } from '../../../../utils/error-helpers.js'
import { TEAM_DB_ERROR_RESPONSE, fetchAuthor } from '../helpers.js'
import { UpdateTeamFlagSchema, UpdateTeamFlagSchemaMcp, UpdateFlagOutputSchema } from '../schemas.js'
import { parseFlagContext, type FlagContext } from '../../../../types/auto-context.js'
import { extractMessageBody, getVocabulary } from './helpers.js'

export function getUpdateFlagTool(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_update_flag',
            title: 'Update Team Flag',
            description:
                "Update a flag's metadata without resolving it. Escalate severity (fyi → blocker), reassign target_user, edit message, add/update link, or reopen a resolved flag. Returns the updated flag with a list of changes made.",
            group: 'team',
            inputSchema: UpdateTeamFlagSchemaMcp,
            outputSchema: UpdateFlagOutputSchema,
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

                    const input = UpdateTeamFlagSchema.parse(params)
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

                    if (entry.entryType !== 'flag') {
                        return {
                            success: false,
                            error: `Entry ${String(input.flag_id)} is not a flag (type: ${entry.entryType})`,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion:
                                'Use team_update_flag only on entries created by team_pass_flag',
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

                    // Validate new flag_type against vocabulary
                    const vocabulary = getVocabulary(context)
                    if (input.flag_type && !vocabulary.includes(input.flag_type)) {
                        return {
                            success: false,
                            error: `Invalid flag type: "${input.flag_type}". Valid types: ${vocabulary.join(', ')}`,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: `Use one of: ${vocabulary.join(', ')}`,
                            recoverable: true,
                        }
                    }

                    // Track changes for audit trail
                    const changes: string[] = []
                    const updatedContext: FlagContext = { ...flagCtx }

                    // Handle reopen
                    if (input.reopen === true && flagCtx.resolved) {
                        updatedContext.resolved = false
                        updatedContext.resolved_at = null
                        updatedContext.resolution = null
                        changes.push('reopened')
                    }

                    // Update flag_type
                    if (input.flag_type !== undefined && input.flag_type !== flagCtx.flag_type) {
                        const old = flagCtx.flag_type
                        updatedContext.flag_type = input.flag_type
                        changes.push(`flag_type: ${old} → ${input.flag_type}`)
                    }

                    // Update target_user
                    if (input.target_user !== undefined) {
                        const newTarget =
                            input.target_user === null ? null : input.target_user.replace(/^@/, '')
                        if (newTarget !== (flagCtx.target_user ?? null)) {
                            const old = flagCtx.target_user ?? 'none'
                            updatedContext.target_user = newTarget
                            changes.push(`target_user: ${old} → ${newTarget ?? 'cleared'}`)
                        }
                    }

                    // Update link
                    if (input.link !== undefined) {
                        if (input.link !== (flagCtx.link ?? null)) {
                            updatedContext.link = input.link
                            changes.push(input.link === null ? 'link: cleared' : `link: updated`)
                        }
                    }

                    // No changes detected
                    if (changes.length === 0 && input.message === undefined) {
                        const author = fetchAuthor(teamDb, input.flag_id)
                        return {
                            success: true,
                            entry: {
                                ...entry,
                                author,
                                flagMetadata: flagCtx as Record<string, unknown>,
                            },
                            flag_type: flagCtx.flag_type,
                            target_user: flagCtx.target_user ?? null,
                            resolved: flagCtx.resolved,
                            author,
                            changes: [],
                        }
                    }

                    // Rebuild content with updated metadata
                    const effectiveFlagType = updatedContext.flag_type
                    const effectiveTarget = updatedContext.target_user
                    const messageBody = input.message ?? extractMessageBody(entry.content)
                    const contentPrefix = `flag:${effectiveFlagType}`
                    const targetSuffix = effectiveTarget ? ` — @${effectiveTarget}` : ''
                    let updatedContent = `${contentPrefix}${targetSuffix}: ${messageBody}`

                    // Preserve [RESOLVED] suffix if still resolved
                    if (updatedContext.resolved && updatedContext.resolution) {
                        updatedContent += ` [RESOLVED: ${updatedContext.resolution}]`
                    } else if (updatedContext.resolved) {
                        updatedContent += ' [RESOLVED]'
                    }

                    if (input.message !== undefined) {
                        changes.push('message: updated')
                    }

                    // Rebuild tags
                    const tags = [`flag:${effectiveFlagType}`]
                    if (effectiveTarget) {
                        tags.push(`@${effectiveTarget}`)
                    }

                    // Persist
                    teamDb.updateEntry(input.flag_id, {
                        autoContext: JSON.stringify(updatedContext),
                        content: updatedContent,
                        tags,
                    })
                    teamDb.flushSave()

                    if (context.config?.subscriptionManager) {
                        void context.config.subscriptionManager.notifyResourceUpdated('memory://team/recent')
                        void context.config.subscriptionManager.notifyResourceUpdated('memory://flags')
                        void context.config.subscriptionManager.notifyResourceUpdated('memory://briefing')
                    }

                    const updatedEntry = teamDb.getEntryById(input.flag_id)
                    const author = fetchAuthor(teamDb, input.flag_id)

                    return {
                        success: true,
                        entry: updatedEntry
                            ? {
                                  ...updatedEntry,
                                  author,
                                  flagMetadata: updatedContext as Record<string, unknown>,
                              }
                            : undefined,
                        flag_type: updatedContext.flag_type,
                        target_user: updatedContext.target_user ?? null,
                        resolved: updatedContext.resolved,
                        author,
                        changes,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
