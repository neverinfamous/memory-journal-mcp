/**
 * memory-journal-mcp — Scope Map Unit Tests
 *
 * Tests for the tool-to-scope reverse lookup.
 */

import { describe, it, expect } from 'vitest'
import { getRequiredScope, getToolScopeMap } from '../../src/auth/scope-map.js'
import { TOOL_GROUPS } from '../../src/filtering/tool-filter.js'
import { TOOL_GROUP_SCOPES } from '../../src/auth/scopes.js'
import type { ToolGroup } from '../../src/types/index.js'

describe('scope-map', () => {
    describe('getRequiredScope', () => {
        it('should return read for read-only core tools', () => {
            expect(getRequiredScope('get_recent_entries')).toBe('read')
        })

        it('should return write for github tools', () => {
            const githubTools = TOOL_GROUPS['github']
            if (githubTools && githubTools.length > 0) {
                const firstTool = githubTools[0]!
                expect(getRequiredScope(firstTool)).toBe('write')
            }
        })

        it('should return admin for admin tools', () => {
            const adminTools = TOOL_GROUPS['admin']
            if (adminTools && adminTools.length > 0) {
                const firstTool = adminTools[0]!
                expect(getRequiredScope(firstTool)).toBe('admin')
            }
        })

        it('should throw error for unknown tools', () => {
            expect(() => getRequiredScope('nonexistent_tool_xyz')).toThrow('CRITICAL SECURITY FAILURE')
        })
    })

    describe('getToolScopeMap', () => {
        it('should return a ReadonlyMap', () => {
            const map = getToolScopeMap()
            expect(map).toBeInstanceOf(Map)
        })

        it('should contain entries for every tool in TOOL_GROUPS', () => {
            const map = getToolScopeMap()

            for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
            const expectedScope = TOOL_GROUP_SCOPES[group as ToolGroup]
                for (const tool of tools) {
                    let expected = expectedScope
                    // import_markdown (personal journal) stays at write
                    // team_import_markdown now requires team scope (SEC-1.3)
                    if (tool === 'import_markdown') {
                        expected = 'write'
                    } else if (tool === 'team_import_markdown') {
                        expected = 'team'
                    } else if (['create_entry', 'create_entry_minimal', 'link_entries', 'export_markdown'].includes(tool)) {
                        expected = 'write'
                    }
                    expect(map.get(tool)).toBe(expected)
                }
            }
        })

        it('should not be empty', () => {
            const map = getToolScopeMap()
            expect(map.size).toBeGreaterThan(0)
        })
    })
})
