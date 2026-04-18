/**
 * Kanban Payload Optimization Tests
 *
 * Tests summary_only mode, item_limit truncation, and the interplay
 * between the two for get_kanban_board.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { callTool as _callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import type { GitHubIntegration } from '../../src/github/github-integration.js'

const callTool = (name: any, params: any, db: any, vectorManager?: any, github?: any, config?: any, progress?: any, teamDb?: any, teamVector?: any) => 
    _callTool(name, params, db, vectorManager, github, config ?? { runtime: { maintenanceManager: { withActiveJob: (fn: any) => fn(), acquireMaintenanceLock: async () => {}, releaseMaintenanceLock: () => {} } }, io: { allowedRoots: [process.cwd()] } } as any, progress, teamDb, teamVector);


// ============================================================================
// Mock Data
// ============================================================================

function createMockBoard(itemsPerColumn: number) {
    const items = Array.from({ length: itemsPerColumn }, (_, i) => ({
        id: `PVTITEM_${String(i)}`,
        title: `Item ${String(i)}`,
        type: 'ISSUE',
        number: i + 1,
    }))

    return {
        projectId: 'PVT_1',
        projectNumber: 5,
        projectTitle: 'Test Board',
        statusFieldId: 'FIELD_1',
        statusOptions: [
            { id: 'OPT_TODO', name: 'Todo' },
            { id: 'OPT_PROGRESS', name: 'In Progress' },
            { id: 'OPT_DONE', name: 'Done' },
        ],
        columns: [
            {
                status: 'Todo',
                statusOptionId: 'OPT_TODO',
                items: items.slice(0, Math.floor(itemsPerColumn / 2)),
            },
            {
                status: 'In Progress',
                statusOptionId: 'OPT_PROGRESS',
                items: items.slice(
                    Math.floor(itemsPerColumn / 2),
                    Math.floor(itemsPerColumn / 2) + 5
                ),
            },
            { status: 'Done', statusOptionId: 'OPT_DONE', items },
        ],
        totalItems: itemsPerColumn + 5 + Math.floor(itemsPerColumn / 2),
    }
}

function createMockGitHub(overrides: Partial<Record<string, unknown>> = {}): GitHubIntegration {
    const defaults = {
        isApiAvailable: vi.fn().mockReturnValue(true),
        getRepoInfo: vi.fn().mockResolvedValue({
            owner: 'testowner',
            repo: 'testrepo',
            branch: 'main',
            remoteUrl: 'git@github.com:testowner/testrepo.git',
        }),
        getCachedRepoInfo: vi.fn().mockReturnValue({
            owner: 'testowner',
            repo: 'testrepo',
            branch: 'main',
            remoteUrl: 'git@github.com:testowner/testrepo.git',
        }),
        getProjectKanban: vi.fn().mockResolvedValue(createMockBoard(50)),
        moveProjectItem: vi.fn().mockResolvedValue({ success: true }),
        addProjectItem: vi.fn().mockResolvedValue({ success: true }),
        clearCache: vi.fn(),
    }
    return { ...defaults, ...overrides } as unknown as GitHubIntegration
}

// ============================================================================
// Tests
// ============================================================================

describe('Kanban Payload Optimization', () => {
    let db: DatabaseAdapter
    const testDbPath = './test-kanban-payload.db'

    beforeAll(async () => {
        db = new DatabaseAdapter(testDbPath)
        await db.initialize()
    })

    afterAll(() => {
        db.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
        } catch {
            // Ignore
        }
    })

    // =========================================================================
    // summary_only mode
    // =========================================================================

    describe('summary_only', () => {
        it('should return column summaries without items when summary_only is true', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_kanban_board',
                { project_number: 5, summary_only: true },
                db,
                undefined,
                github
            )) as {
                columns: { status: string; items: unknown[]; itemCount: number }[]
                summaryOnly: boolean
            }

            expect(result.summaryOnly).toBe(true)
            for (const col of result.columns) {
                expect(col.items).toHaveLength(0)
                expect(col.itemCount).toBeGreaterThanOrEqual(0)
            }
        })

        it('should treat item_limit: 0 as summary_only', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_kanban_board',
                { project_number: 5, item_limit: 0 },
                db,
                undefined,
                github
            )) as { columns: { items: unknown[] }[]; summaryOnly: boolean }

            expect(result.summaryOnly).toBe(true)
            for (const col of result.columns) {
                expect(col.items).toHaveLength(0)
            }
        })
    })

    // =========================================================================
    // item_limit truncation
    // =========================================================================

    describe('item_limit', () => {
        it('should truncate columns with more items than item_limit', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_kanban_board',
                { project_number: 5, item_limit: 3 },
                db,
                undefined,
                github
            )) as {
                columns: {
                    status: string
                    items: unknown[]
                    truncated?: boolean
                    itemCount: number
                }[]
            }

            // Done column has 50 items, should be truncated to 3
            const doneCol = result.columns.find((c) => c.status === 'Done')
            expect(doneCol).toBeDefined()
            expect(doneCol!.items).toHaveLength(3)
            expect(doneCol!.truncated).toBe(true)
            expect(doneCol!.itemCount).toBe(50)
        })

        it('should not truncate columns within the limit', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_kanban_board',
                { project_number: 5, item_limit: 100 },
                db,
                undefined,
                github
            )) as {
                columns: {
                    status: string
                    items: unknown[]
                    truncated?: boolean
                    itemCount: number
                }[]
            }

            // In Progress has 5 items, well within 100
            const progressCol = result.columns.find((c) => c.status === 'In Progress')
            expect(progressCol).toBeDefined()
            expect(progressCol!.truncated).toBeUndefined()
            expect(progressCol!.itemCount).toBe(5)
        })

        it('should use default item_limit of 25', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_kanban_board',
                { project_number: 5 },
                db,
                undefined,
                github
            )) as {
                columns: {
                    status: string
                    items: unknown[]
                    truncated?: boolean
                    itemCount: number
                }[]
            }

            // Done column has 50 items, should be truncated to 25
            const doneCol = result.columns.find((c) => c.status === 'Done')
            expect(doneCol).toBeDefined()
            expect(doneCol!.items).toHaveLength(25)
            expect(doneCol!.truncated).toBe(true)
            expect(doneCol!.itemCount).toBe(50)
        })
    })

    // =========================================================================
    // All columns carry itemCount
    // =========================================================================

    describe('itemCount metadata', () => {
        it('should always include itemCount on all columns', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_kanban_board',
                { project_number: 5, item_limit: 100 },
                db,
                undefined,
                github
            )) as { columns: { itemCount: number }[] }

            for (const col of result.columns) {
                expect(typeof col.itemCount).toBe('number')
            }
        })
    })
})
