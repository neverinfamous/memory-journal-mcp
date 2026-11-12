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
                { entry_id: 14, status: 'outdated' },
                { id: 15, status: 'deleted' },
            ],
        })
        expect(parsed.updates).toEqual([
            { id: 12, status: 'valid' },
            { id: 14, status: 'stale' },
            { id: 15, status: 'invalidated' },
        ])
    })

    it('heals string anchors and status: "active" in CreateEntrySchema and Code Mode interceptions', async () => {
        const parsed = CreateEntrySchema.parse({
            content: '## Summary\nAnchored implementation note.',
            entry_type: 'technical_note',
            workspace_id: 'memory-journal-mcp',
            project_number: 5,
            anchors: [
                '.agents/scripts/lib-agent-exec/inline-script-healer.ts',
                'src/codemode/api/journal-api.ts#JournalApi',
                { anchor_path: 'src/handlers/tools/git-staleness.ts', anchor_type: 'file', status: 'active' },
            ],
        })

        expect(parsed.anchors).toEqual([
            {
                anchor_path: '.agents/scripts/lib-agent-exec/inline-script-healer.ts',
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
})
