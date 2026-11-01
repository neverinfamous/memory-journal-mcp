/**
 * Cross-Subsystem Integration Test 5:
 * OAuth Scope Enforcement + Team RBAC + AuditLogger Telemetry +
 * DatabaseAdapterProxy (`use_test_db`) + Workspace Isolation (Critical C-4 Fix)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { DatabaseAdapterProxy } from '../../src/database/core/DatabaseAdapterProxy.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { readResource, validateResourceSubscription } from '../../src/handlers/resources/index.js'
import { runWithAuthContext } from '../../src/auth/auth-context.js'
import type { AuthenticatedContext } from '../../src/auth/middleware.js'
import { AuditLogger, createAuditInterceptor } from '../../src/audit/index.js'
import type { AuditEntry } from '../../src/audit/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { requestContextStorage } from '../../src/utils/request-context.js'
import { PermissionError } from '../../src/types/errors.js'
import type { ToolHandlerConfig } from '../../src/types/index.js'

interface ToolResponse {
    success?: boolean
    id?: number
    count?: number
    results?: AuditEntry[]
    error?: string
    code?: string
    category?: string
}

function isToolResponse(val: unknown): val is ToolResponse {
    return typeof val === 'object' && val !== null
}

function makeAuthContext(sub: string, scopes: string[]): AuthenticatedContext {
    const now = Math.floor(Date.now() / 1000)
    return {
        authenticated: true,
        scopes,
        claims: { sub, scopes, exp: now + 3600, iat: now },
    }
}

describe('OAuth Scopes, Team RBAC, Audit Boundary & DatabaseAdapterProxy Integration', () => {
    const baseDir = path.resolve(process.cwd(), '.test-output', 'integration-oauth-rbac-audit')
    const primaryDbPath = path.join(baseDir, 'primary.db')
    const testDbPath = path.join(baseDir, 'test.db')
    const teamDbPath = path.join(baseDir, 'team.db')
    const auditLogPath = path.join(baseDir, 'audit.jsonl')

    let primaryDb: DatabaseAdapter
    let testDb: DatabaseAdapter
    let teamDb: DatabaseAdapter
    let proxiedDb: IDatabaseAdapter
    let auditLogger: AuditLogger
    let runtime: ServerRuntime
    let config: ToolHandlerConfig

    beforeAll(async () => {
        await fs.rm(baseDir, { recursive: true, force: true })
        await fs.mkdir(baseDir, { recursive: true })

        primaryDb = new DatabaseAdapter(primaryDbPath)
        await primaryDb.initialize()
        testDb = new DatabaseAdapter(testDbPath)
        await testDb.initialize()
        teamDb = new DatabaseAdapter(teamDbPath)
        await teamDb.initialize()
        teamDb.applyTeamSchema()

        proxiedDb = DatabaseAdapterProxy.create(primaryDb, testDb)

        auditLogger = new AuditLogger({
            enabled: true,
            logPath: auditLogPath,
            redact: false,
            auditReads: true,
        })

        runtime = new ServerRuntime()
        runtime.auditLogger = auditLogger
        runtime.auditInterceptor = createAuditInterceptor(auditLogger)

        config = {
            oauthEnabled: true,
            teamDefaultRole: 'denied',
            defaultProjectNumber: 77,
            projectRegistry: {
                'ws-alpha': { path: path.join(baseDir, 'alpha'), project_number: 77 },
                'ws-beta': { path: path.join(baseDir, 'beta'), project_number: 88 },
            },
            runtime,
        }
    })

    afterAll(async () => {
        await auditLogger.close()
        primaryDb.close()
        testDb.close()
        teamDb.close()
        await fs.rm(baseDir, { recursive: true, force: true }).catch(() => undefined)
    })

    it('enforces OAuth scopes across callTool, readResource, and validateResourceSubscription and records denials to AuditLogger', async () => {
        const readOnlyCtx = makeAuthContext('reader-user', ['read'])
        const writeCtx = makeAuthContext('writer-user', ['write'])
        const adminCtx = makeAuthContext('admin-user', ['admin'])

        await runWithAuthContext(readOnlyCtx, async () => {
            const recentRes = await callTool('get_recent_entries', { limit: 5, workspace_id: 'ws-alpha' }, proxiedDb, undefined, undefined, config, undefined, teamDb)
            expect(isToolResponse(recentRes)).toBe(true)
            expect(() => validateResourceSubscription('memory://recent', runtime)).not.toThrow()
        })

        await runWithAuthContext(readOnlyCtx, async () => {
            await expect(
                callTool('create_entry', { content: 'Unauthorized write attempt', entry_type: 'technical_note', workspace_id: 'ws-alpha' }, proxiedDb, undefined, undefined, config, undefined, teamDb)
            ).rejects.toThrow(PermissionError)

            await expect(
                callTool('team_get_recent', { limit: 5 }, proxiedDb, undefined, undefined, config, undefined, teamDb)
            ).rejects.toThrow(PermissionError)

            await expect(
                readResource('memory://audit', proxiedDb, undefined, null, null, null, teamDb, undefined, runtime)
            ).rejects.toThrow(PermissionError)

            expect(() => validateResourceSubscription('memory://audit', runtime)).toThrow(PermissionError)
            expect(() => validateResourceSubscription('memory://team/recent', runtime)).toThrow(PermissionError)
        })

        await runWithAuthContext(writeCtx, async () => {
            const createRes = await callTool(
                'create_entry',
                { content: 'Authorized write entry in primaryDb via write scope', entry_type: 'technical_note', workspace_id: 'ws-alpha' },
                proxiedDb,
                undefined,
                undefined,
                config,
                undefined,
                teamDb
            )
            expect(isToolResponse(createRes) && createRes.success).toBe(true)

            await expect(
                callTool('search_audit_log', { limit: 10 }, proxiedDb, undefined, undefined, config, undefined, teamDb)
            ).rejects.toThrow(PermissionError)
        })

        await runWithAuthContext(adminCtx, async () => {
            const auditResource = await readResource('memory://audit', proxiedDb, undefined, null, null, null, teamDb, undefined, runtime)
            expect(typeof auditResource.data).toBe('string')
            const auditText = String(auditResource.data)
            expect(auditText).toContain('Access Denied: Insufficient scope')
            expect(auditText).toContain('tool: create_entry')
            expect(auditText).toContain('tool: memory://audit')

            const searchAuditRes = await callTool('search_audit_log', { status: false, limit: 20 }, proxiedDb, undefined, undefined, config, undefined, teamDb)
            expect(isToolResponse(searchAuditRes)).toBe(true)
            if (isToolResponse(searchAuditRes)) {
                expect(searchAuditRes.success).toBe(true)
                expect(searchAuditRes.count).toBeGreaterThanOrEqual(4)
                const deniedTools = (searchAuditRes.results ?? []).map((r) => r.tool)
                expect(deniedTools).toEqual(
                    expect.arrayContaining(['create_entry', 'team_get_recent', 'memory://audit', 'search_audit_log'])
                )
            }
        })
    })

    it('enforces Team RBAC roles (admin, member, viewer, denied) and author ownership boundaries', async () => {
        const adminCtx = makeAuthContext('alice-admin', ['admin', 'team'])
        const memberCtx = makeAuthContext('bob-member', ['team'])
        const viewerCtx = makeAuthContext('charlie-viewer', ['team'])
        const outsiderCtx = makeAuthContext('eve-outsider', ['team'])

        await runWithAuthContext(adminCtx, async () => {
            const bootstrapRes = await callTool('team_add_member', { author: 'alice-admin', role: 'admin', display_name: 'Alice Admin' }, proxiedDb, undefined, undefined, config, undefined, teamDb)
            expect(isToolResponse(bootstrapRes) && bootstrapRes.success).toBe(true)

            const addBob = await callTool('team_add_member', { author: 'bob-member', role: 'member', display_name: 'Bob Member' }, proxiedDb, undefined, undefined, config, undefined, teamDb)
            expect(isToolResponse(addBob) && addBob.success).toBe(true)

            const addCharlie = await callTool('team_add_member', { author: 'charlie-viewer', role: 'viewer', display_name: 'Charlie Viewer' }, proxiedDb, undefined, undefined, config, undefined, teamDb)
            expect(isToolResponse(addCharlie) && addCharlie.success).toBe(true)
        })

        expect(teamDb.isTeamRbacActive()).toBe(true)

        await runWithAuthContext(outsiderCtx, async () => {
            const outsiderRead = await callTool('team_get_recent', { limit: 5 }, proxiedDb, undefined, undefined, config, undefined, teamDb)
            expect(isToolResponse(outsiderRead)).toBe(true)
            if (isToolResponse(outsiderRead)) {
                expect(outsiderRead.success).toBe(false)
                expect(outsiderRead.error).toContain('not registered')
            }
        })

        await runWithAuthContext(viewerCtx, async () => {
            const viewerRead = await callTool('team_get_recent', { limit: 5 }, proxiedDb, undefined, undefined, config, undefined, teamDb)
            expect(isToolResponse(viewerRead) && viewerRead.error).toBeUndefined()

            const viewerWrite = await callTool(
                'team_create_entry',
                {
                    content: '## Summary\nViewer attempting to write',
                    entry_type: 'technical_note',
                    project_number: 77,
                    workspace_id: 'ws-alpha',
                    impact_score: 0.3,
                    trust_score: 0.8,
                    validation_status: 'passed',
                },
                proxiedDb,
                undefined,
                undefined,
                config,
                undefined,
                teamDb
            )
            expect(isToolResponse(viewerWrite)).toBe(true)
            if (isToolResponse(viewerWrite)) {
                expect(viewerWrite.success).toBe(false)
                expect(viewerWrite.error).toContain("required 'member' role")
            }
        })

        await runWithAuthContext(memberCtx, async () => {
            const impersonateRes = await callTool(
                'team_create_entry',
                {
                    content: '## Summary\nAttempting author spoofing',
                    entry_type: 'technical_note',
                    author: 'alice-admin',
                    project_number: 77,
                    workspace_id: 'ws-alpha',
                    impact_score: 0.5,
                    trust_score: 0.9,
                    validation_status: 'passed',
                },
                proxiedDb,
                undefined,
                undefined,
                config,
                undefined,
                teamDb
            )
            expect(isToolResponse(impersonateRes)).toBe(true)
            if (isToolResponse(impersonateRes)) {
                expect(impersonateRes.success).toBe(false)
                expect(impersonateRes.code).toBe('PERMISSION_DENIED')
            }

            const memberCreate = await callTool(
                'team_create_entry',
                {
                    content: '## Summary\nLegitimate member team entry',
                    entry_type: 'technical_note',
                    project_number: 77,
                    workspace_id: 'ws-alpha',
                    impact_score: 0.5,
                    trust_score: 0.9,
                    validation_status: 'passed',
                },
                proxiedDb,
                undefined,
                undefined,
                config,
                undefined,
                teamDb
            )
            expect(isToolResponse(memberCreate) && memberCreate.success).toBe(true)
        })
    })

    it('routes mutations to testDb when use_test_db is active via DatabaseAdapterProxy and isolates workspaces (C-4 fix)', async () => {
        const adminCtx = makeAuthContext('admin-user', ['admin'])
        const primaryCountBefore = primaryDb.getActiveEntryCount('ws-alpha')
        expect(testDb.getActiveEntryCount('ws-alpha')).toBe(0)

        await runWithAuthContext(adminCtx, async () => {
            const testCreateRes = await callTool(
                'create_entry',
                {
                    content: 'Isolated test database entry via use_test_db flag',
                    entry_type: 'technical_note',
                    workspace_id: 'ws-alpha',
                    project_number: 999,
                    use_test_db: true,
                },
                proxiedDb,
                undefined,
                undefined,
                config,
                undefined,
                teamDb
            )
            expect(isToolResponse(testCreateRes) && testCreateRes.success).toBe(true)
        })

        expect(primaryDb.getActiveEntryCount('ws-alpha')).toBe(primaryCountBefore)
        expect(testDb.getActiveEntryCount('ws-alpha')).toBe(1)

        requestContextStorage.run({ useTestDb: true }, () => {
            const alphaWf = proxiedDb.createEntry({
                content: 'Alpha CI workflow run and milestone',
                entryType: 'technical_note',
                tags: ['ci-alpha'],
                workspaceId: 'ws-alpha',
                projectNumber: 77,
                workflowRunId: 5001,
                workflowName: 'build-alpha',
                workflowStatus: 'success',
                significanceType: 'milestone',
                timestamp: '2025-01-01T00:00:00.000Z',
            })

            const betaWf = proxiedDb.createEntry({
                content: 'Beta CI workflow run and architectural breakthrough',
                entryType: 'technical_note',
                tags: ['ci-beta'],
                workspaceId: 'ws-beta',
                projectNumber: 88,
                workflowRunId: 6002,
                workflowName: 'build-beta',
                workflowStatus: 'failure',
                significanceType: 'architectural',
                timestamp: '2025-01-01T00:00:00.000Z',
            })

            const alphaDel = proxiedDb.createEntry({
                content: 'Alpha entry to be soft-deleted',
                entryType: 'personal_reflection',
                workspaceId: 'ws-alpha',
            })
            const betaDel = proxiedDb.createEntry({
                content: 'Beta entry to be soft-deleted',
                entryType: 'personal_reflection',
                workspaceId: 'ws-beta',
            })

            proxiedDb.deleteEntry(alphaDel.id, false)
            proxiedDb.deleteEntry(betaDel.id, false)

            expect(proxiedDb.getDeletedEntries({ workspaceId: 'ws-alpha' }).entries[0]?.id).toBe(alphaDel.id)
            expect(proxiedDb.getDeletedEntries({ workspaceId: 'ws-beta' }).entries[0]?.id).toBe(betaDel.id)
            expect(proxiedDb.getWorkflowActionEntries(10, 'ws-alpha')[0]?.id).toBe(alphaWf.id)
            expect(proxiedDb.getWorkflowActionEntries(10, 'ws-beta')[0]?.id).toBe(betaWf.id)
            expect(proxiedDb.getSignificantEntries(10, undefined, 'ws-alpha')[0]?.id).toBe(alphaWf.id)
            expect(proxiedDb.getSignificantEntries(10, undefined, 'ws-beta')[0]?.id).toBe(betaWf.id)

            const digestAlpha = proxiedDb.computeDigest('ws-alpha')
            const staleAlpha = digestAlpha['staleProjects'] as { projectNumber: number }[]
            expect(staleAlpha.map((p) => p.projectNumber)).toEqual([77])

            const digestBeta = proxiedDb.computeDigest('ws-beta')
            const staleBeta = digestBeta['staleProjects'] as { projectNumber: number }[]
            expect(staleBeta.map((p) => p.projectNumber)).toEqual([88])

            const insightsAlpha = proxiedDb.getCrossProjectInsights({
                minEntries: 1,
                inactiveThresholdDays: 1,
                workspaceId: 'ws-alpha',
            })
            expect(insightsAlpha.projects.map((p) => p['project_number'])).toEqual(expect.arrayContaining([77, 999]))
            expect(insightsAlpha.inactiveProjects.map((p) => p.project_number)).toEqual([77])

            const insightsBeta = proxiedDb.getCrossProjectInsights({
                minEntries: 1,
                inactiveThresholdDays: 1,
                workspaceId: 'ws-beta',
            })
            expect(insightsBeta.projects[0]?.['project_number']).toBe(88)
            expect(insightsBeta.inactiveProjects.map((p) => p.project_number)).toEqual([88])
        })

        expect(primaryDb.getActiveEntryCount('ws-alpha')).toBe(primaryCountBefore)
        expect(primaryDb.getActiveEntryCount('ws-beta')).toBe(0)
    })
})
