/**
 * Server Instructions Tests
 *
 * Tests the generateInstructions function at all instruction levels
 * with comprehensive content validation for behavioral guidance,
 * help pointers, filter-aware section inclusion, and GOTCHAS_CONTENT export.
 *
 * Tool parameter reference tables are served dynamically via memory://help/{group}
 * and tested in the help resource tests, not here.
 */

import { describe, it, expect } from 'vitest'
import { generateInstructions, GOTCHAS_CONTENT } from '../../src/constants/server-instructions.js'
import { TOOL_GROUPS, getAllToolNames, getEnabledGroups } from '../../src/filtering/tool-filter.js'
import type { ToolGroup } from '../../src/types/index.js'

/** Full tool set based on TOOL_GROUPS for realistic testing */
const ALL_TOOLS = new Set(getAllToolNames())

/** All groups enabled */
const ALL_GROUPS = new Set(Object.keys(TOOL_GROUPS) as ToolGroup[])

/** Minimal tool set for basic testing */
const TEST_TOOLS = new Set(['create_entry', 'search_entries', 'backup_journal'])

/** Minimal prompts for testing */
const TEST_PROMPTS = [{ name: 'test-prompt', description: 'A test prompt' }]

/** Helper to generate full-level instructions with all tools */
function fullInstructions(): string {
    return generateInstructions(ALL_TOOLS, TEST_PROMPTS, undefined, 'full', ALL_GROUPS)
}

/** Helper to build a tool set from specific groups */
function toolsFromGroups(...groups: ToolGroup[]): Set<string> {
    const tools = new Set<string>()
    for (const group of groups) {
        for (const tool of TOOL_GROUPS[group]) {
            tools.add(tool)
        }
    }
    return tools
}

