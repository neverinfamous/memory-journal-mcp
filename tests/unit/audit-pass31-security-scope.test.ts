/**
 * Pass 31 Adversarial Security, Scope, RBAC, SSRF & CLI Regression Suite
 * Covers H1-H14 across auth/SSRF, Code Mode recovery, restore lock, markdown/registry guards,
 * admin batch scope, core grep containment, Team RBAC/analytics, GitHub issue scope, and CLI/scripts.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Command } from 'commander'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { resolveSafePublicDnsAddresses } from '../../src/auth/jwks-ssrf-guard.js'
import { AuthorizationServerDiscovery } from '../../src/auth/authorization-server-discovery.js'
import { extractAndRecoverPreparedStatementCode } from '../../src/handlers/tools/codemode/sql-prepared-recovery.js'
import { synthesizeNaturalLanguageOrEntryPayload } from '../../src/handlers/tools/codemode/natural-language-synthesizer.js'
import { acquireRestoreLock } from '../../src/database/sqlite-adapter/restore-lock.js'
import { isValidProjectPath } from '../../src/utils/project-registry-guards.js'
import { parseYamlFrontmatter } from '../../src/markdown/converters/yaml-parser.js'
import { findWildcardProjectMismatches } from '../../src/handlers/tools/admin/batch-vector-helpers.js'
import { getFsFallbackToolDefinitions } from '../../src/handlers/tools/core/dummy-healing/fs-fallbacks.js'
import { getTeamAnalyticsTools } from '../../src/handlers/tools/team/analytics-tools.js'
import { resolveTeamCreateAuthor } from '../../src/handlers/tools/team/admin-tools/batch-create-helpers.js'
import { executeTeamBatchDelete } from '../../src/handlers/tools/team/admin-tools/batch-delete-helpers.js'
import { enforceCliTeamRbac } from '../../src/cli/commands/db-helper.js'
import { assertCliUpdateWorkspaceOwnership } from '../../src/cli/commands/entry-update-helpers.js'
import { buildServerOptions } from '../../src/cli/server-options-builder.js'
import { addCoreOptions, addWorkspaceScopeOptions } from '../../src/cli/option-groups.js'
import { ConfigResolver } from '../../src/utils/config-resolver.js'
import { resolveIssueEntryScope } from '../../src/handlers/tools/github/issue-entry-scope.js'
import { runWithAuthContext } from '../../src/auth/auth-context.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { AuthorizationError, ValidationError } from '../../src/types/errors.js'
import type { ToolContext } from '../../src/types/index.js'

const TEST_REGISTRY = {
    'memory-journal-mcp': { project_number: 5, path: process.cwd() },
    'other-repo': { project_number: 9 },
}

describe('Pass 31 Security, Scope, RBAC & CLI Regressions (H1-H14)', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter
    let tmpDir: string

    beforeEach(async () => {
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
        await teamDb.applyTeamSchema()
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass31-sec-'))
    })

    afterEach(() => {
        vi.restoreAllMocks()
        db.close()
        teamDb.close()
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('H1: blocks private/loopback IPs and non-HTTPS URLs in SSRF guard & OAuth discovery', async () => {
        await expect(resolveSafePublicDnsAddresses('127.0.0.1', 'jwks')).rejects.toThrow(/SSRF Protection/i)
        await expect(resolveSafePublicDnsAddresses('169.254.169.254', 'jwks')).rejects.toThrow(/SSRF Protection/i)

        const httpDiscovery = new AuthorizationServerDiscovery({
            authServerUrl: 'http://auth.example.com',
        })
        await expect(httpDiscovery.discover()).rejects.toThrow(/HTTPS/i)

        const privateIpDiscovery = new AuthorizationServerDiscovery({
            authServerUrl: 'https://127.0.0.1',
        })
        await expect(privateIpDiscovery.discover()).rejects.toThrow(/SSRF Protection/i)
    })

    it('H2 & H3: recovers prepared statements safely while preserving valid SQL/JS without spurious write synthesis', () => {
        const recoveredGet = extractAndRecoverPreparedStatementCode(
            'const row = db.prepare("SELECT * FROM memory_journal WHERE id = ?").get(42);'
        )
        expect(recoveredGet).toContain('mj.core.getEntryById')
        expect(recoveredGet).toContain('"entry_id":42')

        // Prose/string literal containing ".prepare(" inside a valid mj.* call must not be rewritten
        const validMjCall = 'return await mj.core.createEntry({ content: "note .prepare(1) .run(2)" });'
        expect(extractAndRecoverPreparedStatementCode(validMjCall)).toBeNull()

        const selectSql = 'SELECT id, content FROM memory_journal LIMIT 5'
        expect(
            synthesizeNaturalLanguageOrEntryPayload(
                selectSql,
                { code: selectSql },
                { code: selectSql }
            )
        ).toBe(selectSql)
    })

    it('H4: restore-lock rejects live concurrent PID holders', () => {
        const lockDir = path.join(tmpDir, 'restore.lock')
        const lockFile = path.join(lockDir, 'lock.json')
        fs.mkdirSync(lockDir, { recursive: true })
        fs.writeFileSync(
            lockFile,
            JSON.stringify({ pid: 999999, timestamp: Date.now(), nonce: 'live-holder' }),
            'utf-8'
        )
        vi.spyOn(process, 'kill').mockImplementation(() => true)

        expect(() => acquireRestoreLock(lockDir, lockFile, undefined)).toThrow(/holding the database lock/i)
    })

    it('H5: project-registry-guards rejects relative paths, traversals, UNC paths, and OS system dirs', () => {
        expect(isValidProjectPath('relative/path')).toBe(false)
        expect(isValidProjectPath(`${tmpDir}/../escape`)).toBe(false)
        expect(isValidProjectPath('\\\\fileserver\\share\\repo')).toBe(false)
        expect(isValidProjectPath('/etc/passwd')).toBe(false)
        expect(isValidProjectPath('c:/windows/system32')).toBe(false)
        expect(isValidProjectPath(tmpDir)).toBe(true)
    })

    it('H6: parseYamlFrontmatter strips prototype-pollution keys and skips oversized inputs safely', () => {
        const parsed = parseYamlFrontmatter(
            '---\n__proto__: polluted\nconstructor: evil\nprototype: bad\ntitle: Safe Title\n---\nBody content'
        )
        expect(parsed.metadata['title']).toBe('Safe Title')
        expect(Object.getOwnPropertyDescriptor(parsed.metadata, '__proto__')).toBeUndefined()
        expect(Object.getOwnPropertyDescriptor(parsed.metadata, 'constructor')).toBeUndefined()
        expect(Object.getOwnPropertyDescriptor(parsed.metadata, 'prototype')).toBeUndefined()
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()

        const oversized = '---\ntitle: big\n---\n' + 'x'.repeat(600 * 1024)
        expect(parseYamlFrontmatter(oversized).metadata).toEqual({})
    })

    it('H7: findWildcardProjectMismatches rejects cross-project target_workspace_id moves under wildcard scope', () => {
        const e9 = db.createEntry({
            content: 'Other project entry',
            workspaceId: 'other-repo',
            projectNumber: 9,
        })
        const e5 = db.createEntry({
            content: 'Project 5 entry',
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
        })
        const mismatches = findWildcardProjectMismatches(
            db,
            [
                { entry_id: e9.id, target_workspace_id: 'memory-journal-mcp' },
                { entry_id: e5.id, target_workspace_id: 'other-repo' },
            ],
            '*',
            5,
            { projectRegistry: TEST_REGISTRY }
        )
        expect(mismatches).toEqual([e9.id])
    })

    it('H8: grep_search single-file fallback isolates only the requested file and honors allowedIoRoots', async () => {
        const fileA = path.join(tmpDir, 'alpha.txt')
        const fileB = path.join(tmpDir, 'beta.txt')
        fs.writeFileSync(fileA, 'findme-token in alpha', 'utf-8')
        fs.writeFileSync(fileB, 'findme-token in beta', 'utf-8')

        const grepTool = getFsFallbackToolDefinitions({
            config: { allowedIoRoots: [tmpDir] },
        }).find((t) => t.name === 'grep_search')
        expect(grepTool).toBeDefined()

        const singleRes = (await grepTool?.handler({
            search_path: fileA,
            query: 'findme-token',
        })) as { success: boolean; matches: Array<{ file: string }> }
        expect(singleRes.success).toBe(true)
        expect(singleRes.matches).toHaveLength(1)
        expect(singleRes.matches[0]?.file).toBe(fileA)

        const outsideFile = path.join(os.tmpdir(), 'mj-outside-nonexistent.txt')
        const deniedRes = (await grepTool?.handler({
            search_path: outsideFile,
            query: 'needle',
        })) as { success: boolean; code?: string }
        expect(deniedRes.success).toBe(false)
    })

    it('H9 & H11: team_get_cross_project_insights blocks unscoped wildcard and permanent team_batch_delete_entries enforces SCOPES.ADMIN', async () => {
        const insightsTool = getTeamAnalyticsTools({
            db,
            teamDb,
            config: { projectRegistry: TEST_REGISTRY },
        }).find((t) => t.name === 'team_get_cross_project_insights')
        expect(insightsTool).toBeDefined()

        const wildcardRes = (await insightsTool?.handler({
            workspace_id: '*',
        })) as { success: boolean; code?: string }
        expect(wildcardRes.success).toBe(false)
        expect(wildcardRes.code).toBe('VALIDATION_ERROR')

        const dateErrRes = (await insightsTool?.handler({
            workspace_id: 'memory-journal-mcp',
            project_number: 5,
            start_date: '2026-12-01',
            end_date: '2026-01-01',
        })) as { success: boolean; code?: string }
        expect(dateErrRes.success).toBe(false)

        const runtime = new ServerRuntime()
        const e = teamDb.createEntry({
            content: 'Team delete target',
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
            author: 'Alice',
            isPersonal: false,
        })
        await expect(
            runWithAuthContext(
                {
                    authenticated: true,
                    scopes: ['read', 'write', 'team'],
                    claims: { sub: 'Alice' },
                },
                () =>
                    executeTeamBatchDelete(
                        {
                            db,
                            teamDb,
                            config: { authEnabled: true, projectRegistry: TEST_REGISTRY, runtime },
                        },
                        teamDb,
                        {
                            entry_ids: [e.id],
                            permanent: true,
                            workspace_id: 'memory-journal-mcp',
                            project_number: 5,
                        }
                    )
            )
        ).rejects.toThrow(/insufficient scope/i)
    })

    it('H10: resolveIssueEntryScope rejects explicit default mismatch and requires project_number when default is unregistered', () => {
        const mismatch = resolveIssueEntryScope(
            { db, config: { projectRegistry: TEST_REGISTRY } },
            'memory-journal-mcp',
            'default',
            undefined,
            'create issue entry'
        )
        expect('errorResponse' in mismatch).toBe(true)

        const missingProj = resolveIssueEntryScope(
            { db, config: { projectRegistry: TEST_REGISTRY, defaultProjectNumber: 5 } },
            'unregistered-repo',
            'default',
            undefined,
            'create issue entry'
        )
        expect('errorResponse' in missingProj).toBe(true)

        const validDefault = resolveIssueEntryScope(
            { db, config: { projectRegistry: TEST_REGISTRY } },
            'unregistered-repo',
            'default',
            12,
            'create issue entry'
        )
        expect('workspaceId' in validDefault && validDefault.workspaceId).toBe('default')
        expect('projectNumber' in validDefault && validDefault.projectNumber).toBe(12)
    })

    it('H12: enforces CLI team RBAC roles and blocks non-admin author impersonation', () => {
        teamDb.addTeamMember('BobAdmin', 'admin', 'system')
        const prevAuthor = process.env['TEAM_AUTHOR']
        try {
            process.env['TEAM_AUTHOR'] = 'Outsider'
            expect(() =>
                enforceCliTeamRbac(teamDb, { teamDefaultRole: 'denied' }, 'viewer', 'memory-journal-mcp')
            ).toThrow(AuthorizationError)

            teamDb.addTeamMember('MemberOne', 'member', 'BobAdmin')
            process.env['TEAM_AUTHOR'] = 'MemberOne'
            expect(() =>
                enforceCliTeamRbac(teamDb, { teamDefaultRole: 'denied' }, 'admin', 'memory-journal-mcp')
            ).toThrow(AuthorizationError)

            const impersonation = resolveTeamCreateAuthor(
                'SomeoneElse',
                teamDb,
                { teamDefaultRole: 'denied' },
                'memory-journal-mcp'
            )
            expect('errorResponse' in impersonation).toBe(true)

            process.env['TEAM_AUTHOR'] = 'BobAdmin'
            expect(() =>
                enforceCliTeamRbac(teamDb, { teamDefaultRole: 'denied' }, 'admin', 'memory-journal-mcp')
            ).not.toThrow()
        } finally {
            if (prevAuthor === undefined) delete process.env['TEAM_AUTHOR']
            else process.env['TEAM_AUTHOR'] = prevAuthor
        }
    })

    it('H13: isolates subcommand --workspace from serve defaults and requires ownership on --target-workspace', () => {
        const emptyConfigPath = path.join(tmpDir, 'empty-config.json')
        fs.writeFileSync(emptyConfigPath, '{}', 'utf-8')
        const savedEnv = { ...process.env }
        try {
            const pruneCmd = addWorkspaceScopeOptions(addCoreOptions(new Command('prune')))
            pruneCmd.parse(['node', 'mj', '--workspace', '*'])
            const pruneResolver = new ConfigResolver(pruneCmd, pruneCmd.opts(), emptyConfigPath)
            const pruneErrors: string[] = []
            const pruneBuilt = buildServerOptions(pruneResolver, pruneCmd.opts(), pruneCmd, pruneErrors)
            expect(pruneErrors).toEqual([])
            expect(pruneBuilt.serverOptions.defaultWorkspaceId).toBeUndefined()

            const serveCmd = addWorkspaceScopeOptions(addCoreOptions(new Command('serve')))
            serveCmd.parse(['node', 'mj', '--workspace', '*'])
            const serveResolver = new ConfigResolver(serveCmd, serveCmd.opts(), emptyConfigPath)
            const serveErrors: string[] = []
            buildServerOptions(serveResolver, serveCmd.opts(), serveCmd, serveErrors)
            expect(serveErrors.some((e) => e.includes("Invalid workspace '*'"))).toBe(true)
        } finally {
            for (const k of Object.keys(process.env)) {
                if (!(k in savedEnv)) delete process.env[k]
            }
            Object.assign(process.env, savedEnv)
        }

        expect(() =>
            assertCliUpdateWorkspaceOwnership(
                42,
                { workspaceId: 'repo-a' },
                undefined,
                {
                    entryType: undefined,
                    significanceType: undefined,
                    tags: undefined,
                    projectNumber: undefined,
                    workspaceId: 'repo-b',
                    trustScore: undefined,
                    impactScore: undefined,
                    validationStatus: undefined,
                    sessionId: undefined,
                    autoContextStr: undefined,
                    relationships: [],
                    relatedIds: [],
                },
                'repo-b',
                { projectRegistry: { 'repo-b': { project_number: 2, path: tmpDir } } }
            )
        ).toThrow(ValidationError)
    })

    it('H14: encrypt-db validates hex keys without SQLite double-quote identifier bugs and stages temp files', () => {
        const scriptSrc = fs.readFileSync(
            path.join(process.cwd(), 'scripts', 'encrypt-db.ts'),
            'utf-8'
        )
        expect(scriptSrc).toContain("/^x'(?:[0-9a-fA-F]{2})+'$/i")
        expect(scriptSrc).toContain('`${pragma} = ${secret}`')
        expect(scriptSrc).not.toContain('${pragma} = "${secret')
        expect(scriptSrc).toContain("pragma('integrity_check', { simple: true })")
        expect(scriptSrc).toContain('.tmp-${String(process.pid)}')
    })
})
