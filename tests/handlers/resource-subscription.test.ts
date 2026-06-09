import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateResourceSubscription } from '../../src/handlers/resources/index.js'
import { ResourceNotFoundError, PermissionError } from '../../src/types/errors.js'
import { withAuthContext } from '../../src/auth/auth-context.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { AuditLogger } from '../../src/audit/index.js'

describe('validateResourceSubscription', () => {
    let mockRuntime: ServerRuntime

    beforeEach(() => {
        // Create a minimal mock ServerRuntime
        const mockAuditLogger = {
            logDenial: vi.fn(),
            logAccess: vi.fn(),
            logMutation: vi.fn(),
            logSystem: vi.fn()
        } as unknown as AuditLogger

        mockRuntime = {
            auditLogger: mockAuditLogger,
            maintenanceManager: {
                withActiveJob: vi.fn().mockImplementation((fn) => fn())
            }
        } as unknown as ServerRuntime
    })

    it('throws ResourceNotFoundError for completely invalid URIs', () => {
        expect(() => {
            validateResourceSubscription('memory://does-not-exist', mockRuntime)
        }).toThrow(ResourceNotFoundError)
    })

    it('passes validation for a public/read resource without auth (stdio mode)', () => {
        // stdio mode (no auth context)
        expect(() => {
            validateResourceSubscription('memory://recent', mockRuntime)
        }).not.toThrow()
    })

    it('passes validation for template resources', () => {
        expect(() => {
            validateResourceSubscription('memory://github/status/owner/repo', mockRuntime)
        }).not.toThrow()
    })

    describe('with OAuth context', () => {
        it('throws PermissionError when accessing admin resource with only read scope', () => {
            withAuthContext(
                { authenticated: true, scopes: ['read'], claims: { sub: 'user1', scopes: ['read'], exp: 9999999999, iat: 1234567890 } },
                () => {
                    expect(() => {
                        validateResourceSubscription('memory://audit', mockRuntime)
                    }).toThrow(PermissionError)
                    expect(mockRuntime.auditLogger?.logDenial).toHaveBeenCalledWith(
                        'memory://audit',
                        'Insufficient scope',
                        expect.objectContaining({ scope: 'admin' })
                    )
                }
            )
        })

        it('throws PermissionError when accessing team resource with only read scope', () => {
            withAuthContext(
                { authenticated: true, scopes: ['read'], claims: { sub: 'user1', scopes: ['read'], exp: 9999999999, iat: 1234567890 } },
                () => {
                    expect(() => {
                        validateResourceSubscription('memory://team/recent', mockRuntime)
                    }).toThrow(PermissionError)
                }
            )
        })

        it('passes validation when accessing team resource with team scope', () => {
            withAuthContext(
                { authenticated: true, scopes: ['team'], claims: { sub: 'user1', scopes: ['team'], exp: 9999999999, iat: 1234567890 } },
                () => {
                    expect(() => {
                        validateResourceSubscription('memory://team/recent', mockRuntime)
                    }).not.toThrow()
                }
            )
        })

        it('passes validation when accessing admin resource with admin scope', () => {
            withAuthContext(
                { authenticated: true, scopes: ['admin'], claims: { sub: 'user1', scopes: ['admin'], exp: 9999999999, iat: 1234567890 } },
                () => {
                    expect(() => {
                        validateResourceSubscription('memory://audit', mockRuntime)
                    }).not.toThrow()
                }
            )
        })
    })
})
