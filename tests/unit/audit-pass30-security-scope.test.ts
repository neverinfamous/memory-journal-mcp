/**
 * Pass 30 Adversarial Security, Scope, RBAC & Code Mode Regression Suite
 * Covers H1-H19 across storage, Code Mode, Team RBAC, GitHub, CLI, ConfigManager, and Resources.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { DatabaseAdapterProxy } from '../../src/database/core/DatabaseAdapterProxy.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { getTeamCoreTools } from '../../src/handlers/tools/team/core-tools.js'
import { resolveTeamImportContextAuthor } from '../../src/handlers/tools/team/io-scope-helpers.js'
import { enforceTeamRbac, wrapWithRbac } from '../../src/handlers/tools/team/rbac.js'
import { enforceTeamResourceRbac } from '../../src/handlers/resources/team.js'
import { resolveOwnerRepo } from '../../src/handlers/tools/github/helpers.js'
import { extractAndRecoverSqlCode } from '../../src/handlers/tools/codemode/sql-recovery.js'
import { parseSqlStatement } from '../../src/codemode/sql-positional-binder.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { synthesizeNaturalLanguageOrEntryPayload } from '../../src/handlers/tools/codemode/natural-language-synthesizer.js'
import { healCodeModeScript, isValidJsScript } from '../../src/handlers/tools/codemode/code-healer.js'
import { buildSandboxUserContext } from '../../src/handlers/tools/codemode/sandbox-user-context.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import { isValidProjectPath } from '../../src/utils/project-registry-guards.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { redactConfig } from '../../src/cli/dump-config.js'
import { runWithAuthContext } from '../../src/auth/auth-context.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { ValidationError } from '../../src/types/errors.js'
import type { ToolContext } from '../../src/types/index.js'

const TEST_REGISTRY = {
    'memory-journal-mcp': { project_number: 5, path: process.cwd() },
    'other-repo': { project_number: 9 },
}

describe('Pass 30 Security, Scope, RBAC & Config Regressions (H1-H19)', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter
    let tmpDir: string

    beforeEach(async () => {
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
        await teamDb.applyTeamSchema()
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass30-sec-'))
    })

    afterEach(() => {
        db.close()
        teamDb.close()
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('H1 & M5: keeps disk DB intact on missing restore file and preserves team schema on valid restore', async () => {
        const livePath = path.join(tmpDir, 'live.db')
        const diskDb = new DatabaseAdapter(livePath)
        try {
            await diskDb.initialize()
            await diskDb.applyTeamSchema()
            diskDb.addTeamMember('alice', 'admin', 'alice')
            diskDb.createEntry({
                content: 'Before failed restore',
                workspaceId: 'memory-journal-mcp',
                projectNumber: 5,
            })
            const exported = await diskDb.exportToFile('snap')

            await expect(diskDb.restoreFromFile('missing.db')).rejects.toThrow()
            const surviving = diskDb.searchEntries('Before failed restore', {
                workspaceId: 'memory-journal-mcp',
                projectNumber: 5,
            })
            expect(surviving.entries.length).toBeGreaterThan(0)

            await diskDb.restoreFromFile(exported.filename)
            expect(diskDb.isTeamRbacActive()).toBe(true)
        } finally {
            diskDb.close()
        }
    })

    it('H2: binds non-positive projectNumber as exact SQL filter in listTags/getActiveEntryCount/getAuthorStatistics and rejects in merge_tags', async () => {
        db.createEntry({
            content: 'Project 5 tagged entry',
            tags: ['p5tag'],
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
        })
        teamDb.createEntry({
            content: 'Team entry P5',
            author: 'alice',
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
        })

        expect(db.listTags('memory-journal-mcp', 5).some((t) => t.name === 'p5tag')).toBe(true)
        expect(db.listTags('memory-journal-mcp', 0)).toEqual([])
        expect(db.listTags('memory-journal-mcp', -2)).toEqual([])
        expect(db.getActiveEntryCount('memory-journal-mcp', 0)).toBe(0)
        expect(db.getActiveEntryCount('memory-journal-mcp', -1)).toBe(0)
        expect(teamDb.getAuthorStatistics('memory-journal-mcp', 0)).toEqual([])

        const mergeZero = (await callTool(
            'merge_tags',
            { source_tag: 'p5tag', target_tag: 'other', workspace_id: 'memory-journal-mcp', project_number: 0 },
            db,
            undefined,
            undefined,
            { runtime: new ServerRuntime(), projectRegistry: TEST_REGISTRY }
        )) as { success: boolean }
        expect(mergeZero.success).toBe(false)
    })

    it('H4: restricts SPECIAL_TABLES SQL recovery to SELECT and rejects unsafe WHERE/SET clauses', () => {
        expect(extractAndRecoverSqlCode("SELECT * FROM tags WHERE workspace_id = 'memory-journal-mcp'")).toContain('mj.core.listTags')
        expect(extractAndRecoverSqlCode("DELETE FROM tags WHERE name = 'x'")).toBeNull()
        expect(extractAndRecoverSqlCode("UPDATE tags SET name = 'y' WHERE name = 'x'")).toBeNull()
        expect(extractAndRecoverSqlCode("DELETE FROM memory_journal WHERE id = 1 OR workspace_id = 'other'")).toBeNull()
        expect(extractAndRecoverSqlCode("UPDATE memory_journal SET bogus_col = 'evil' WHERE id = 1")).toBeNull()
        expect(parseSqlStatement("UPDATE memory_journal SET bogus_col = 'x' WHERE id = 1", []).action).toBe('unmapped')
        expect(extractAndRecoverSqlCode('SELECT * FROM memory_journal WHERE id = 42 AND deleted_at IS NULL')).toContain('mj.core.getEntryById')
    })

    it('H5: rejects raw SQL in `query` parameter without synthesizing writes or unfiltered searches', () => {
        const res = resolveExecutionPayload(
            { query: 'SELECT * FROM memory_journal' } as Parameters<typeof resolveExecutionPayload>[0],
            { query: 'SELECT * FROM memory_journal' },
            true,
            Date.now()
        )
        expect('earlyReturn' in res).toBe(true)
        if ('earlyReturn' in res) {
            expect(res.earlyReturn['success']).toBe(false)
            expect(String(res.earlyReturn['error'])).toContain('Could not translate raw SQL')
        }
        const rawNl = synthesizeNaturalLanguageOrEntryPayload(
            'DELETE FROM memory_journal WHERE id = 1',
            {} as Parameters<typeof synthesizeNaturalLanguageOrEntryPayload>[1],
            {}
        )
        expect(rawNl).toBe('DELETE FROM memory_journal WHERE id = 1')
    })

    it('H6: validates JS syntax strictly before unwrapping nested execute_code prose', () => {
        expect(isValidJsScript('return 1 + 2;')).toBe(true)
        expect(isValidJsScript('please save a journal note about OAuth')).toBe(false)
        const healed = healCodeModeScript('await mj.execute_code({ code: "document OAuth decision" })')
        expect(healed).not.toBe('document OAuth decision')
    })

    it('H7 & M8: strips internal defaultProjectNumber from userContext and propagates use_test_db safely', async () => {
        const ctx: ToolContext = {
            db,
            config: { defaultProjectNumber: 5, projectRegistry: TEST_REGISTRY, runtime: new ServerRuntime() },
        }
        const { userContext } = buildSandboxUserContext(
            { code: 'return 1' } as Parameters<typeof buildSandboxUserContext>[0],
            ctx,
            undefined,
            undefined,
            'default',
            false
        )
        expect(userContext['project_number']).toBeUndefined()
        expect(userContext['__mj_project_number']).toBeUndefined()

        const seenPayloads: unknown[] = []
        const exec = createSandboxExecutor({
            shimMj: {
                core: {
                    createEntry: (p: unknown) => {
                        seenPayloads.push(p)
                        return { success: true }
                    },
                },
            },
            vmContextRef: { current: undefined },
            timeoutMs: 1000,
            useTestDbMode: true,
            pinnedWorkspaceRaw: 'memory-journal-mcp',
            pinnedProjectRaw: 5,
            projectRegistryRaw: TEST_REGISTRY,
            runIsolatedNestedCode: async () => ({ success: true }),
        })
        await exec({ code: 'record a technical note about worker tests' })
        expect(seenPayloads).toHaveLength(1)
        const firstPayload = seenPayloads[0] as Record<string, unknown>
        expect(firstPayload['use_test_db']).toBe(true)

        const testDb = new DatabaseAdapter(':memory:')
        try {
            await testDb.initialize()
            const proxiedDb = DatabaseAdapterProxy.create(db, testDb)
            const cmRes = (await callTool(
                'mj_execute_code',
                {
                    code: "return await mj.core.createEntry({ content: 'Isolated test db note' })",
                    workspace_id: 'memory-journal-mcp',
                    project_number: 5,
                    use_test_db: true,
                    timeout_ms: 15000,
                },
                proxiedDb,
                undefined,
                undefined,
                { runtime: new ServerRuntime(), codemodeEnabled: true, projectRegistry: TEST_REGISTRY }
            )) as { success: boolean }
            expect(cmRes.success).toBe(true)
            expect(
                db.searchEntries('Isolated test db note', {
                    workspaceId: 'memory-journal-mcp',
                    projectNumber: 5,
                }).entries
            ).toHaveLength(0)
            expect(
                testDb.searchEntries('Isolated test db note', {
                    workspaceId: 'memory-journal-mcp',
                    projectNumber: 5,
                }).entries
            ).toHaveLength(1)
        } finally {
            testDb.close()
        }
    }, 20000)

    it('H3, H8 & H9: excludes project config tools from Code Mode inheritance and enforces project_number filters', async () => {
        const runtimeConfig = { runtime: new ServerRuntime(), projectRegistry: TEST_REGISTRY }
        const e5 = db.createEntry({
            content: 'Anchor P5',
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
            tags: ['t'],
            anchors: [{ anchorPath: 'src/a.ts', anchorType: 'file', status: 'valid' }],
        })
        const e9 = db.createEntry({
            content: 'Anchor P9',
            workspaceId: 'other-repo',
            projectNumber: 9,
            tags: ['t'],
            anchors: [{ anchorPath: 'src/b.ts', anchorType: 'file', status: 'valid' }],
        })
        const anchors5 = db.getAnchorsByEntryId(e5.id, 'memory-journal-mcp')
        const anchors9 = db.getAnchorsByEntryId(e9.id, 'other-repo')
        const first5 = anchors5[0]
        const first9 = anchors9[0]
        expect(first5).toBeDefined()
        expect(first9).toBeDefined()
        if (first5 === undefined || first9 === undefined) return

        const staleRes = (await callTool(
            'mark_anchors_stale',
            {
                updates: [
                    { id: first5.id, status: 'stale' },
                    { id: first9.id, status: 'stale' },
                ],
                workspace_id: 'memory-journal-mcp',
                project_number: 5,
            },
            db,
            undefined,
            undefined,
            runtimeConfig
        )) as { success: boolean; updated_count: number }
        expect(staleRes.success).toBe(true)
        expect(staleRes.updated_count).toBe(1)

        const badInsights = (await callTool(
            'get_cross_project_insights',
            { project_number: 0 },
            db,
            undefined,
            undefined,
            runtimeConfig
        )) as { success: boolean; code?: string }
        expect(badInsights.success).toBe(false)

        const okInsights = (await callTool(
            'get_cross_project_insights',
            { project_number: 5, workspace_id: 'memory-journal-mcp', min_entries: 1 },
            db,
            undefined,
            undefined,
            runtimeConfig
        )) as { success: boolean; projects: Record<string, unknown>[] }
        expect(okInsights.success).toBe(true)
        expect(okInsights.projects.length).toBe(1)
        expect(okInsights.projects.every((p) => Number(p['project_number']) === 5)).toBe(true)
    })

    it('H10, H11, H12 & H15: enforces Team RBAC across global tools, nested containers, import scope, and resources', () => {
        teamDb.addTeamMember('alice', 'admin', 'alice')
        teamDb.addTeamMember('bob', 'member', 'alice')
        const ctx: ToolContext = { db, teamDb, config: { projectRegistry: TEST_REGISTRY } }

        runWithAuthContext({ authenticated: true, claims: { sub: 'alice', scopes: ['team', 'write', 'admin'] } }, () => {
            expect(() => enforceTeamRbac(ctx, 'team_add_member', { workspace_id: 'memory-journal-mcp', metadata: { workspace_id: 'other-repo' } }, 'owner')).toThrow()
        })

        runWithAuthContext({ authenticated: true, claims: { sub: 'bob', scopes: ['team', 'write'] } }, () => {
            expect(() =>
                enforceTeamRbac(ctx, 'team_cross_workspace_summary', { target_workspace_id: 'memory-journal-mcp' }, 'admin')
            ).toThrow()

            const importAuthor = resolveTeamImportContextAuthor(ctx, 'memory-journal-mcp', undefined, false)
            expect(importAuthor.author).toBe('bob')
            expect(importAuthor.enforceStrictTeamOwnership).toBe(true)

            const wrapped = wrapWithRbac(ctx, getTeamCoreTools(ctx), 'member')
            expect(wrapped.length).toBeGreaterThan(0)
            expect(() =>
                enforceTeamResourceRbac({ db, teamDb, briefingConfig: DEFAULT_BRIEFING_CONFIG }, 'memory-journal-mcp')
            ).not.toThrow()
        })

        runWithAuthContext({ authenticated: true, claims: { sub: 'stranger', scopes: ['team', 'read'] } }, () => {
            expect(() =>
                enforceTeamResourceRbac({ db, teamDb, briefingConfig: DEFAULT_BRIEFING_CONFIG }, 'memory-journal-mcp')
            ).toThrow()
        })
    })

    it('H13, H14, H16, H17 & H19: rejects URL/path drift, empty allowedRoots, CLI config persistence bleed, and auth/webhook secrets', async () => {
        const errDot = await resolveOwnerRepo(
            { db, config: { projectRegistry: TEST_REGISTRY } },
            { path: '../outside' },
            'test'
        )
        expect('error' in errDot && errDot.error).toBe(true)

        expect(isValidProjectPath(process.cwd(), [])).toBe(false)

        const cfgPath = path.join(tmpDir, 'cfg.json')
        fs.writeFileSync(cfgPath, JSON.stringify({ projectRegistry: TEST_REGISTRY }), 'utf8')
        const manager = new ConfigManager(
            {
                rawToolFilter: '+core',
                toolFilterConfig: null,
                briefingConfig: { ...DEFAULT_BRIEFING_CONFIG, defaultWorkspaceId: 'memory-journal-mcp', defaultProjectNumber: 5 },
            },
            cfgPath,
            { rawToolFilter: '+core', defaultWorkspaceId: 'memory-journal-mcp', defaultProjectNumber: 5 }
        )
        manager.updateConfig({ briefingConfig: { ...DEFAULT_BRIEFING_CONFIG, entryCount: 7 } }, true, {
            mutatedFields: { briefingKeys: ['entryCount'] },
        })
        const saved = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as Record<string, unknown>
        expect(saved['toolFilter']).toBeUndefined()
        expect(saved['defaultWorkspaceId']).toBeUndefined()
        expect(saved['briefingEntries']).toBe(7)
        manager.close()

        const redacted = redactConfig({
            authHeader: 'Bearer xyz',
            webhookSecretUrl: 'https://hooks.example.com/123',
            emptyAuth: '',
        }) as Record<string, unknown>
        expect(redacted['authHeader']).toBe('[REDACTED]')
        expect(redacted['webhookSecretUrl']).toBe('[REDACTED]')
        expect(redacted['emptyAuth']).toBe('')
    })
})
