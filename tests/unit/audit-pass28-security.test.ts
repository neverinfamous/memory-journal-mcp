/**
 * Pass 28 Security Regression Suite
 * Covers H1-H6 end-to-end scope, RBAC, alias isolation, and Code Mode boundary hardening.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ToolContext } from '../../src/types/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { runWithAuthContext } from '../../src/auth/auth-context.js'
import { SCOPES } from '../../src/auth/scopes.js'
import { getRequiredScope } from '../../src/auth/scope-map.js'
import { enforceAccessBoundary } from '../../src/auth/validation.js'
import { AuditLogger } from '../../src/audit/audit-logger.js'
import { AuthorizationError, PermissionError } from '../../src/types/errors.js'
import {
    wrapWithRbac,
    resolveScopedTeamRole,
    enforceTeamRbac,
    enforceOwnership,
} from '../../src/handlers/tools/team/rbac.js'
import { resolveTeamImportContextAuthor } from '../../src/handlers/tools/team/io-scope-helpers.js'
import { executeTeamBatchDelete } from '../../src/handlers/tools/team/admin-tools/batch-delete-helpers.js'
import { getTeamCoreTools } from '../../src/handlers/tools/team/core-tools.js'
import { executeTeamAddToVectorIndex } from '../../src/handlers/tools/team/vector-helpers.js'
import { scopeFromSqlLiterals } from '../../src/codemode/sql-literal-scope.js'
import { extractAndRecoverSqlCode } from '../../src/handlers/tools/codemode/sql-recovery.js'
import { validateNestedExecScope } from '../../src/codemode/worker/nested-exec-scope.js'

const TEST_REGISTRY = {
    'memory-journal-mcp': { project_number: 5 },
    'other-repo': { project_number: 9 },
}

const ADMIN_TEAM_TOOLS = [
    'team_add_member',
    'team_remove_member',
    'team_update_member_role',
    'team_backup',
    'team_merge_tags',
    'team_rebuild_vector_index',
    'team_add_author_alias',
    'team_remove_author_alias',
    'team_list_author_aliases',
    'team_resolve_author',
    'team_consolidate_authors',
] as const

describe('Pass 28 Security Regressions (H1-H6)', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter

    beforeEach(async () => {
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
        teamDb.applyTeamSchema()
    })

    afterEach(() => {
        teamDb.close()
        db.close()
        vi.restoreAllMocks()
    })

    function makeContext(overrides?: Partial<ToolContext>): ToolContext {
        return {
            db,
            teamDb,
            config: {
                projectRegistry: TEST_REGISTRY,
                ...(overrides?.config ?? {}),
            },
            ...overrides,
        }
    }

    it('H1: enforces requiresAdminScope before requiresTeamScope, maps 11 team admin tools to admin, and audits unauthenticated denials', () => {
        for (const toolName of ADMIN_TEAM_TOOLS) {
            expect(getRequiredScope(toolName)).toBe(SCOPES.ADMIN)
        }

        const auditLogger = new AuditLogger({
            enabled: true,
            logPath: 'stderr',
            redact: false,
            auditReads: false,
            maxSizeBytes: 0,
        })
        const denialSpy = vi.spyOn(auditLogger, 'logDenial').mockImplementation(() => {})

        // SCOPES.TEAM alone is insufficient when both requiresTeamScope and requiresAdminScope are true
        runWithAuthContext(
            {
                authenticated: true,
                claims: { sub: 'alice', scopes: [SCOPES.TEAM] },
                scopes: [SCOPES.TEAM],
            },
            () => {
                expect(() =>
                    enforceAccessBoundary(
                        'team_add_member',
                        'tool',
                        { requiresTeamScope: true, requiresAdminScope: true },
                        auditLogger
                    )
                ).toThrow(PermissionError)
                expect(() =>
                    enforceAccessBoundary(
                        'memory://team/audit',
                        'resource',
                        { requiresTeamScope: true, requiresAdminScope: true },
                        auditLogger
                    )
                ).toThrow(PermissionError)
            }
        )

        // SCOPES.ADMIN satisfies both tool and resource admin checks
        runWithAuthContext(
            {
                authenticated: true,
                claims: { sub: 'admin-alice', scopes: [SCOPES.ADMIN] },
                scopes: [SCOPES.ADMIN],
            },
            () => {
                expect(() =>
                    enforceAccessBoundary(
                        'team_add_member',
                        'tool',
                        { requiresTeamScope: true, requiresAdminScope: true },
                        auditLogger
                    )
                ).not.toThrow()
            }
        )

        // Unauthenticated fail-closed team boundary calls auditLogger.logDenial
        const prevTeamAuthor = process.env['TEAM_AUTHOR']
        const prevUsername = process.env['USERNAME']
        const prevUser = process.env['USER']
        delete process.env['TEAM_AUTHOR']
        delete process.env['USERNAME']
        delete process.env['USER']
        try {
            runWithAuthContext({ authenticated: false, scopes: [] }, () => {
                expect(() =>
                    enforceAccessBoundary(
                        'team_create_entry',
                        'tool',
                        { requiresTeamScope: true },
                        auditLogger
                    )
                ).toThrow(PermissionError)
            })
            expect(denialSpy).toHaveBeenCalledWith(
                'team_create_entry',
                'Unauthenticated team access',
                expect.objectContaining({ category: 'team', scope: SCOPES.TEAM })
            )
        } finally {
            if (prevTeamAuthor !== undefined) process.env['TEAM_AUTHOR'] = prevTeamAuthor
            if (prevUsername !== undefined) process.env['USERNAME'] = prevUsername
            if (prevUser !== undefined) process.env['USER'] = prevUser
        }
    })

    it('H2: codemodeInternalFullAccess does not bypass team RBAC, ownership, or permanent batch delete', async () => {
        teamDb.addTeamMember('alice-admin', 'admin', 'system')
        teamDb.addTeamMember('bob-member', 'member', 'system')
        teamDb.addTeamMember('eve-viewer', 'viewer', 'system')

        const ctx = makeContext({
            config: {
                codemodeInternalFullAccess: true,
                projectRegistry: TEST_REGISTRY,
            },
        })

        // Seed an entry authored by alice-admin
        const rawCreateTool = getTeamCoreTools(ctx).find((t) => t.name === 'team_create_entry')
        expect(rawCreateTool).toBeDefined()
        const seeded = (await runWithAuthContext(
            {
                authenticated: true,
                claims: { sub: 'alice-admin', scopes: [SCOPES.TEAM, SCOPES.ADMIN] },
                scopes: [SCOPES.TEAM, SCOPES.ADMIN],
            },
            () =>
                rawCreateTool!.handler({
                    content: 'Alice entry for H2 test',
                    workspace_id: 'memory-journal-mcp',
                    project_number: 5,
                    impact_score: 0.7,
                    trust_score: 0.8,
                    validation_status: 'passed',
                })
        )) as { success: boolean; entry?: { id: number } }
        expect(seeded.success).toBe(true)
        const aliceEntryId = seeded.entry!.id

        // Direct RBAC & ownership enforcement cannot be bypassed
        expect(() => enforceTeamRbac(ctx, 'bob-member', 'admin', 'memory-journal-mcp')).toThrow(
            AuthorizationError
        )
        expect(() =>
            enforceOwnership('bob-member', 'alice-admin', 'member', teamDb, 'memory-journal-mcp')
        ).toThrow(AuthorizationError)

        // wrapWithRbac still blocks viewers from creating team entries
        const wrappedTools = wrapWithRbac(ctx, getTeamCoreTools(ctx), 'member')
        const wrappedCreate = wrappedTools.find((t) => t.name === 'team_create_entry')
        const viewerRes = (await runWithAuthContext(
            {
                authenticated: true,
                claims: { sub: 'eve-viewer', scopes: [SCOPES.TEAM] },
                scopes: [SCOPES.TEAM],
            },
            () =>
                wrappedCreate!.handler({
                    content: 'Viewer should be blocked',
                    workspace_id: 'memory-journal-mcp',
                    project_number: 5,
                    impact_score: 0.5,
                    trust_score: 0.5,
                    validation_status: 'none',
                })
        )) as { success: boolean; error?: string }
        expect(viewerRes.success).toBe(false)
        expect(viewerRes.error).toMatch(/required 'member' role/i)

        // executeTeamBatchDelete denies permanent delete & non-owner delete by bob-member
        await runWithAuthContext(
            {
                authenticated: true,
                claims: { sub: 'bob-member', scopes: [SCOPES.TEAM] },
                scopes: [SCOPES.TEAM],
            },
            async () => {
                const permRes = await executeTeamBatchDelete(ctx, teamDb, {
                    entry_ids: [aliceEntryId],
                    permanent: true,
                    workspace_id: 'memory-journal-mcp',
                    project_number: 5,
                })
                expect(permRes['success']).toBe(false)

                const nonOwnerRes = await executeTeamBatchDelete(ctx, teamDb, {
                    entry_ids: [aliceEntryId],
                    permanent: false,
                    workspace_id: 'memory-journal-mcp',
                    project_number: 5,
                })
                expect(nonOwnerRes['success']).toBe(false)
            }
        )
    })

    it('H3: author_aliases in workspace-a do not grant RBAC role, ownership, or import privileges in workspace-b', () => {
        teamDb.addTeamMember('alice-admin', 'admin', 'system')
        teamDb.addAuthorAlias('alice-alias', 'alice-admin', 'system', 'workspace-a')

        const ctx = makeContext()

        // Same workspace inherits canonical admin role and ownership
        expect(resolveScopedTeamRole(teamDb, 'alice-alias', 'denied', 'workspace-a')).toBe('admin')
        expect(() =>
            enforceTeamRbac(ctx, 'alice-alias', 'admin', 'workspace-a')
        ).not.toThrow()
        expect(() =>
            enforceOwnership('alice-alias', 'alice-admin', 'member', teamDb, 'workspace-a')
        ).not.toThrow()

        // Cross-workspace does NOT resolve workspace-a's alias
        expect(resolveScopedTeamRole(teamDb, 'alice-alias', 'denied', 'workspace-b')).toBeNull()
        expect(() => enforceTeamRbac(ctx, 'alice-alias', 'member', 'workspace-b')).toThrow(
            AuthorizationError
        )
        expect(() =>
            enforceOwnership('alice-alias', 'alice-admin', 'member', teamDb, 'workspace-b')
        ).toThrow(AuthorizationError)

        // Import author helper enforces workspace-scoped RBAC as well
        runWithAuthContext(
            {
                authenticated: true,
                claims: { sub: 'alice-alias', scopes: [SCOPES.TEAM] },
                scopes: [SCOPES.TEAM],
            },
            () => {
                const deniedImport = resolveTeamImportContextAuthor(ctx, 'workspace-b')
                expect('errorResponse' in deniedImport).toBe(true)

                const allowedImport = resolveTeamImportContextAuthor(ctx, 'workspace-a')
                expect('errorResponse' in allowedImport).toBe(false)
                if (!('errorResponse' in allowedImport)) {
                    expect(allowedImport.allowAdminAuthorOverride).toBe(true)
                }
            }
        )
    })

    it('H4: team_get_entry_by_id rejects project_number mismatches and team_add_to_vector_index rejects wildcard workspace_id', async () => {
        teamDb.addTeamMember('alice-admin', 'admin', 'system')
        const ctx = makeContext({
            teamVectorManager: {
                addEntry: vi.fn().mockResolvedValue(undefined),
            } as unknown as ToolContext['teamVectorManager'],
        })

        const coreTools = getTeamCoreTools(ctx)
        const createTool = coreTools.find((t) => t.name === 'team_create_entry')!
        const getByIdTool = coreTools.find((t) => t.name === 'team_get_entry_by_id')!

        const created = (await runWithAuthContext(
            {
                authenticated: true,
                claims: { sub: 'alice-admin', scopes: [SCOPES.TEAM, SCOPES.ADMIN] },
                scopes: [SCOPES.TEAM, SCOPES.ADMIN],
            },
            () =>
                createTool.handler({
                    content: 'Project 5 scoped team entry',
                    workspace_id: 'memory-journal-mcp',
                    project_number: 5,
                    impact_score: 0.6,
                    trust_score: 0.9,
                    validation_status: 'passed',
                })
        )) as { success: boolean; entry?: { id: number } }
        expect(created.success).toBe(true)
        const entryId = created.entry!.id

        const okGet = (await getByIdTool.handler({
            entry_id: entryId,
            workspace_id: 'memory-journal-mcp',
            project_number: 5,
        })) as { success: boolean }
        expect(okGet.success).toBe(true)

        const mismatchGet = (await getByIdTool.handler({
            entry_id: entryId,
            workspace_id: 'memory-journal-mcp',
            project_number: 9,
        })) as { success: boolean; code?: string; error?: string }
        expect(mismatchGet.success).toBe(false)
        expect(mismatchGet.code).toBe('VALIDATION_ERROR')

        // Unregistered workspace exercises handler-level project_number check (line 249)
        const createdUnreg = (await runWithAuthContext(
            {
                authenticated: true,
                claims: { sub: 'alice-admin', scopes: [SCOPES.TEAM, SCOPES.ADMIN] },
                scopes: [SCOPES.TEAM, SCOPES.ADMIN],
            },
            () =>
                createTool.handler({
                    content: 'Unregistered workspace project 77 entry',
                    workspace_id: 'unregistered-ws',
                    project_number: 77,
                    impact_score: 0.6,
                    trust_score: 0.9,
                    validation_status: 'passed',
                })
        )) as { success: boolean; entry?: { id: number } }
        expect(createdUnreg.success).toBe(true)
        const unregMismatchGet = (await getByIdTool.handler({
            entry_id: createdUnreg.entry!.id,
            workspace_id: 'unregistered-ws',
            project_number: 99,
        })) as { success: boolean; code?: string; error?: string }
        expect(unregMismatchGet.success).toBe(false)
        expect(unregMismatchGet.code).toBe('RESOURCE_NOT_FOUND')
        expect(unregMismatchGet.error).toContain('does not belong to project 99')

        const wildcardAdd = await executeTeamAddToVectorIndex(ctx, {
            entry_id: entryId,
            workspace_id: '*',
            project_number: 5,
        })
        expect(wildcardAdd['success']).toBe(false)
        expect(wildcardAdd['code']).toBe('VALIDATION_ERROR')
    })

    it('H5: ignores SQL string literal decoys and rejects multi-row or unparseable INSERT payloads', () => {
        const decoySql = `SELECT * FROM memory_journal WHERE id = 42 AND content = "workspace_id = 'evil'"`
        expect(scopeFromSqlLiterals(decoySql)).toEqual({})
        expect(extractAndRecoverSqlCode(decoySql)).toBeNull()

        const contentDecoySql = `SELECT * FROM memory_journal WHERE content = "workspace_id = 'evil'"`
        const recoveredContentDecoy = extractAndRecoverSqlCode(contentDecoySql)
        expect(recoveredContentDecoy).toContain('mj.search.searchEntries')
        expect(recoveredContentDecoy).not.toContain('"workspace_id"')

        const validScopedSql = `SELECT * FROM memory_journal WHERE id = 42 AND workspace_id = 'memory-journal-mcp'`
        expect(scopeFromSqlLiterals(validScopedSql)).toEqual({ workspace_id: 'memory-journal-mcp' })
        expect(extractAndRecoverSqlCode(validScopedSql)).toContain('memory-journal-mcp')

        const multiRowInsert = `INSERT INTO memory_journal (content, project_number) VALUES ('row1', 5), ('row2', 5)`
        expect(extractAndRecoverSqlCode(multiRowInsert)).toBeNull()

        const unparseableInsert = `INSERT INTO memory_journal DEFAULT VALUES`
        expect(extractAndRecoverSqlCode(unparseableInsert)).toBeNull()
    })

    it('H6: validateNestedExecScope rejects drift across aliases, nested envelopes, and default project numbers', () => {
        // Matching pinned workspace and project number succeeds
        expect(
            validateNestedExecScope(
                { workspace_id: 'memory-journal-mcp', project_number: 5, code: 'return 1' },
                'memory-journal-mcp',
                5,
                TEST_REGISTRY
            )
        ).toBeNull()

        // Direct workspace aliases & target_workspace_id drift are rejected
        for (const args of [
            { workspace: 'other-repo', project_number: 5 },
            { workspaceId: 'other-repo', project_number: 5 },
            { target_workspace_id: 'other-repo', project_number: 5 },
            { project_id: 9 },
            { projectNumber: 9 },
            { metadata: { projectNumber: 9 } },
            { context: { workspace_id: 'other-repo' } },
        ]) {
            const res = validateNestedExecScope(args, 'memory-journal-mcp', 5, TEST_REGISTRY)
            expect(res).not.toBeNull()
            expect(res?.error).toBeTruthy()
        }

        // Unregistered 'default' session still blocks project_number drift
        const defaultDrift = validateNestedExecScope(
            { workspace_id: 'default', project_number: 9 },
            'default',
            5,
            TEST_REGISTRY
        )
        expect(defaultDrift).not.toBeNull()
    })
})
