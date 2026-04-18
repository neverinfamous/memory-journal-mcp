/**
 * MAX_QUERY_LIMIT Enforcement Tests
 *
 * Verifies that all paginated tools enforce the shared MAX_QUERY_LIMIT (500)
 * constant and return structured validation errors for out-of-bounds values.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { callTool as _callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { MAX_QUERY_LIMIT } from '../../src/handlers/tools/schemas.js'
import type { GitHubIntegration } from '../../src/github/github-integration/index.js'

const callTool = (name: any, params: any, db: any, vectorManager?: any, github?: any, config?: any, progress?: any, teamDb?: any, teamVector?: any) => 
    _callTool(name, params, db, vectorManager, github, config ?? { runtime: { maintenanceManager: { withActiveJob: (fn: any) => fn(), acquireMaintenanceLock: async () => {}, releaseMaintenanceLock: () => {} } }, io: { allowedRoots: [process.cwd()] } } as any, progress, teamDb, teamVector);


function createMockGitHub(): GitHubIntegration {
    return {
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
        getIssues: vi.fn().mockResolvedValue([]),
        getPullRequests: vi.fn().mockResolvedValue([]),
        clearCache: vi.fn(),
    } as unknown as GitHubIntegration
}

describe('MAX_QUERY_LIMIT Enforcement', () => {
    let db: DatabaseAdapter
    const testDbPath = './test-max-query-limit.db'

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

    it('MAX_QUERY_LIMIT should be 500', () => {
        expect(MAX_QUERY_LIMIT).toBe(500)
    })

    // =========================================================================
    // Core tools
    // =========================================================================

    describe('get_recent_entries', () => {
        it('should accept limit at MAX_QUERY_LIMIT', async () => {
            const result = (await callTool(
                'get_recent_entries',
                { limit: MAX_QUERY_LIMIT },
                db
            )) as { entries: unknown[] }

            expect(result.entries).toBeDefined()
        })

        it('should reject limit above MAX_QUERY_LIMIT', async () => {
            const result = (await callTool(
                'get_recent_entries',
                { limit: MAX_QUERY_LIMIT + 1 },
                db
            )) as { success: boolean; error: string; code: string }

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION_ERROR')
        })
    })

    // =========================================================================
    // GitHub list tools
    // =========================================================================

    describe('get_github_issues', () => {
        it('should accept limit at MAX_QUERY_LIMIT', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_github_issues',
                { limit: MAX_QUERY_LIMIT },
                db,
                undefined,
                github
            )) as { issues: unknown[] }

            expect(result.issues).toBeDefined()
        })

        it('should reject limit above MAX_QUERY_LIMIT', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_github_issues',
                { limit: MAX_QUERY_LIMIT + 1 },
                db,
                undefined,
                github
            )) as { success: boolean; code: string }

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION_ERROR')
        })
    })

    describe('get_github_prs', () => {
        it('should accept limit at MAX_QUERY_LIMIT', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_github_prs',
                { limit: MAX_QUERY_LIMIT },
                db,
                undefined,
                github
            )) as { pullRequests: unknown[] }

            expect(result.pullRequests).toBeDefined()
        })

        it('should reject limit above MAX_QUERY_LIMIT', async () => {
            const github = createMockGitHub()
            const result = (await callTool(
                'get_github_prs',
                { limit: MAX_QUERY_LIMIT + 1 },
                db,
                undefined,
                github
            )) as { success: boolean; code: string }

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION_ERROR')
        })
    })

    // =========================================================================
    // Search tools
    // =========================================================================

    describe('search_entries', () => {
        it('should accept limit at MAX_QUERY_LIMIT', async () => {
            const result = (await callTool(
                'search_entries',
                { query: 'test', limit: MAX_QUERY_LIMIT },
                db
            )) as { entries: unknown[] }

            expect(result.entries).toBeDefined()
        })

        it('should reject limit above MAX_QUERY_LIMIT', async () => {
            const result = (await callTool(
                'search_entries',
                { query: 'test', limit: MAX_QUERY_LIMIT + 1 },
                db
            )) as { success: boolean; code: string }

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION_ERROR')
        })
    })
})
