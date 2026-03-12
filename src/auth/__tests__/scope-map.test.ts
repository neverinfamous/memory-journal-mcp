/**
 * memory-journal-mcp — Scope Map Unit Tests
 *
 * Tests for the tool-to-scope reverse lookup.
 */

import { describe, it, expect } from 'vitest'
import { getRequiredScope, getToolScopeMap } from '../scope-map.js'
import { TOOL_GROUPS } from '../../filtering/ToolFilter.js'
import { TOOL_GROUP_SCOPES } from '../scopes.js'
import type { ToolGroup } from '../../types/index.js'

describe('scope-map', () => {
    describe('getRequiredScope', () => {
        it('should return read for core tools', () => {
            const coreTools = TOOL_GROUPS['core']
            if (coreTools && coreTools.length > 0) {
                const firstTool = coreTools[0]!
                expect(getRequiredScope(firstTool)).toBe('read')
            }
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

        it('should return read as safe default for unknown tools', () => {
            expect(getRequiredScope('nonexistent_tool_xyz')).toBe('read')
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
                    expect(map.get(tool)).toBe(expectedScope)
                }
            }
        })

        it('should not be empty', () => {
            const map = getToolScopeMap()
            expect(map.size).toBeGreaterThan(0)
        })
    })
})
