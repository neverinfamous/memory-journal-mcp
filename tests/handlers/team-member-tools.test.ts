import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTeamMemberTools } from '../../src/handlers/tools/team/member-tools.js'
import type { ToolContext } from '../../src/types/index.js'

describe('Team Member Management Tools', () => {
    let mockContext: Partial<ToolContext>
    let tools: ReturnType<typeof getTeamMemberTools>

    beforeEach(() => {
        mockContext = {
            teamDb: {
                addTeamMember: vi.fn(),
                removeTeamMember: vi.fn(),
                updateTeamRole: vi.fn(),
                getTeamMember: vi.fn(),
                listTeamMembers: vi.fn(),
                isTeamRbacActive: vi.fn().mockReturnValue(true)
            } as any
        }
        tools = getTeamMemberTools(mockContext as ToolContext)
    })

    const getTool = (name: string) => tools.find(t => t.name === name)!

    describe('team_add_member', () => {
        it('requires TEAM_DB_PATH', () => {
            const tool = getTeamMemberTools({} as ToolContext).find(t => t.name === 'team_add_member')!
            const result = tool.handler({ author: 'test_user', role: 'viewer' }) as any
            expect(result.success).toBe(false)
            expect(result.error).toMatch(/Team database not configured/)
        })

        it('returns unsupported if database adapter lacks method', () => {
            delete mockContext.teamDb!.addTeamMember
            const tool = getTool('team_add_member')
            const result = tool.handler({ author: 'test_user', role: 'viewer' }) as any
            expect(result.success).toBe(false)
            expect(result.code).toBe('UNSUPPORTED')
        })

        it('successfully adds a member', () => {
            mockContext.teamDb!.addTeamMember = vi.fn().mockReturnValue({ author: 'test_user', role: 'viewer' })
            const tool = getTool('team_add_member')
            const result = tool.handler({ author: 'test_user', role: 'viewer' }) as any
            
            expect(result.success).toBe(true)
            expect(result.member.role).toBe('viewer')
            expect(mockContext.teamDb!.addTeamMember).toHaveBeenCalledWith('test_user', 'viewer', expect.any(String), undefined)
        })

        it('handles database errors gracefully', () => {
            mockContext.teamDb!.addTeamMember = vi.fn().mockImplementation(() => { throw new Error('DB Error') })
            const tool = getTool('team_add_member')
            const result = tool.handler({ author: 'test_user', role: 'viewer' }) as any
            expect(result.success).toBe(false)
            expect(result.error).toBe('DB Error')
        })
    })

    describe('team_remove_member', () => {
        it('successfully removes a member', () => {
            mockContext.teamDb!.removeTeamMember = vi.fn().mockReturnValue(true)
            const tool = getTool('team_remove_member')
            const result = tool.handler({ author: 'test_user' }) as any
            
            expect(result.success).toBe(true)
            expect(mockContext.teamDb!.removeTeamMember).toHaveBeenCalledWith('test_user')
        })
    })

    describe('team_update_member_role', () => {
        it('successfully updates a member role', () => {
            mockContext.teamDb!.updateTeamMemberRole = vi.fn().mockReturnValue({ author: 'test_user', role: 'admin' })
            const tool = getTool('team_update_member_role')
            const result = tool.handler({ author: 'test_user', role: 'admin' }) as any
            
            expect(result.success).toBe(true)
            expect(result.member.role).toBe('admin')
            expect(mockContext.teamDb!.updateTeamMemberRole).toHaveBeenCalledWith('test_user', 'admin')
        })
    })

    describe('team_get_member', () => {
        it('successfully gets a member', () => {
            mockContext.teamDb!.getTeamMember = vi.fn().mockReturnValue({ author: 'test_user', role: 'member' })
            const tool = getTool('team_get_member')
            const result = tool.handler({ author: 'test_user' }) as any
            
            expect(result.success).toBe(true)
            expect(result.member.role).toBe('member')
        })

        it('returns RESOURCE_NOT_FOUND when member does not exist', () => {
            mockContext.teamDb!.getTeamMember = vi.fn().mockReturnValue(null)
            const tool = getTool('team_get_member')
            const result = tool.handler({ author: 'test_user' }) as any
            
            expect(result.success).toBe(false)
            expect(result.code).toBe('RESOURCE_NOT_FOUND')
        })
    })

    describe('team_list_members', () => {
        it('successfully lists members', () => {
            mockContext.teamDb!.listTeamMembers = vi.fn().mockReturnValue([{ author: 'admin', role: 'admin' }])
            const tool = getTool('team_list_members')
            const result = tool.handler({}) as any
            
            expect(result.success).toBe(true)
            expect(result.members).toHaveLength(1)
            expect(result.members[0].author).toBe('admin')
        })
    })
})
