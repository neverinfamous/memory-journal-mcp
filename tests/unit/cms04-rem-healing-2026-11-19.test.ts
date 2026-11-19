/**
 * CMS-04 REM Supervisor Regression Suite (2026-11-19)
 *
 * Covers the 4 self-healing adaptations mined from CMS-02 (#15303) and mcp-audit.jsonl:
 * 1. Legacy Team DB orphaned `projectNumber` realignment on registered workspaces (`team_update_entry`,
 *    `team_batch_update_entries`, `team_get_entry_by_id`, `team_link_entries`, `team_visualize_relationships`,
 *    `team_add_to_vector_index`, `team_delete_entry`, `team_restore_entry`) without weakening cross-project isolation.
 * 2. Single-pass commit prefetch in `check_entry_staleness` (`evaluateWorkspaceAnchors`) avoiding O(N_anchors) git spawns.
 * 3. Global wildcard `workspace_id: '*'` vector index rebuilds (`team_rebuild_vector_index` and `rebuild_vector_index`)
 *    ignoring Code Mode's inherited registered `project_number`.
 * 4. Optional `session_id` acceptance across strict Team analytics/relationship/vector schemas.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { evaluateWorkspaceAnchors } from '../../src/handlers/tools/git-staleness.js'
import { insertAnchors } from '../../src/database/sqlite-adapter/entries/anchors.js'
import {
    TeamGetStatisticsSchema,
    TeamLinkEntriesSchema,
    TeamVisualizeRelationshipsSchema,
    TeamSemanticSearchSchema,
    TeamAddToVectorIndexSchema,
    TeamCrossProjectInsightsSchema,
} from '../../src/handlers/tools/team/schemas.js'
import type { ToolHandlerConfig } from '../../src/types/index.js'
import type { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'

function createStubConfig(registry: ToolHandlerConfig['projectRegistry']): ToolHandlerConfig {
    return {
        projectRegistry: registry,
        runtime: {
            maintenanceManager: {
                withActiveJob: <T>(fn: () => T): T => fn(),
                acquireMaintenanceLock: async (): Promise<void> => {},
                releaseMaintenanceLock: (): void => {},
            },
        },
        io: { allowedRoots: [process.cwd()] },
    } as unknown as ToolHandlerConfig
}

function createStubVectorManager(
    rebuildSpy = vi.fn().mockResolvedValue({
        success: true,
        indexed: 12,
        failed: 0,
        firstError: null,
    })
): { manager: VectorSearchManager; rebuildSpy: ReturnType<typeof vi.fn> } {
    const manager = {
        isInitialized: () => true,
        initialize: async () => {},
        search: async () => [],
        searchByEntryId: async () => [],
        addEntry: async () => ({ success: true }),
        removeEntry: () => true,
        rebuildIndex: rebuildSpy,
        getStats: () => ({
            itemCount: 12,
            modelName: 'Xenova/all-MiniLM-L6-v2',
            dimensions: 384,
        }),
    } as unknown as VectorSearchManager
    return { manager, rebuildSpy }
}

describe('CMS-04 REM Healing (2026-11-19)', () => {
    let personalDb: DatabaseAdapter
    let teamDb: DatabaseAdapter

    beforeEach(async () => {
        personalDb = new DatabaseAdapter(':memory:')
        await personalDb.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
    })

    afterEach(() => {
        personalDb.close()
        teamDb.close()
    })

    describe('1. Legacy Team DB orphaned projectNumber realignment', () => {
        it('allows realigning, reading, and linking orphaned projectNumber entries on their owning registered workspace while blocking cross-project steals', async () => {
            // Seed entry under legacy project_number: 14 before registry renumbered mysql-mcp -> 9
            const legacyA = teamDb.createEntry({
                content: 'Legacy mysql-mcp team architecture note A',
                entryType: 'project_decision',
                workspaceId: 'mysql-mcp',
                projectNumber: 14,
                tags: ['mysql-mcp'],
            })
            const legacyB = teamDb.createEntry({
                content: 'Legacy mysql-mcp team architecture note B',
                entryType: 'technical_note',
                workspaceId: 'mysql-mcp',
                projectNumber: 14,
                tags: ['mysql-mcp'],
            })
            const otherRepoEntry = teamDb.createEntry({
                content: 'Active db-mcp team entry',
                entryType: 'technical_note',
                workspaceId: 'db-mcp',
                projectNumber: 15,
            })

            const config = createStubConfig({
                'mysql-mcp': { path: process.cwd(), project_number: 9 },
                'db-mcp': { path: process.cwd(), project_number: 15 },
            })

            // Reading legacy entry via current registered project 9 succeeds
            const getRes = (await callTool(
                'team_get_entry_by_id',
                { entry_id: legacyA.id, workspace_id: 'mysql-mcp', project_number: 9 },
                personalDb,
                undefined,
                undefined,
                config,
                undefined,
                teamDb
            )) as { success: boolean; entry?: { id: number; projectNumber: number } }
            expect(getRes.success).toBe(true)
            expect(getRes.entry?.id).toBe(legacyA.id)

            // Linking two legacy entries under current registered project 9 succeeds
            const linkRes = (await callTool(
                'team_link_entries',
                {
                    from_entry_id: legacyA.id,
                    to_entry_id: legacyB.id,
                    relationship_type: 'references',
                    workspace_id: 'mysql-mcp',
                    project_number: 9,
                },
                personalDb,
                undefined,
                undefined,
                config,
                undefined,
                teamDb
            )) as { success: boolean }
            expect(linkRes.success).toBe(true)

            // Realigning legacyA via project_number-only team_update_entry migrates 14 -> 9
            const realignSingle = (await callTool(
                'team_update_entry',
                {
                    entry_id: legacyA.id,
                    workspace_id: 'mysql-mcp',
                    project_number: 9,
                },
                personalDb,
                undefined,
                undefined,
                config,
                undefined,
                teamDb
            )) as { success: boolean; entry?: { projectNumber: number } }
            expect(realignSingle.success).toBe(true)
            expect(realignSingle.entry?.projectNumber).toBe(9)

            // Empty metadata-only update when projectNumber is ALREADY 9 is still rejected
            const noopUpdate = (await callTool(
                'team_update_entry',
                {
                    entry_id: legacyA.id,
                    workspace_id: 'mysql-mcp',
                    project_number: 9,
                },
                personalDb,
                undefined,
                undefined,
                config,
                undefined,
                teamDb
            )) as { success: boolean; code?: string }
            expect(noopUpdate.success).toBe(false)
            expect(noopUpdate.code).toBe('VALIDATION_ERROR')

            // Realigning legacyB via team_batch_update_entries migrates 14 -> 9
            const realignBatch = (await callTool(
                'team_batch_update_entries',
                {
                    workspace_id: 'mysql-mcp',
                    project_number: 9,
                    updates: [{ entry_id: legacyB.id, project_number: 9 }],
                },
                personalDb,
                undefined,
                undefined,
                config,
                undefined,
                teamDb
            )) as { success: boolean; updated?: { projectNumber: number }[] }
            expect(realignBatch.success).toBe(true)
            expect(realignBatch.updated?.[0]?.projectNumber).toBe(9)

            // Cross-project steal attempt against registered project 15 (db-mcp) stays blocked
            const crossSteal = (await callTool(
                'team_update_entry',
                {
                    entry_id: otherRepoEntry.id,
                    workspace_id: 'mysql-mcp',
                    project_number: 9,
                    content: 'Attempted cross-project hijack',
                },
                personalDb,
                undefined,
                undefined,
                config,
                undefined,
                teamDb
            )) as { success: boolean; code?: string }
            expect(crossSteal.success).toBe(false)
            expect(crossSteal.code).toBe('RESOURCE_NOT_FOUND')
        })
    })

    describe('2. Single-pass commit prefetch in check_entry_staleness', () => {
        it('evaluates >= 4 live anchors with a single prefetchCommitsSince call instead of per-anchor git spawns', async () => {
            const entry = personalDb.createEntry({
                content: 'Entry with four real repo file anchors',
                workspaceId: 'memory-journal-mcp',
                projectNumber: 5,
            })
            const nativeDb = (
                personalDb as unknown as { connection: { getNativeDb: () => never } }
            ).connection.getNativeDb()
            insertAnchors({ db: nativeDb } as never, entry.id, [
                { anchorPath: 'package.json', anchorType: 'file' },
                { anchorPath: 'README.md', anchorType: 'file' },
                { anchorPath: 'AGENT_README.md', anchorType: 'file' },
                { anchorPath: 'tsconfig.json', anchorType: 'file' },
            ])

            const countCommitsSpy = vi.fn(async () => 99)
            const futureDate = new Date(Date.now() + 60_000).toISOString()
            const prefetchSpy = vi.fn(async () => [
                {
                    date: futureDate,
                    files: [{ file: 'package.json' }, { file: 'README.md' }],
                },
                {
                    date: futureDate,
                    files: [{ file: 'package.json' }],
                },
            ])

            const outcome = await evaluateWorkspaceAnchors({
                db: personalDb,
                wsId: 'memory-journal-mcp',
                rawWs: 'memory-journal-mcp',
                rawProj: 5,
                resolvedEntryId: entry.id,
                registry: {
                    'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
                },
                maxCommitsPerAnchor: 25,
                countCommitsSince: countCommitsSpy,
                prefetchCommitsSince: prefetchSpy,
            })

            expect(outcome.skipped).toBe(false)
            expect(prefetchSpy).toHaveBeenCalledTimes(1)
            expect(countCommitsSpy).not.toHaveBeenCalled()

            const byPath = new Map(outcome.rows.map((r) => [r.path, r]))
            expect(byPath.get('package.json')?.commitsSince).toBe(2)
            expect(byPath.get('package.json')?.newStatus).toBe('stale')
            expect(byPath.get('README.md')?.commitsSince).toBe(1)
            expect(byPath.get('README.md')?.newStatus).toBe('stale')
            expect(byPath.get('AGENT_README.md')?.commitsSince).toBe(0)
            expect(byPath.get('AGENT_README.md')?.newStatus).toBe('valid')
            expect(byPath.get('tsconfig.json')?.commitsSince).toBe(0)
            expect(byPath.get('tsconfig.json')?.newStatus).toBe('valid')
        })
    })

    describe('3. Wildcard vector index rebuild with inherited registered project_number', () => {
        it('strips registered single-workspace project_number when workspace_id is "*" on team_rebuild_vector_index and rebuild_vector_index', async () => {
            const config = createStubConfig({
                'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
                'db-mcp': { path: process.cwd(), project_number: 15 },
            })
            const { manager: personalVec, rebuildSpy: personalSpy } = createStubVectorManager()
            const { manager: teamVec, rebuildSpy: teamSpy } = createStubVectorManager()

            const teamRes = (await callTool(
                'team_rebuild_vector_index',
                {
                    workspace_id: '*',
                    project_number: 5,
                    session_id: 'session-test-123',
                },
                personalDb,
                personalVec,
                undefined,
                config,
                undefined,
                teamDb,
                teamVec
            )) as { success: boolean; entriesIndexed?: number }
            expect(teamRes.success).toBe(true)
            expect(teamRes.entriesIndexed).toBe(12)
            expect(teamSpy).toHaveBeenCalledWith(undefined, { workspaceId: '*' })

            const personalRes = (await callTool(
                'rebuild_vector_index',
                {
                    workspace_id: '*',
                    project_number: 5,
                    session_id: 'session-test-123',
                },
                personalDb,
                personalVec,
                undefined,
                config,
                undefined,
                teamDb,
                teamVec
            )) as { success: boolean; entriesIndexed?: number }
            expect(personalRes.success).toBe(true)
            expect(personalRes.entriesIndexed).toBe(12)
            expect(personalSpy).toHaveBeenCalledWith(undefined, { workspaceId: '*' })
        })
    })

    describe('4. Strict Team schemas accept optional session_id', () => {
        it('parses session_id cleanly without Unrecognized key errors', () => {
            expect(
                TeamGetStatisticsSchema.safeParse({ session_id: 'sess-1', project_number: 5 })
                    .success
            ).toBe(true)
            expect(
                TeamLinkEntriesSchema.safeParse({
                    from_entry_id: 1,
                    to_entry_id: 2,
                    session_id: 'sess-1',
                }).success
            ).toBe(true)
            expect(
                TeamVisualizeRelationshipsSchema.safeParse({
                    entry_id: 1,
                    session_id: 'sess-1',
                }).success
            ).toBe(true)
            expect(
                TeamSemanticSearchSchema.safeParse({
                    query: 'healing',
                    session_id: 'sess-1',
                }).success
            ).toBe(true)
            expect(
                TeamAddToVectorIndexSchema.safeParse({
                    entry_id: 1,
                    session_id: 'sess-1',
                }).success
            ).toBe(true)
            expect(
                TeamCrossProjectInsightsSchema.safeParse({
                    session_id: 'sess-1',
                }).success
            ).toBe(true)
        })
    })
})
