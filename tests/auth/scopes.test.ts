/**
 * memory-journal-mcp — OAuth Scopes Unit Tests
 *
 * Tests for scope definitions, hierarchy, and enforcement utilities.
 */

import { describe, it, expect } from 'vitest'
import {
    SCOPES,
    parseScopes,
    hasScope,
    hasAnyScope,
    hasAllScopes,
    hasAdminScope,
    hasWriteScope,
    hasReadScope,
    isValidScope,
    getScopeForToolGroup,
    getScopeDisplayName,
    getRequiredScopeForGroup,
    getAccessibleToolGroups,
    getAccessibleTools,
    TOOL_GROUP_SCOPES,
    READ_SCOPE_GROUPS,
    WRITE_SCOPE_GROUPS,
    ADMIN_SCOPE_GROUPS,
} from '../../src/auth/scopes.js'

// =============================================================================
// parseScopes
// =============================================================================

describe('parseScopes', () => {
    it('should parse space-delimited scope string', () => {
        expect(parseScopes('read write admin')).toEqual(['read', 'write', 'admin'])
    })

    it('should return empty array for empty string', () => {
        expect(parseScopes('')).toEqual([])
    })

    it('should handle single scope', () => {
        expect(parseScopes('read')).toEqual(['read'])
    })

    it('should strip extra whitespace', () => {
        expect(parseScopes('  read   write  ')).toEqual(['read', 'write'])
    })
})

// =============================================================================
// hasScope (hierarchy: full ⊃ admin ⊃ write ⊃ read)
// =============================================================================

describe('hasScope', () => {
    it('should return true for direct match', () => {
        expect(hasScope(['read', 'write'], 'read')).toBe(true)
    })

    it('should return false when scope not present', () => {
        expect(hasScope(['read'], 'write')).toBe(false)
    })

    it('should grant all scopes when full is present', () => {
        expect(hasScope(['full'], 'read')).toBe(true)
        expect(hasScope(['full'], 'write')).toBe(true)
        expect(hasScope(['full'], 'admin')).toBe(true)
    })

    it('should grant read and write when admin is present', () => {
        expect(hasScope(['admin'], 'read')).toBe(true)
        expect(hasScope(['admin'], 'write')).toBe(true)
    })

    it('should NOT grant admin when only write is present', () => {
        expect(hasScope(['write'], 'admin')).toBe(false)
    })

    it('should grant read when write is present', () => {
        expect(hasScope(['write'], 'read')).toBe(true)
    })

    it('should NOT grant write when only read is present', () => {
        expect(hasScope(['read'], 'write')).toBe(false)
    })

    it('should return false for empty scopes', () => {
        expect(hasScope([], 'read')).toBe(false)
    })
})

// =============================================================================
// hasAnyScope / hasAllScopes
// =============================================================================

describe('hasAnyScope', () => {
    it('should return true if any scope matches', () => {
        expect(hasAnyScope(['read'], ['read', 'write'])).toBe(true)
    })

    it('should return false if no scopes match', () => {
        expect(hasAnyScope(['read'], ['write', 'admin'])).toBe(false)
    })

    it('should handle hierarchy (full grants any)', () => {
        expect(hasAnyScope(['full'], ['admin'])).toBe(true)
    })
})

describe('hasAllScopes', () => {
    it('should return true if all scopes match', () => {
        expect(hasAllScopes(['read', 'write', 'admin'], ['read', 'write'])).toBe(true)
    })

    it('should return false if not all scopes match', () => {
        expect(hasAllScopes(['read'], ['read', 'write'])).toBe(false)
    })

    it('should respect hierarchy for all checks', () => {
        expect(hasAllScopes(['full'], ['read', 'write', 'admin'])).toBe(true)
    })
})

// =============================================================================
// Convenience scope checks
// =============================================================================

