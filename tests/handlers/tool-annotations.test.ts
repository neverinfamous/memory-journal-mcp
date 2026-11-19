/**
 * Tool Annotations Invariant Test
 *
 * Structural enforcement: verifies every registered tool has complete MCP
 * behavioral annotations (`readOnlyHint`, `openWorldHint`, `destructiveHint`,
 * `idempotentHint`), non-empty title, contradiction-free hints, and exact
 * allowlist parity for canonical `TOOL_GROUPS` tools.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTools } from '../../src/handlers/tools/index.js'
import { getAllToolNames } from '../../src/filtering/tool-filter.js'
import { DatabaseAdapterFactory } from '../../src/database/adapter-factory.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'
import type { ToolRegistration } from '../../src/types/index.js'

const OPEN_WORLD_ALLOWLIST = [
    'add_kanban_item',
    'close_github_issue_with_entry',
    'create_github_issue_with_entry',
    'create_github_milestone',
    'delete_github_milestone',
    'delete_kanban_item',
    'export_markdown',
    'get_copilot_reviews',
    'get_github_context',
    'get_github_issue',
    'get_github_issues',
    'get_github_milestone',
    'get_github_milestones',
    'get_github_pr',
    'get_github_prs',
    'get_kanban_board',
    'get_repo_insights',
    'import_external',
    'import_markdown',
    'mj_execute_code',
    'move_kanban_item',
    'team_export_markdown',
    'team_import_external',
    'team_import_markdown',
    'update_github_milestone',
]

const DESTRUCTIVE_ALLOWLIST = [
    'batch_delete_entries',
    'cleanup_backups',
    'delete_entry',
    'delete_github_milestone',
    'delete_project',
    'merge_tags',
    'restore_backup',
    'run_auto_prune',
    'team_batch_delete_entries',
    'team_consolidate_authors',
    'team_delete_entry',
    'team_merge_tags',
    'team_remove_author_alias',
    'team_remove_member',
]

const READ_ONLY_ALLOWLIST = [
    'analyze_commit_patterns',
    'cross_team_search',
    'export_entries',
    'get_commit_history',
    'get_copilot_reviews',
    'get_cross_project_insights',
    'get_entry_by_id',
    'get_entry_history',
    'get_github_context',
    'get_github_issue',
    'get_github_issues',
    'get_github_milestone',
    'get_github_milestones',
    'get_github_pr',
    'get_github_prs',
    'get_kanban_board',
    'get_project',
    'get_recent_entries',
    'get_release_info',
    'get_repo_insights',
    'get_statistics',
    'get_unreleased_commits',
    'get_vector_index_stats',
    'list_backups',
    'list_deleted_entries',
    'list_projects',
    'list_tags',
    'search_audit_log',
    'search_by_date_range',
    'search_commits',
    'search_entries',
    'semantic_search',
    'team_export_entries',
    'team_get_collaboration_matrix',
    'team_get_cross_project_insights',
    'team_get_entry_by_id',
    'team_get_member',
    'team_get_recent',
    'team_get_statistics',
    'team_get_vector_index_stats',
    'team_list_author_aliases',
    'team_list_backups',
    'team_list_deleted_entries',
    'team_list_members',
    'team_list_tags',
    'team_resolve_author',
    'team_search',
    'team_search_by_date_range',
    'team_semantic_search',
    'team_visualize_relationships',
    'test_error_handling',
    'test_simple',
    'trigger_progress',
    'visualize_relationships',
]

describe('Tool Annotations Invariant', () => {
    let db: IDatabaseAdapter
    let tools: ToolRegistration[]
    let canonicalTools: ToolRegistration[]
    let prevDbKey: string | undefined
    let prevMjKey: string | undefined

    beforeAll(async () => {
        prevDbKey = process.env['DB_ENCRYPTION_KEY']
        prevMjKey = process.env['MJ_DB_ENCRYPTION_KEY']
        process.env['DB_ENCRYPTION_KEY'] = ''
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''

        db = await DatabaseAdapterFactory.create(':memory:')
        await db.initialize()
        tools = getTools(db, null)
        const canonicalSet = new Set(getAllToolNames())
        canonicalTools = tools.filter((t) => canonicalSet.has(t.name))
    })

    afterAll(() => {
        db.close()
        if (prevDbKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = prevDbKey
        else delete process.env['DB_ENCRYPTION_KEY']
        if (prevMjKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = prevMjKey
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
    })

    it('canonical tool inventory contains 108 tools', () => {
        expect(canonicalTools).toHaveLength(108)
    })

    it('every registered tool has annotations, readOnlyHint, openWorldHint, unique name, and title', () => {
        const names = tools.map((t) => t.name)
        expect(new Set(names).size).toBe(names.length)

        for (const tool of tools) {
            expect(tool.name.length).toBeGreaterThan(0)
            expect(tool.name.length).toBeLessThanOrEqual(128)
            expect(tool.annotations, `Tool "${tool.name}" is missing annotations`).toBeDefined()
            expect(
                typeof tool.annotations?.readOnlyHint,
                `Tool "${tool.name}" is missing readOnlyHint`
            ).toBe('boolean')
            expect(
                typeof tool.annotations?.openWorldHint,
                `Tool "${tool.name}" is missing openWorldHint`
            ).toBe('boolean')
            expect(
                typeof tool.title === 'string' && tool.title.length > 0,
                `Tool "${tool.name}" is missing non-empty title`
            ).toBe(true)
        }
    })

    it('0 tools have readOnlyHint=true and destructiveHint=true contradictions', () => {
        const contradictions = tools.filter(
            (t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === true
        )
        expect(contradictions.map((t) => t.name)).toEqual([])
    })

    it('every canonical tool has explicit destructiveHint and idempotentHint', () => {
        for (const tool of canonicalTools) {
            expect(
                typeof tool.annotations?.destructiveHint,
                `Canonical tool "${tool.name}" missing destructiveHint`
            ).toBe('boolean')
            expect(
                typeof tool.annotations?.idempotentHint,
                `Canonical tool "${tool.name}" missing idempotentHint`
            ).toBe('boolean')
        }
    })

    it('every read-only canonical tool has idempotentHint=true', () => {
        const nonIdempotent = canonicalTools.filter(
            (t) => t.annotations?.readOnlyHint === true && t.annotations?.idempotentHint !== true
        )
        expect(nonIdempotent.map((t) => t.name)).toEqual([])
    })

    it('openWorldHint=true, destructiveHint=true, and readOnlyHint=true match canonical allowlists', () => {
        const openWorld = canonicalTools
            .filter((t) => t.annotations?.openWorldHint === true)
            .map((t) => t.name)
            .sort()
        const destructive = canonicalTools
            .filter((t) => t.annotations?.destructiveHint === true)
            .map((t) => t.name)
            .sort()
        const readOnly = canonicalTools
            .filter((t) => t.annotations?.readOnlyHint === true)
            .map((t) => t.name)
            .sort()

        expect(openWorld).toEqual([...OPEN_WORLD_ALLOWLIST].sort())
        expect(destructive).toEqual([...DESTRUCTIVE_ALLOWLIST].sort())
        expect(readOnly).toEqual([...READ_ONLY_ALLOWLIST].sort())
    })
})
