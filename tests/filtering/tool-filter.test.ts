/**
 * ToolFilter Tests
 *
 * Tests the tool filtering system: groups, meta-groups, parsing, filtering.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
    TOOL_GROUPS,
    META_GROUPS,
    getAllToolNames,
    getToolGroup,
    parseToolFilter,
    isToolEnabled,
    filterTools,
    getToolFilterFromEnv,
    calculateTokenSavings,
    getFilterSummary,
} from '../../src/filtering/tool-filter.js'

// ============================================================================
// Constants
// ============================================================================

describe('TOOL_GROUPS', () => {
    it('should contain all 8 groups', () => {
        const groups = Object.keys(TOOL_GROUPS)
        expect(groups).toContain('core')
        expect(groups).toContain('search')
        expect(groups).toContain('analytics')
        expect(groups).toContain('relationships')
        expect(groups).toContain('export')
        expect(groups).toContain('admin')
        expect(groups).toContain('github')
        expect(groups).toContain('backup')
    })

    it('should have no duplicate tools across groups', () => {
        const allTools = Object.values(TOOL_GROUPS).flat()
        const unique = new Set(allTools)
        expect(unique.size).toBe(allTools.length)
    })
})

describe('META_GROUPS', () => {
    it('should define starter as core + search', () => {
        expect(META_GROUPS.starter).toEqual(['core', 'search'])
    })

    it('should define essential as core only', () => {
        expect(META_GROUPS.essential).toEqual(['core'])
    })

    it('should define full with all groups', () => {
        expect(META_GROUPS.full).toContain('core')
        expect(META_GROUPS.full).toContain('github')
        expect(META_GROUPS.full).toContain('backup')
    })

    it('should define readonly without admin, github, backup', () => {
        expect(META_GROUPS.readonly).not.toContain('admin')
        expect(META_GROUPS.readonly).not.toContain('github')
        expect(META_GROUPS.readonly).not.toContain('backup')
    })
})

// ============================================================================
// getAllToolNames
// ============================================================================

describe('getAllToolNames', () => {
    it('should return all tools', () => {
        const names = getAllToolNames()
        expect(names.length).toBeGreaterThan(0)
    })

    it('should contain no duplicates', () => {
        const names = getAllToolNames()
        const unique = new Set(names)
        expect(unique.size).toBe(names.length)
    })

    it('should include known tools', () => {
        const names = getAllToolNames()
        expect(names).toContain('create_entry')
        expect(names).toContain('search_entries')
        expect(names).toContain('backup_journal')
    })
})

// ============================================================================
// getToolGroup
// ============================================================================

describe('getToolGroup', () => {
    it('should return correct group for known tools', () => {
        expect(getToolGroup('create_entry')).toBe('core')
        expect(getToolGroup('search_entries')).toBe('search')
        expect(getToolGroup('backup_journal')).toBe('backup')
    })

    it('should return undefined for unknown tools', () => {
        expect(getToolGroup('nonexistent_tool')).toBeUndefined()
    })
})

// ============================================================================
// Type guards
// ============================================================================

describe('group validation via getToolGroup', () => {
    it('should identify valid groups from tool lookups', () => {
        expect(getToolGroup('create_entry')).toBe('core')
        expect(getToolGroup('search_entries')).toBe('search')
        expect(getToolGroup('delete_entry')).toBe('admin')
    })

    it('should return undefined for non-tool strings', () => {
        expect(getToolGroup('starter')).toBeUndefined() // meta-group, not a tool
        expect(getToolGroup('nonexistent')).toBeUndefined()
    })
})

// ============================================================================
// parseToolFilter
// ============================================================================

describe('parseToolFilter', () => {
    it('should parse a single group', () => {
        const config = parseToolFilter('core')
        expect(config.enabledTools.has('create_entry')).toBe(true)
        expect(config.enabledTools.has('backup_journal')).toBe(false)
    })

    it('should parse multiple groups', () => {
        const config = parseToolFilter('core,search')
        expect(config.enabledTools.has('create_entry')).toBe(true)
        expect(config.enabledTools.has('search_entries')).toBe(true)
        expect(config.enabledTools.has('backup_journal')).toBe(false)
    })

    it('should parse meta-groups', () => {
        const config = parseToolFilter('starter')
        // starter = core + search
        expect(config.enabledTools.has('create_entry')).toBe(true)
        expect(config.enabledTools.has('search_entries')).toBe(true)
    })

    it('should parse group exclusion', () => {
        const config = parseToolFilter('full,-admin')
        expect(config.enabledTools.has('create_entry')).toBe(true)
        // Admin tools should be excluded
        expect(config.enabledTools.has('delete_entry')).toBe(false)
        expect(config.enabledTools.has('merge_tags')).toBe(false)
    })

    it('should parse tool exclusion', () => {
        const config = parseToolFilter('core,-delete_entry')
        expect(config.enabledTools.has('create_entry')).toBe(true)
        expect(config.enabledTools.has('delete_entry')).toBe(false)
    })

    it('should parse tool addition with +', () => {
        const config = parseToolFilter('core,+semantic_search')
        expect(config.enabledTools.has('create_entry')).toBe(true)
        expect(config.enabledTools.has('semantic_search')).toBe(true)
    })

    it('should store raw filter string', () => {
        const config = parseToolFilter('starter,-delete_entry')
        expect(config.raw).toBe('starter,-delete_entry')
    })
})

// ============================================================================
// isToolEnabled / filterTools
// ============================================================================

describe('isToolEnabled', () => {
    it('should return true for enabled tools', () => {
        const config = parseToolFilter('core')
        expect(isToolEnabled('create_entry', config)).toBe(true)
    })

    it('should return false for disabled tools', () => {
        const config = parseToolFilter('core')
        expect(isToolEnabled('backup_journal', config)).toBe(false)
    })
})

describe('filterTools', () => {
    it('should filter tool objects by name', () => {
        const tools = [
            { name: 'create_entry', other: 'data' },
            { name: 'backup_journal', other: 'data' },
            { name: 'search_entries', other: 'data' },
        ]
        const config = parseToolFilter('core')
        const filtered = filterTools(tools, config)

        expect(filtered.some((t) => t.name === 'create_entry')).toBe(true)
        expect(filtered.some((t) => t.name === 'backup_journal')).toBe(false)
    })
})

// ============================================================================
// getToolFilterFromEnv
// ============================================================================

describe('getToolFilterFromEnv', () => {
    afterEach(() => {
        delete process.env['MEMORY_JOURNAL_MCP_TOOL_FILTER']
    })

    it('should return null when env var not set', () => {
        delete process.env['MEMORY_JOURNAL_MCP_TOOL_FILTER']
        expect(getToolFilterFromEnv()).toBeNull()
    })

    it('should parse env var when set', () => {
        process.env['MEMORY_JOURNAL_MCP_TOOL_FILTER'] = 'starter'
        const config = getToolFilterFromEnv()

        expect(config).not.toBeNull()
        expect(config?.enabledTools.has('create_entry')).toBe(true)
    })
})

// ============================================================================
// calculateTokenSavings
// ============================================================================

describe('calculateTokenSavings', () => {
    it('should calculate correct reduction percentage', () => {
        const result = calculateTokenSavings(38, 10)
        // (38-10)/38 ≈ 73.68%
        expect(result.reduction).toBeGreaterThan(70)
        expect(result.reduction).toBeLessThan(80)
    })

    it('should calculate saved tokens', () => {
        const result = calculateTokenSavings(38, 10, 150)
        // (38-10) * 150 = 4200
        expect(result.savedTokens).toBe(4200)
    })

    it('should return 0 when no tools filtered', () => {
        const result = calculateTokenSavings(38, 38)
        expect(result.reduction).toBe(0)
        expect(result.savedTokens).toBe(0)
    })
})

// ============================================================================
// getFilterSummary
// ============================================================================

describe('getFilterSummary', () => {
    it('should return human-readable summary', () => {
        const config = parseToolFilter('starter')
        const summary = getFilterSummary(config)

        expect(typeof summary).toBe('string')
        expect(summary.length).toBeGreaterThan(0)
    })
})

// ============================================================================
// parseToolFilter edge cases
// ============================================================================

describe('parseToolFilter edge cases', () => {
    it('should handle blacklist-first mode (-admin = all except admin)', () => {
        const config = parseToolFilter('-admin')
        // Should have all tools EXCEPT admin tools
        expect(config.enabledTools.has('create_entry')).toBe(true)
        expect(config.enabledTools.has('search_entries')).toBe(true)
        expect(config.enabledTools.has('backup_journal')).toBe(true)
        // Admin tools should be excluded
        expect(config.enabledTools.has('delete_entry')).toBe(false)
    })

    it('should handle single tool name whitelist', () => {
        const config = parseToolFilter('create_entry')
        expect(config.enabledTools.has('create_entry')).toBe(true)
        expect(config.enabledTools.size).toBe(1)
    })

    it('should handle meta-group in non-first position', () => {
        const config = parseToolFilter('backup,starter')
        // starter = core + search, plus backup group
        expect(config.enabledTools.has('create_entry')).toBe(true)
        expect(config.enabledTools.has('search_entries')).toBe(true)
        expect(config.enabledTools.has('backup_journal')).toBe(true)
    })

    it('should handle combined meta-group with tool exclusion', () => {
        const config = parseToolFilter('starter,-create_entry_minimal')
        expect(config.enabledTools.has('create_entry')).toBe(true)
        expect(config.enabledTools.has('create_entry_minimal')).toBe(false)
    })

    it('should handle multiple exclusions', () => {
        const config = parseToolFilter('full,-admin,-backup,-github')
        expect(config.enabledTools.has('create_entry')).toBe(true)
        expect(config.enabledTools.has('search_entries')).toBe(true)
        // Excluded groups
        expect(config.enabledTools.has('delete_entry')).toBe(false)
        expect(config.enabledTools.has('backup_journal')).toBe(false)
        expect(config.enabledTools.has('get_github_issues')).toBe(false)
    })
})
