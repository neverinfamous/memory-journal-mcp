/**
 * Server Instructions Tests
 *
 * Tests the generateInstructions function at all instruction levels
 * with comprehensive content validation for behavioral guidance,
 * help pointers, filter-aware section inclusion, and HELP_CONTENT export.
 *
 * Tool parameter reference tables are served dynamically via memory://help/{group}
 * and tested in the help resource tests, not here.
 */

import { describe, it, expect } from 'vitest'
import { generateInstructions, HELP_CONTENT } from '../../src/constants/server-instructions.js'
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
            expect(result).toContain('Essential Session Start')
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
            expect(result).toContain('get-context-bundle')
        })

        it('should include core Behaviors sections', () => {
            const result = generateInstructions(TEST_TOOLS, TEST_PROMPTS, undefined, 'essential')
            expect(result).toContain('Create entries for')
            expect(result).toContain('Search before')
            expect(result).toContain('### Link Entries')
            expect(result).toContain('### Session Summaries')
            expect(result).toContain('### Entry Type Selection')
            expect(result).toContain('### Tag Taxonomy')
        })

        it('should include help pointer at essential level', () => {
            const result = generateInstructions(TEST_TOOLS, TEST_PROMPTS, undefined, 'essential')
            expect(result).toContain('memory://help')
        })

        it('should not include Session End section (replaced by session-summary prompt)', () => {
            const result = generateInstructions(TEST_TOOLS, TEST_PROMPTS, undefined, 'essential')
            expect(result).not.toContain('Session End')
        })

        it('should include Code Mode section when codemode group is enabled', () => {
            const tools = toolsFromGroups('core', 'codemode')
            const groups = getEnabledGroups(tools)
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'essential', groups)
            expect(result).toContain('Code Mode')
            expect(result).toContain('mj.core')
        })
    })

    describe('standard level', () => {
        it('should include dynamic help pointers for enabled groups', () => {
            const tools = toolsFromGroups('core', 'github')
            const groups = getEnabledGroups(tools)
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'standard', groups)
            expect(result).toContain('Available Help')
            expect(result).toContain('memory://help')
        })

        it('should include help resource pointers', () => {
            const result = generateInstructions(TEST_TOOLS, TEST_PROMPTS, undefined, 'standard')
            expect(result).toContain('memory://help')
        })

        it('should not include active tools listing', () => {
            const result = generateInstructions(TEST_TOOLS, TEST_PROMPTS, undefined, 'standard')
            expect(result).not.toContain('Active Tools')
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

        it('should NOT include field notes (served via memory://help/gotchas)', () => {
            const result = fullInstructions()
            expect(result).not.toContain('Field Notes')
            expect(result).not.toContain('autoContext')
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
            const tools = toolsFromGroups('core', 'github')
            const result = generateInstructions(tools, TEST_PROMPTS)
            // Standard includes help pointers
            expect(result).toContain('memory://help')
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
            expect(result).not.toContain('mj.core')
        })

        it('starter shortcut includes Code Mode but not Copilot', () => {
            // starter = core + search, plus codemode auto-included
            const tools = toolsFromGroups('core', 'search', 'codemode')
            const groups = getEnabledGroups(tools)
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'essential', groups)
            expect(result).toContain('## Code Mode')
        })

        it('essential shortcut includes Code Mode', () => {
            // essential = core, plus codemode auto-included
            const tools = toolsFromGroups('core', 'codemode')
            const groups = getEnabledGroups(tools)
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'essential', groups)
            expect(result).toContain('## Code Mode')
        })

        it('backward compat: no enabledGroups derives from enabledTools', () => {
            // When enabledGroups is omitted, it should derive from enabledTools
            const tools = toolsFromGroups('core', 'codemode')
            const result = generateInstructions(tools, TEST_PROMPTS, undefined, 'essential')
            // Should include Code Mode because codemode group is in enabledTools
            expect(result).toContain('## Code Mode')
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

describe('HELP_CONTENT', () => {
    it('should be a non-empty Map export', () => {
        expect(HELP_CONTENT).toBeInstanceOf(Map)
        expect(HELP_CONTENT.size).toBeGreaterThan(0)
    })

    it('should include gotchas entry', () => {
        const gotchas = HELP_CONTENT.get('gotchas')
        expect(gotchas).toBeDefined()
        expect(gotchas).toContain('Critical Patterns')
    })

    it('should include autoContext field note in gotchas', () => {
        const gotchas = HELP_CONTENT.get('gotchas')!
        expect(gotchas).toContain('autoContext')
    })

    it('should include memory://tags vs list_tags note in gotchas', () => {
        const gotchas = HELP_CONTENT.get('gotchas')!
        expect(gotchas).toContain('memory://tags')
        expect(gotchas).toContain('list_tags')
    })

    it('should include tag naming guidance in gotchas', () => {
        const gotchas = HELP_CONTENT.get('gotchas')!
        expect(gotchas).toContain('Tag naming')
        expect(gotchas).toContain('merge_tags')
    })

    it('should include prStatus field note in gotchas', () => {
        const gotchas = HELP_CONTENT.get('gotchas')!
        expect(gotchas).toContain('prStatus')
    })

    it('should include restore_backup behavior note in gotchas', () => {
        const gotchas = HELP_CONTENT.get('gotchas')!
        expect(gotchas).toContain('restore_backup')
    })

    it('should include semantic search thresholds note in gotchas', () => {
        const gotchas = HELP_CONTENT.get('gotchas')!
        expect(gotchas).toContain('Default similarity threshold is 0.25')
    })

    it('should include causal relationship types note in gotchas', () => {
        const gotchas = HELP_CONTENT.get('gotchas')!
        expect(gotchas).toContain('Causal relationship types')
        expect(gotchas).toContain('blocked_by')
        expect(gotchas).toContain('resolved')
        expect(gotchas).toContain('caused')
    })

    it('should include enhanced analytics note in gotchas', () => {
        const gotchas = HELP_CONTENT.get('gotchas')!
        expect(gotchas).toContain('decisionDensity')
        expect(gotchas).toContain('relationshipComplexity')
        expect(gotchas).toContain('activityTrend')
        expect(gotchas).toContain('causalMetrics')
    })

    it('should include importance scores note in gotchas', () => {
        const gotchas = HELP_CONTENT.get('gotchas')!
        expect(gotchas).toContain('importanceBreakdown')
        expect(gotchas).toContain('significance (30%)')
        expect(gotchas).toContain('relationships (35%)')
    })

    it('should include inactiveThresholdDays note in gotchas', () => {
        const gotchas = HELP_CONTENT.get('gotchas')!
        expect(gotchas).toContain('inactiveThresholdDays')
    })

    it('should include GitHub metadata note in gotchas', () => {
        const gotchas = HELP_CONTENT.get('gotchas')!
        expect(gotchas).toContain('GitHub metadata in entries')
        expect(gotchas).toContain('issueNumber')
        expect(gotchas).toContain('workflowRunId')
    })

    it('should include delete_entry soft-deleted note in gotchas', () => {
        const gotchas = HELP_CONTENT.get('gotchas')!
        expect(gotchas).toContain('delete_entry')
        expect(gotchas).toContain('soft-deleted')
    })

    it('should include team cross-database search note in gotchas', () => {
        const gotchas = HELP_CONTENT.get('gotchas')!
        expect(gotchas).toContain('Team cross-database search')
        expect(gotchas).toContain('source')
    })

    it('should include team tools without TEAM_DB_PATH note in gotchas', () => {
        const gotchas = HELP_CONTENT.get('gotchas')!
        expect(gotchas).toContain('TEAM_DB_PATH')
        expect(gotchas).toContain(`${TOOL_GROUPS.team.length} team tools`)
    })

    it('should include codemode help content', () => {
        const codemode = HELP_CONTENT.get('codemode')
        expect(codemode).toBeDefined()
        expect(codemode).toContain('mj_execute_code')
        expect(codemode).toContain('mj.core')
        expect(codemode).toContain('mj.help()')
    })

    it('should include github help content', () => {
        const github = HELP_CONTENT.get('github')
        expect(github).toBeDefined()
        expect(github).toContain('issue_number')
        expect(github).toContain('pr_number')
        expect(github).toContain('actions-failure-digest')
        expect(github).toContain('get_kanban_board')
        expect(github).toContain('get_github_milestones')
        expect(github).toContain('Copilot Review Patterns')
        expect(github).toContain('get_copilot_reviews')
    })

    it('should include hush-protocol help content', () => {
        const hush = HELP_CONTENT.get('hush-protocol')
        expect(hush).toBeDefined()
        expect(hush).toContain('team_pass_flag')
        expect(hush).toContain('team_resolve_flag')
    })

    it('should include server-access help content', () => {
        const access = HELP_CONTENT.get('server-access')
        expect(access).toBeDefined()
        expect(access).toContain('Server Name Discovery')
        expect(access).toContain('AntiGravity')
        expect(access).toContain('Cursor')
    })

    it('should include skills help content', () => {
        const skills = HELP_CONTENT.get('skills')
        expect(skills).toBeDefined()
        expect(skills).toContain('Rule & Skill Suggestions')
        expect(skills).toContain('neverinfamous-agent-skills')
    })
})
