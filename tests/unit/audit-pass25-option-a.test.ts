/**
 * Pass 25 Option A Regression Suite:
 * Covers scope isolation, SQLite storage backstop, CLI/config/importer/search hardening,
 * Code Mode session/normalizer/SQL/sandbox hardening, and prompt template fixes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { ValidationError } from '../../src/types/errors.js'
import type { ToolContext, ToolHandlerConfig } from '../../src/types/index.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { setActiveSessionProject, resolveProjectContext } from '../../src/utils/workspace-resolver.js'
import * as wsRegistry from '../../src/utils/workspace-resolver-registry.js'
import { exactRegistryKey, pairStoredScope, type ProjectRegistry } from '../../src/utils/write-scope.js'
import { getAdversarialPromptDefinitions } from '../../src/handlers/prompts/adversarial.js'
import { validateAdversarialPromptScope } from '../../src/handlers/prompts/adversarial-args.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import {
    buildPlanReviewPriorContextSection,
    buildPriorAuditSection,
} from '../../src/handlers/prompts/adversarial-helpers.js'
import { getCmsSupervisorPromptDefinitions } from '../../src/handlers/prompts/cms-supervisor.js'
import { getOptimizerPromptDefinitions } from '../../src/handlers/prompts/optimizer.js'
import { resolveMcpCreateWorkspaceScope } from '../../src/server/mcp-server/tool-registration/create-scope-interceptor.js'
import { preprocessBatchCreateEntries } from '../../src/handlers/tools/admin/schemas/batch-preprocessors.js'
import { resolveActiveBriefingConfig } from '../../src/server/mcp-server/tool-registration/register-tools-helpers.js'
import { handleUpdateConfiguration } from '../../src/handlers/tools/admin/update_configuration.js'
import { resolveImportedFileContext } from '../../src/markdown/importer-scope.js'
import { getSearchEntriesTool } from '../../src/handlers/tools/search/search-entries.js'
import { rankByBlendedScore } from '../../src/handlers/tools/search/semantic-branch.js'
import { getCoreTools } from '../../src/handlers/tools/core/tools.js'
import { resolveCodeModeSessionContext } from '../../src/handlers/tools/codemode/session-context.js'
import { ExecuteCodeSchema } from '../../src/handlers/tools/codemode/schemas.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { normalizeDispatchParams } from '../../src/handlers/tools/codemode/dispatch-scope.js'
import { applyGenericInterceptions } from '../../src/codemode/normalizers/generic-interceptions.js'
import { normalizeExecuteCodeAliases } from '../../src/codemode/normalizers/generic-field-aliases.js'
import { isNaturalLanguagePrompt } from '../../src/handlers/tools/codemode/natural-language-synthesizer.js'
import { parseSqlStatement } from '../../src/codemode/sql-positional-binder.js'
import { extractAndRecoverSqlCode } from '../../src/handlers/tools/codemode/sql-recovery.js'
import { extractAndRecoverEntryCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { recoverStructuredJsonCode, resolveRepoWorkspace } from '../../src/handlers/tools/codemode/json-entry-structured.js'
import { WorkerSandbox } from '../../src/codemode/worker-sandbox.js'

const REGISTRY: Record<string, { path: string; project_number: number }> = {
    'memory-journal-mcp': { path: path.resolve('/repos/memory-journal-mcp'), project_number: 5 },
    'other-repo': { path: path.resolve('/repos/other-repo'), project_number: 9 },
}

const SLIM_REGISTRY: ProjectRegistry = {
    'memory-journal-mcp': { project_number: 5 },
    'other-repo': { project_number: 9 },
}

function getPromptText(res: { messages: { content: unknown }[] }): string {
    const first = res.messages[0]
    if (first === undefined || typeof first.content !== 'object' || first.content === null) return ''
    const textVal = Reflect.get(first.content, 'text')
    return typeof textVal === 'string' ? textVal : ''
}

function readProp(obj: unknown, key: string): unknown {
    if (typeof obj !== 'object' || obj === null) return undefined
    return Reflect.get(obj, key)
}

function isBlockedSandboxResult(res: { success: boolean; result?: unknown }): boolean {
    return res.success === false || readProp(res.result, 'success') === false
}

describe('Pass 25 Option A Regressions', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter

    beforeEach(async () => {
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
    })

    afterEach(() => {
        teamDb.close()
        db.close()
    })

    describe('1. Prompt Hardening & Attribution', () => {
        it('renders hardened audit prompt with valid Method 2 JS syntax and zero banned strings', async () => {
            const def = getCodeQualityAuditPromptDefinition()
            const text = getPromptText(await def.handler({}, db))
            expect(AUDIT_PROMPT_REVISION).toBe('2026-11-15-audit-pass26')
            expect(text).toContain('memory://agent-context/')
            expect(text).toContain('mj.core.createEntry')
            expect(text).toContain('node <file>')
            expect(text).not.toContain('invoke_subagent')
            expect(text).not.toContain('bun path/to/commit.ts')

            const m2Idx = text.indexOf('Method 2')
            expect(m2Idx).toBeGreaterThan(-1)
            const fenceMatch = /```(?:js|javascript|mjs)\r?\n([\s\S]*?)```/.exec(text.slice(m2Idx))
            expect(fenceMatch?.[1]).toBeDefined()
            const stripped = (fenceMatch?.[1] ?? '').replace(/import\s*\{[^;]*\}\s*from\s*'[^']+';\s*/g, '')
            expect(stripped).toContain('SCAN_OK')
            expect(() => new vm.Script(stripped)).not.toThrow()
        })

        it('omits hardcoded project #5 in supervisor and optimizer prompts when registry is empty', async () => {
            const emptyBriefing = { ...DEFAULT_BRIEFING_CONFIG, projectRegistry: {} }
            const supDef = getCmsSupervisorPromptDefinitions()[0]
            expect(supDef).toBeDefined()
            const supText = supDef ? getPromptText(await supDef.handler({}, db, undefined, undefined, emptyBriefing)) : ''
            expect(supText).toContain('pnpm exec vitest run')
            expect(supText).toContain('pnpm exec playwright test')
            expect(supText).not.toContain('npx vitest run')
            expect(supText).not.toContain('npx playwright test')
            expect(supText).not.toContain('project #5')
            expect(supText).not.toContain('project_number: 5')

            const optDef = getOptimizerPromptDefinitions()[0]
            expect(optDef).toBeDefined()
            const optText = optDef ? getPromptText(await optDef.handler({}, db, undefined, undefined, emptyBriefing)) : ''
            expect(optText).not.toContain('project_number: 5')
            expect(optText).toContain('{ workspace_id: "*" }')
        })

        it('enforces target/workspace pair validation and explicit default vs free-text attribution', () => {
            const cfg: ToolHandlerConfig = { projectRegistry: REGISTRY }
            expect(() =>
                validateAdversarialPromptScope('memory-journal-mcp', undefined, cfg, 'other-repo')
            ).toThrow(ValidationError)
            expect(() => validateAdversarialPromptScope('default', 5, cfg)).toThrow(ValidationError)

            db.createEntry({
                content: '## Plan\nExisting OAuth refactor plan',
                entryType: 'plan_finalized',
                tags: ['adversarial-planner'],
                workspaceId: 'memory-journal-mcp',
                projectNumber: 5,
            })

            const briefing = { ...DEFAULT_BRIEFING_CONFIG, projectRegistry: REGISTRY, defaultWorkspaceId: 'memory-journal-mcp' }
            const explicitDefaultAudit = buildPriorAuditSection(db, 'topic', undefined, briefing, 'default')
            expect(explicitDefaultAudit).toContain('explicitly targets personal workspace `default`')
            expect(explicitDefaultAudit).not.toContain('project_number: 5')

            const explicitDefaultPlan = buildPlanReviewPriorContextSection(db, 'topic', undefined, briefing, 'default')
            expect(explicitDefaultPlan).toContain('explicitly targets personal workspace `default`')

            const freeTextPlan = buildPlanReviewPriorContextSection(db, 'OAuth refactor', 'OAuth refactor', briefing)
            expect(freeTextPlan).toContain('Existing OAuth refactor plan')

            const explicitPlan = buildPlanReviewPriorContextSection(db, 'OAuth', undefined, briefing, 'memory-journal-mcp', undefined, 5)
            expect(explicitPlan).toContain('workspace_id: "memory-journal-mcp"')

            const explicitAudit = buildPriorAuditSection(db, 'topic', undefined, briefing, 'memory-journal-mcp', undefined, 5)
            expect(explicitAudit).toContain('instead of `default`')

            const unresolvedAudit = buildPriorAuditSection(db, 'unregistered-ext', 'unregistered-ext', briefing)
            expect(unresolvedAudit).toContain('Never log audit entries or session summaries to workspace `default`')
            expect(unresolvedAudit).not.toContain('Existing OAuth refactor plan')
        })

        it('includes portable cross-host subagent guidance in sibling audit prompts', async () => {
            const defs = getAdversarialPromptDefinitions().filter((d) =>
                ['adversarial-audit-seo', 'adversarial-audit-skill', 'adversarial-audit-workflow'].includes(d.name)
            )
            expect(defs).toHaveLength(3)
            for (const def of defs) {
                const text = getPromptText(await def.handler({}, db))
                expect(text).toContain("that host's read-only subagent tool")
            }
        })
    })

    describe('2. Scope Isolation, Storage Backstop, Config, Importer & Search', () => {
        it('matches slug keys uniquely and rejects mismatched project/workspace pairs', () => {
            expect(exactRegistryKey('memory_journal_mcp', SLIM_REGISTRY)).toBe('memory-journal-mcp')
            expect(exactRegistryKey('repo-a', { 'repo-a': { project_number: 1 }, repo_a: { project_number: 2 } })).toBe('repo-a')
            expect(exactRegistryKey('x-y', { 'x-y': { project_number: 1 } })).toBe('x-y')
            expect(exactRegistryKey('x_y', { 'x-y': { project_number: 1 } })).toBe('x-y')
            expect(exactRegistryKey('x*y', { 'x-y': { project_number: 1 }, x_y: { project_number: 2 } })).toBeUndefined()
            expect(() => pairStoredScope('default', 5, SLIM_REGISTRY)).toThrow(ValidationError)
        })

        it('prevents prose/tag keyword guessing at storage and resolver boundaries while keeping author writes safe', () => {
            const cfg: ToolHandlerConfig = { defaultWorkspaceId: 'memory-journal-mcp', projectRegistry: REGISTRY }
            const resolved = resolveProjectContext({ content: 'unrelated work in other-repo' }, cfg)
            expect(resolved.workspaceId).toBe('memory-journal-mcp')

            const spy = vi.spyOn(wsRegistry, 'loadProjectRegistryFromConfig').mockReturnValue(REGISTRY)
            try {
                expect(() => db.createEntry({ content: 'bad', workspaceId: 'default', projectNumber: 5 })).toThrow(ValidationError)
                const saved = db.createEntry({
                    content: 'notes mentioning other-repo',
                    tags: ['other-repo'],
                    workspaceId: 'default',
                    author: 'alice',
                })
                expect(saved.workspaceId).toBe('default')
                expect(saved.author).toBeUndefined()
            } finally {
                spy.mockRestore()
            }
        })

        it('guards MCP create scope interceptor and batch preprocessor against default/mismatched leaks', () => {
            const args: Record<string, unknown> = {
                workspace_id: 'default',
                project_number: 5,
                entries: [{ content: 'entry' }],
            }
            resolveMcpCreateWorkspaceScope('batch_create_entries', args, { projectRegistry: REGISTRY })
            const entries = readProp(args, 'entries')
            expect(Array.isArray(entries)).toBe(true)
            const firstItem = Array.isArray(entries) ? entries[0] : undefined
            expect(readProp(firstItem, 'project_number')).toBeUndefined()

            const batch = preprocessBatchCreateEntries({
                workspace_id: 'other-repo',
                project_number: 9,
                entries: [{ content: 'personal', workspace_id: 'default' }],
            })
            const processed = readProp(batch, 'entries')
            const item0 = Array.isArray(processed) ? processed[0] : undefined
            expect(readProp(item0, 'workspace_id')).toBe('default')
            expect(readProp(item0, 'project_number')).toBeUndefined()
        })

        it('clears foreign session project_number for unregistered defaultWorkspaceId (C-14)', () => {
            const runtime = new ServerRuntime()
            setActiveSessionProject('other-repo', 9, runtime)
            const active = resolveActiveBriefingConfig(
                { ...DEFAULT_BRIEFING_CONFIG, defaultWorkspaceId: 'unregistered-ws', projectRegistry: REGISTRY },
                { transport: 'stdio', dbPath: ':memory:' },
                [],
                runtime
            )
            expect(active.defaultWorkspaceId).toBe('unregistered-ws')
            expect(active.defaultProjectNumber).toBeUndefined()
        })

        it('rejects wildcard and conflicting default+project_number in handleUpdateConfiguration (C-20)', () => {
            const mgr = new ConfigManager({
                rawToolFilter: 'starter',
                toolFilterConfig: null,
                briefingConfig: { ...DEFAULT_BRIEFING_CONFIG, projectRegistry: REGISTRY },
            })
            const runtime = new ServerRuntime()
            runtime.configManager = mgr
            const cfg: ToolHandlerConfig = { runtime, projectRegistry: REGISTRY }
            expect(() => handleUpdateConfiguration({ workspace_id: '*' }, cfg)).toThrow(ValidationError)
            expect(() =>
                handleUpdateConfiguration({ workspace_id: 'default', project_number: 5 }, cfg)
            ).toThrow(ValidationError)
        })

        it('validates importer frontmatter vs caller scope and pairs registry project_number (C-25)', () => {
            const cfg: ToolHandlerConfig = { projectRegistry: REGISTRY }
            expect(() =>
                resolveImportedFileContext(
                    { filename: 'a.md', body: 'hi', metadata: { workspace_id: 'other-repo' } },
                    { workspaceId: 'memory-journal-mcp', config: cfg }
                )
            ).toThrow(ValidationError)
            expect(() =>
                resolveImportedFileContext(
                    { filename: 'b.md', body: 'hi', metadata: {} },
                    { workspaceId: '*', config: cfg }
                )
            ).toThrow(ValidationError)
            const ok = resolveImportedFileContext(
                { filename: 'c.md', body: 'hi', metadata: { workspace_id: 'memory-journal-mcp' } },
                { config: cfg }
            )
            expect(ok).toEqual({ effectiveWsId: 'memory-journal-mcp', effectiveProjNum: 5 })
        })

        it('preserves VALIDATION_ERROR code, composite relevance keys, and team entry hint (H-08)', async () => {
            const ctx: ToolContext = { db, teamDb, config: { defaultWorkspaceId: 'default' } }
            const searchTool = getSearchEntriesTool(ctx).find((t) => t.name === 'search_entries')
            expect(searchTool).toBeDefined()
            const searchRes = searchTool ? await searchTool.handler({}) : undefined
            expect(readProp(searchRes, 'code')).toBe('VALIDATION_ERROR')

            const ranked = rankByBlendedScore(
                db,
                [
                    { id: 1, content: 'p', timestamp: '2026-01-01T00:00:00Z', source: 'personal', importanceScore: 0.1 },
                    { id: 1, content: 't', timestamp: '2026-01-01T00:00:00Z', source: 'team', importanceScore: 0.1 },
                ],
                'default',
                new Map([['personal:1', 0.1], ['team:1', 0.9]]),
                teamDb
            )
            expect(ranked[0]?.source).toBe('team')

            const teamCreated = teamDb.createEntry({ content: 'team only', workspaceId: 'default' })
            const getTool = getCoreTools(ctx).find((t) => t.name === 'get_entry_by_id')
            expect(getTool).toBeDefined()
            const missRes = getTool ? await getTool.handler({ entry_id: teamCreated.id }) : undefined
            expect(String(readProp(missRes, 'suggestion'))).toContain('team_get_entry_by_id')
        })
    })

    describe('3. Code Mode Scope, SQL & Sandbox Hardening', () => {
        it('honors explicit default over CWD, picks longest CWD prefix, and rejects unknown repo (C-01/C-02)', async () => {
            const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p25-parent-'))
            const childDir = path.join(parentDir, 'nested-child')
            fs.mkdirSync(childDir, { recursive: true })
            const nestedReg = {
                'parent-ws': { path: parentDir, project_number: 1 },
                'child-ws': { path: childDir, project_number: 2 },
            }
            const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(childDir)
            try {
                const explicitDefault = await resolveCodeModeSessionContext(
                    { db, config: { defaultWorkspaceId: 'default', projectRegistry: nestedReg } },
                    { workspace_id: undefined }
                )
                expect(explicitDefault).toMatchObject({ workspaceId: 'default' })

                const longestPrefix = await resolveCodeModeSessionContext(
                    { db, config: { projectRegistry: nestedReg } },
                    { workspace_id: undefined }
                )
                expect(longestPrefix).toMatchObject({ workspaceId: 'child-ws' })
            } finally {
                cwdSpy.mockRestore()
                fs.rmSync(parentDir, { recursive: true, force: true })
            }

            const unknownRepo = await resolveCodeModeSessionContext(
                { db, config: { projectRegistry: nestedReg } },
                { repo: 'unregistered-repo' }
            )
            expect('errorResponse' in unknownRepo).toBe(true)
        })

        it('skips context metadata hoisting on executeCode and forwards/rejects default+project_number (C-03/C-04)', async () => {
            const execRes = applyGenericInterceptions('executeCode', [{ context: { workspace_id: 'other-repo' }, code: 'return 1' }])
            expect('args' in execRes).toBe(true)
            const execArg0 = 'args' in execRes ? execRes.args[0] : undefined
            expect(readProp(execArg0, 'workspace_id')).toBeUndefined()

            const createRes = applyGenericInterceptions('createEntry', [{ context: { workspace_id: 'other-repo' }, content: 'hi' }])
            expect('args' in createRes).toBe(true)
            const createArg0 = 'args' in createRes ? createRes.args[0] : undefined
            expect(readProp(createArg0, 'workspace_id')).toBe('other-repo')

            const rawParams = { context: { content: 'note', workspace_id: 'default', project_number: 5 } }
            const parsed = ExecuteCodeSchema.parse(rawParams)
            const payloadRes = resolveExecutionPayload(parsed, rawParams, true, performance.now())
            expect('executionCode' in payloadRes).toBe(true)
            const code = 'executionCode' in payloadRes ? payloadRes.executionCode : ''
            expect(code).toContain('"workspace_id":"default"')
            expect(code).toContain('"project_number":5')

            await expect(
                resolveCodeModeSessionContext(
                    { db, config: { projectRegistry: REGISTRY } },
                    { workspace_id: 'default', project_number: 5 }
                )
            ).rejects.toThrow(ValidationError)
        })

        it('rejects alias workspace mismatches without project_number and pairs batch items case-insensitively (C-05/C-06)', async () => {
            const mockTool = {
                name: 'create_entry',
                description: 'x',
                inputSchema: {},
                annotations: {},
                handler: vi.fn(),
            }
            await expect(
                normalizeDispatchParams(
                    mockTool,
                    { _alias_derived_workspace: true, workspace_id: 'other-repo', content: 'hi' },
                    {
                        sessionContext: { db, config: { projectRegistry: REGISTRY } },
                        projectId: undefined,
                        workspaceId: 'memory-journal-mcp',
                        explicitWorkspace: true,
                    }
                )
            ).rejects.toThrow(ValidationError)

            const okCase = await normalizeDispatchParams(
                mockTool,
                { _alias_derived_workspace: true, workspace_id: 'Memory-Journal-MCP', content: 'hi' },
                {
                    sessionContext: { db, config: { projectRegistry: REGISTRY } },
                    projectId: 5,
                    workspaceId: 'memory-journal-mcp',
                    explicitWorkspace: true,
                }
            )
            expect('params' in okCase).toBe(true)
        })

        it('keeps query distinct from code and avoids rewriting valid JS calls (C-07/C-08)', () => {
            const obj: Record<string, unknown> = { query: 'recent entries' }
            normalizeExecuteCodeAliases(obj)
            expect(obj['code']).toBeUndefined()
            expect(isNaturalLanguagePrompt('add(1, 2)')).toBe(false)
        })

        it('enforces entry table allowlist and safe WHERE predicates in SQL recovery (C-09/C-10)', () => {
            expect(parseSqlStatement('SELECT * FROM sqlite_master', []).action).toBe('unmapped')
            expect(parseSqlStatement('SELECT * FROM memory_journal WHERE id = 1 OR id = 2', []).action).toBe('unmapped')
            expect(parseSqlStatement('SELECT * FROM memory_journal WHERE tags IS NULL', []).action).toBe('unmapped')
            expect(parseSqlStatement('SELECT * FROM memory_journal WHERE id IN (1, 2)', []).action).toBe('unmapped')
            expect(extractAndRecoverSqlCode('SELECT * FROM users WHERE id = 1')).toBeNull()
        })

        it('rejects multi-call fuzzy scripts, strips title duplication, and canonicalizes repo slugs (H-01/H-02)', () => {
            expect(
                extractAndRecoverEntryCode('mj.core.createEntry({ content: "a" }); mj.admin.updateEntry({ entry_id: 1, content: "b" })')
            ).toBeNull()
            const single = extractAndRecoverEntryCode(
                'Title: My Note\n\nmj.core.createEntry({ title: "My Note", content: `Line with `ticks`` })'
            )
            expect(single).toContain('return await mj.createEntry(')
            expect(single ?? '').toContain('Line with `ticks`')
            expect(single ?? '').not.toContain('Title: My Note')

            const spy = vi.spyOn(wsRegistry, 'loadProjectRegistryFromConfig').mockReturnValue(REGISTRY)
            try {
                expect(resolveRepoWorkspace('owner/Memory-Journal-MCP')).toBe('memory-journal-mcp')
                expect(resolveRepoWorkspace('owner/unregistered-xyz')).toBeUndefined()
            } finally {
                spy.mockRestore()
            }
            expect(recoverStructuredJsonCode(JSON.stringify({ query: 'find docs' }))).toContain('mj.search.searchEntries')
        })

        it('enforces readonly, workspace isolation, and security validation on nested worker executeCode (C-11/C-12)', async () => {
            const sandbox = new WorkerSandbox()
            try {
                const createStub = vi.fn().mockResolvedValue({ success: true })
                const roRes = await sandbox.execute(
                    'return await mj.core.executeCode({ query: "Write a journal entry now" })',
                    { core: { createEntry: createStub } },
                    undefined,
                    5000,
                    {},
                    true
                )
                expect(isBlockedSandboxResult(roRes)).toBe(true)
                expect(createStub).not.toHaveBeenCalled()

                const crossWs = await sandbox.execute(
                    'return await mj.core.executeCode({ workspace_id: "other-repo", code: "return 1" })',
                    {},
                    undefined,
                    5000,
                    { __mj_workspace_id: 'memory-journal-mcp' },
                    false
                )
                expect(isBlockedSandboxResult(crossWs)).toBe(true)

                const evalBlock = await sandbox.execute(
                    'return await mj.core.executeCode({ code: "return eval(\'1+1\')" })',
                    {},
                    undefined,
                    5000,
                    {},
                    false
                )
                expect(isBlockedSandboxResult(evalBlock)).toBe(true)
            } finally {
                sandbox.dispose()
            }
        })
    })
})
