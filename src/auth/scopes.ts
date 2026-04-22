/**
 * memory-journal-mcp — OAuth Scopes
 *
 * Scope definitions and enforcement utilities for
 * granular access control.
 *
 * Scope Hierarchy:  full ⊃ admin ⊃ write ⊃ read
 *
 * Note: memory-journal-mcp uses only base scopes (no wildcard patterns).
 */

import type { ToolGroup } from '../types/index.js'
import { TOOL_GROUPS } from '../filtering/tool-filter.js'

// =============================================================================
// Scope Constants
// =============================================================================

/**
 * Standard OAuth scopes for memory-journal-mcp
 */
export const SCOPES = {
    /** Read-only access */
    READ: 'read',
    /** Read and write access */
    WRITE: 'write',
    /** Administrative access */
    ADMIN: 'admin',
    /** Unrestricted access to all operations */
    FULL: 'full',
    /** Team operations access */
    TEAM: 'team',
    /** Audit log access */
    AUDIT: 'audit',
} as const

export type StandardScope = (typeof SCOPES)[keyof typeof SCOPES]

/**
 * Base scopes supported by the server
 */
export const BASE_SCOPES = ['read', 'write', 'admin', 'full', 'team', 'audit'] as const

/**
 * All supported scope patterns for metadata
 */
export const SUPPORTED_SCOPES = ['read', 'write', 'admin', 'full', 'team', 'audit'] as const

// =============================================================================
// Scope to Tool Group Mapping
// =============================================================================

/**
 * Declarative mapping from tool group to required minimum scope.
 * Single source of truth — all other scope-group arrays derive from this.
 */
export const TOOL_GROUP_SCOPES: Record<ToolGroup, StandardScope> = {
    core: SCOPES.READ,
    search: SCOPES.READ,
    analytics: SCOPES.READ,
    relationships: SCOPES.READ,
    io: SCOPES.READ,
    admin: SCOPES.ADMIN,
    github: SCOPES.WRITE,
    backup: SCOPES.ADMIN,
    // SEC-1.3: Team tools require the dedicated `team` scope, not generic `write`.
    // This aligns tool-level enforcement with the resource-level boundary at memory://team/*.
    // Tokens with `admin` or `full` scope still implicitly include `team` via hasScope().
    team: SCOPES.TEAM,
    codemode: SCOPES.ADMIN,
}

/**
 * Per-tool scope overrides. These tools require different scopes than their group default.
 */
export const TOOL_SCOPE_OVERRIDES: Record<string, StandardScope> = {
    import_markdown: SCOPES.WRITE,
    team_import_markdown: SCOPES.TEAM,
    mj_execute_code: SCOPES.ADMIN,
    create_entry: SCOPES.WRITE,
    create_entry_minimal: SCOPES.WRITE,
    link_entries: SCOPES.WRITE,
    export_markdown: SCOPES.WRITE,
}

/**
 * Get the required scope for a tool group.
 */
export function getScopeForToolGroup(group: ToolGroup): StandardScope {
    return TOOL_GROUP_SCOPES[group] ?? SCOPES.READ
}

// Derived arrays for backward compatibility
const groupsForScope = (maxScope: StandardScope): ToolGroup[] => {
    const hierarchy: Record<StandardScope, number> = {
        read: 0,
        write: 1,
        team: 1.5,
        audit: 1.5,
        admin: 2,
        full: 3,
    }
    const maxLevel = hierarchy[maxScope]
    return (Object.entries(TOOL_GROUP_SCOPES) as [ToolGroup, StandardScope][])
        .filter(([, scope]) => hierarchy[scope] <= maxLevel)
        .map(([group]) => group)
}

/**
 * Tool groups accessible with read scope (read-only operations)
 */
export const READ_SCOPE_GROUPS: ToolGroup[] = groupsForScope(SCOPES.READ)

/**
 * Tool groups accessible with write scope (read + write operations)
 */
export const WRITE_SCOPE_GROUPS: ToolGroup[] = groupsForScope(SCOPES.WRITE)

/**
 * Tool groups accessible with admin scope (all operations)
 */
export const ADMIN_SCOPE_GROUPS: ToolGroup[] = groupsForScope(SCOPES.ADMIN)

