/**
 * Pass 32 Adversarial Security, Scope & Code Mode Boundary Regression Suite
 * Covers H1-H11 and M1 across path-safety symlink checks, OAuth tool scopes, key-normalizer
 * snake_case precedence, empty registry isolation, query non-write synthesis, strict numeric
 * batch IDs, wildcard target project mismatches, live/disk registry separation, and GitHub scope.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import {
    assertSafeDirectoryPath,
    assertSafeFilePath,
    PathTraversalError,
} from '../../src/utils/path-safety.js'
import { SCOPES } from '../../src/auth/scopes.js'
import { getRequiredScope } from '../../src/auth/scope-map.js'
import { enforceAccessBoundary } from '../../src/auth/validation.js'
import { runWithAuthContext } from '../../src/auth/auth-context.js'
import { PermissionError } from '../../src/types/errors.js'
import { convertKeysToSnakeCase } from '../../src/codemode/api/key-normalizer.js'
import {
    resolveEffectiveProjectRegistry,
    setActiveProjectRegistry,
} from '../../src/codemode/normalizers/generic-field-aliases.js'
import { applyEntryAndSearchInterceptions } from '../../src/codemode/normalizers/entry-and-search-interceptions.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { ExecuteCodeSchema } from '../../src/handlers/tools/codemode/schemas.js'
import { getCodeModeTools } from '../../src/handlers/tools/codemode/handler.js'
import { findWildcardProjectMismatches } from '../../src/handlers/tools/admin/batch-vector-helpers.js'
import { getProjectTools } from '../../src/handlers/tools/admin/project-tools.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { resolveIssueEntryScope } from '../../src/handlers/tools/github/issue-entry-scope.js'
import { resolveOwner } from '../../src/handlers/tools/github/helpers.js'
import { createGitHubContextTool } from '../../src/handlers/tools/github/context-tool.js'
import type { ToolContext } from '../../src/types/index.js'

const TEST_REGISTRY = {
    'memory-journal-mcp': { project_number: 5, path: process.cwd() },
    'other-repo': { project_number: 9 },
}

describe('Pass 32 Security, Scope & Code Mode Regressions (H1-H11, M1)', () => {
    let db: DatabaseAdapter
    let tmpDir: string
    let savedEnv: NodeJS.ProcessEnv

    beforeEach(async () => {
        savedEnv = { ...process.env }
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass32-sec-'))
    })

    afterEach(() => {
        setActiveProjectRegistry(undefined)
        vi.restoreAllMocks()
        for (const key of Object.keys(process.env)) {
            if (!(key in savedEnv)) delete process.env[key]
        }
        Object.assign(process.env, savedEnv)
        db.close()
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('H1: blocks percent-encoded symlink escapes while allowing valid in-root paths', () => {
        const allowedRoot = path.join(tmpDir, 'allowed-root')
        const outsideDir = path.join(tmpDir, 'outside-secret')
        fs.mkdirSync(allowedRoot, { recursive: true })
        fs.mkdirSync(outsideDir, { recursive: true })

        const insideFile = path.join(allowedRoot, 'entry.md')
        fs.writeFileSync(insideFile, '# Safe', 'utf-8')
        expect(() => assertSafeDirectoryPath(allowedRoot, [allowedRoot])).not.toThrow()
        expect(() => assertSafeFilePath(insideFile, [allowedRoot])).not.toThrow()
        expect(() => assertSafeDirectoryPath(outsideDir, [allowedRoot])).toThrow(PathTraversalError)

        // Create symlink/junction literally named '%41' pointing outside allowedRoot (decoded 'A' does not exist).
        const encodedLink = path.join(allowedRoot, '%41')
        const linkType = process.platform === 'win32' ? 'junction' : 'dir'
        let linkCreated = false
        try {
            fs.symlinkSync(outsideDir, encodedLink, linkType)
            linkCreated = true
        } catch {
            // Symlink/junction creation unavailable in this environment; skip symlink assertions.
        }
        if (linkCreated) {
            expect(() => assertSafeDirectoryPath(encodedLink, [allowedRoot])).toThrow(
                PathTraversalError
            )
            expect(() =>
                assertSafeFilePath(path.join(encodedLink, 'leak.md'), [allowedRoot])
            ).toThrow(PathTraversalError)
        }
    })

    it('H2 & M1: maps check_entry_staleness to SCOPES.WRITE and search_audit_log to SCOPES.AUDIT', () => {
        expect(getRequiredScope('check_entry_staleness')).toBe(SCOPES.WRITE)
        expect(getRequiredScope('search_audit_log')).toBe(SCOPES.AUDIT)

        runWithAuthContext(
            { authenticated: true, scopes: ['read'], claims: { sub: 'reader', scopes: ['read'] } },
            () => {
                expect(() => enforceAccessBoundary('check_entry_staleness', 'tool')).toThrow(
                    PermissionError
                )
                expect(() => enforceAccessBoundary('search_audit_log', 'tool')).toThrow(
                    PermissionError
                )
            }
        )

        runWithAuthContext(
            {
                authenticated: true,
                scopes: ['read', 'write', 'audit'],
                claims: { sub: 'auditor', scopes: ['read', 'write', 'audit'] },
            },
            () => {
                expect(() => enforceAccessBoundary('check_entry_staleness', 'tool')).not.toThrow()
                expect(() => enforceAccessBoundary('search_audit_log', 'tool')).not.toThrow()
            }
        )
    })

    it('H3: convertKeysToSnakeCase preserves explicit snake_case over camelCase overrides', () => {
        const normalized = convertKeysToSnakeCase(
            {
                workspaceId: 'stale-camel-ws',
                workspace_id: 'memory-journal-mcp',
                projectNumber: 99,
                project_number: 5,
                content: 'Keep explicit snake_case bounds',
            },
            'createEntry'
        )
        expect(normalized['workspace_id']).toBe('memory-journal-mcp')
        expect(normalized['project_number']).toBe(5)
    })

    it('H4: setActiveProjectRegistry({}) does not fall back to disk config', () => {
        const diskCfg = path.join(tmpDir, 'fallback-registry.json')
        fs.writeFileSync(
            diskCfg,
            JSON.stringify({ projectRegistry: { 'disk-only': { path: tmpDir, project_number: 3 } } }),
            'utf-8'
        )
        process.env['MEMORY_JOURNAL_CONFIG'] = diskCfg
        delete process.env['NODE_ENV']
        delete process.env['VITEST']

        setActiveProjectRegistry({})
        expect(resolveEffectiveProjectRegistry()).toEqual({})

        setActiveProjectRegistry(undefined)
        const fromDisk = resolveEffectiveProjectRegistry()
        expect(fromDisk?.['disk-only']).toBeDefined()
    })

    it('H5: query alone never synthesizes write entries while dangerous tokens still fail security check', async () => {
        const queryInput = ExecuteCodeSchema.parse({ query: 'create entry about auth bug' })
        const payload = resolveExecutionPayload(queryInput, { query: 'create entry about auth bug' }, true, 0)
        if ('executionCode' in payload) {
            expect(payload.executionCode).not.toContain('createEntry')
        } else {
            expect(payload.earlyReturn['success']).toBe(false)
        }

        const execTool = getCodeModeTools({
            db,
            config: { codemodeEnabled: true, projectRegistry: TEST_REGISTRY, runtime: new ServerRuntime() },
        }).find((t) => t.name === 'mj_execute_code')
        expect(execTool).toBeDefined()

        const dangerousRes = (await execTool?.handler({ query: 'process.exit(1)' })) as Record<
            string,
            unknown
        >
        expect(dangerousRes['success']).toBe(false)
        expect(String(dangerousRes['error'] ?? '')).toMatch(/security|validation/i)
    })

    it('H6: batch_delete_entries and update_entry reject partial hex/UUID prefixes like 7a9f2b1-c3d4', () => {
        const batchErr = applyEntryAndSearchInterceptions('batch_delete_entries', ['7a9f2b1-c3d4'])
        expect('error' in batchErr).toBe(true)

        const twoArgErr = applyEntryAndSearchInterceptions('update_entry', [
            '7a9f2b1-c3d4',
            { content: 'Should fail' },
        ])
        expect('error' in twoArgErr).toBe(true)

        const validHash = applyEntryAndSearchInterceptions('batch_delete_entries', ['#42'])
        expect('args' in validHash).toBe(true)
        if ('args' in validHash) {
            expect(validHash.args[0]).toEqual({ entry_ids: [42] })
        }
    })

    it('H7: findWildcardProjectMismatches checks target_workspace_id even when item specifies project_number', () => {
        const entry9 = db.createEntry({
            content: 'Item in project 9',
            workspaceId: 'other-repo',
            projectNumber: 9,
        })
        const mismatches = findWildcardProjectMismatches(
            db,
            [{ entry_id: entry9.id, target_workspace_id: 'other-repo', project_number: 9 }],
            '*',
            5,
            { projectRegistry: TEST_REGISTRY }
        )
        expect(mismatches).toEqual([entry9.id])
    })

    it('H8: project tools honor live CLI/env projectRegistry without writing CLI baselines to disk', async () => {
        const diskCfgPath = path.join(tmpDir, 'mj-projects.json')
        fs.writeFileSync(diskCfgPath, '{}', 'utf-8')
        const cliDir = path.join(tmpDir, 'cli-repo')
        const diskDir = path.join(tmpDir, 'disk-repo')
        fs.mkdirSync(cliDir, { recursive: true })
        fs.mkdirSync(diskDir, { recursive: true })

        const runtime = new ServerRuntime()
        const cliBaselineRegistry = { 'cli-proj': { path: cliDir, project_number: 77 } }
        const configManager = new ConfigManager(
            {
                rawToolFilter: undefined,
                toolFilterConfig: null,
                briefingConfig: { ...DEFAULT_BRIEFING_CONFIG, projectRegistry: cliBaselineRegistry },
            },
            diskCfgPath,
            { projectRegistry: cliBaselineRegistry }
        )
        runtime.configManager = configManager

        const ctx: ToolContext = {
            db,
            config: {
                projectRegistry: cliBaselineRegistry,
                allowedIoRoots: [tmpDir],
                runtime,
            },
        }
        const tools = getProjectTools(ctx)
        const registerTool = tools.find((t) => t.name === 'register_project')
        const conflictKeyRes = (await registerTool?.handler({
            name: 'CLI-Proj',
            absolute_path: diskDir,
        })) as Record<string, unknown>
        expect(conflictKeyRes['success']).toBe(false)

        const conflictNumRes = (await registerTool?.handler({
            name: 'disk-proj',
            absolute_path: diskDir,
            project_number: 77,
        })) as Record<string, unknown>
        expect(conflictNumRes['success']).toBe(false)

        const registerOk = (await registerTool?.handler({
            name: 'disk-proj',
            absolute_path: diskDir,
            project_number: 88,
        })) as Record<string, unknown>
        expect(registerOk['success']).toBe(true)

        const written = JSON.parse(fs.readFileSync(diskCfgPath, 'utf-8')) as {
            projectRegistry?: Record<string, unknown>
        }
        expect(written.projectRegistry?.['disk-proj']).toBeDefined()
        expect(written.projectRegistry?.['cli-proj']).toBeUndefined()
        configManager.close()
    })

    it('H9: resolveIssueEntryScope qualifies foreign-owner repo slugs when workspace_id is omitted', () => {
        const res = resolveIssueEntryScope(
            { db, config: { projectRegistry: TEST_REGISTRY } },
            'memory-journal-mcp',
            undefined,
            undefined,
            'create issue entry',
            'foreign-org',
            'neverinfamous'
        )
        expect('workspaceId' in res).toBe(true)
        if ('workspaceId' in res) {
            expect(res.workspaceId).toBe('foreign-org/memory-journal-mcp')
            expect(res.projectNumber).toBeUndefined()
        }
    })

    it('H10 & H11: resolveOwner uses matchedRegistryKey fallback and get_github_context surfaces VALIDATION_ERROR', async () => {
        const mockGithub = {
            isApiAvailable: () => true,
            getCachedRepoInfo: () => ({ owner: 'org-x', repo: 'org-x/sub-repo', branch: 'main' }),
            getRepoInfo: async () => ({ owner: 'org-x', repo: null, branch: 'main' }),
            getRepoContext: vi.fn(async () => ({
                repoName: 'leaked',
                branch: 'main',
                commit: 'abc',
                remoteUrl: 'https://github.com/org-x/leaked',
                issues: [],
                pullRequests: [],
            })),
        }

        const resolved = await resolveOwner(
            {
                db,
                github: mockGithub as unknown as ToolContext['github'],
                config: {
                    projectRegistry: {
                        'org-x/sub-repo': { path: '', project_number: 77 },
                    },
                },
            },
            undefined,
            undefined,
            undefined,
            77,
            undefined
        )
        expect('owner' in resolved).toBe(true)
        if ('owner' in resolved) {
            expect(resolved.owner).toBe('org-x')
            expect(resolved.repo).toBe('org-x/sub-repo')
        }

        const contextTool = createGitHubContextTool({
            db,
            github: mockGithub as unknown as ToolContext['github'],
            config: {
                defaultWorkspaceId: 'other-repo',
                projectRegistry: TEST_REGISTRY,
            },
        })
        const errRes = (await contextTool.handler({})) as Record<string, unknown>
        expect(errRes['success']).toBe(false)
        expect(errRes['code']).toBe('VALIDATION_ERROR')
        expect(mockGithub.getRepoContext).not.toHaveBeenCalled()
    })
})
