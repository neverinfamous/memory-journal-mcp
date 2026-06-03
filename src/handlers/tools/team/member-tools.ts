/**
 * Team Member Management Tools - 5 tools
 *
 * Tools: team_add_member, team_remove_member, team_update_member_role, team_list_members, team_get_member
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { TEAM_DB_ERROR_RESPONSE } from './helpers.js'
import { getCallerIdentity } from './rbac.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
// Tool Schemas
// ============================================================================

const TeamAddMemberSchema = z.object({
    author: z.string().describe('The author ID/username to add'),
    role: z.enum(['admin', 'member', 'viewer']).describe('The role to assign'),
    display_name: z.string().optional().describe('Optional display name'),
}).strict()

const TeamRemoveMemberSchema = z.object({
    author: z.string().describe('The author ID/username to remove'),
}).strict()

const TeamUpdateMemberRoleSchema = z.object({
    author: z.string().describe('The author ID/username to update'),
    role: z.enum(['admin', 'member', 'viewer']).describe('The new role to assign'),
}).strict()

const TeamGetMemberSchema = z.object({
    author: z.string().describe('The author ID/username to fetch'),
}).strict()

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamMemberTools(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_add_member',
            title: 'Add Team Member',
            description: 'Add a new member to the team with a specific role. Bootstraps the first user as admin if table is empty. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamAddMemberSchema,
            outputSchema: z.object({
                success: z.boolean(),
                member: z.any().optional(),
                message: z.string().optional(),
                error: z.string().optional(),
            }).extend(ErrorFieldsMixin.shape),
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            capabilities: {
                requiresAdminScope: true, // This maps to requiring 'admin' role in wrapWithRbac
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    if (teamDb.addTeamMember === undefined) return { success: false, error: 'Database adapter does not support team membership', code: 'UNSUPPORTED' }

                    const input = TeamAddMemberSchema.parse(params)
                    const caller = getCallerIdentity(params as Record<string, unknown> | undefined)

                    // Notice: wrapWithRbac will ensure caller is 'admin' BEFORE we get here,
                    // UNLESS the table is empty, in which case RBAC is inactive and allows everyone.
                    // The MembersManager natively handles the bootstrap logic inside `addTeamMember`.

                    const member = teamDb.addTeamMember(input.author, input.role, caller, input.display_name)
                    return { success: true, member, message: `Added ${input.author} as ${input.role}` }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_remove_member',
            title: 'Remove Team Member',
            description: 'Remove a member from the team. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamRemoveMemberSchema,
            outputSchema: z.object({
                success: z.boolean(),
                message: z.string().optional(),
                error: z.string().optional(),
            }).extend(ErrorFieldsMixin.shape),
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            capabilities: {
                requiresAdminScope: true,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    if (teamDb.removeTeamMember === undefined) return { success: false, error: 'Unsupported' }

                    const { author } = TeamRemoveMemberSchema.parse(params)
                    
                    const caller = getCallerIdentity(params as Record<string, unknown> | undefined)
                    if (author.toLowerCase() === caller.toLowerCase()) {
                        return { success: false, error: 'Cannot remove yourself. Have another admin do it.', code: 'VALIDATION_ERROR' }
                    }

                    const success = teamDb.removeTeamMember(author)
                    if (!success) {
                        return { success: false, error: `Member ${author} not found`, code: 'RESOURCE_NOT_FOUND' }
                    }
                    return { success: true, message: `Removed ${author} from team` }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_update_member_role',
            title: 'Update Team Member Role',
            description: 'Update the role of an existing team member. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamUpdateMemberRoleSchema,
            outputSchema: z.object({
                success: z.boolean(),
                member: z.any().optional(),
                error: z.string().optional(),
            }).extend(ErrorFieldsMixin.shape),
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            capabilities: {
                requiresAdminScope: true,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    if (teamDb.updateTeamMemberRole === undefined) return { success: false, error: 'Unsupported' }

                    const { author, role } = TeamUpdateMemberRoleSchema.parse(params)
                    const updated = teamDb.updateTeamMemberRole(author, role)
                    if (!updated) {
                        return { success: false, error: `Member ${author} not found`, code: 'RESOURCE_NOT_FOUND' }
                    }
                    return { success: true, member: updated }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_list_members',
            title: 'List Team Members',
            description: 'List all registered team members and their roles. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: z.object({}).strict(),
            outputSchema: z.object({
                success: z.boolean(),
                members: z.array(z.any()).optional(),
                count: z.number().optional(),
                error: z.string().optional(),
            }).extend(ErrorFieldsMixin.shape),
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (_params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    if (teamDb.listTeamMembers === undefined) return { success: false, error: 'Unsupported' }

                    const members = teamDb.listTeamMembers()
                    return { success: true, members, count: members.length }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_get_member',
            title: 'Get Team Member',
            description: 'Get details about a specific team member. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamGetMemberSchema,
            outputSchema: z.object({
                success: z.boolean(),
                member: z.any().optional(),
                error: z.string().optional(),
            }).extend(ErrorFieldsMixin.shape),
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    if (teamDb.getTeamMember === undefined) return { success: false, error: 'Unsupported' }

                    const { author } = TeamGetMemberSchema.parse(params)
                    const member = teamDb.getTeamMember(author)
                    if (!member) {
                        return { success: false, error: `Member ${author} not found`, code: 'RESOURCE_NOT_FOUND' }
                    }
                    return { success: true, member }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
