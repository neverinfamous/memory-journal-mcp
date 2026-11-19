import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { collectNonCodeModeTools } from '../../src/handlers/tools/codemode/singleton-state.js'
import { createJournalApi } from '../../src/codemode/api/journal-api.js'
import { applyArgInterceptions } from '../../src/codemode/param-normalizer.js'
import { CreateEntrySchema, GetRecentEntriesSchema } from '../../src/handlers/tools/core/schemas.js'
import { SearchEntriesSchema } from '../../src/handlers/tools/search/schemas.js'
import { MarkAnchorsStaleSchema } from '../../src/handlers/tools/core/staleness-tools.js'
import { SearchAuditLogSchema } from '../../src/handlers/tools/admin/schemas/project-and-ops-schemas.js'
import { resolveGitWorkingDir } from '../../src/handlers/tools/git-staleness.js'
import { insertAnchors } from '../../src/database/sqlite-adapter/entries/anchors.js'
import { buildApiProxy } from '../../src/codemode/worker-api-proxy.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import type { ToolHandlerConfig } from '../../src/types/index.js'

describe('CMS-04 REM Self-Healing Regressions (agent-issues.jsonl & audit telemetry)', () => {
    let db: DatabaseAdapter
    let config: ToolHandlerConfig

    beforeEach(async () => {
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        config = {
            defaultWorkspaceId: 'memory-journal-mcp',
            projectRegistry: {
                'memory-journal-mcp': {
                    path: process.cwd(),
                    project_number: 5,
                },
            },
            runtime: new ServerRuntime(),
        }
    })

    afterEach(() => {
        db.close()
    })

    it('exposes mark_anchors_stale in Code Mode (mj.core.markAnchorsStale and mj.git.markAnchorsStale) and normalizes status/id aliases', () => {
        const tools = collectNonCodeModeTools({ db, config })
        expect(tools.some((t) => t.name === 'mark_anchors_stale')).toBe(true)

        const api = createJournalApi(tools)
        expect(typeof api.core['markAnchorsStale']).toBe('function')
        expect(typeof api.core['mark_anchors_stale']).toBe('function')
        expect(typeof api.git['markAnchorsStale']).toBe('function')
        expect(typeof api.git['mark_anchors_stale']).toBe('function')

        const parsed = MarkAnchorsStaleSchema.parse({
            anchors: [
                { anchor_id: '12', status: 'active' },
                { id: 15, status: 'deleted' },
            ],
        })
        expect(parsed.updates).toEqual([
            { id: 12, status: 'valid' },
            { id: 15, status: 'invalidated' },
        ])
        // M2: entry_id is a journal entry ID, never aliased to entry_anchors.id
        expect(() =>
            MarkAnchorsStaleSchema.parse({ anchors: [{ entry_id: 14, status: 'outdated' }] })
        ).toThrow()
    })

    it('heals string anchors and status: "active" in CreateEntrySchema and Code Mode interceptions', async () => {
        const parsed = CreateEntrySchema.parse({
            content: '## Summary\nAnchored implementation note.',
            entry_type: 'technical_note',
            workspace_id: 'memory-journal-mcp',
            project_number: 5,
            anchors: [
                'src/utils/inline-script-healer.ts',
                'src/codemode/api/journal-api.ts#JournalApi',
                { anchor_path: 'src/handlers/tools/git-staleness.ts', anchor_type: 'file', status: 'active' },
            ],
        })

        expect(parsed.anchors).toEqual([
            {
                anchor_path: 'src/utils/inline-script-healer.ts',
                anchor_type: 'file',
                status: 'pending',
            },
            {
                anchor_path: 'src/codemode/api/journal-api.ts#JournalApi',
                anchor_type: 'symbol',
                status: 'pending',
            },
            {
                anchor_path: 'src/handlers/tools/git-staleness.ts',
                anchor_type: 'file',
                status: 'valid',
            },
        ])

        const intercept = applyArgInterceptions('createEntry', [
            {
                content: 'Test anchor array normalization',
                workspace_id: 'memory-journal-mcp',
                project_number: 5,
                anchors: ['package.json'],
            },
        ])
        expect('args' in intercept).toBe(true)
        if ('args' in intercept) {
            const first = intercept.args[0] as Record<string, unknown>
            expect(first['anchors']).toEqual([
                { anchor_path: 'package.json', anchor_type: 'file', status: 'pending' },
            ])
        }

        const createRes = (await callTool(
            'create_entry',
            {
                content: 'Entry with string anchors',
                workspace_id: 'memory-journal-mcp',
                project_number: 5,
                anchors: ['package.json'],
            },
            db,
            undefined,
            undefined,
            config
        )) as { success: boolean; id: number }
        expect(createRes.success).toBe(true)
        const storedAnchors = db.getAnchorsByEntryId(createRes.id, 'memory-journal-mcp')
        expect(storedAnchors).toHaveLength(1)
        expect(storedAnchors[0]?.anchorPath).toBe('package.json')
    })

    it('normalizes sort_by aliases ("date", "created_at", "score", "relevance") in search and recent schemas', () => {
        expect(SearchEntriesSchema.parse({ query: 'sqlite', sort_by: 'date' }).sort_by).toBe('timestamp')
        expect(SearchEntriesSchema.parse({ query: 'sqlite', sort_by: 'created_at' }).sort_by).toBe('timestamp')
        expect(SearchEntriesSchema.parse({ query: 'sqlite', sort_by: 'relevance' }).sort_by).toBe('importance')
        expect(GetRecentEntriesSchema.parse({ limit: 5, sort_by: 'date' as 'timestamp' }).sort_by).toBe('timestamp')

        const intercept = applyArgInterceptions('searchEntries', [{ query: 'test', sort_by: 'date_desc' }])
        expect('args' in intercept).toBe(true)
        if ('args' in intercept) {
            const first = intercept.args[0] as Record<string, unknown>
            expect(first['sort_by']).toBe('timestamp')
        }
    })

    it('preserves category and user on search_audit_log and maps tool/success aliases', () => {
        const intercept = applyArgInterceptions('searchAuditLog', [
            { category: 'write', user: 'alice', success: false, tool: 'create_entry', keep: '25' },
        ])
        expect('args' in intercept).toBe(true)
        if ('args' in intercept) {
            const first = intercept.args[0] as Record<string, unknown>
            expect(first['category']).toBe('write')
            expect(first['entry_type']).toBeUndefined()
            expect(first['type']).toBeUndefined()
            expect(first['user']).toBe('alice')
            expect(first['status']).toBe(false)
            expect(first['tool_name']).toBe('create_entry')
            expect(first['limit']).toBe(25)
        }

        const parsed = SearchAuditLogSchema.parse({
            category: 'write',
            user: 'alice',
            success: false,
            tool: 'delete_entry',
            workspace_id: '*',
            limit: 20,
        })
        expect(parsed).toEqual({
            category: 'write',
            user: 'alice',
            status: false,
            tool_name: 'delete_entry',
            workspace_id: '*',
            limit: 20,
        })
    })

    it('resolves registered absolute repository paths passed via repo in resolveGitWorkingDir and preserves repo on git tools', () => {
        const resolved = resolveGitWorkingDir(
            { repo: process.cwd() },
            {
                projectRegistry: {
                    'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
                },
            }
        )
        expect(resolved).toBe(process.cwd())

        const gitIntercept = applyArgInterceptions('search_commits', [
            { query: 'json_keys', repo: process.cwd(), max_count: 10 },
        ])
        expect('args' in gitIntercept).toBe(true)
        if ('args' in gitIntercept) {
            const first = gitIntercept.args[0] as Record<string, unknown>
            expect(first['repo']).toBe(process.cwd())
            expect(first['repo_name']).toBeUndefined()
        }
    })

    it('routes get_entry_by_id with resource URI to read_resource or extracts numeric entry ID from memory://entries/<id>', async () => {
        const created = db.createEntry({
            content: 'URI lookup test entry',
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
        })
        const nativeDb = (
            db as unknown as { connection: { getNativeDb: () => never } }
        ).connection.getNativeDb()
        insertAnchors({ db: nativeDb } as never, created.id, [
            { anchorPath: 'package.json', anchorType: 'file' },
        ])

        const byEntryUri = (await callTool(
            'get_entry_by_id',
            { uri: `memory://entries/${String(created.id)}`, workspace_id: 'memory-journal-mcp' },
            db,
            undefined,
            undefined,
            config
        )) as { success: boolean; entry?: { id: number } }
        expect(byEntryUri.success).toBe(true)
        expect(byEntryUri.entry?.id).toBe(created.id)

        const byBriefingUri = (await callTool(
            'get_entry_by_id',
            {
                uri: 'memory://briefing/memory-journal-mcp',
                project_number: 5,
                workspace_id: 'memory-journal-mcp',
            },
            db,
            undefined,
            undefined,
            config
        )) as { success: boolean; _healing_note?: string }
        expect(byBriefingUri.success).toBe(true)
        expect(byBriefingUri._healing_note).toContain('AUTONOMOUS HEALING')

        const api = createJournalApi(collectNonCodeModeTools({ db, config }))
        const getEntryByIdFn = api.core['getEntryById']
        expect(typeof getEntryByIdFn).toBe('function')
        if (typeof getEntryByIdFn === 'function') {
            const cmRes = (await getEntryByIdFn({
                uri: 'memory://briefing/memory-journal-mcp',
                project_number: 5,
                workspace_id: 'memory-journal-mcp',
            })) as { success: boolean; _healing_note?: string }
            expect(cmRes.success).toBe(true)
            expect(cmRes._healing_note).toContain('AUTONOMOUS HEALING')
        }
    })

    it('normalizes is_archived, isArchived, archived, and includeArchived into include_archived on search and recent tools', () => {
        const searchParsed = SearchEntriesSchema.parse({
            query: 'compaction',
            workspace_id: '*',
            is_archived: true,
        })
        expect(searchParsed.include_archived).toBe(true)

        const recentParsed = GetRecentEntriesSchema.parse({
            limit: 20,
            workspace_id: '*',
            isArchived: true,
        })
        expect(recentParsed.include_archived).toBe(true)

        const cmSearch = applyArgInterceptions('searchEntries', [
            { query: 'audit', workspace_id: '*', is_archived: true },
        ])
        expect('args' in cmSearch).toBe(true)
        if ('args' in cmSearch) {
            const argObj = cmSearch.args[0] as Record<string, unknown>
            expect(argObj['include_archived']).toBe(true)
            expect(argObj['is_archived']).toBeUndefined()
        }

        const cmRecent = applyArgInterceptions('getRecentEntries', [
            { limit: 10, workspace_id: '*', is_archived: true },
        ])
        expect('args' in cmRecent).toBe(true)
        if ('args' in cmRecent) {
            const argObj = cmRecent.args[0] as Record<string, unknown>
            expect(argObj['include_archived']).toBe(true)
            expect(argObj['is_archived']).toBeUndefined()
        }
    })

    it('aliases mj.graph to mj.relationships and supports .schema() across Object.keys(mj.admin) and unknown groups', async () => {
        const proxy = buildApiProxy(
            () => Promise.resolve({ success: true }),
            {
                admin: ['update_entry', 'delete_entry', 'merge_tags'],
                relationships: ['link_entries', 'visualize_relationships'],
            },
            {
                admin: {
                    update_entry: '{ entry_id: number }',
                    delete_entry: '{ entry_id: number }',
                    merge_tags: '{ source_tag: string, target_tag: string }',
                },
                relationships: {
                    link_entries: '{ from_entry_id: number, to_entry_id: number, relationship_type: string }',
                    visualize_relationships: '{ entry_id?: number }',
                },
            }
        )

        const graphGroup = proxy['graph'] as Record<
            string,
            { schema: () => Promise<string> }
        >
        expect(graphGroup).toBeDefined()
        const linkSchema = await graphGroup['linkEntries']?.schema()
        expect(linkSchema).toContain('from_entry_id')

        const adminGroup = proxy['admin'] as Record<
            string,
            { schema: () => Promise<string> }
        >
        const adminKeys = Object.keys(adminGroup)
        expect(adminKeys).toEqual(['update_entry', 'delete_entry', 'merge_tags'])
        for (const methodKey of adminKeys) {
            const schemaStr = await adminGroup[methodKey]?.schema()
            expect(typeof schemaStr).toBe('string')
        }
        // Direct .schema() on help/describe also resolves cleanly
        expect(typeof (await adminGroup['help']?.schema())).toBe('string')

        // Unknown group method .schema() never throws TypeError
        const unknownGroup = proxy['nonexistentGroup'] as Record<
            string,
            { schema: () => Promise<string> }
        >
        expect(await unknownGroup['someMethod']?.schema()).toBe('unknown')
    })

    it('synthesizes fallback content from anchors when content is omitted and strips session-summary when semantic-summary is present', () => {
        const anchorOnly = CreateEntrySchema.parse({
            workspace_id: 'db-mcp',
            project_number: 15,
            session_id: '00000000-0000-4000-8000-000000000001',
            entry_type: 'bug_fix',
            impact_score: 0.4,
            trust_score: 0.95,
            validation_status: 'passed',
            tags: ['testing', 'db-mcp', 'tool-groups'],
            anchors: [
                { anchor_path: 'src/adapters/sqlite/tools/vector/helpers.ts', anchor_type: 'file', status: 'pending' },
                { anchor_path: 'tests/adapters/sqlite/tools/vector-part5-schema.test.ts', anchor_type: 'file', status: 'pending' },
            ],
        })
        expect(anchorOnly.content).toContain('# bug_fix (testing, db-mcp, tool-groups)')
        expect(anchorOnly.content).toContain('`src/adapters/sqlite/tools/vector/helpers.ts`')

        const semanticMcp = CreateEntrySchema.parse({
            workspace_id: 'db-mcp',
            project_number: 15,
            entry_type: 'retrospective',
            content: '# Semantic Consolidation\n\n## Consolidated Episodic Scope\nSynthesized 15 entries.',
            tags: ['session-summary', 'db-mcp', 'cms-02-nrem-consolidation', 'semantic-summary'],
        })
        expect(semanticMcp.tags).not.toContain('session-summary')
        expect(semanticMcp.content).not.toContain('## Accomplished')

        const semanticCm = applyArgInterceptions('createEntry', [
            {
                workspace_id: 'mysql-mcp',
                project_number: 9,
                entry_type: 'retrospective',
                content: '# Semantic Consolidation\n\n## Consolidated Episodic Scope\nSynthesized 31 entries.',
                tags: ['session-summary', 'mysql-mcp', 'semantic-summary'],
            },
        ])
        expect('args' in semanticCm).toBe(true)
        if ('args' in semanticCm) {
            const first = semanticCm.args[0] as Record<string, unknown>
            expect(first['tags']).not.toContain('session-summary')
            expect(String(first['content'])).not.toContain('## Accomplished')
        }
    })

    it('aliases mj.relationships.getEntryRelationships to visualizeRelationships and exposes .relationships on graph results', async () => {
        const e1 = db.createEntry({
            content: 'Source entry',
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
        })
        const e2 = db.createEntry({
            content: 'Target entry',
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
        })
        db.linkEntries(e1.id, e2.id, 'implements', undefined, 'memory-journal-mcp')

        const api = createJournalApi(collectNonCodeModeTools({ db, config }))
        const getRelsFn = api.relationships['getEntryRelationships']
        expect(typeof getRelsFn).toBe('function')

        const proxy = buildApiProxy(
            (_g, _m, args) => Promise.resolve(getRelsFn?.(...args)),
            { relationships: ['link_entries', 'visualize_relationships'] }
        )
        const relGroup = proxy['relationships'] as Record<
            string,
            (arg: unknown) => Promise<Record<string, unknown>>
        >
        const res = await relGroup['getEntryRelationships']!({
            entry_id: e1.id,
            workspace_id: 'memory-journal-mcp',
        })
        const relList = res?.['relationships'] as Array<{
            fromEntryId: number
            toEntryId: number
            relationshipType: string
        }>
        expect(Array.isArray(relList)).toBe(true)
        expect(relList).toHaveLength(1)
        expect(relList[0]).toMatchObject({
            fromEntryId: e1.id,
            toEntryId: e2.id,
            relationshipType: 'implements',
        })
    })

    it('allows cross-project batchUpdateEntries with explicit workspace_id: "*" and foreign repo git calls in Code Mode dispatch', async () => {
        const { normalizeDispatchParams } = await import('../../src/handlers/tools/codemode/dispatch-scope.js')
        const { getGitTools } = await import('../../src/handlers/tools/git.js')
        const { getBatchTools } = await import('../../src/handlers/tools/admin/batch-tools.js')

        const multiConfig: ToolHandlerConfig = {
            defaultWorkspaceId: 'memory-journal-mcp',
            projectRegistry: {
                'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
                'db-mcp': { path: process.cwd(), project_number: 15 },
                'workspace-gamma': { path: process.cwd(), project_number: 16 },
            },
            runtime: new ServerRuntime(),
        }
        const sessionCtx = { db, config: multiConfig }

        // 1. Foreign repo git call inside a project #5 Code Mode session
        const gitTool = getGitTools(sessionCtx).find((t) => t.name === 'get_commit_history')!
        const gitNorm = await normalizeDispatchParams(
            gitTool,
            { repo: 'db-mcp', max_count: 5, tech_debt_audit: true },
            {
                sessionContext: sessionCtx,
                projectId: 5,
                workspaceId: 'memory-journal-mcp',
                explicitWorkspace: true,
            }
        )
        expect('params' in gitNorm).toBe(true)
        if ('params' in gitNorm) {
            const p = gitNorm.params as Record<string, unknown>
            expect(p['project_number']).toBe(15)
            expect(p['workspace_id']).toBeUndefined()
        }

        // 2. Cross-project batch_update_entries with explicit workspace_id: '*' inside a project #5 session
        const e5 = db.createEntry({ content: 'Entry in MJ', workspaceId: 'memory-journal-mcp', projectNumber: 5 })
        const e15 = db.createEntry({ content: 'Entry in DB', workspaceId: 'db-mcp', projectNumber: 15 })
        const e16 = db.createEntry({ content: 'Entry in Gamma', workspaceId: 'workspace-gamma', projectNumber: 16 })

        const batchUpdateTool = getBatchTools(sessionCtx).find((t) => t.name === 'batch_update_entries')!
        const batchNorm = await normalizeDispatchParams(
            batchUpdateTool,
            {
                workspace_id: '*',
                entries: [
                    { id: e5.id, significance_type: 'architecture' },
                    { id: e15.id, significance_type: 'blocker_resolved' },
                    { id: e16.id, significance_type: 'milestone' },
                ],
            },
            {
                sessionContext: sessionCtx,
                projectId: 5,
                workspaceId: 'memory-journal-mcp',
                explicitWorkspace: true,
            }
        )
        expect('params' in batchNorm).toBe(true)
        if ('params' in batchNorm) {
            const p = batchNorm.params as Record<string, unknown>
            expect(p['project_number']).toBeUndefined()
            const updates = p['entries'] as Array<Record<string, unknown>>
            expect(updates.every((u) => u['project_number'] === undefined)).toBe(true)

            const execRes = (await batchUpdateTool.handler(p)) as { success: boolean; count: number }
            expect(execRes.success).toBe(true)
            expect(execRes.count).toBe(3)
        }
    })
})
