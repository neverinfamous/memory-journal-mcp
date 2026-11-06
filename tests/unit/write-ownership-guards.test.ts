/**
 * Tests for enforceEntryOwnership (null-author handling) and resolveWriteWorkspaceId ('*' rejection).
 */

import { describe, it, expect } from 'vitest'
import { enforceEntryOwnership } from '../../src/handlers/tools/team/rbac.js'
import { resolveWriteWorkspaceId } from '../../src/handlers/tools/write-workspace.js'
import { ValidationError } from '../../src/types/errors.js'
import { AuthorizationError } from '../../src/types/errors.js'

describe('enforceEntryOwnership', () => {
    it('allows an admin to modify an entry with no author', () => {
        expect(() => enforceEntryOwnership('alice', null, 'admin')).not.toThrow()
        expect(() => enforceEntryOwnership('alice', '', 'admin')).not.toThrow()
    })

    it('allows null-author modification when RBAC is inactive (role null)', () => {
        expect(() => enforceEntryOwnership('alice', null, null)).not.toThrow()
    })

    it('denies a non-admin from modifying an entry with no author', () => {
        expect(() => enforceEntryOwnership('alice', null, 'member')).toThrow(AuthorizationError)
        expect(() => enforceEntryOwnership('alice', undefined, 'viewer')).toThrow(AuthorizationError)
    })

    it('falls back to the normal ownership check when an author exists', () => {
        expect(() => enforceEntryOwnership('alice', 'Alice', 'member')).not.toThrow()
        expect(() => enforceEntryOwnership('alice', 'bob', 'member')).toThrow(AuthorizationError)
    })
})

describe('resolveWriteWorkspaceId', () => {
    it("rejects the read-only wildcard workspace '*'", () => {
        expect(() => resolveWriteWorkspaceId('*', undefined)).toThrow(ValidationError)
    })

    it('resolves a concrete workspace id', () => {
        expect(resolveWriteWorkspaceId('alpha', undefined)).toBe('alpha')
    })
})
