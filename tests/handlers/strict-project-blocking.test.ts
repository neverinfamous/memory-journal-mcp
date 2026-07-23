import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { callTool as _callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

const mockConfig = {
    runtime: {
        maintenanceManager: {
            withActiveJob: (fn: any) => fn(),
            acquireMaintenanceLock: async () => {},
            releaseMaintenanceLock: () => {},
        },
    },
    io: { allowedRoots: [process.cwd()] },
    projectRegistry: {}
} as any

const callTool = (
    name: any,
    params: any,
    db: any,
    vectorManager?: any,
    github?: any,
    config?: any,
    progress?: any,
    teamDb?: any,
    teamVector?: any
) =>
    _callTool(
        name,
        params,
        db,
        vectorManager,
        github,
        config ?? mockConfig,
        progress,
        teamDb,
        teamVector
    )

describe('Strict Project Blocking in Entry Creation', () => {
    let db: DatabaseAdapter
    const testDbPath = './.test-output/vitest/test-strict-project.db'
    let cwdSpy: any

    beforeAll(async () => {
        db = new DatabaseAdapter(testDbPath)
        await db.initialize()
        // Mock process.cwd to a temporary directory so path-based auto-resolution returns undefined
        cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('C:\\tmp\\unregistered-project')
    })

    afterAll(() => {
        cwdSpy.mockRestore()
        db.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
        } catch {
            // Ignore cleanup
        }
    })

    it('blocks create_entry when project_number cannot be resolved', async () => {
        const res = await callTool('create_entry', {
            content: 'Generic note with no project context',
            entry_type: 'technical_note',
            tags: ['random-tag'],
            impact_score: 0.5,
            trust_score: 0.8,
            validation_status: 'passed'
        }, db)

        expect(res.success).toBe(false)
        expect(res.code).toBe('VALIDATION_ERROR')
        expect(res.error).toContain('Missing or unresolvable project_number')
    })

    it('allows create_entry when project_number is explicitly provided', async () => {
        const res = await callTool('create_entry', {
            content: 'Technical note for unit testing explicit project_number',
            entry_type: 'technical_note',
            tags: ['unit-test'],
            workspace_id: 'mysql-mcp',
            project_number: 99,
            impact_score: 0.5,
            trust_score: 0.8,
            validation_status: 'passed'
        }, db)

        expect(res.success).toBe(true)
        expect(res.entry).toBeDefined()
        expect(res.entry.projectNumber).toBe(99)
    })

    it('blocks team_create_entry when project_number cannot be resolved', async () => {
        const res = await callTool('team_create_entry', {
            content: 'Team note without project context',
            entry_type: 'technical_note',
            tags: ['general'],
            impact_score: 0.5,
            trust_score: 0.8,
            validation_status: 'passed'
        }, db, undefined, undefined, undefined, undefined, db)

        expect(res.success).toBe(false)
        expect(res.code).toBe('VALIDATION_ERROR')
        expect(res.error).toContain('Missing or unresolvable project_number')
    })
})
