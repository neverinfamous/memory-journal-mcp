/**
 * CMS-04 REM Supervisor Regression Suite (2026-11-24)
 *
 * Covers the 5 self-healing adaptations mined from CMS-02 (#16198), logs/agent-issues.jsonl,
 * and logs/mcp-audit.jsonl:
 * 1. Merged Personal+Team pagination cursors (`search_entries` & `search_by_date_range`) never skip
 *    rows or terminate early when 2x per-DB over-fetching merges to `limit`.
 * 2. Create-payload `significance_type: null` healing (`CreateEntrySchema`, `TeamCreateEntrySchema`,
 *    `BatchCreateEntriesSchema`) while preserving `significance_type: null` on updates.
 * 3. Unwrapping `{ content }` context wrappers in `synthesizeEntryMutationFields` and
 *    `healAgentHallucinations` without literal `**Context:** { "content": ... }` serialization.
 * 4. ISO-8601 datetime normalization (`YYYY-MM-DDTHH:mm:ssZ` -> `YYYY-MM-DD`), Code Mode omitted
 *    `start_date` defaulting, and strict-schema `AUTONOMOUS HEALING` hints for `search_by_date_range`.
 * 5. Actionable `AUTONOMOUS HEALING` hints for `batch_update_entries` project pinning (preserving
 *    Pass 40 H5) and `get_vector_index_stats` scope keys (preserving Pass 72 D-M1).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { CreateEntrySchema } from '../../src/handlers/tools/core/schemas.js'
import {
    BatchCreateEntriesSchema,
    UpdateEntrySchema,
} from '../../src/handlers/tools/admin/schemas/crud-batch-schemas.js'
import { TeamCreateEntrySchema } from '../../src/handlers/tools/team/schemas/core-search-schemas.js'
import {
    SearchByDateRangeSchema,
    SearchEntriesSchema,
} from '../../src/handlers/tools/search/schemas.js'
import { getMiscSearchTools } from '../../src/handlers/tools/search/misc-tools.js'
import { healAgentHallucinations } from '../../src/handlers/tools/schemas/hallucination-healer.js'
import { synthesizeEntryMutationFields } from '../../src/codemode/normalizers/entry-mutation-synthesis.js'
import { applyArgInterceptions } from '../../src/codemode/param-normalizer.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import type { ToolContext, ToolHandlerConfig } from '../../src/types/index.js'

function createTestConfig(registry: ToolHandlerConfig['projectRegistry']): ToolHandlerConfig {
    return {
        projectRegistry: registry,
        runtime: new ServerRuntime(),
        io: { allowedRoots: [process.cwd()] },
    } as unknown as ToolHandlerConfig
}

interface SearchPagePayload {
    success?: boolean
    entries?: { id: number; source?: string; alsoInTeam?: number }[]
    count?: number
    next_cursor?: string
}

async function collectAllPages(
    toolName: 'search_entries' | 'search_by_date_range',
    baseArgs: Record<string, unknown>,
    personalDb: DatabaseAdapter,
    teamDb: DatabaseAdapter,
    config: ToolHandlerConfig
): Promise<{ keys: string[]; pageCounts: number[] }> {
    const keys: string[] = []
    const pageCounts: number[] = []
    let cursor: string | undefined

    for (let pageIdx = 0; pageIdx < 25; pageIdx++) {
        const res = (await callTool(
            toolName,
            { ...baseArgs, ...(cursor !== undefined ? { cursor } : {}) },
            personalDb,
            undefined,
            undefined,
            config,
            undefined,
            teamDb
        )) as SearchPagePayload

        expect(res.success).toBe(true)
        const batch = res.entries ?? []
        pageCounts.push(batch.length)
        for (const entry of batch) {
            keys.push(`${entry.source ?? 'personal'}:${String(entry.id)}`)
        }
        if (res.next_cursor === undefined) break
        cursor = res.next_cursor
    }

    return { keys, pageCounts }
}

describe('CMS-04 REM Healing (2026-11-24)', () => {
    let personalDb: DatabaseAdapter
    let teamDb: DatabaseAdapter
    let config: ToolHandlerConfig

    beforeEach(async () => {
        personalDb = new DatabaseAdapter(':memory:')
        await personalDb.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
        teamDb.applyTeamSchema()
        config = createTestConfig({
            'repo-alpha': { path: process.cwd(), project_number: 5 },
            'repo-beta': { path: process.cwd(), project_number: 15 },
        })
    })

    afterEach(() => {
        personalDb.close()
        teamDb.close()
    })

    describe('1. Merged Personal+Team search pagination cursors', () => {
        it('paginates all 18 personal retrospectives without skipping or truncating when teamDb is empty', async () => {
            for (let i = 1; i <= 18; i++) {
                const minute = String(i).padStart(2, '0')
                personalDb.createEntry({
                    content: `Retrospective checkpoint ${String(i)}`,
                    entryType: 'retrospective',
                    workspaceId: 'repo-alpha',
                    projectNumber: 5,
                    timestamp: `2026-06-10T10:${minute}:00.000Z`,
                })
            }

            const noQueryKeyset = await collectAllPages(
                'search_entries',
                {
                    entry_type: 'retrospective',
                    workspace_id: 'repo-alpha',
                    project_number: 5,
                    limit: 5,
                    include_team: true,
                },
                personalDb,
                teamDb,
                config
            )
            expect(noQueryKeyset.pageCounts).toEqual([5, 5, 5, 3])
            expect(new Set(noQueryKeyset.keys).size).toBe(18)
            expect(noQueryKeyset.keys).toHaveLength(18)

            const ftsOffset = await collectAllPages(
                'search_entries',
                {
                    query: 'checkpoint',
                    workspace_id: 'repo-alpha',
                    project_number: 5,
                    limit: 5,
                    include_team: true,
                },
                personalDb,
                teamDb,
                config
            )
            expect(ftsOffset.pageCounts).toEqual([5, 5, 5, 3])
            expect(new Set(ftsOffset.keys).size).toBe(18)
            expect(ftsOffset.keys).toHaveLength(18)

            const dateRangeKeyset = await collectAllPages(
                'search_by_date_range',
                {
                    start_date: '2026-01-01',
                    end_date: '2026-12-31',
                    workspace_id: 'repo-alpha',
                    project_number: 5,
                    limit: 5,
                    include_team: true,
                },
                personalDb,
                teamDb,
                config
            )
            expect(dateRangeKeyset.pageCounts).toEqual([5, 5, 5, 3])
            expect(new Set(dateRangeKeyset.keys).size).toBe(18)
            expect(dateRangeKeyset.keys).toHaveLength(18)
        })

        it('preserves unconsumed personal entries when Page 1 is 100% filled by newer team entries and handles collapsed mirrors', async () => {
            for (let i = 1; i <= 18; i++) {
                const minute = String(i).padStart(2, '0')
                personalDb.createEntry({
                    content: `Personal historical item ${String(i)}`,
                    entryType: 'technical_note',
                    workspaceId: 'repo-alpha',
                    projectNumber: 5,
                    timestamp: `2026-06-10T10:${minute}:00.000Z`,
                })
            }
            for (let j = 1; j <= 6; j++) {
                const minute = String(j).padStart(2, '0')
                teamDb.createEntry({
                    content: `Newer team item ${String(j)}`,
                    entryType: 'technical_note',
                    workspaceId: 'repo-alpha',
                    projectNumber: 5,
                    timestamp: `2026-06-12T12:${minute}:00.000Z`,
                })
            }

            const dateRes = await collectAllPages(
                'search_by_date_range',
                {
                    start_date: '2026-01-01',
                    end_date: '2026-12-31',
                    workspace_id: 'repo-alpha',
                    project_number: 5,
                    limit: 5,
                    include_team: true,
                },
                personalDb,
                teamDb,
                config
            )
            expect(dateRes.pageCounts).toEqual([5, 5, 5, 5, 4])
            expect(new Set(dateRes.keys).size).toBe(24)
            expect(dateRes.keys).toHaveLength(24)

            // Also verify mirror collapse counts the collapsed team row as consumed
            const pMirror = personalDb.createEntry({
                content: 'Shared architectural mirror decision',
                entryType: 'project_decision',
                workspaceId: 'repo-alpha',
                projectNumber: 5,
                timestamp: '2026-06-15T15:00:00.000Z',
            })
            teamDb.createEntry({
                content: 'Shared architectural mirror decision',
                entryType: 'project_decision',
                workspaceId: 'repo-alpha',
                projectNumber: 5,
                timestamp: '2026-06-15T15:00:05.000Z',
                originPersonalId: pMirror.id,
            })

            const mirrored = await collectAllPages(
                'search_entries',
                {
                    workspace_id: 'repo-alpha',
                    project_number: 5,
                    limit: 5,
                    include_team: true,
                },
                personalDb,
                teamDb,
                config
            )
            expect(new Set(mirrored.keys).size).toBe(25)
            expect(mirrored.keys).toHaveLength(25)
        })
    })

    describe('2. Create-payload significance_type: null healing', () => {
        it('strips significance_type: null on create schemas while preserving null on update schemas', () => {
            const single = CreateEntrySchema.parse({
                content: 'Bug fix audit entry',
                workspace_id: 'repo-alpha',
                significance_type: null,
            })
            expect(single.significance_type).toBeUndefined()

            const team = TeamCreateEntrySchema.parse({
                content: 'Team bug fix entry',
                workspace_id: 'repo-alpha',
                significance_type: null,
            })
            expect(team.significance_type).toBeUndefined()

            const batch = BatchCreateEntriesSchema.parse({
                entries: [
                    {
                        content: 'Batch create item',
                        workspace_id: 'repo-alpha',
                        significance_type: null,
                    },
                ],
            })
            expect(batch.entries[0]?.significance_type).toBeUndefined()

            const update = UpdateEntrySchema.parse({
                entry_id: 42,
                significance_type: null,
            })
            expect(update.significance_type).toBeNull()
        })
    })

    describe('3. Unwrapping { content } context wrappers', () => {
        it('unwraps plain context wrappers without literal **Context:** JSON serialization', () => {
            const synthPayload: Record<string, unknown> = {
                context: { content: 'Audit with "quotes" and `code`' },
            }
            synthesizeEntryMutationFields(synthPayload)
            expect(synthPayload['content']).toBe('Audit with "quotes" and `code`')
            expect(synthPayload['context']).toBeUndefined()

            const healed = healAgentHallucinations({
                context: { content: 'Clean "markdown" findings' },
                entry_type: 'bug_fix',
            }) as Record<string, unknown>
            expect(healed['content']).toBe('Clean "markdown" findings')
            expect('context' in healed).toBe(false)

            // Non-wrapper structured context object still preserves **Context:** metadata formatting
            const nonWrapper = healAgentHallucinations({
                context: { step: 2, module: 'search' },
                entry_type: 'technical_note',
            }) as Record<string, unknown>
            expect(typeof nonWrapper['content']).toBe('string')
            expect(String(nonWrapper['content'])).toContain('"step": 2')
        })
    })

    describe('4. ISO-8601 date normalization and search_by_date_range healing', () => {
        it('normalizes ISO-8601 datetime strings on search schemas while preserving invalid-date rejection', () => {
            const dr = SearchByDateRangeSchema.parse({
                start_date: '2026-11-01T00:00:00Z',
                end_date: '2026-11-08T07:00:00.000Z',
            })
            expect(dr.start_date).toBe('2026-11-01')
            expect(dr.end_date).toBe('2026-11-08')

            const se = SearchEntriesSchema.parse({
                end_date: '2026-11-08T07:00:00.000Z',
                entry_type: 'other',
            })
            expect(se.end_date).toBe('2026-11-08')

            expect(() =>
                SearchByDateRangeSchema.parse({
                    start_date: 'not-a-date',
                    end_date: '2026-11-08',
                })
            ).toThrow()

            const missingStart = SearchByDateRangeSchema.safeParse({
                end_date: '2026-11-08',
            })
            expect(missingStart.success).toBe(false)
            if (!missingStart.success) {
                expect(missingStart.error.issues[0]?.message).toContain('🛠️ AUTONOMOUS HEALING:')
            }

            const intercepted = applyArgInterceptions('search_by_date_range', [
                { end_date: '2026-11-08T07:00:00.000Z' },
            ])
            expect('args' in intercepted).toBe(true)
            if ('args' in intercepted) {
                expect((intercepted.args[0] as Record<string, unknown>)['start_date']).toBe(
                    '1970-01-01'
                )
            }
        })
    })

    describe('5. Actionable scope hints preserving Pass 40 H5 & Pass 72 D-M1', () => {
        it('returns AUTONOMOUS HEALING hint on batch_update_entries project mismatch without weakening enforcement', async () => {
            const target = personalDb.createEntry({
                content: 'Entry in project 15',
                entryType: 'technical_note',
                workspaceId: 'repo-beta',
                projectNumber: 15,
            })

            const mismatch = (await callTool(
                'batch_update_entries',
                {
                    workspace_id: '*',
                    project_number: 5,
                    updates: [
                        {
                            entry_id: target.id,
                            entry_type: 'maintenance',
                        },
                    ],
                },
                personalDb,
                undefined,
                undefined,
                config
            )) as Record<string, unknown>

            expect(mismatch['success']).toBe(false)
            expect(mismatch['code']).toBe('RESOURCE_NOT_FOUND')
            expect(String(mismatch['suggestion'])).toContain('🛠️ AUTONOMOUS HEALING:')
            expect(String(mismatch['suggestion'])).toContain('omit top-level project_number')
        })

        it('returns AUTONOMOUS HEALING hint when get_vector_index_stats receives scope keys while staying strict', () => {
            const ctx = {
                db: personalDb,
                vectorManager: undefined,
                config: { runtime: new ServerRuntime() },
            } as unknown as ToolContext
            const statsTool = getMiscSearchTools(ctx).find(
                (t) => t.name === 'get_vector_index_stats'
            )
            expect(statsTool).toBeDefined()

            const wildcardRes = statsTool?.handler({ workspace_id: '*' }) as Record<string, unknown>
            expect(wildcardRes['success']).toBe(false)
            expect(wildcardRes['code']).toBe('VALIDATION_ERROR')
            expect(String(wildcardRes['suggestion'])).toContain('🛠️ AUTONOMOUS HEALING:')

            const scopedRes = statsTool?.handler({ workspace_id: 'alpha' }) as Record<
                string,
                unknown
            >
            expect(scopedRes['success']).toBe(false)
            expect(scopedRes['code']).toBe('VALIDATION_ERROR')
            expect(String(scopedRes['suggestion'])).toContain('🛠️ AUTONOMOUS HEALING:')
        })
    })
})
