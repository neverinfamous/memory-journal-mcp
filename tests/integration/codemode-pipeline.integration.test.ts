import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditLogger } from '../../src/audit/audit-logger.js'
import { createAuditInterceptor } from '../../src/audit/interceptor.js'
import { DatabaseAdapterFactory } from '../../src/database/adapter-factory.js'
import { parseToolFilter } from '../../src/filtering/tool-filter.js'
import { getGitHubIntegration } from '../../src/github/github-integration/index.js'
import { getSandboxPool } from '../../src/handlers/tools/codemode/singleton-state.js'
import { callTool } from '../../src/handlers/tools/index.js'
import type { IDatabaseAdapter, ToolHandlerConfig } from '../../src/types/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'

function isRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function getProp(obj: unknown, key: string): unknown {
    if (!isRecord(obj)) return undefined
    const found = Object.entries(obj).find(([k]) => k === key)
    return found ? found[1] : undefined
}

describe('Cross-Subsystem Integration: Code Mode End-to-End Pipeline', () => {
    let tempDir: string
    let auditLogPath: string
    let db: IDatabaseAdapter
    let teamDb: IDatabaseAdapter
    let runtime: ServerRuntime
    let auditLogger: AuditLogger
    let vectorManager: VectorSearchManager
    let teamVectorManager: VectorSearchManager
    const savedTeamAuthor = process.env['TEAM_AUTHOR']

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mj-codemode-int-'))
        auditLogPath = path.join(tempDir, 'audit.jsonl')

        db = await DatabaseAdapterFactory.create(':memory:')
        await db.initialize()

        teamDb = await DatabaseAdapterFactory.create(':memory:')
        await teamDb.initialize()
        teamDb.applyTeamSchema()

        runtime = new ServerRuntime()
        auditLogger = new AuditLogger({
            enabled: true,
            logPath: auditLogPath,
            redact: false,
            auditReads: true,
            maxSizeBytes: 1024 * 1024,
        })
        runtime.auditLogger = auditLogger
        runtime.auditInterceptor = createAuditInterceptor(auditLogger)

        vectorManager = new VectorSearchManager(db)
        teamVectorManager = new VectorSearchManager(teamDb)
        process.env['TEAM_AUTHOR'] = 'alice-dev'
    })

    afterEach(async () => {
        if (savedTeamAuthor === undefined) {
            delete process.env['TEAM_AUTHOR']
        } else {
            process.env['TEAM_AUTHOR'] = savedTeamAuthor
        }
        await auditLogger.close()
        db.close()
        teamDb.close()
        await fs.rm(tempDir, { recursive: true, force: true })
    })

    afterAll(() => {
        getSandboxPool().dispose()
    })

    function createConfig(overrides: Partial<ToolHandlerConfig> = {}): ToolHandlerConfig {
        return {
            codemodeEnabled: true,
            defaultProjectNumber: 101,
            defaultWorkspaceId: 'alpha-repo',
            projectRegistry: {
                'alpha-repo': { path: '/tmp/alpha', project_number: 101 },
                'beta-repo': { path: '/tmp/beta', project_number: 202 },
            },
            runtime,
            ...overrides,
        }
    }

    it('executes multi-step mj.core.* and mj.team.* workflows across real personal and team SQLite DBs', async () => {
        const config = createConfig()
        const github = getGitHubIntegration('.', runtime)

        const script = `
            const p1 = await mj.core.createEntry({
                content: '## Architecture Note\\nImplemented worker sandbox pool.',
                entry_type: 'technical_note',
                tags: ['codemode', 'architecture'],
                workspace_id: 'alpha-repo',
                project_number: 101
            });
            const p2 = await mj.core.createEntry({
                content: '## Verification\\nVerified isolation boundaries.',
                entry_type: 'test_entry',
                tags: ['codemode', 'verification'],
                workspace_id: 'alpha-repo',
                project_number: 101
            });
            const rel = await mj.core.linkEntries({
                from_entry_id: p2.entry.id,
                to_entry_id: p1.entry.id,
                relationship_type: 'references',
                description: 'Verifies architecture note'
            });
            const t1 = await mj.team.createEntry({
                content: '## Team Sync\\nShared sandbox findings with team.',
                entry_type: 'technical_note',
                tags: ['team-sync'],
                workspace_id: 'alpha-repo',
                project_number: 101
            });
            const recentPersonal = await mj.core.getRecentEntries({ limit: 5, workspace_id: 'alpha-repo' });
            const recentTeam = await mj.team.teamGetRecent({ limit: 5, workspace_id: 'alpha-repo', project_number: 101 });
            return {
                p1Id: p1.entry.id,
                p2Id: p2.entry.id,
                relSuccess: rel.success,
                teamEntryId: t1.entry.id,
                teamAuthor: t1.entry.author,
                personalCount: recentPersonal.entries.length,
                teamCount: recentTeam.entries.length
            };
        `

        const res = await callTool(
            'mj_execute_code',
            { code: script, workspace_id: 'alpha-repo', project_number: 101 },
            db,
            vectorManager,
            github,
            config,
            undefined,
            teamDb,
            teamVectorManager
        )

        expect(getProp(res, 'success')).toBe(true)
        const resultObj = getProp(res, 'result')
        expect(getProp(resultObj, 'p1Id')).toBe(1)
        expect(getProp(resultObj, 'p2Id')).toBe(2)
        expect(getProp(resultObj, 'relSuccess')).toBe(true)
        expect(getProp(resultObj, 'teamEntryId')).toBe(1)
        expect(getProp(resultObj, 'teamAuthor')).toBe('alice-dev')
        expect(getProp(resultObj, 'personalCount')).toBe(2)
        expect(getProp(resultObj, 'teamCount')).toBe(1)

        expect(db.getEntryById(1, 'alpha-repo')?.content).toContain('Implemented worker sandbox pool')
        expect(teamDb.getEntryById(1, 'alpha-repo')?.content).toContain('Shared sandbox findings with team')
    })

    it('enforces projectRegistry string resolution and workspace_id isolation inside Code Mode', async () => {
        const config = createConfig({ defaultProjectNumber: undefined, defaultWorkspaceId: undefined })
        const github = getGitHubIntegration('.', runtime)

        const script = `
            const alphaEntry = await mj.core.createEntry({
                content: 'Alpha workspace entry',
                entry_type: 'technical_note',
                project_number: 'alpha-repo',
                workspace_id: 'alpha-repo'
            });
            const betaEntry = await mj.core.createEntry({
                content: 'Beta workspace entry',
                entry_type: 'technical_note',
                project_number: 'beta-repo',
                workspace_id: 'beta-repo'
            });
            const alphaOnly = await mj.core.getRecentEntries({ workspace_id: 'alpha-repo', limit: 10 });
            const betaOnly = await mj.core.getRecentEntries({ workspace_id: 'beta-repo', limit: 10 });
            const crossLookupBlocked = await mj.core.getEntryById({
                entry_id: betaEntry.entry.id,
                workspace_id: 'alpha-repo'
            });
            return {
                alphaProj: alphaEntry.entry.projectNumber,
                betaProj: betaEntry.entry.projectNumber,
                alphaCount: alphaOnly.entries.length,
                betaCount: betaOnly.entries.length,
                crossLookupSuccess: crossLookupBlocked.success
            };
        `

        const res = await callTool(
            'mj_execute_code',
            { code: script, project_number: 'alpha-repo', workspace_id: 'alpha-repo' },
            db,
            vectorManager,
            github,
            config,
            undefined,
            teamDb,
            teamVectorManager
        )

        expect(getProp(res, 'success')).toBe(true)
        const resultObj = getProp(res, 'result')
        expect(getProp(resultObj, 'alphaProj')).toBe(101)
        expect(getProp(resultObj, 'betaProj')).toBe(202)
        expect(getProp(resultObj, 'alphaCount')).toBe(1)
        expect(getProp(resultObj, 'betaCount')).toBe(1)
        expect(getProp(resultObj, 'crossLookupSuccess')).toBe(false)
    })

    it('enforces readonly execution mode and parseToolFilter("readonly") in the worker sandbox', async () => {
        const github = getGitHubIntegration('.', runtime)

        await callTool(
            'create_entry',
            {
                content: 'Seeded entry before readonly lock',
                entry_type: 'technical_note',
                workspace_id: 'alpha-repo',
                project_number: 101,
            },
            db,
            vectorManager,
            github,
            createConfig()
        )

        const writeAttempt = await callTool(
            'mj_execute_code',
            {
                code: `const target = await mj.core.getEntryById({ entry_id: 1, workspace_id: 'alpha-repo' }); return await mj.core.deleteEntry({ entry_id: target.entry.id, workspace_id: 'alpha-repo' });`,
                readonly: true,
                workspace_id: 'alpha-repo',
                project_number: 101,
            },
            db,
            vectorManager,
            github,
            createConfig({ agentHealing: false })
        )
        expect(getProp(writeAttempt, 'success')).toBe(true)
        const innerWriteResult = getProp(writeAttempt, 'result')
        expect(getProp(innerWriteResult, 'success')).toBe(false)
        expect(String(getProp(innerWriteResult, 'error'))).toMatch(/not found in group|blocked in readonly|Available:/i)
        expect(db.getEntryById(1, 'alpha-repo')).not.toBeNull()

        const readSuccess = await callTool(
            'mj_execute_code',
            {
                code: `
                    const recent = await mj.core.getRecentEntries({ workspace_id: 'alpha-repo', limit: 5 });
                    const helpInfo = await mj.core.help();
                    const blockedDel = await mj.core.deleteEntry({ entry_id: 1, workspace_id: 'alpha-repo' });
                    return { count: recent.entries.length, methods: helpInfo.methods, blockedSuccess: blockedDel.success };
                `,
                workspace_id: 'alpha-repo',
                project_number: 101,
            },
            db,
            vectorManager,
            github,
            createConfig({ filterConfig: parseToolFilter('readonly'), agentHealing: false })
        )
        expect(getProp(readSuccess, 'success')).toBe(true)
        const readResult = getProp(readSuccess, 'result')
        expect(getProp(readResult, 'count')).toBe(1)
        const exposedMethods = getProp(readResult, 'methods')
        expect(exposedMethods).not.toContain('createEntry')
        expect(exposedMethods).not.toContain('deleteEntry')
        expect(getProp(readResult, 'blockedSuccess')).toBe(false)
        expect(db.getEntryById(1, 'alpha-repo')).not.toBeNull()
    })

    it('enforces Team RBAC inside Code Mode when RBAC is active (viewer vs member/admin)', async () => {
        const github = getGitHubIntegration('.', runtime)
        teamDb.addTeamMember('lead-admin', 'admin', 'system', 'Lead Admin')

        process.env['TEAM_AUTHOR'] = 'viewer-bob'
        const viewerRes = await callTool(
            'mj_execute_code',
            {
                code: `
                    const readRes = await mj.team.teamGetRecent({ project_number: 101, workspace_id: 'alpha-repo' });
                    const writeRes = await mj.team.createEntry({
                        content: 'Unauthorized write attempt by viewer',
                        entry_type: 'technical_note',
                        project_number: 101,
                        workspace_id: 'alpha-repo'
                    });
                    return { readSuccess: readRes.success !== false, writeRes };
                `,
                workspace_id: 'alpha-repo',
                project_number: 101,
            },
            db,
            vectorManager,
            github,
            createConfig({ teamDefaultRole: 'viewer' }),
            undefined,
            teamDb,
            teamVectorManager
        )

        expect(getProp(viewerRes, 'success')).toBe(true)
        const viewerResult = getProp(viewerRes, 'result')
        expect(getProp(viewerResult, 'readSuccess')).toBe(true)
        const writeRes = getProp(viewerResult, 'writeRes')
        expect(getProp(writeRes, 'success')).toBe(false)
        expect(getProp(writeRes, 'code')).toBe('AUTHORIZATION_FAILED')

        process.env['TEAM_AUTHOR'] = 'lead-admin'
        const adminRes = await callTool(
            'mj_execute_code',
            {
                code: `
                    const created = await mj.team.createEntry({
                        content: 'Authorized admin team note',
                        entry_type: 'technical_note',
                        project_number: 101,
                        workspace_id: 'alpha-repo'
                    });
                    const deleted = await mj.team.deleteEntry({
                        entry_id: created.entry.id,
                        project_number: 101,
                        workspace_id: 'alpha-repo'
                    });
                    return { createdSuccess: created.success, deletedSuccess: deleted.success };
                `,
                workspace_id: 'alpha-repo',
                project_number: 101,
            },
            db,
            vectorManager,
            github,
            createConfig({ teamDefaultRole: 'viewer' }),
            undefined,
            teamDb,
            teamVectorManager
        )

        expect(getProp(adminRes, 'success')).toBe(true)
        const adminResult = getProp(adminRes, 'result')
        expect(getProp(adminResult, 'createdSuccess')).toBe(true)
        expect(getProp(adminResult, 'deletedSuccess')).toBe(true)
    })

    it('records inner per-tool telemetry in MetricsAccumulator and AuditLogger (C-3 verification)', async () => {
        const config = createConfig()
        const github = getGitHubIntegration('.', runtime)

        const execRes = await callTool(
            'mj_execute_code',
            {
                code: `
                    const entry = await mj.core.createEntry({ content: 'Telemetry entry', entry_type: 'technical_note', workspace_id: 'alpha-repo', project_number: 101 });
                    const recent = await mj.core.getRecentEntries({ workspace_id: 'alpha-repo', limit: 5 });
                    const teamEntry = await mj.team.createEntry({ content: 'Team telemetry entry', entry_type: 'technical_note', workspace_id: 'alpha-repo', project_number: 101 });
                    return { id: entry.entry.id, count: recent.entries.length, teamId: teamEntry.entry.id };
                `,
                workspace_id: 'alpha-repo',
                project_number: 101,
            },
            db,
            vectorManager,
            github,
            config,
            undefined,
            teamDb,
            teamVectorManager
        )

        expect(getProp(execRes, 'success')).toBe(true)

        const breakdown = runtime.metrics.getSummary().toolBreakdown
        expect(getProp(getProp(breakdown, 'mj_execute_code'), 'callCount')).toBe(1)
        expect(getProp(getProp(breakdown, 'create_entry'), 'callCount')).toBe(1)
        expect(getProp(getProp(breakdown, 'get_recent_entries'), 'callCount')).toBe(1)
        expect(getProp(getProp(breakdown, 'team_create_entry'), 'callCount')).toBe(1)

        const auditRes = await callTool('search_audit_log', { limit: 20 }, db, vectorManager, github, config)
        expect(getProp(auditRes, 'success')).toBe(true)
        const results = getProp(auditRes, 'results')
        expect(Array.isArray(results)).toBe(true)
        const auditedTools = Array.isArray(results) ? results.map((e) => String(getProp(e, 'tool'))) : []
        expect(auditedTools).toContain('create_entry')
        expect(auditedTools).toContain('get_recent_entries')
        expect(auditedTools).toContain('team_create_entry')
        expect(auditedTools).toContain('mj_execute_code')
    })
})
