/**
 * Regression tests for the AGENTS.md ecosystem audit fixes in memory-journal-mcp.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as os from 'node:os'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { CreateEntrySchemaMcp } from '../../src/handlers/tools/core/schemas.js'
import { healSearchPayload } from '../../src/handlers/tools/schemas/hallucination-healer.js'
import { convertKeysToSnakeCase } from '../../src/codemode/api/key-normalizer.js'
import { buildEntryPayload } from '../../src/cli/commands/entry-payload.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { getAdminTools } from '../../src/handlers/tools/admin/index.js'
import { resolveGitWorkingDir } from '../../src/handlers/tools/git-staleness.js'
import { getGitTools } from '../../src/handlers/tools/git.js'
import { ValidationError } from '../../src/types/errors.js'
import type { ToolContext } from '../../src/types/index.js'
import type { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'

const { mockStreamGitRecords } = vi.hoisted(() => ({
    mockStreamGitRecords: vi.fn(),
}))

vi.mock('../../src/vendor/lib-git-history/git-runner.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/vendor/lib-git-history/git-runner.js')>()
    return {
        ...actual,
        streamGitRecords: mockStreamGitRecords,
    }
})

describe('AGENTS.md Ecosystem Audit Regressions', () => {
    let db: DatabaseAdapter
    let context: ToolContext

    beforeEach(async () => {
        vi.clearAllMocks()
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        context = {
            db,
            config: {
                defaultWorkspaceId: 'default',
                runtime: {
                    maintenanceManager: {
                        withActiveJob: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
                        acquireMaintenanceLock: async (): Promise<void> => {},
                        releaseMaintenanceLock: (): void => {},
                    },
                },
            } as unknown as ToolContext['config'],
        }
    })

    afterEach(() => {
        db.close()
    })

    describe('Relationship Payload Healing & CLI Significance', () => {
        it('accepts target_entry_id, targetEntryId, to_id, and target aliases in CreateEntrySchemaMcp', () => {
            const parsed1 = CreateEntrySchemaMcp.parse({
                workspace_id: 'default',
                content: 'Replay agent-issues payload 1',
                relationships: [{ target_entry_id: 14653, relationship_type: 'references' }],
            })
            expect(parsed1.relationships).toEqual([{ targetId: 14653, relationType: 'references' }])

            const parsed2 = CreateEntrySchemaMcp.parse({
                workspace_id: 'default',
                content: 'Replay agent-issues payload 2',
                relationships: [
                    { targetEntryId: 14654, relation_type: 'evolves_from' },
                    { to_id: '14655', type: 'resolved' },
                    { target: 14656, relationshipType: 'blocked_by' },
                ],
            })
            expect(parsed2.relationships).toEqual([
                { targetId: 14654, relationType: 'evolves_from' },
                { targetId: 14655, relationType: 'resolved' },
                { targetId: 14656, relationType: 'blocked_by' },
            ])
        })

        it('normalizes Code Mode relationship keys cleanly via convertKeysToSnakeCase', () => {
            const normalized = convertKeysToSnakeCase({
                content: 'Code mode relationship payload',
                relationships: [
                    { target_entry_id: 42, relationship_type: 'evolves_from' },
                    { to_id: '99', type: 'resolved' },
                ],
            }) as Record<string, unknown>

            expect(normalized['relationships']).toEqual([
                { targetId: 42, relationType: 'evolves_from' },
                { targetId: 99, relationType: 'resolved' },
            ])
        })

        it('wires CLI --significance, --relationships aliases, and --related-to in buildEntryPayload', () => {
            const payload = buildEntryPayload(
                {
                    content: 'CLI architecture decision',
                    type: 'project_decision',
                    significance: 'architecture',
                    relatedTo: '101, 102',
                    relationships: JSON.stringify([{ target_entry_id: 201, relationship_type: 'resolves' }]),
                },
                {}
            )
            expect(payload.entryType).toBe('project_decision')
            expect(payload.significanceType).toBe('architecture')
            expect(payload.relatedIds).toEqual([101, 102])
            expect(payload.relationships).toEqual([{ target_id: 201, relation_type: 'resolved' }])
        })
    })

    describe('entry_type: architecture -> project_decision + significance_type', () => {
        it('promotes architecture/architectural-decision/adr aliases in MCP and Code Mode', () => {
            const parsed = CreateEntrySchemaMcp.parse({
                workspace_id: 'default',
                content: 'Architecture decision note',
                entry_type: 'architecture',
            })
            expect(parsed.entry_type).toBe('project_decision')
            expect(parsed.significance_type).toBe('architecture')

            const cmNormalized = convertKeysToSnakeCase({
                content: 'ADR note',
                entry_type: 'adr',
            }) as Record<string, unknown>
            expect(cmNormalized['entry_type']).toBe('project_decision')
            expect(cmNormalized['significance_type']).toBe('architecture')
        })
    })

    describe('FTS Compound Queries, 0-Hit LIKE Fallback, exclude_tags, and blended Sort', () => {
        it('finds dotted tokens like AGENTS.md via FTS and mid-word substrings via LIKE fallback', () => {
            db.createEntry({
                content: 'Refined AGENTS.md global rules and xyznonexistentmidstringtoken guard',
                entryType: 'project_decision',
                significanceType: 'architecture',
                tags: ['agents-md'],
            })

            const ftsHit = db.searchEntries('AGENTS.md', { limit: 10 })
            expect(ftsHit.entries).toHaveLength(1)
            expect(ftsHit.degraded).toBeUndefined()

            const likeHit = db.searchEntries('midstring', { limit: 10 })
            expect(likeHit.entries).toHaveLength(1)
            expect(likeHit.degraded).toBe(true)
        })

        it('supports exclude_tags and sort_by: blended across fts, semantic, and hybrid modes', async () => {
            const commitEntry = db.createEntry({
                content: 'interceptor stall commit narrative with high trust',
                entryType: 'development_note',
                tags: ['commit-narrative'],
                impactScore: 0.9,
                trustScore: 0.95,
                validationStatus: 'passed',
            })
            const decisionEntry = db.createEntry({
                content: 'interceptor stall architectural root cause fix for AGENTS.md',
                entryType: 'project_decision',
                significanceType: 'architecture',
                tags: ['agents-md'],
                impactScore: 0.85,
                trustScore: 0.9,
                validationStatus: 'passed',
            })

            expect(
                healSearchPayload({ excludeTags: 'commit-narrative, noise', sortBy: 'BLENDED' })
            ).toEqual({
                exclude_tags: ['commit-narrative', 'noise'],
                sort_by: 'blended',
            })

            const ftsRes = (await callTool(
                'search_entries',
                {
                    query: 'interceptor stall',
                    mode: 'fts',
                    exclude_tags: ['commit-narrative'],
                    sort_by: 'blended',
                },
                db,
                undefined,
                undefined,
                context.config
            )) as { success: boolean; entries: { id: number }[] }
            expect(ftsRes.success).toBe(true)
            expect(ftsRes.entries.map((e) => e.id)).toEqual([decisionEntry.id])

            const mockVector = {
                search: vi.fn().mockResolvedValue([
                    { entryId: commitEntry.id, score: 0.92 },
                    { entryId: decisionEntry.id, score: 0.88 },
                ]),
            } as unknown as VectorSearchManager

            const semanticRes = (await callTool(
                'search_entries',
                {
                    query: 'interceptor stall',
                    mode: 'semantic',
                    exclude_tags: ['commit-narrative'],
                    sort_by: 'blended',
                },
                db,
                mockVector,
                undefined,
                context.config
            )) as { success: boolean; entries: { id: number }[] }
            expect(semanticRes.success).toBe(true)
            expect(semanticRes.entries.map((e) => e.id)).toEqual([decisionEntry.id])

            const hybridRes = (await callTool(
                'search_entries',
                {
                    query: 'interceptor stall',
                    mode: 'hybrid',
                    exclude_tags: ['commit-narrative'],
                    sort_by: 'blended',
                },
                db,
                mockVector,
                undefined,
                context.config
            )) as { success: boolean; entries: { id: number }[] }
            expect(hybridRes.success).toBe(true)
            expect(hybridRes.entries.map((e) => e.id)).toEqual([decisionEntry.id])
        })
    })

    describe('Git Error Clarity & Admin Tool Description', () => {
        it('throws actionable ValidationError listing registered repos when cwd is outside git', () => {
            const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(os.tmpdir())
            try {
                expect(() =>
                    resolveGitWorkingDir(
                        {},
                        {
                            projectRegistry: {
                                'core-platform': { path: '/nonexistent/core-platform', project_number: 16 },
                                'memory-journal-mcp': { path: '/nonexistent/mj', project_number: 5 },
                            },
                        }
                    )
                ).toThrowError(ValidationError)

                expect(() =>
                    resolveGitWorkingDir(
                        {},
                        {
                            projectRegistry: {
                                'core-platform': { path: '/nonexistent/core-platform', project_number: 16 },
                            },
                        }
                    )
                ).toThrow(/Registered repositories: core-platform/)
            } finally {
                cwdSpy.mockRestore()
            }
        })

        it('maps git code 128 not a git repository failures to ValidationError in get_commit_history', async () => {
            const failingIterable: AsyncIterable<unknown> = {
                [Symbol.asyncIterator](): AsyncIterator<unknown> {
                    return {
                        next: () =>
                            Promise.reject(
                                new Error(
                                    'fatal: not a git repository (or any of the parent directories): .git (code 128)'
                                )
                            ),
                    }
                },
            }
            mockStreamGitRecords.mockReturnValueOnce(failingIterable)
            const gitTool = getGitTools(context).find((t) => t.name === 'get_commit_history')
            if (!gitTool) throw new Error('get_commit_history missing')

            const res = (await gitTool.handler({})) as { success: boolean; code?: string; error?: string }
            expect(res.success).toBe(false)
            expect(res.code).toBe('VALIDATION_ERROR')
            expect(res.error).toContain('not a valid git repository')
        })

        it('keeps update_configuration description aligned with supported parameters', () => {
            const updateTool = getAdminTools(context).find((t) => t.name === 'update_configuration')
            expect(updateTool?.description).toBeDefined()
            expect(updateTool?.description).not.toContain('instruction level')
            expect(updateTool?.description).toContain('tool filters')
        })

        it('normalizes value/target/uri/location/filePath anchor objects in CreateEntrySchemaMcp and CLI buildEntryPayload', () => {
            const parsed = CreateEntrySchemaMcp.parse({
                workspace_id: 'default',
                content: 'Replay live anchor value payload',
                anchors: [
                    { type: 'file', value: 'src/handlers/tools/schemas/hallucination-healer-anchors.ts' },
                    { anchor_type: 'symbol', filePath: 'src/index.ts#main' },
                    { target: 'src/cli/commands/entry-payload.ts' },
                    { uri: 'README.md' },
                    { location: 'DOCKER_README.md' },
                ],
            })
            expect(parsed.anchors).toEqual([
                {
                    anchor_path: 'src/handlers/tools/schemas/hallucination-healer-anchors.ts',
                    anchor_type: 'file',
                    status: 'pending',
                },
                {
                    anchor_path: 'src/index.ts#main',
                    anchor_type: 'symbol',
                    status: 'pending',
                },
                {
                    anchor_path: 'src/cli/commands/entry-payload.ts',
                    anchor_type: 'file',
                    status: 'pending',
                },
                {
                    anchor_path: 'README.md',
                    anchor_type: 'file',
                    status: 'pending',
                },
                {
                    anchor_path: 'DOCKER_README.md',
                    anchor_type: 'file',
                    status: 'pending',
                },
            ])

            const cliPayload = buildEntryPayload(
                { project: '1' },
                {
                    anchors: [
                        { type: 'file', value: 'src/foo.ts' },
                        { target: 'src/bar.ts#baz' },
                    ],
                }
            )
            expect(cliPayload.anchors).toEqual([
                { anchor_path: 'src/foo.ts', anchor_type: 'file' },
                { anchor_path: 'src/bar.ts#baz', anchor_type: 'symbol' },
            ])
        })
    })
})
