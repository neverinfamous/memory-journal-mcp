/**
 * Server Instructions Tests
 *
 * Tests the generateInstructions function at all instruction levels
 * with comprehensive content validation for all tools, resources, and field notes.
 */

import { describe, it, expect } from 'vitest'
import { generateInstructions } from '../../src/constants/ServerInstructions.js'
import { TOOL_GROUPS, getAllToolNames } from '../../src/filtering/ToolFilter.js'

/** Full tool set based on TOOL_GROUPS for realistic testing */
const ALL_TOOLS = new Set(getAllToolNames())

/** Minimal tool set for basic testing */
const TEST_TOOLS = new Set(['create_entry', 'search_entries', 'backup_journal'])

/** Minimal resources for testing */
const TEST_RESOURCES = [{ uri: 'memory://health', name: 'health', description: 'Health check' }]

/** Minimal prompts for testing */
const TEST_PROMPTS = [{ name: 'test-prompt', description: 'A test prompt' }]

/** Helper to generate full-level instructions with all tools */
function fullInstructions(): string {
    return generateInstructions(ALL_TOOLS, TEST_RESOURCES, TEST_PROMPTS, undefined, 'full')
}

describe('generateInstructions', () => {
    describe('essential level', () => {
        it('should return non-empty string', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'essential'
            )
            expect(result.length).toBeGreaterThan(0)
        })

        it('should include core behaviors', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'essential'
            )
            expect(result).toContain('memory://briefing')
            expect(result).toContain('Session Start')
        })

        it('should include Quick Access table', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'essential'
            )
            expect(result).toContain('Quick Access')
            expect(result).toContain('memory://health')
            expect(result).toContain('semantic_search')
            expect(result).toContain('get-context-bundle')
        })

        it('should include all three Behaviors bullets', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'essential'
            )
            expect(result).toContain('Create entries for')
            expect(result).toContain('Search before')
            expect(result).toContain('Link entries')
        })

        it('should not include tool parameter reference', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'essential'
            )
            expect(result).not.toContain('Tool Parameter Reference')
        })

        it('should not include GitHub Integration heading', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'essential'
            )
            expect(result).not.toContain('## GitHub Integration')
        })
    })

    describe('standard level', () => {
        it('should include GitHub instructions', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'standard'
            )
            expect(result).toContain('GitHub')
        })

        it('should include GitHub integration patterns', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'standard'
            )
            expect(result).toContain('issue_number')
            expect(result).toContain('pr_number')
            expect(result).toContain('actions-failure-digest')
            expect(result).toContain('get_kanban_board')
            expect(result).toContain('get_github_milestones')
            expect(result).toContain('memory://github/milestones')
        })

        it('should not include tool parameter reference', () => {
            const result = generateInstructions(
                TEST_TOOLS,
                TEST_RESOURCES,
                TEST_PROMPTS,
                undefined,
                'standard'
            )
            expect(result).not.toContain('Tool Parameter Reference')
        })
    })

    describe('full level', () => {
        it('should include tool parameter reference', () => {
            const result = fullInstructions()
            expect(result).toContain('Tool Parameter Reference')
        })

        it('should include active tools listing', () => {
            const result = fullInstructions()
            expect(result).toContain('Active Tools')
        })

        it('should include prompts section', () => {
            const result = fullInstructions()
            expect(result).toContain('Prompts')
            expect(result).toContain('test-prompt')
        })

        it('should include key resources section', () => {
            const result = fullInstructions()
            expect(result).toContain('Key Resources')
        })
    })

    describe('full level — entry operations tools', () => {
        it('should list all 7 entry operation tools', () => {
            const result = fullInstructions()
            expect(result).toContain('create_entry')
            expect(result).toContain('create_entry_minimal')
            expect(result).toContain('get_entry_by_id')
            expect(result).toContain('get_recent_entries')
            expect(result).toContain('update_entry')
            expect(result).toContain('delete_entry')
            expect(result).toContain('list_tags')
        })

        it('should document correct get_recent_entries default limit of 5', () => {
            const result = fullInstructions()
            expect(result).toContain('`limit` (default 5)')
        })

        it('should document get_entry_by_id include_relationships param', () => {
            const result = fullInstructions()
            expect(result).toContain('include_relationships')
        })

        it('should document create_entry GitHub linking params', () => {
            const result = fullInstructions()
            expect(result).toContain('issue_number')
            expect(result).toContain('pr_number')
            expect(result).toContain('project_number')
            expect(result).toContain('significance_type')
        })
    })

    describe('full level — search tools', () => {
        it('should list all 4 search tools', () => {
            const result = fullInstructions()
            expect(result).toContain('search_entries')
            expect(result).toContain('search_by_date_range')
            expect(result).toContain('semantic_search')
            expect(result).toContain('get_vector_index_stats')
        })

        it('should document correct similarity_threshold default of 0.25', () => {
            const result = fullInstructions()
            expect(result).toContain('similarity_threshold` (default 0.25)')
        })

        it('should document search_entries filter params', () => {
            const result = fullInstructions()
            // search_entries has optional query and filter params
            expect(result).toContain('workflow_run_id')
        })

        it('should document hint_on_empty param for semantic_search', () => {
            const result = fullInstructions()
            expect(result).toContain('hint_on_empty')
        })
    })

    describe('full level — relationship tools', () => {
        it('should list both relationship tools', () => {
            const result = fullInstructions()
            expect(result).toContain('link_entries')
            expect(result).toContain('visualize_relationships')
        })

        it('should list all 8 relationship types including causal', () => {
            const result = fullInstructions()
            expect(result).toContain('evolves_from')
            expect(result).toContain('references')
            expect(result).toContain('implements')
            expect(result).toContain('clarifies')
            expect(result).toContain('response_to')
            expect(result).toContain('blocked_by')
            expect(result).toContain('resolved')
            expect(result).toContain('caused')
        })

        it('should document visualize_relationships optional params', () => {
            const result = fullInstructions()
            // visualize_relationships has all optional params
            expect(result).toContain('`tags` (array)')
            expect(result).toContain('`depth` (1-3, default 2)')
            expect(result).toContain('`limit` (default 20)')
        })
    })

    describe('full level — github tools', () => {
        it('should list all 5 GitHub read tools', () => {
            const result = fullInstructions()
            expect(result).toContain('get_github_context')
            expect(result).toContain('get_github_issues')
            expect(result).toContain('get_github_prs')
            expect(result).toContain('get_github_issue')
            expect(result).toContain('get_github_pr')
        })

        it('should document get_repo_insights tool', () => {
            const result = fullInstructions()
            expect(result).toContain('get_repo_insights')
            expect(result).toContain('stars/traffic/referrers/paths/all')
        })

        it('should document owner/repo auto-detection', () => {
            const result = fullInstructions()
            expect(result).toContain('detectedOwner')
            expect(result).toContain('detectedRepo')
        })
    })

    describe('full level — issue lifecycle tools', () => {
        it('should include Issue Lifecycle Tools section', () => {
            const result = fullInstructions()
            expect(result).toContain('Issue Lifecycle Tools')
        })

        it('should document create_github_issue_with_entry', () => {
            const result = fullInstructions()
            expect(result).toContain('create_github_issue_with_entry')
            expect(result).toContain('milestone_number')
            expect(result).toContain('initial_status')
        })

        it('should document close_github_issue_with_entry', () => {
            const result = fullInstructions()
            expect(result).toContain('close_github_issue_with_entry')
            expect(result).toContain('move_to_done')
            expect(result).toContain('resolution_notes')
        })
    })

    describe('full level — kanban tools', () => {
        it('should list both kanban tools', () => {
            const result = fullInstructions()
            expect(result).toContain('get_kanban_board')
            expect(result).toContain('move_kanban_item')
        })

        it('should document kanban resources', () => {
            const result = fullInstructions()
            expect(result).toContain('memory://kanban/{project_number}')
        })

        it('should document default status columns', () => {
            const result = fullInstructions()
            expect(result).toContain('Backlog')
            expect(result).toContain('In progress')
            expect(result).toContain('Done')
        })
    })

    describe('full level — milestone tools', () => {
        it('should list all 5 milestone tools', () => {
            const result = fullInstructions()
            expect(result).toContain('get_github_milestones')
            expect(result).toContain('get_github_milestone')
            expect(result).toContain('create_github_milestone')
            expect(result).toContain('update_github_milestone')
            expect(result).toContain('delete_github_milestone')
        })

        it('should document milestone resources', () => {
            const result = fullInstructions()
            expect(result).toContain('memory://github/milestones')
            expect(result).toContain('memory://milestones/{number}')
        })
    })

    describe('full level — admin tools', () => {
        it('should list all admin tools with correct param names', () => {
            const result = fullInstructions()
            expect(result).toContain('backup_journal')
            expect(result).toContain('list_backups')
            expect(result).toContain('cleanup_backups')
            expect(result).toContain('restore_backup')
            expect(result).toContain('add_to_vector_index')
            expect(result).toContain('rebuild_vector_index')
        })

        it('should use correct param name for backup_journal (name, not backup_name)', () => {
            const result = fullInstructions()
            expect(result).toContain('`name` (custom backup name)')
        })

        it('should use correct param name for restore_backup (filename, not backup_filename)', () => {
            const result = fullInstructions()
            expect(result).toContain('`filename`, `confirm: true`')
        })

        it('should document cleanup_backups keep_count param', () => {
            const result = fullInstructions()
            expect(result).toContain('keep_count')
        })
    })

    describe('full level — export tools', () => {
        it('should document export_entries with all optional params', () => {
            const result = fullInstructions()
            expect(result).toContain('export_entries')
            expect(result).toContain('entry_types')
        })
    })

    describe('full level — entry types', () => {
        it('should list all 7 entry types', () => {
            const result = fullInstructions()
            expect(result).toContain('personal_reflection')
            expect(result).toContain('technical_note')
            expect(result).toContain('bug_fix')
            expect(result).toContain('progress_update')
            expect(result).toContain('code_review')
            expect(result).toContain('deployment')
            expect(result).toContain('technical_achievement')
        })
    })

    describe('full level — field notes', () => {
        it('should include autoContext field note', () => {
            const result = fullInstructions()
            expect(result).toContain('autoContext')
        })

        it('should include memory://tags vs list_tags note', () => {
            const result = fullInstructions()
            expect(result).toContain('memory://tags` vs `list_tags')
        })

        it('should include tag naming guidance', () => {
            const result = fullInstructions()
            expect(result).toContain('Tag naming')
            expect(result).toContain('merge_tags')
        })

        it('should include prStatus field note', () => {
            const result = fullInstructions()
            expect(result).toContain('prStatus')
        })

        it('should include restore_backup behavior note', () => {
            const result = fullInstructions()
            expect(result).toContain('restore_backup` behavior')
        })

        it('should include semantic search thresholds note with correct default', () => {
            const result = fullInstructions()
            expect(result).toContain('Default similarity threshold is 0.25')
        })

        it('should include causal relationship types note', () => {
            const result = fullInstructions()
            expect(result).toContain('Causal relationship types')
        })

        it('should include enhanced analytics note', () => {
            const result = fullInstructions()
            expect(result).toContain('decisionDensity')
            expect(result).toContain('relationshipComplexity')
            expect(result).toContain('activityTrend')
            expect(result).toContain('causalMetrics')
        })

        it('should include importance scores note with importanceBreakdown', () => {
            const result = fullInstructions()
            expect(result).toContain('importanceBreakdown')
            expect(result).toContain('significance (30%)')
            expect(result).toContain('relationships (35%)')
        })

        it('should include inactiveThresholdDays note', () => {
            const result = fullInstructions()
            expect(result).toContain('inactiveThresholdDays')
        })

        it('should include GitHub metadata in entries note', () => {
            const result = fullInstructions()
            expect(result).toContain('GitHub metadata in entries')
            expect(result).toContain('issueNumber')
            expect(result).toContain('workflowRunId')
        })

        it('should include delete_entry soft-deleted note', () => {
            const result = fullInstructions()
            expect(result).toContain('delete_entry` on soft-deleted')
        })
    })

    describe('full level — key resources table', () => {
        const EXPECTED_RESOURCE_URIS = [
            'memory://health',
            'memory://briefing',
            'memory://instructions',
            'memory://statistics',
            'memory://recent',
            'memory://tags',
            'memory://significant',
            'memory://graph/recent',
            'memory://graph/actions',
            'memory://actions/recent',
            'memory://team/recent',
            'memory://github/status',
            'memory://github/milestones',
            'memory://github/insights',
            'memory://kanban/{n}',
            'memory://kanban/{n}/diagram',
            'memory://milestones/{n}',
        ]

        it.each(EXPECTED_RESOURCE_URIS)('should include resource URI %s', (uri) => {
            const result = fullInstructions()
            expect(result).toContain(uri)
        })
    })

    describe('tool count consistency', () => {
        it('should have 39 tools across all groups', () => {
            const allToolNames = getAllToolNames()
            expect(allToolNames.length).toBe(39)
        })

        it('should show correct active tool count for all tools', () => {
            const result = fullInstructions()
            expect(result).toContain(`Active Tools (${String(ALL_TOOLS.size)})`)
        })

        it('should list all 8 tool groups in active tools', () => {
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
                TEST_RESOURCES,
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
                TEST_RESOURCES,
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
            const result = generateInstructions(TEST_TOOLS, TEST_RESOURCES, TEST_PROMPTS)
            // Standard includes GitHub but not tool parameter reference
            expect(result).toContain('GitHub')
            expect(result).not.toContain('Tool Parameter Reference')
        })
    })
})
