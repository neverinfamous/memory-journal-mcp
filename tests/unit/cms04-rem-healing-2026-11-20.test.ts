/**
 * CMS-04 REM Supervisor Regression Suite (2026-11-20)
 *
 * Covers the 5 self-healing adaptations mined from CMS-02 (#15442), agent-issues.jsonl (449 rows),
 * and mcp-audit.jsonl:
 * 1. `create_entry` / `CreateEntrySchema` `repo` (`repo_name`/`repoName`/`repository`) normalization
 *    when matching or filling registered `workspace_id` while preserving fork-slug & conflict rejection,
 *    plus `auto_link: true` (`autoLink`) deterministic same-session / shared-anchor linking.
 * 2. Code Mode `ctx` global & `mj.ctx` alias for `context` (`ReferenceError: ctx is not defined`)
 *    while preserving lexical `const ctx` shadowing.
 * 3. Cross-workspace `update_entry` move deadlock fixes: unassigned (`projectNumber === null | 0`)
 *    source moves with explicit `project_number`, `effectiveSourceWs` in `hasCrossWorkspaceTarget`,
 *    cross-project global moves via `mj_execute_code({ workspace_id: '*' })`, and `🛠️ AUTONOMOUS HEALING:`
 *    guidance on `crud-update` / `update-scope-helpers` / `dispatch-scope`.
 * 4. Actionable `🛠️ AUTONOMOUS HEALING:` per-project `listProjects` + `teamGetRecent` guidance on
 *    Team DB cross-tenant `workspace_id: '*'` rejections (`team_get_recent`, `team_get_entry_by_id`).
 * 5. `optimize-journal` and `cms-rem-supervisor` prompt guardrails for cross-workspace moves,
 *    Team DB per-project enumeration, and `getRecentEntries` unassigned checks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import vm from 'node:vm'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { getCoreTools } from '../../src/handlers/tools/core/tools.js'
import { getAdminTools } from '../../src/handlers/tools/admin/index.js'
import { getCodeModeTools } from '../../src/handlers/tools/codemode/index.js'
import { createSecureDispatcher } from '../../src/handlers/tools/codemode/secure-dispatcher.js'
import { CreateEntrySchema, CreateEntrySchemaMcp } from '../../src/handlers/tools/core/schemas.js'
import { TeamCreateEntrySchema } from '../../src/handlers/tools/team/schemas/core-search-schemas.js'
import { buildSandboxGlobals } from '../../src/codemode/worker/sandbox-globals.js'
import { createShimMjProxy } from '../../src/codemode/worker/mj-shim-proxy.js'
import { createSafeFsShim } from '../../src/codemode/worker/node-shims.js'
import { getOptimizerPromptDefinitions } from '../../src/handlers/prompts/optimizer.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import type { ToolContext, ToolHandlerConfig } from '../../src/types/index.js'

const TEST_REGISTRY: NonNullable<ToolHandlerConfig['projectRegistry']> = {
    'memory-journal-mcp': { path: 'C:/repos/memory-journal-mcp', project_number: 5 },
    'mysql-mcp': { path: 'C:/repos/mysql-mcp', project_number: 9 },
    'db-mcp': { path: 'C:/repos/db-mcp', project_number: 15 },
    'do-test-worker': { path: 'C:/repos/do-test-worker', project_number: 1 },
}

function createConfig(): ToolHandlerConfig {
    return {
        projectRegistry: TEST_REGISTRY,
        runtime: new ServerRuntime(),
    }
}

describe('CMS-04 REM Healing (2026-11-20)', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter

    beforeEach(async () => {
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
    })

    afterEach(() => {
        db.close()
        teamDb.close()
    })

    describe('1. create_entry repo alias normalization & auto_link support', () => {
        it('strips matching repo/repo_name/repository keys on CreateEntrySchema while rejecting conflicting or fork slugs', () => {
            const parsed = CreateEntrySchema.parse({
                workspace_id: 'db-mcp',
                project_number: 15,
                entry_type: 'bug_fix',
                content: 'Hardened admin input-hygiene guards.',
                impact_score: 0.4,
                trust_score: 0.95,
                validation_status: 'passed',
                tags: ['testing', 'db-mcp'],
                repo: 'db-mcp',
            })
            expect(parsed.workspace_id).toBe('db-mcp')
            expect(parsed.project_number).toBe(15)

            const mcpParsed = CreateEntrySchemaMcp.parse({
                workspace_id: 'db-mcp',
                project_number: 15,
                content: 'Note with repo_name.',
                repo_name: 'db-mcp',
            })
            expect(mcpParsed.workspace_id).toBe('db-mcp')

            // Conflicting repo vs workspace_id must still fail strict validation
            expect(
                CreateEntrySchema.safeParse({
                    workspace_id: 'db-mcp',
                    project_number: 15,
                    content: 'Conflicting repo scope',
                    repo: 'mysql-mcp',
                }).success
            ).toBe(false)

            // Unregistered foreign-org/repo fork slug must not stamp workspace_id or pass strict parse
            expect(
                CreateEntrySchema.safeParse({
                    content: 'Fork note',
                    repo: 'foreign-org/memory-journal-mcp',
                }).success
            ).toBe(false)
        })

        it('supports auto_link: true (and autoLink: true) on create_entry & TeamCreateEntrySchema', async () => {
            const cfg = createConfig()
            const first = (await callTool(
                'create_entry',
                {
                    workspace_id: 'db-mcp',
                    project_number: 15,
                    session_id: 'sess-autolink-1',
                    entry_type: 'technical_note',
                    content: 'Initial session audit note',
                    tags: ['testing', 'db-mcp'],
                    impact_score: 0.4,
                    trust_score: 0.95,
                    validation_status: 'passed',
                },
                db,
                undefined,
                undefined,
                cfg
            )) as Record<string, unknown>
            expect(first['success']).toBe(true)
            const firstId = first['id'] as number

            const second = (await callTool(
                'create_entry',
                {
                    workspace_id: 'db-mcp',
                    project_number: 15,
                    session_id: 'sess-autolink-1',
                    entry_type: 'retrospective',
                    content:
                        '## Accomplished\n- Finished audit\n\n## Unfinished / Blocked\n- None\n\n## Context for Next Session\n- Clean\n\n## Commits\n- None',
                    tags: ['session-summary', 'db-mcp'],
                    impact_score: 0.8,
                    trust_score: 0.98,
                    validation_status: 'passed',
                    autoLink: true,
                },
                db,
                undefined,
                undefined,
                cfg
            )) as Record<string, unknown>
            expect(second['success']).toBe(true)
            expect(second['suggested_links']).toBeUndefined()

            const rels = db.getRelationships(second['id'] as number, 'db-mcp')
            expect(rels.some((r) => r.toEntryId === firstId || r.fromEntryId === firstId)).toBe(true)

            expect(
                TeamCreateEntrySchema.safeParse({
                    workspace_id: 'db-mcp',
                    project_number: 15,
                    content: 'Team note with auto_link flag',
                    auto_link: true,
                }).success
            ).toBe(true)
        })
    })

    describe('2. Code Mode ctx global & mj.ctx alias for context', () => {
        it('exposes ctx alongside context in sandbox globals and mj.ctx while allowing lexical const ctx shadowing', () => {
            const frozenContext = Object.freeze({ content: '# Audit Summary\nPassed.' })
            const safeFsShim = createSafeFsShim(frozenContext)
            const mjApi: Record<string, unknown> = { context: frozenContext }
            const shimMj = createShimMjProxy({
                mjApi,
                safeFsShim,
                executeCodeFnRef: {},
                getUpdateMemoryFn: () => () => undefined,
            })
            const globals = buildSandboxGlobals({
                mjApi,
                shimMj,
                safeFsShim,
                frozenContext,
                executeCodeFn: async () => ({}),
                updateMemoryFn: () => undefined,
            })

            expect(globals['ctx']).toBe(frozenContext)
            expect(shimMj['ctx']).toBe(frozenContext)

            const vmCtx = vm.createContext({ ...globals })
            const globalRead = vm.runInContext('ctx.content', vmCtx) as string
            expect(globalRead).toBe('# Audit Summary\nPassed.')

            const shadowedRead = vm.runInContext(
                '(() => { const ctx = { content: "local" }; return ctx.content; })()',
                vmCtx
            ) as string
            expect(shadowedRead).toBe('local')
        })
    })

    describe('3. Cross-workspace update_entry move fixes & AUTONOMOUS HEALING hints', () => {
        it('migrates unassigned (projectNumber null) entries even when project_number is passed, while preserving positive-project ownership protection', async () => {
            const cfg = createConfig()
            const unassigned = db.createEntry({
                content: 'Legacy unassigned observability note',
                workspaceId: 'default',
            })
            expect(unassigned.projectNumber).toBeNull()

            const moveUnassigned = (await callTool(
                'update_entry',
                {
                    entry_id: unassigned.id,
                    workspace_id: '*',
                    project_number: 5,
                    target_workspace_id: 'memory-journal-mcp',
                },
                db,
                undefined,
                undefined,
                cfg
            )) as Record<string, unknown>
            expect(moveUnassigned['success']).toBe(true)
            const migrated = db.getEntryById(unassigned.id, 'memory-journal-mcp')
            expect(migrated?.workspaceId).toBe('memory-journal-mcp')
            expect(migrated?.projectNumber).toBe(5)

            // Owned entry in do-test-worker (#1) still blocks mismatched project_number: 5 on wildcard move
            const owned1 = db.createEntry({
                content: 'Historical July entry in project 1',
                workspaceId: 'do-test-worker',
                projectNumber: 1,
            })
            const mismatchMove = (await callTool(
                'update_entry',
                {
                    entry_id: owned1.id,
                    workspace_id: '*',
                    project_number: 5,
                    target_workspace_id: 'memory-journal-mcp',
                },
                db,
                undefined,
                undefined,
                cfg
            )) as Record<string, unknown>
            expect(mismatchMove['success']).toBe(false)
            expect(mismatchMove['code']).toBe('RESOURCE_NOT_FOUND')
            expect(String(mismatchMove['suggestion'])).toContain('🛠️ AUTONOMOUS HEALING:')

            // Concrete source workspace move returns ConflictError with AUTONOMOUS HEALING guidance
            const nonWildcardMove = (await callTool(
                'update_entry',
                {
                    entry_id: owned1.id,
                    workspace_id: 'do-test-worker',
                    target_workspace_id: 'memory-journal-mcp',
                },
                db,
                undefined,
                undefined,
                cfg
            )) as Record<string, unknown>
            expect(nonWildcardMove['success']).toBe(false)
            expect(String(nonWildcardMove['error'])).toContain('🛠️ AUTONOMOUS HEALING:')
            expect(String(nonWildcardMove['error'])).toContain("Moving an entry to another workspace requires workspaceId = '*'")

            // Global Code Mode dispatcher (workspaceId: '*', projectId: undefined) moves owned1 cleanly when project_number is omitted
            const ctx: ToolContext = { db, config: cfg }
            const tools = [...getCoreTools(ctx), ...getAdminTools(ctx), ...getCodeModeTools(ctx)]
            const globalDispatch = createSecureDispatcher({
                tools,
                sessionContext: ctx,
                projectId: undefined,
                workspaceId: '*',
                explicitWorkspace: true,
                autoVersion: true,
            })
            const globalMoved = (await globalDispatch('update_entry', {
                entry_id: owned1.id,
                workspace_id: '*',
                target_workspace_id: 'memory-journal-mcp',
            })) as Record<string, unknown>
            expect(globalMoved['success']).toBe(true)
            const afterGlobal = db.getEntryById(owned1.id, 'memory-journal-mcp')
            expect(afterGlobal?.workspaceId).toBe('memory-journal-mcp')
            expect(afterGlobal?.projectNumber).toBe(5)
        })
    })

    describe('4. Team DB cross-tenant wildcard guidance & CMS prompt instructions', () => {
        it('returns actionable AUTONOMOUS HEALING per-project listProjects guidance on wildcard team_get_recent and team_get_entry_by_id', async () => {
            const cfg = createConfig()
            const recentErr = (await callTool(
                'team_get_recent',
                { workspace_id: '*', limit: 10 },
                db,
                undefined,
                undefined,
                cfg,
                undefined,
                teamDb
            )) as Record<string, unknown>
            expect(recentErr['success']).toBe(false)
            expect(String(recentErr['suggestion'])).toContain('🛠️ AUTONOMOUS HEALING:')
            expect(String(recentErr['suggestion'])).toContain('listProjects')

            const byIdErr = (await callTool(
                'team_get_entry_by_id',
                { entry_id: 1, workspace_id: '*' },
                db,
                undefined,
                undefined,
                cfg,
                undefined,
                teamDb
            )) as Record<string, unknown>
            expect(byIdErr['success']).toBe(false)
            expect(String(byIdErr['suggestion'])).toContain('🛠️ AUTONOMOUS HEALING:')
            expect(String(byIdErr['suggestion'])).toContain('teamGetRecent')
        })

        it('documents cross-workspace move contract and per-project Team DB enumeration in optimize-journal and cms-rem-supervisor prompts', async () => {
            const defs = getOptimizerPromptDefinitions()
            const optDef = defs.find((d) => d.name === 'optimize-journal')
            const supDef = defs.find((d) => d.name === 'cms-rem-supervisor')
            expect(optDef).toBeDefined()
            expect(supDef).toBeDefined()
            if (optDef === undefined || supDef === undefined) {
                throw new Error('Expected optimize-journal and cms-rem-supervisor prompt definitions')
            }

            const optOut = await optDef.handler({ mode: 'full', autoRun: 'true' }, db, teamDb, undefined, {
                projectRegistry: TEST_REGISTRY,
            })
            const optText = optOut.messages[0]?.content.text ?? ''
            expect(optText).toContain("updateEntry({ entry_id: id, workspace_id: '*', target_workspace_id: correctWorkspace })")
            expect(optText).toContain('mj.admin.listProjects({})')

            const supOut = await supDef.handler({ lookbackHours: '24', autoRestore: 'true' }, db, teamDb, undefined, {
                projectRegistry: TEST_REGISTRY,
            })
            const supText = supOut.messages[0]?.content.text ?? ''
            expect(supText).toContain("getRecentEntries({ workspace_id: 'default'")
        })
    })
})