describe('hasAdminScope', () => {
    it('should return true for admin', () => {
        expect(hasAdminScope(['admin'])).toBe(true)
    })

    it('should return true for full (which includes admin)', () => {
        expect(hasAdminScope(['full'])).toBe(true)
    })

    it('should return false for write/read only', () => {
        expect(hasAdminScope(['write'])).toBe(false)
        expect(hasAdminScope(['read'])).toBe(false)
    })
})

describe('hasWriteScope', () => {
    it('should return true for write', () => {
        expect(hasWriteScope(['write'])).toBe(true)
    })

    it('should return true for admin (which includes write)', () => {
        expect(hasWriteScope(['admin'])).toBe(true)
    })

    it('should return true for full', () => {
        expect(hasWriteScope(['full'])).toBe(true)
    })

    it('should return false for read only', () => {
        expect(hasWriteScope(['read'])).toBe(false)
    })
})

describe('hasReadScope', () => {
    it('should return true for read', () => {
        expect(hasReadScope(['read'])).toBe(true)
    })

    it('should return true for write (which includes read)', () => {
        expect(hasReadScope(['write'])).toBe(true)
    })

    it('should return true for full', () => {
        expect(hasReadScope(['full'])).toBe(true)
    })
})

// =============================================================================
// isValidScope
// =============================================================================

describe('isValidScope', () => {
    it('should validate base scopes', () => {
        expect(isValidScope('read')).toBe(true)
        expect(isValidScope('write')).toBe(true)
        expect(isValidScope('admin')).toBe(true)
        expect(isValidScope('full')).toBe(true)
    })

    it('should reject invalid scopes', () => {
        expect(isValidScope('unknown')).toBe(false)
        expect(isValidScope('database:mydb')).toBe(false)
        expect(isValidScope('db:mydb')).toBe(false)
    })
})

// =============================================================================
// TOOL_GROUP_SCOPES & getScopeForToolGroup
// =============================================================================

describe('TOOL_GROUP_SCOPES', () => {
    it('should map read-only groups to read', () => {
        expect(TOOL_GROUP_SCOPES['core']).toBe(SCOPES.READ)
        expect(TOOL_GROUP_SCOPES['search']).toBe(SCOPES.READ)
        expect(TOOL_GROUP_SCOPES['analytics']).toBe(SCOPES.READ)
        expect(TOOL_GROUP_SCOPES['relationships']).toBe(SCOPES.READ)
        expect(TOOL_GROUP_SCOPES['io']).toBe(SCOPES.READ)
    })

    it('should map write groups to write', () => {
        expect(TOOL_GROUP_SCOPES['github']).toBe(SCOPES.WRITE)
    })

    // SEC-1.3: Team tools require dedicated `team` scope, not generic `write`.
    // Tokens with admin/full still have access via hasScope() hierarchy.
    it('should map team group to team scope', () => {
        expect(TOOL_GROUP_SCOPES['team']).toBe(SCOPES.TEAM)
    })

    it('should map admin groups to admin', () => {
        expect(TOOL_GROUP_SCOPES['admin']).toBe(SCOPES.ADMIN)
        expect(TOOL_GROUP_SCOPES['backup']).toBe(SCOPES.ADMIN)
        expect(TOOL_GROUP_SCOPES['codemode']).toBe(SCOPES.ADMIN)
    })
})

describe('getScopeForToolGroup', () => {
    it('should return correct scope for each group', () => {
        expect(getScopeForToolGroup('core')).toBe('read')
        expect(getScopeForToolGroup('github')).toBe('write')
        expect(getScopeForToolGroup('admin')).toBe('admin')
    })
})

// =============================================================================
// Derived group arrays
// =============================================================================