describe('generateInstructions', () => {
    describe('essential level', () => {
        it('should return non-empty string', () => {
            const result = generateInstructions(TEST_TOOLS, TEST_PROMPTS, undefined, 'essential')
            expect(result.length).toBeGreaterThan(0)
        })

        it('should include core behaviors', () => {
            const result = generateInstructions(TEST_TOOLS, TEST_PROMPTS, undefined, 'essential')
            expect(result).toContain('memory://briefing')
            expect(result).toContain('Session Start')
        })

        it('should include Quick Access table', () => {
            const result = generateInstructions(
                ALL_TOOLS,
                TEST_PROMPTS,
                undefined,
                'essential',
                ALL_GROUPS
            )
            expect(result).toContain('Quick Access')
            expect(result).toContain('memory://health')
            expect(result).toContain('semantic_search')
            expect(result).toContain('get-context-bundle')
        })

        it('should include all three Behaviors bullets', () => {
            const result = generateInstructions(TEST_TOOLS, TEST_PROMPTS, undefined, 'essential')
            expect(result).toContain('Create entries for')
            expect(result).toContain('Search before')
            expect(result).toContain('Link entries')
        })

        it('should not include GitHub Integration heading', () => {
            const result = generateInstructions(TEST_TOOLS, TEST_PROMPTS, undefined, 'essential')
            expect(result).not.toContain('## GitHub Integration')
        })

        it('should not include help pointers', () => {
            const result = generateInstructions(TEST_TOOLS, TEST_PROMPTS, undefined, 'essential')
            expect(result).not.toContain('## Help Resources')
        })

        it('should not include Session End section (replaced by session-summary prompt)', () => {
            const result = generateInstructions(TEST_TOOLS, TEST_PROMPTS, undefined, 'essential')
            expect(result).not.toContain('Session End')
        })

        it('should include Rule & Skill Suggestions section', () => {
            const result = generateInstructions(TEST_TOOLS, TEST_PROMPTS, undefined, 'essential')
            expect(result).toContain('Rule & Skill Suggestions')
            expect(result).toContain('Always ask the user first')
        })

        it('should include Code Mode section when codemode group is enabled', () => {
            const tools = toolsFromGroups('core', 'codemode')
            const groups = getEnabledGroups(tools)
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'essential', groups)
            expect(result).toContain('Code Mode')
            expect(result).toContain('mj_execute_code')
            expect(result).toContain('mj.core')
            expect(result).toContain('mj.help()')
        })

        it('should include Copilot Review Patterns when github group is enabled', () => {
            const tools = toolsFromGroups('core', 'github')
            const groups = getEnabledGroups(tools)
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'essential', groups)
            expect(result).toContain('Copilot Review Patterns')
            expect(result).toContain('get_copilot_reviews')
        })
    })

    describe('standard level', () => {
        it('should include GitHub instructions when github group is enabled', () => {
            const tools = toolsFromGroups('core', 'github')
            const groups = getEnabledGroups(tools)
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'standard', groups)
            expect(result).toContain('## GitHub Integration')
        })

        it('should include GitHub integration patterns', () => {
            const tools = toolsFromGroups('core', 'github')
            const groups = getEnabledGroups(tools)
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'standard', groups)
            expect(result).toContain('issue_number')
            expect(result).toContain('pr_number')
            expect(result).toContain('actions-failure-digest')
            expect(result).toContain('get_kanban_board')
            expect(result).toContain('get_github_milestones')
            expect(result).toContain('memory://github/milestones')
        })

        it('should include help resource pointers', () => {
            const result = generateInstructions(TEST_TOOLS, TEST_PROMPTS, undefined, 'standard')
            expect(result).toContain('## Help Resources')
            expect(result).toContain('memory://help')
            expect(result).toContain('memory://help/{group}')
            expect(result).toContain('memory://help/gotchas')
        })

        it('should not include server access instructions', () => {
            const result = generateInstructions(TEST_TOOLS, TEST_PROMPTS, undefined, 'standard')
            expect(result).not.toContain('How to Access This Server')
        })
    })

    describe('full level', () => {
        it('should include active tools listing', () => {
            const result = fullInstructions()
            expect(result).toContain('Active Tools')
        })

        it('should include prompts section', () => {
            const result = fullInstructions()
            expect(result).toContain('Prompts')
            expect(result).toContain('test-prompt')
        })

        it('should include server access instructions', () => {
            const result = fullInstructions()
            expect(result).toContain('How to Access This Server')
            expect(result).toContain('Server Name Discovery')
        })

        it('should include help resource pointers (inherited from standard)', () => {
            const result = fullInstructions()
            expect(result).toContain('memory://help')
            expect(result).toContain('memory://help/{group}')
            expect(result).toContain('memory://help/gotchas')
        })

        it('should NOT include tool parameter tables (served via memory://help/{group})', () => {
            const result = fullInstructions()
            expect(result).not.toContain('Tool Parameter Reference')
            expect(result).not.toContain('Entry Operations')
        })

        it('should NOT include field notes (served via memory://help/gotchas)', () => {
            const result = fullInstructions()
            expect(result).not.toContain('Field Notes')
            expect(result).not.toContain('autoContext')
        })

        it('should NOT include key resources table (served via memory://help)', () => {
            const result = fullInstructions()
            expect(result).not.toContain('Key Resources')
        })
    })

    describe('tool count consistency', () => {
        it('should have no duplicate tool names across groups', () => {
            const allToolNames = getAllToolNames()
            const unique = new Set(allToolNames)
            expect(unique.size).toBe(allToolNames.length)
        })

        it('should match the sum of all group lengths', () => {
            const allToolNames = getAllToolNames()
            const groupSum = Object.values(TOOL_GROUPS).reduce(
                (sum, tools) => sum + tools.length,
                0
            )
            expect(allToolNames.length).toBe(groupSum)
        })

        it('should show correct active tool count for all tools', () => {
            const result = fullInstructions()
            expect(result).toContain(`Active Tools (${String(ALL_TOOLS.size)})`)
        })

        it('should list all 10 tool groups in active tools', () => {
            const result = fullInstructions()
            const groups = Object.keys(TOOL_GROUPS)
            for (const group of groups) {
                expect(result).toContain(`**${group}**`)
            }
        })
    })

    describe('latest entry snapshot', () => {
        it('should include latest entry when provided', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_PROMPTS,
                {
                    id: 42,
                    timestamp: '2026-02-27',
                    entryType: 'decision',
                    content: 'Important decision about architecture',
                },
                'essential'
            )
            expect(result).toContain('#42')
            expect(result).toContain('decision')
            expect(result).toContain('Important decision')
        })

        it('should truncate long content with ellipsis', () => {
            const longContent = 'A'.repeat(200)
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_PROMPTS,
                {
                    id: 1,
                    timestamp: '2026-02-27',
                    entryType: 'note',
                    content: longContent,
                },
                'essential'
            )
            expect(result).toContain('...')
        })
    })

    describe('default level', () => {
        it('should default to standard level', () => {
            const result = generateInstructions(toolsFromGroups('core', 'github'), TEST_PROMPTS)
            // Standard includes GitHub and help pointers
            expect(result).toContain('## GitHub Integration')
            expect(result).toContain('## Help Resources')
            // Standard does NOT include server access
            expect(result).not.toContain('How to Access This Server')
        })
    })

    describe('level ordering', () => {
        it('essential < standard < full in character count', () => {
            const essential = generateInstructions(
                ALL_TOOLS,
                TEST_PROMPTS,
                undefined,
                'essential',
                ALL_GROUPS
            )
            const standard = generateInstructions(
                ALL_TOOLS,
                TEST_PROMPTS,
                undefined,
                'standard',
                ALL_GROUPS
            )
            const full = generateInstructions(
                ALL_TOOLS,
                TEST_PROMPTS,
                undefined,
                'full',
                ALL_GROUPS
            )
            expect(essential.length).toBeLessThan(standard.length)
            expect(standard.length).toBeLessThan(full.length)
        })
    })

    // =========================================================================
    // Filter-Aware Section Inclusion
    // =========================================================================

    describe('filter-aware sections', () => {
        it('should omit Code Mode section when codemode group is not enabled', () => {
            const tools = toolsFromGroups('core', 'search')
            const groups = getEnabledGroups(tools)
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'essential', groups)
            expect(result).not.toContain('## Code Mode')
            expect(result).not.toContain('mj_execute_code')
            expect(result).not.toContain('mj.core')
        })

        it('should omit Copilot Review section when github group is not enabled', () => {
            const tools = toolsFromGroups('core', 'search', 'codemode')
            const groups = getEnabledGroups(tools)
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'essential', groups)
            expect(result).not.toContain('Copilot Review Patterns')
            expect(result).not.toContain('get_copilot_reviews')
        })

        it('should omit GitHub Integration section when github group is not enabled (standard level)', () => {
            const tools = toolsFromGroups('core', 'search')
            const groups = getEnabledGroups(tools)
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'standard', groups)
            expect(result).not.toContain('## GitHub Integration')
            // Help pointers are always included at standard+
            expect(result).toContain('## Help Resources')
        })

        it('should omit semantic_search from Quick Access without search group', () => {
            const tools = toolsFromGroups('core')
            const groups = getEnabledGroups(tools)
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'essential', groups)
            expect(result).toContain('Quick Access')
            expect(result).not.toContain('semantic_search')
            // Other rows should still be present
            expect(result).toContain('memory://briefing')
            expect(result).toContain('memory://health')
            expect(result).toContain('get-context-bundle')
        })

        it('Code Mode namespace table only shows enabled groups', () => {
            const tools = toolsFromGroups('core', 'search', 'codemode')
            const groups = getEnabledGroups(tools)
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'essential', groups)
            // Should include enabled groups
            expect(result).toContain('mj.core')
            expect(result).toContain('mj.search')
            // Should NOT include disabled groups
            expect(result).not.toContain('mj.github')
            expect(result).not.toContain('mj.team')
            expect(result).not.toContain('mj.admin')
            expect(result).not.toContain('mj.backup')
        })

        it('starter shortcut includes Code Mode but not Copilot', () => {
            // starter = core + search, plus codemode auto-included
            const tools = toolsFromGroups('core', 'search', 'codemode')
            const groups = getEnabledGroups(tools)
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'essential', groups)
            expect(result).toContain('## Code Mode')
            expect(result).not.toContain('Copilot Review Patterns')
        })

        it('essential shortcut includes Code Mode but not Copilot', () => {
            // essential = core, plus codemode auto-included
            const tools = toolsFromGroups('core', 'codemode')
            const groups = getEnabledGroups(tools)
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'essential', groups)
            expect(result).toContain('## Code Mode')
            expect(result).not.toContain('Copilot Review Patterns')
        })

        it('codemode-only filter includes Code Mode, omits GitHub/Copilot', () => {
            const tools = toolsFromGroups('codemode')
            const groups = getEnabledGroups(tools)
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'standard', groups)
            expect(result).toContain('## Code Mode')
            expect(result).not.toContain('Copilot Review Patterns')
            expect(result).not.toContain('## GitHub Integration')
            // Help resources always included at standard+
            expect(result).toContain('## Help Resources')
        })

        it('backward compat: no enabledGroups derives from enabledTools', () => {
            // When enabledGroups is omitted, it should derive from enabledTools
            const tools = toolsFromGroups('core', 'codemode')
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'essential')
            // Should include Code Mode because codemode group is in enabledTools
            expect(result).toContain('## Code Mode')
            // Should NOT include Copilot because github group is not in enabledTools
            expect(result).not.toContain('Copilot Review Patterns')
        })

        it('filter-aware instructions are smaller than full instructions', () => {
            const fullResult = generateInstructions(
                ALL_TOOLS,
                TEST_PROMPTS,
                undefined,
                'essential',
                ALL_GROUPS
            )
            const coreOnly = generateInstructions(
                toolsFromGroups('core'),
                TEST_PROMPTS,
                undefined,
                'essential',
                getEnabledGroups(toolsFromGroups('core'))
            )
            expect(coreOnly.length).toBeLessThan(fullResult.length)
        })
    })
})

