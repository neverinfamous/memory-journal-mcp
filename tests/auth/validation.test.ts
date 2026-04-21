import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { enforceAccessBoundary } from '../../src/auth/validation.js'
import { PermissionError } from '../../src/types/errors.js'
import * as authContext from '../../src/auth/auth-context.js'

vi.mock('../../src/auth/auth-context.js', () => ({
    getAuthContext: vi.fn(),
}))

describe('enforceAccessBoundary', () => {
    let originalEnv: NodeJS.ProcessEnv

    beforeEach(() => {
        originalEnv = process.env
        process.env = { ...originalEnv }
        vi.clearAllMocks()
    })

    afterEach(() => {
        process.env = originalEnv
    })

    it('should throw if target is team and no auth or TEAM_AUTHOR is present', () => {
        delete process.env['TEAM_AUTHOR']
        process.env['CODEMODE_INTERNAL_FULL_ACCESS'] = 'false'
        vi.mocked(authContext.getAuthContext).mockReturnValue(undefined)

        expect(() => enforceAccessBoundary('memory://team/test', 'resource')).toThrow(
            PermissionError
        )
        expect(() => enforceAccessBoundary('memory://team/test', 'resource')).toThrow(
            /missing TEAM_AUTHOR or active OAuth session/
        )
    })

    it('should allow team target if CODEMODE_INTERNAL_FULL_ACCESS is true', () => {
        delete process.env['TEAM_AUTHOR']
        process.env['CODEMODE_INTERNAL_FULL_ACCESS'] = 'true'
        vi.mocked(authContext.getAuthContext).mockReturnValue(undefined)

        expect(() => enforceAccessBoundary('memory://team/test', 'resource')).not.toThrow()
    })

    it('should require admin scope for memory://audit resource', () => {
        vi.mocked(authContext.getAuthContext).mockReturnValue({
            authenticated: true,
            claims: { sub: 'test', scopes: ['read'], exp: 0, iat: 0, iss: '', aud: '' },
        })

        const mockAuditLogger = {
            logDenial: vi.fn(),
        }

        expect(() =>
            enforceAccessBoundary('memory://audit', 'resource', undefined, mockAuditLogger as any)
        ).toThrow(PermissionError)
        expect(mockAuditLogger.logDenial).toHaveBeenCalledWith(
            'memory://audit',
            'Insufficient scope',
            expect.objectContaining({ scope: 'admin', category: 'admin' })
        )
    })

    it('should allow if admin scope is present for memory://audit', () => {
        vi.mocked(authContext.getAuthContext).mockReturnValue({
            authenticated: true,
            claims: { sub: 'test', scopes: ['admin'], exp: 0, iat: 0, iss: '', aud: '' },
        })

        expect(() => enforceAccessBoundary('memory://audit', 'resource')).not.toThrow()
    })

    it('should log denial with team category when team scope is missing', () => {
        vi.mocked(authContext.getAuthContext).mockReturnValue({
            authenticated: true,
            claims: { sub: 'test', scopes: ['read'], exp: 0, iat: 0, iss: '', aud: '' },
        })
        process.env['TEAM_AUTHOR'] = 'test-author'

        const mockAuditLogger = {
            logDenial: vi.fn(),
        }

        expect(() =>
            enforceAccessBoundary(
                'team_create_entry',
                'tool',
                { requiresTeamScope: true },
                mockAuditLogger as any
            )
        ).toThrow(PermissionError)
        expect(mockAuditLogger.logDenial).toHaveBeenCalledWith(
            'team_create_entry',
            'Insufficient scope',
            expect.objectContaining({ category: 'team' })
        )
    })
})
