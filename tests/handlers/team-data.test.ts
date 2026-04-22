/**
 * Team Backup and Export Tool Handler Tests
 *
 * Tests the team export/backup tool group: team_export_entries, team_backup, team_list_backups
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { callTool as _callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

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
        config ??
            ({
                runtime: {
                    maintenanceManager: {
                        withActiveJob: (fn: any) => fn(),
                        acquireMaintenanceLock: async () => {},
                        releaseMaintenanceLock: () => {},
                    },
                },
                io: { allowedRoots: [process.cwd()] },
            } as any),
        progress,
        teamDb,
        teamVector
    )

vi.mock('../../src/auth/auth-context.js', async (importOriginal: any) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAuthContext: () => ({
            authenticated: true,
            claims: { sub: 'test-user', scopes: ['team', 'write', 'admin'] },
        }),
    }
})

describe('Team Backup and Export Tool Handlers', () => {
    let personalDb: DatabaseAdapter
    let teamDb: DatabaseAdapter
    const personalDbPath = './test-team-data-personal.db'
    const teamDbPath = './test-team-data-team.db'

    beforeAll(async () => {
        try {
            const fs = require('node:fs')
            if (fs.existsSync(personalDbPath)) fs.unlinkSync(personalDbPath)
            if (fs.existsSync(teamDbPath)) fs.unlinkSync(teamDbPath)
        } catch {}

        personalDb = new DatabaseAdapter(personalDbPath)
        await personalDb.initialize()

        teamDb = new DatabaseAdapter(teamDbPath)
        await teamDb.initialize()
        teamDb.applyTeamSchema()

        // Seed entries for export/backup
        const r1 = (await callTool(
            'team_create_entry',
            {
                project_number: 1,
                content: 'Export test 1',
                tags: ['export-1'],
                entry_type: 'technical_note',
            },
            personalDb,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        const r2 = (await callTool(
            'team_create_entry',
            {
                project_number: 1,
                content: 'Export test 2',
                entry_type: 'project_decision',
            },
            personalDb,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any

        expect(r1.success).toBe(true)
        expect(r2.success).toBe(true)
    })

    afterAll(() => {
        personalDb.close()
        teamDb.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(personalDbPath)) fs.unlinkSync(personalDbPath)
            if (fs.existsSync(teamDbPath)) fs.unlinkSync(teamDbPath)

            // Clean up team backups directory
            const backupsDir = teamDb.getBackupsDir()
            if (fs.existsSync(backupsDir)) {
                const files = fs.readdirSync(backupsDir)
                for (const f of files) {
                    fs.unlinkSync(`${backupsDir}/${f}`)
                }
            }
        } catch {
            // Ignore cleanup errors
        }
    })

    describe('team_export_entries', () => {
        it('should export team entries in JSON format', async () => {
            const result = (await callTool(
                'team_export_entries',
                {
                    project_number: 1,
                    format: 'json',
                },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.success).toBe(true)
            expect(result.format).toBe('json')
            expect(result.count).toBeGreaterThan(0)
            const parsed = JSON.parse(result.data)
            expect(parsed.length).toBeGreaterThan(0)
            expect(parsed[0].content).toBeDefined()
        })

        it('should export team entries in Markdown format', async () => {
            const result = (await callTool(
                'team_export_entries',
                {
                    project_number: 1,
                    format: 'markdown',
                },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.success).toBe(true)
            expect(result.format).toBe('markdown')
            expect(result.data).toContain('# Team Journal Export')
            expect(result.data).toContain('Export test 1')
        })

        it('should filter export by tags and entry_type', async () => {
            const result = (await callTool(
                'team_export_entries',
                {
                    project_number: 1,
                    format: 'json',
                    tags: ['export-1'],
                    entry_type: 'technical_note',
                },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            console.error('DEBUG TEAM DATA EXPORT', JSON.stringify(result, null, 2))
            expect(result.success).toBe(true)
            expect(result.count).toBe(1)
            const parsed = JSON.parse(result.data)
            expect(parsed[0].tags).toContain('export-1')
        })

        it('should return error if team DB is not configured', async () => {
            const result = (await callTool(
                'team_export_entries',
                {
                    project_number: 1,
                    format: 'json',
                },
                personalDb
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })
    })

    describe('team_backup and team_list_backups', () => {
        it('should return error if team DB is not configured for backup', async () => {
            const result = (await callTool(
                'team_backup',
                {
                    project_number: 1,
                },
                personalDb
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })

        it('should return error if team DB is not configured for list', async () => {
            const result = (await callTool(
                'team_list_backups',
                {
                    project_number: 1,
                },
                personalDb
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })

        it('should create and list team backups', async () => {
            const backupResult = (await callTool(
                'team_backup',
                {
                    project_number: 1,
                    name: 'test-team-backup',
                },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(backupResult.success).toBe(true)
            expect(backupResult.filename).toContain('test-team-backup')
            expect(backupResult.sizeBytes).toBeGreaterThan(0)

            const listResult = (await callTool(
                'team_list_backups',
                {
                    project_number: 1,
                },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(listResult.success).toBe(true)
            expect(listResult.total).toBeGreaterThanOrEqual(1)
            expect(listResult.backups.some((b: any) => b.filename === backupResult.filename)).toBe(
                true
            )
            expect(listResult.hint).toBeUndefined()
        })
    })
})