describe('getEnabledGroups', () => {
    it('should return all groups for all tools', () => {
        const groups = getEnabledGroups(ALL_TOOLS)
        expect(groups.size).toBe(Object.keys(TOOL_GROUPS).length)
    })

    it('should return correct groups for starter tools', () => {
        const tools = toolsFromGroups('core', 'search', 'codemode')
        const groups = getEnabledGroups(tools)
        expect(groups.has('core')).toBe(true)
        expect(groups.has('search')).toBe(true)
        expect(groups.has('codemode')).toBe(true)
        expect(groups.has('github')).toBe(false)
        expect(groups.has('team')).toBe(false)
    })

    it('should return empty set for empty tool set', () => {
        const groups = getEnabledGroups(new Set())
        expect(groups.size).toBe(0)
    })

    it('should detect group from single tool', () => {
        const groups = getEnabledGroups(new Set(['mj_execute_code']))
        expect(groups.has('codemode')).toBe(true)
        expect(groups.size).toBe(1)
    })
})

describe('GOTCHAS_CONTENT', () => {
    it('should be a non-empty string export', () => {
        expect(typeof GOTCHAS_CONTENT).toBe('string')
        expect(GOTCHAS_CONTENT.length).toBeGreaterThan(0)
    })

    it('should include critical patterns section', () => {
        expect(GOTCHAS_CONTENT).toContain('Critical Patterns')
    })

    it('should include autoContext field note', () => {
        expect(GOTCHAS_CONTENT).toContain('autoContext')
    })

    it('should include memory://tags vs list_tags note', () => {
        expect(GOTCHAS_CONTENT).toContain('memory://tags')
        expect(GOTCHAS_CONTENT).toContain('list_tags')
    })

    it('should include tag naming guidance', () => {
        expect(GOTCHAS_CONTENT).toContain('Tag naming')
        expect(GOTCHAS_CONTENT).toContain('merge_tags')
    })

    it('should include prStatus field note', () => {
        expect(GOTCHAS_CONTENT).toContain('prStatus')
    })

    it('should include restore_backup behavior note', () => {
        expect(GOTCHAS_CONTENT).toContain('restore_backup')
    })

    it('should include semantic search thresholds note', () => {
        expect(GOTCHAS_CONTENT).toContain('Default similarity threshold is 0.25')
    })

    it('should include causal relationship types note', () => {
        expect(GOTCHAS_CONTENT).toContain('Causal relationship types')
        expect(GOTCHAS_CONTENT).toContain('blocked_by')
        expect(GOTCHAS_CONTENT).toContain('resolved')
        expect(GOTCHAS_CONTENT).toContain('caused')
    })

    it('should include enhanced analytics note', () => {
        expect(GOTCHAS_CONTENT).toContain('decisionDensity')
        expect(GOTCHAS_CONTENT).toContain('relationshipComplexity')
        expect(GOTCHAS_CONTENT).toContain('activityTrend')
        expect(GOTCHAS_CONTENT).toContain('causalMetrics')
    })

    it('should include importance scores note', () => {
        expect(GOTCHAS_CONTENT).toContain('importanceBreakdown')
        expect(GOTCHAS_CONTENT).toContain('significance (30%)')
        expect(GOTCHAS_CONTENT).toContain('relationships (35%)')
    })

    it('should include inactiveThresholdDays note', () => {
        expect(GOTCHAS_CONTENT).toContain('inactiveThresholdDays')
    })

    it('should include GitHub metadata note', () => {
        expect(GOTCHAS_CONTENT).toContain('GitHub metadata in entries')
        expect(GOTCHAS_CONTENT).toContain('issueNumber')
        expect(GOTCHAS_CONTENT).toContain('workflowRunId')
    })

    it('should include delete_entry soft-deleted note', () => {
        expect(GOTCHAS_CONTENT).toContain('delete_entry')
        expect(GOTCHAS_CONTENT).toContain('soft-deleted')
    })

    it('should include team cross-database search note', () => {
        expect(GOTCHAS_CONTENT).toContain('Team cross-database search')
        expect(GOTCHAS_CONTENT).toContain('source')
    })

    it('should include team tools without TEAM_DB_PATH note', () => {
        expect(GOTCHAS_CONTENT).toContain('TEAM_DB_PATH')
        expect(GOTCHAS_CONTENT).toContain(`${TOOL_GROUPS.team.length} team tools`)
    })
})
