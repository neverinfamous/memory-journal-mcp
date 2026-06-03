import { describe, it, expect, vi, beforeEach } from 'vitest'
import { enforceTeamRbac, enforceOwnership, getCallerIdentity } from '../../src/handlers/tools/team/rbac.js'
import { AuthorizationError } from '../../src/types/errors.js'
import type { ToolContext } from '../../src/types/index.js'
import type { TeamRole } from '../../src/database/core/interfaces.js'

vi.mock('../../src/auth/auth-context.js', () => ({
    getAuthContext: vi.fn().mockReturnValue(null)
}))

describe('Team RBAC Security', () => {
    let mockContext: Partial<ToolContext>

    beforeEach(() => {
        mockContext = {
            config: {
                teamDefaultRole: 'denied',
                teamAuthor: 'test_author'
            } as any,
            teamDb: {
                isTeamRbacActive: vi.fn().mockReturnValue(true),
                resolveTeamRole: vi.fn()
            } as any
        }
    })

    describe('enforceTeamRbac', () => {
        it('bypasses checks if teamDb is missing', () => {
            const ctxWithoutDb: Partial<ToolContext> = { ...mockContext, teamDb: undefined }
            expect(() => enforceTeamRbac(ctxWithoutDb as ToolContext, 'author', 'admin')).not.toThrow()
        })

        it('bypasses checks if RBAC is disabled', () => {
            mockContext.teamDb!.isTeamRbacActive = vi.fn().mockReturnValue(false)
            expect(() => enforceTeamRbac(mockContext as ToolContext, 'author', 'admin')).not.toThrow()
        })

        it('throws if role is denied', () => {
            mockContext.teamDb!.resolveTeamRole = vi.fn().mockReturnValue('denied')
            expect(() => enforceTeamRbac(mockContext as ToolContext, 'author', 'viewer'))
                .toThrowError(AuthorizationError)
            expect(() => enforceTeamRbac(mockContext as ToolContext, 'author', 'viewer'))
                .toThrow(/Access denied: author 'author' is not registered and default role is 'denied'/)
        })

        it('allows viewer to access viewer endpoints', () => {
            mockContext.teamDb!.resolveTeamRole = vi.fn().mockReturnValue('viewer')
            expect(() => enforceTeamRbac(mockContext as ToolContext, 'author', 'viewer')).not.toThrow()
        })

        it('blocks viewer from accessing member endpoints', () => {
            mockContext.teamDb!.resolveTeamRole = vi.fn().mockReturnValue('viewer')
            expect(() => enforceTeamRbac(mockContext as ToolContext, 'author', 'member'))
                .toThrow(/Access denied: required 'member' role, but author 'author' has 'viewer'/)
        })

        it('blocks viewer from accessing admin endpoints', () => {
            mockContext.teamDb!.resolveTeamRole = vi.fn().mockReturnValue('viewer')
            expect(() => enforceTeamRbac(mockContext as ToolContext, 'author', 'admin'))
                .toThrow(/Access denied: required 'admin' role, but author 'author' has 'viewer'/)
        })

        it('allows member to access viewer endpoints', () => {
            mockContext.teamDb!.resolveTeamRole = vi.fn().mockReturnValue('member')
            expect(() => enforceTeamRbac(mockContext as ToolContext, 'author', 'viewer')).not.toThrow()
        })

        it('allows member to access member endpoints', () => {
            mockContext.teamDb!.resolveTeamRole = vi.fn().mockReturnValue('member')
            expect(() => enforceTeamRbac(mockContext as ToolContext, 'author', 'member')).not.toThrow()
        })

        it('blocks member from accessing admin endpoints', () => {
            mockContext.teamDb!.resolveTeamRole = vi.fn().mockReturnValue('member')
            expect(() => enforceTeamRbac(mockContext as ToolContext, 'author', 'admin'))
                .toThrow(/Access denied: required 'admin' role, but author 'author' has 'member'/)
        })

        it('allows admin to access all endpoints', () => {
            mockContext.teamDb!.resolveTeamRole = vi.fn().mockReturnValue('admin')
            expect(() => enforceTeamRbac(mockContext as ToolContext, 'author', 'viewer')).not.toThrow()
            expect(() => enforceTeamRbac(mockContext as ToolContext, 'author', 'member')).not.toThrow()
            expect(() => enforceTeamRbac(mockContext as ToolContext, 'author', 'admin')).not.toThrow()
        })

        it('falls back to default role if user is missing', () => {
            mockContext.teamDb!.resolveTeamRole = vi.fn().mockImplementation((author, defaultRole) => defaultRole)
            mockContext.config!.teamDefaultRole = 'viewer'
            expect(() => enforceTeamRbac(mockContext as ToolContext, 'author', 'viewer')).not.toThrow()
        })
    })

    describe('enforceOwnership', () => {
        it('allows admin to modify any entry', () => {
            expect(() => enforceOwnership('admin_author', 'other_author', 'admin')).not.toThrow()
        })

        it('allows member to modify their own entry (case insensitive)', () => {
            expect(() => enforceOwnership('MyAuthor', 'myauthor', 'member')).not.toThrow()
        })

        it('blocks member from modifying another person\'s entry', () => {
            expect(() => enforceOwnership('author1', 'author2', 'member'))
                .toThrowError(AuthorizationError)
            expect(() => enforceOwnership('author1', 'author2', 'member'))
                .toThrow(/Access denied: cannot modify resource owned by 'author2'/)
        })
    })
})
