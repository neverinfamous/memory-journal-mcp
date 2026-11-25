/**
 * Targeted regression tests for Code Mode proxy invariants, team recall hints,
 * exclude_tags parity, numeric cursor coercion, CLI anchors, TOOL_FILTER isolation,
 * and issue-logger truncation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { buildApiProxy } from '../../src/codemode/worker-api-proxy.js'
import { createSearchDomainProxy } from '../../src/codemode/worker/mj-shim-domains.js'
import { createShimMjProxy } from '../../src/codemode/worker/mj-shim-proxy.js'
import { createSafeFsShim } from '../../src/codemode/worker/node-shims.js'
import { createContextProxy } from '../../src/codemode/worker/namespace-shims.js'
import { buildSandboxGlobals } from '../../src/codemode/worker/sandbox-globals.js'
import { wrapResult } from '../../src/codemode/worker-result-proxy.js'
import { applyArgInterceptions } from '../../src/codemode/param-normalizer.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { GetRecentEntriesSchema } from '../../src/handlers/tools/core/schemas.js'
import { TeamGetRecentSchema } from '../../src/handlers/tools/team/schemas/core-search-schemas.js'
import { resolveEntryAnchors } from '../../src/handlers/tools/core/staleness-tools.js'
import { buildEntryPayload } from '../../src/cli/commands/entry-payload.js'
import { parseFrontmatter, serializeFrontmatter } from '../../src/markdown/frontmatter.js'
import { getToolFilterFromEnv } from '../../src/filtering/tool-filter.js'
import { sanitizeIssueInput } from '../../src/utils/issue-logger.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import type { ToolContext } from '../../src/types/index.js'
import type { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'

describe('Ecosystem Audit Regressions: Code Mode Proxies, Recall, Search, CLI Anchors & Hygiene', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter
    let context: ToolContext
    let savedToolFilter: string | undefined
    let savedMjToolFilter: string | undefined

    beforeEach(async () => {
        savedToolFilter = process.env['TOOL_FILTER']
        savedMjToolFilter = process.env['MEMORY_JOURNAL_MCP_TOOL_FILTER']
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
        context = {
            db,
            teamDb,
            config: {
                defaultWorkspaceId: 'memory-journal-mcp',
                projectRegistry: {
                    'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
                },
                runtime: new ServerRuntime(),
            } as unknown as ToolContext['config'],
        }
    })

    afterEach(() => {
        db.close()
        teamDb.close()
        if (savedToolFilter !== undefined) process.env['TOOL_FILTER'] = savedToolFilter
        else delete process.env['TOOL_FILTER']
        if (savedMjToolFilter !== undefined) {
            process.env['MEMORY_JOURNAL_MCP_TOOL_FILTER'] = savedMjToolFilter
        } else {
            delete process.env['MEMORY_JOURNAL_MCP_TOOL_FILTER']
        }
    })

    it('avoids ownKeys duplicate help crash on mj.search and binds global help() to mj.help', async () => {
        const rpcSpy = vi.fn(async (group: string, method: string) => ({
            success: true,
            entries: [{ id: 1, group, method }],
        }))
        const mjApi = buildApiProxy(rpcSpy, {
            core: ['create_entry', 'get_entry_by_id', 'help'],
            search: ['search_entries', 'search_by_date_range', 'help'],
        })
        const shimMj = createShimMjProxy({
            mjApi,
            safeFsShim: createSafeFsShim(),
            executeCodeFnRef: {},
            getUpdateMemoryFn: () => () => ({ success: false }),
        })

        // Accessing search twice reuses cached proxy and Reflect.ownKeys contains unique 'help'
        const searchA = shimMj['search'] as object
        const searchB = shimMj['search'] as object
        expect(searchA).toBe(searchB)
        const searchKeys = Reflect.ownKeys(searchA)
        expect(searchKeys.filter((k) => k === 'help')).toHaveLength(1)
        expect(Reflect.getOwnPropertyDescriptor(mjApi['search'] as object, 'help')?.value).toBe(
            (mjApi['search'] as Record<string, unknown>)['help']
        )

        const searchProxy = createSearchDomainProxy(mjApi) as {
            searchEntries: (q: unknown) => Promise<{ entries: unknown[] }>
        }
        const searchResult = await searchProxy.searchEntries({ query: 'hello' })
        expect(searchResult.entries).toHaveLength(1)
        expect(rpcSpy).toHaveBeenCalledWith('search', 'search_entries', [{ query: 'hello' }])

        const globals = buildSandboxGlobals({
            mjApi,
            shimMj,
            safeFsShim: createSafeFsShim(),
            frozenContext: Object.freeze({ note: 'ok' }),
            executeCodeFn: async () => ({ success: true }),
            updateMemoryFn: () => ({ success: true }),
        })
        const topHelpFn = globals['help'] as () => Promise<{ groups: string[]; totalMethods: number }>
        const topHelpRes = await topHelpFn()
        expect(topHelpRes.groups).toContain('core')
        expect(topHelpRes.groups).toContain('search')
        expect(topHelpRes.totalMethods).toBeGreaterThan(0)
    })

    it('preserves frozen context own properties and includes suggestion on frozen failed results', () => {
        const frozen = Object.freeze({ toString: 'custom-value', custom_key: 'abc' })
        const ctxProxy = createContextProxy(frozen)
        expect(ctxProxy['toString']).toBe('custom-value')
        expect(ctxProxy['customKey']).toBe('abc')

        const failedFrozen = Object.freeze({
            success: false,
            error: 'Entry 99 not found',
            code: 'RESOURCE_NOT_FOUND',
            suggestion: 'Use mj.team.teamGetEntryById instead.',
        })
        const wrapped = wrapResult(failedFrozen) as { entries: unknown[] }
        expect(() => wrapped.entries).toThrow(
            'Entry 99 not found (Use mj.team.teamGetEntryById instead.)'
        )
    })

    it('returns team DB suggestions for visualize_relationships and get_entry_history when entry is in teamDb', async () => {
        const teamEntry = teamDb.createEntry({
            content: 'Shared architectural ADR in team DB',
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
            isPersonal: false,
            author: 'test-author',
        })

        const visRes = (await callTool(
            'visualize_relationships',
            { entry_id: teamEntry.id, workspace_id: 'memory-journal-mcp', project_number: 5 },
            db,
            undefined,
            undefined,
            context.config,
            undefined,
            teamDb
        )) as { success: boolean; code?: string; suggestion?: string }
        expect(visRes.success).toBe(false)
        expect(visRes.code).toBe('RESOURCE_NOT_FOUND')
        expect(visRes.suggestion).toContain('team_visualize_relationships')

        const histRes = (await callTool(
            'get_entry_history',
            { entry_id: teamEntry.id, workspace_id: 'memory-journal-mcp', project_number: 5 },
            db,
            undefined,
            undefined,
            context.config,
            undefined,
            teamDb
        )) as { success: boolean; code?: string; suggestion?: string }
        expect(histRes.success).toBe(false)
        expect(histRes.code).toBe('RESOURCE_NOT_FOUND')
        expect(histRes.suggestion).toContain('team_get_entry_by_id')
    })

    it('filters excluded tags across search_by_date_range, team_search_by_date_range, and semantic_search', async () => {
        const keepPersonal = db.createEntry({
            content: 'Keep architectural pattern note',
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
            tags: ['architecture'],
        })
        db.createEntry({
            content: 'Commit narrative noise in range',
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
            tags: ['commit-narrative'],
        })

        const keepTeam = teamDb.createEntry({
            content: 'Shared team pattern',
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
            isPersonal: false,
            author: 'test-author',
            tags: ['team-pattern'],
        })
        teamDb.createEntry({
            content: 'Shared commit narrative',
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
            isPersonal: false,
            author: 'test-author',
            tags: ['commit-narrative'],
        })

        const today = new Date().toISOString().slice(0, 10)
        const dateRes = (await callTool(
            'search_by_date_range',
            {
                start_date: '2020-01-01',
                end_date: today,
                workspace_id: 'memory-journal-mcp',
                project_number: 5,
                exclude_tags: ['commit-narrative'],
            },
            db,
            undefined,
            undefined,
            context.config,
            undefined,
            teamDb
        )) as { success: boolean; entries: { id: number; source: string }[] }
        expect(dateRes.success).toBe(true)
        expect(
            dateRes.entries.some((e) => e.source === 'personal' && e.id === keepPersonal.id)
        ).toBe(true)
        expect(dateRes.entries).toHaveLength(2)

        const teamDateRes = (await callTool(
            'team_search_by_date_range',
            {
                start_date: '2020-01-01',
                end_date: today,
                workspace_id: 'memory-journal-mcp',
                project_number: 5,
                exclude_tags: ['commit-narrative'],
            },
            db,
            undefined,
            undefined,
            context.config,
            undefined,
            teamDb
        )) as { success: boolean; entries: { id: number }[] }
        expect(teamDateRes.success).toBe(true)
        expect(teamDateRes.entries.map((e) => e.id)).toEqual([keepTeam.id])

        const mockVector: VectorSearchManager = {
            getStats: () => ({ itemCount: 2, model: 'test', dimensions: 3 }),
            search: vi.fn(async () => [
                { entryId: keepPersonal.id, score: 0.9 },
                { entryId: keepPersonal.id + 1, score: 0.85 },
            ]),
        } as unknown as VectorSearchManager

        const semRes = (await callTool(
            'semantic_search',
            {
                query: 'architectural pattern',
                workspace_id: 'memory-journal-mcp',
                project_number: 5,
                exclude_tags: ['commit-narrative'],
                include_team: false,
            },
            db,
            mockVector,
            undefined,
            context.config
        )) as { success: boolean; entries: { id: number }[] }
        expect(semRes.success).toBe(true)
        expect(semRes.entries.map((e) => e.id)).toEqual([keepPersonal.id])
    })

    it('heals numeric cursor to offset on get_recent_entries / team_get_recent and strips mode on team_search', () => {
        const parsedRecent = GetRecentEntriesSchema.parse({ cursor: '25', limit: 10 })
        expect(parsedRecent.offset).toBe(25)
        expect(parsedRecent.cursor).toBeUndefined()

        const parsedTeamRecent = TeamGetRecentSchema.parse({ cursor: '10', limit: 5 })
        expect(parsedTeamRecent.offset).toBe(10)
        expect(parsedTeamRecent.cursor).toBeUndefined()

        const interceptedRecent = applyArgInterceptions('get_recent_entries', [{ cursor: '40' }])
        expect('error' in interceptedRecent).toBe(false)
        if (!('error' in interceptedRecent)) {
            expect(interceptedRecent.args[0]).toMatchObject({ offset: 40 })
            expect((interceptedRecent.args[0] as Record<string, unknown>)['cursor']).toBeUndefined()
        }

        const interceptedTeamSearch = applyArgInterceptions('team_search', [
            { query: 'routing', mode: 'fts', project_number: 5 },
        ])
        expect('error' in interceptedTeamSearch).toBe(false)
        if (!('error' in interceptedTeamSearch)) {
            expect((interceptedTeamSearch.args[0] as Record<string, unknown>)['mode']).toBeUndefined()
        }
    })

    it('parses CLI anchors frontmatter/metadata, isolates TOOL_FILTER, and truncates long issue strings', async () => {
        const md = serializeFrontmatter({
            entry_type: 'technical_note',
            anchors: ['src/index.ts', 'src/handlers/tools/core/tools.ts'],
        })
        const parsedFm = parseFrontmatter(`${md}\nBody text`)
        expect(parsedFm.metadata.anchors).toEqual([
            'src/index.ts',
            'src/handlers/tools/core/tools.ts',
        ])

        const payload = buildEntryPayload(
            { project: '5', workspace: 'memory-journal-mcp' },
            { anchors: ['src/index.ts', { anchor_path: 'src/cli.ts', anchor_type: 'file' }] },
            context.config,
            'Body text'
        )
        expect(payload.anchors).toEqual([
            { anchor_path: 'src/index.ts', anchor_type: 'file' },
            { anchor_path: 'src/cli.ts', anchor_type: 'file' },
        ])

        const resolvedAnchors = await resolveEntryAnchors(
            payload.anchors,
            undefined,
            'memory-journal-mcp',
            context
        )
        const createdWithAnchors = db.createEntry({
            content: 'CLI anchored entry',
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
            anchors: resolvedAnchors,
        })
        const storedAnchors = db.getAnchorsByEntryId(createdWithAnchors.id, 'memory-journal-mcp')
        expect(storedAnchors).toHaveLength(2)

        delete process.env['MEMORY_JOURNAL_MCP_TOOL_FILTER']
        process.env['TOOL_FILTER'] = 'readonly'
        expect(getToolFilterFromEnv()).toBeNull()

        const longPayload = sanitizeIssueInput({ code: 'x'.repeat(800) }) as { code: string }
        expect(longPayload.code.length).toBeLessThan(550)
        expect(longPayload.code.endsWith('...[truncated]')).toBe(true)

        const longArrayPayload = sanitizeIssueInput({
            content: ['y'.repeat(900)],
        }) as { content: string[] }
        expect(longArrayPayload.content[0]?.length).toBeLessThan(550)
        expect(longArrayPayload.content[0]?.endsWith('...[truncated]')).toBe(true)

        const wrappedCommits = wrapResult({
            success: true,
            commits: [{ commit: 'abc12345', subject: 'feat: test' }],
        }) as {
            length: number
            total: number
            map: <T>(fn: (c: { commit: string }) => T) => T[]
        }
        expect(wrappedCommits.length).toBe(1)
        expect(wrappedCommits.total).toBe(1)
        expect(wrappedCommits.map((c) => c.commit)).toEqual(['abc12345'])

        const wrappedUnreleased = wrapResult({
            success: true,
            changelog: {
                latestTag: 'v5.0.1',
                commits: [{ commit: 'def67890' }, { commit: 'fed09876' }],
                truncated: true,
            },
        }) as {
            latestTag: string
            tag: string
            baseRef: string
            commits: { commit: string }[]
            count: number
            total: number
            truncated: boolean
        }
        expect(wrappedUnreleased.latestTag).toBe('v5.0.1')
        expect(wrappedUnreleased.tag).toBe('v5.0.1')
        expect(wrappedUnreleased.baseRef).toBe('v5.0.1')
        expect(wrappedUnreleased.commits).toHaveLength(2)
        expect(wrappedUnreleased.count).toBe(2)
        expect(wrappedUnreleased.total).toBe(2)
        expect(wrappedUnreleased.truncated).toBe(true)
    })
})