// =============================================================================
// Scope Parsing
// =============================================================================

/**
 * Parse a scope string (space-delimited) into an array
 */
export function parseScopes(scopeString: string): string[] {
    return scopeString
        .split(/\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
}

// =============================================================================
// Scope Validation
// =============================================================================

/**
 * Check if a scope is valid (matches known scopes)
 */
export function isValidScope(scope: string): boolean {
    return (BASE_SCOPES as readonly string[]).includes(scope)
}

/**
 * Check if granted scopes include the required scope.
 * Respects the scope hierarchy: full ⊃ admin ⊃ write ⊃ read
 */
export function hasScope(grantedScopes: string[], requiredScope: string): boolean {
    // Full scope grants everything
    if (grantedScopes.includes(SCOPES.FULL)) {
        return true
    }

    // Direct match
    if (grantedScopes.includes(requiredScope)) {
        return true
    }

    // Admin scope includes write, read, team, and audit
    if (
        requiredScope === SCOPES.READ ||
        requiredScope === SCOPES.WRITE ||
        requiredScope === SCOPES.TEAM ||
        requiredScope === SCOPES.AUDIT
    ) {
        if (grantedScopes.includes(SCOPES.ADMIN)) {
            return true
        }
    }

    // Write scope includes read
    if (requiredScope === SCOPES.READ) {
        if (grantedScopes.includes(SCOPES.WRITE)) {
            return true
        }
    }

    return false
}

/**
 * Check if granted scopes include any of the required scopes
 */
export function hasAnyScope(grantedScopes: string[], requiredScopes: string[]): boolean {
    return requiredScopes.some((scope) => hasScope(grantedScopes, scope))
}

/**
 * Check if granted scopes include all of the required scopes
 */
export function hasAllScopes(grantedScopes: string[], requiredScopes: string[]): boolean {
    return requiredScopes.every((scope) => hasScope(grantedScopes, scope))
}

/**
 * Check if scopes include admin access
 */
export function hasAdminScope(scopes: string[]): boolean {
    return scopes.includes('admin') || scopes.includes('full')
}

/**
 * Check if scopes include write access
 */
export function hasWriteScope(scopes: string[]): boolean {
    return scopes.includes('write') || hasAdminScope(scopes)
}

/**
 * Check if scopes include read access
 */
export function hasReadScope(scopes: string[]): boolean {
    return scopes.includes('read') || hasWriteScope(scopes)
}

// =============================================================================
// Tool Group Utilities
// =============================================================================

/**
 * Get the required minimum scope for a tool group
 */
export function getRequiredScopeForGroup(group: ToolGroup): string {
    return TOOL_GROUP_SCOPES[group] ?? SCOPES.READ
}

/**
 * Get tool groups accessible with given scopes
 */
export function getAccessibleToolGroups(scopes: string[]): ToolGroup[] {
    if (scopes.includes(SCOPES.FULL) || hasAdminScope(scopes)) {
        return [...ADMIN_SCOPE_GROUPS]
    }
    if (hasWriteScope(scopes)) {
        return [...WRITE_SCOPE_GROUPS]
    }
    if (hasReadScope(scopes)) {
        return [...READ_SCOPE_GROUPS]
    }
    return []
}

/**
 * Get all tools accessible with given scopes
 */
export function getAccessibleTools(scopes: string[]): string[] {
    const groups = getAccessibleToolGroups(scopes)
    const allTools: string[] = []

    for (const group of groups) {
        const groupTools = TOOL_GROUPS[group] ?? []
        allTools.push(...groupTools)
    }

    return [...new Set(allTools)]
}

// =============================================================================
// Display Utilities
// =============================================================================

/**
 * Get human-readable display name for a scope
 */
export function getScopeDisplayName(scope: string): string {
    switch (scope) {
        case SCOPES.READ:
            return 'Read Only'
        case SCOPES.WRITE:
            return 'Read/Write'
        case SCOPES.ADMIN:
            return 'Administrative'
        case SCOPES.FULL:
            return 'Full Access'
        case SCOPES.TEAM:
            return 'Team Access'
        case SCOPES.AUDIT:
            return 'Audit Log Access'
        default:
            return scope
    }
}