describe('scope group arrays', () => {
    it('READ_SCOPE_GROUPS should contain only read groups', () => {
        expect(READ_SCOPE_GROUPS).toContain('core')
        expect(READ_SCOPE_GROUPS).toContain('search')
        expect(READ_SCOPE_GROUPS).not.toContain('github')
        expect(READ_SCOPE_GROUPS).not.toContain('admin')
    })

    it('WRITE_SCOPE_GROUPS should contain read + write groups', () => {
        expect(WRITE_SCOPE_GROUPS).toContain('core')
        expect(WRITE_SCOPE_GROUPS).toContain('github')
        // SEC-1.3: `team` is now SCOPES.TEAM, not SCOPES.WRITE.
        // Team group is in the team-scope tier (accessible to team/admin/full tokens only).
        expect(WRITE_SCOPE_GROUPS).not.toContain('team')
        expect(WRITE_SCOPE_GROUPS).not.toContain('admin')
    })

    it('ADMIN_SCOPE_GROUPS should contain all groups', () => {
        expect(ADMIN_SCOPE_GROUPS).toContain('core')
        expect(ADMIN_SCOPE_GROUPS).toContain('github')
        expect(ADMIN_SCOPE_GROUPS).toContain('admin')
        expect(ADMIN_SCOPE_GROUPS).toContain('codemode')
    })
})

// =============================================================================
// getRequiredScopeForGroup / getAccessibleToolGroups
// =============================================================================

describe('getRequiredScopeForGroup', () => {
    it('should return read for read-only groups', () => {
        expect(getRequiredScopeForGroup('core')).toBe('read')
    })

    it('should return write for write groups', () => {
        expect(getRequiredScopeForGroup('github')).toBe('write')
    })

    it('should return admin for admin groups', () => {
        expect(getRequiredScopeForGroup('admin')).toBe('admin')
        expect(getRequiredScopeForGroup('codemode')).toBe('admin')
    })
})

describe('getAccessibleToolGroups', () => {
    it('should return all groups for full scope', () => {
        const groups = getAccessibleToolGroups(['full'])
        expect(groups).toContain('admin')
        expect(groups).toContain('core')
        expect(groups).toContain('codemode')
    })

    it('should return all groups for admin scope', () => {
        const groups = getAccessibleToolGroups(['admin'])
        expect(groups).toContain('admin')
        expect(groups).toContain('github')
        expect(groups).toContain('core')
    })

    it('should return write+read groups for write scope', () => {
        const groups = getAccessibleToolGroups(['write'])
        expect(groups).toContain('core')
        expect(groups).toContain('github')
        expect(groups).not.toContain('admin')
    })

    it('should return read groups for read scope', () => {
        const groups = getAccessibleToolGroups(['read'])
        expect(groups).toContain('core')
        expect(groups).not.toContain('github')
        expect(groups).not.toContain('admin')
    })

    it('should return empty for no scopes', () => {
        expect(getAccessibleToolGroups([])).toEqual([])
    })
})

// =============================================================================
// getAccessibleTools
// =============================================================================

describe('getAccessibleTools', () => {
    it('should return tools for accessible groups', () => {
        const tools = getAccessibleTools(['read'])
        expect(tools.length).toBeGreaterThan(0)
        // Should include core tools
        expect(tools).toContain('create_entry')
    })

    it('should return all tools for full scope', () => {
        const tools = getAccessibleTools(['full'])
        expect(tools).toContain('create_entry') // core
        expect(tools).toContain('mj_execute_code') // codemode
    })

    it('should deduplicate tools', () => {
        const tools = getAccessibleTools(['full'])
        const uniqueTools = [...new Set(tools)]
        expect(tools.length).toBe(uniqueTools.length)
    })
})

// =============================================================================
// getScopeDisplayName
// =============================================================================

describe('getScopeDisplayName', () => {
    it('should return display names for standard scopes', () => {
        expect(getScopeDisplayName('read')).toBe('Read Only')
        expect(getScopeDisplayName('write')).toBe('Read/Write')
        expect(getScopeDisplayName('admin')).toBe('Administrative')
        expect(getScopeDisplayName('full')).toBe('Full Access')
    })

    it('should return unknown scopes as-is', () => {
        expect(getScopeDisplayName('custom_scope')).toBe('custom_scope')
    })
})
