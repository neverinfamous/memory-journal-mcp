import { describe, expect, it, vi } from 'vitest'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import {
    CODE_QUALITY_PROMPT_REVISION,
    getCodeQualityAuditPromptDefinition,
} from '../../src/handlers/prompts/adversarial-code-quality.js'
import { createSecureDispatcher } from '../../src/handlers/tools/codemode/secure-dispatcher.js'
import { resolveCodeModeSessionContext } from '../../src/handlers/tools/codemode/session-context.js'
import { resolveRepoWorkspace } from '../../src/handlers/tools/codemode/json-entry-scope.js'
import { extractAndRecoverPreparedStatementCode } from '../../src/handlers/tools/codemode/sql-prepared-recovery.js'
import { recoverStructuredJsonCode } from '../../src/handlers/tools/codemode/json-entry-structured.js'
import { extractAndRecoverSqlCode } from '../../src/handlers/tools/codemode/sql-recovery.js'
import { extractAndRecoverEntryCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import {
    parsePositiveEntryId,
    parseProjectNumberField,
} from '../../src/handlers/tools/codemode/natural-language-synthesizer.js'
import { ExecuteCodeSchema } from '../../src/handlers/tools/codemode/schemas.js'
import { enforceTeamToolRbac } from '../../src/handlers/tools/team/rbac.js'
import { transformAutoReturn } from '../../src/codemode/auto-return.js'
import { isSupportedWhereClause } from '../../src/codemode/sql-literal-scope.js'
import { parseSqlStatement } from '../../src/codemode/sql-positional-binder.js'
import { convertKeysToSnakeCase } from '../../src/codemode/api/key-normalizer.js'
import { wireProjectAndTeamAliasesHelper } from '../../src/codemode/api/journal-api-aliases.js'
import { applyArgInterceptions } from '../../src/codemode/param-normalizer.js'
import {
    coerceNumericStringIds,
    extractMetadataContextAliases,
    getActiveProjectRegistry,
    setActiveProjectRegistry,
} from '../../src/codemode/normalizers/generic-field-aliases.js'
import { createSystemDatabaseDomainProxy } from '../../src/codemode/worker/mj-shim-db-domains.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import type { ToolContext, ToolDefinition } from '../../src/types/index.js'

function makeBaseContext(overrides: Partial<ToolContext> = {}): ToolContext {
    return {
        db: { searchByDateRange: () => [] } as unknown as ToolContext['db'],
        config: {
            codemodeInternalFullAccess: true,
            projectRegistry: {
                repo: { project_number: 11 },
                'org/repo': { project_number: 22 },
            },
        },
        ...overrides,
    }
}

describe('Pass 75 Audit — Code Mode, Recovery, Normalizers & Prompts', () => {
    it('tracks AP1-AP4 prompt updates and revision 2026-11-22-audit-pass75', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass93')
        expect(CODE_QUALITY_PROMPT_REVISION).toBe('2026-11-24-audit-pass93')
        const def = getCodeQualityAuditPromptDefinition()
        const rendered = await def.handler(
            { target: 'memory-journal-mcp' },
            { searchByDateRange: () => [] } as unknown as Parameters<typeof def.handler>[1]
        )
        const firstMsg = (rendered as { messages?: { content?: { text?: string } }[] }).messages?.[0]
        const text = firstMsg?.content?.text ?? ''
        expect(text).toContain('auto_version`/`dry_run`')
        expect(text).toContain('immediate write transactions (`.immediate()`)')
        expect(text).toContain('pre-authz/pre-maintenance/pre-RBAC DB reads')
        expect(text).toContain('control-flow/branching prefixes')
        expect(text).toContain('batch same-workspace `target_workspace_id`')
    })

    it('H1: enforces team RBAC before auto-version DB reads and dryRun/isSimulation returns', async () => {
        const getEntrySpy = vi.fn(() => ({ id: 9, version: 3, workspaceId: 'repo', projectNumber: 11 }))
        const handlerSpy = vi.fn(() => Promise.resolve({ success: true }))
        const teamTool: ToolDefinition = {
            name: 'team_update_entry',
            title: 'Update Team Entry',
            description: 'Update team entry',
            group: 'team',
            inputSchema: ExecuteCodeSchema,
            outputSchema: ExecuteCodeSchema,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
            handler: handlerSpy,
        }
        const sessionContext: ToolContext = {
            db: { getEntryById: getEntrySpy } as unknown as ToolContext['db'],
            teamDb: {
                isTeamRbacActive: () => true,
                getTeamMember: () => ({ role: 'viewer' }),
                resolveTeamRole: () => 'viewer',
                getEntryById: getEntrySpy,
            } as unknown as ToolContext['teamDb'],
            config: {
                projectRegistry: { repo: { project_number: 11 } },
            },
        }
        expect(() =>
            enforceTeamToolRbac(sessionContext, teamTool, { workspace_id: 'repo', project_number: 11 })
        ).toThrow()

        const simDispatcher = createSecureDispatcher({
            tools: [teamTool],
            sessionContext,
            projectId: 11,
            workspaceId: 'repo',
            autoVersion: true,
            dryRun: false,
        })
        const simRes = (await simDispatcher('team_update_entry', { entry_id: 9, content: 'x' }, true)) as Record<
            string,
            unknown
        >
        expect(simRes['success']).toBe(false)
        expect(simRes['code']).toBe('AUTHORIZATION_FAILED')
        expect(getEntrySpy).not.toHaveBeenCalled()
        expect(handlerSpy).not.toHaveBeenCalled()

        const dryDispatcher = createSecureDispatcher({
            tools: [teamTool],
            sessionContext,
            projectId: 11,
            workspaceId: 'repo',
            autoVersion: true,
            dryRun: true,
        })
        const dryRes = (await dryDispatcher('team_update_entry', { entry_id: 9, content: 'x' })) as Record<
            string,
            unknown
        >
        expect(dryRes['success']).toBe(false)
        expect(dryRes['code']).toBe('AUTHORIZATION_FAILED')
        expect(getEntrySpy).not.toHaveBeenCalled()
    })

    it('H2: matches exact trimmed owner/repo before path leaf in session context and json scope', async () => {
        const ctx = makeBaseContext()
        const sessionRes = await resolveCodeModeSessionContext(ctx, { repo: 'org/repo' })
        expect('errorResponse' in sessionRes).toBe(false)
        if (!('errorResponse' in sessionRes)) {
            expect(sessionRes.workspaceId).toBe('org/repo')
            expect(sessionRes.projectId).toBe(22)
        }

        const prevRegistry = getActiveProjectRegistry()
        setActiveProjectRegistry({
            repo: { project_number: 11 },
            'org/repo': { project_number: 22 },
        })
        try {
            expect(resolveRepoWorkspace('org/repo')).toBe('org/repo')
            expect(resolveRepoWorkspace('other/repo')).toBe('repo')
        } finally {
            setActiveProjectRegistry(prevRegistry)
        }
    })

    it('H3: rejects control-flow prefixes before prepared statement recovery', () => {
        const branched =
            'if (flag) { const stmt = db.prepare("INSERT INTO memory_journal (content) VALUES (?)"); stmt.run("bad"); }'
        expect(extractAndRecoverPreparedStatementCode(branched)).toBeNull()

        const looped =
            'for (const item of items) { const stmt = db.prepare("DELETE FROM memory_journal WHERE id = ?"); stmt.run(1); }'
        expect(extractAndRecoverPreparedStatementCode(looped)).toBeNull()

        const straight =
            'const stmt = db.prepare("INSERT INTO memory_journal (content) VALUES (?)"); stmt.run("ok");'
        const recovered = extractAndRecoverPreparedStatementCode(straight)
        expect(recovered).toContain('mj.core.createEntry(')
    })

    it('H4: routes structured JSON team_delete_entry, restore_entry, and rejects unknown ops', () => {
        const teamDel = recoverStructuredJsonCode(JSON.stringify({ op: 'team_delete_entry', entry_id: 9 }))
        expect(teamDel).toContain('mj.team.teamDeleteEntry(')

        const restore = recoverStructuredJsonCode(JSON.stringify({ op: 'restore_entry', entry_id: 9 }))
        expect(restore).toContain('mj.admin.restoreEntry(')

        const teamRestore = recoverStructuredJsonCode(JSON.stringify({ op: 'team_restore_entry', entry_id: 9 }))
        expect(teamRestore).toContain('mj.team.teamRestoreEntry(')

        const teamGet = recoverStructuredJsonCode(JSON.stringify({ op: 'team_get_entry_by_id', entry_id: 9 }))
        expect(teamGet).toContain('mj.team.teamGetEntryById(')

        const getById = recoverStructuredJsonCode(JSON.stringify({ op: 'get_entry_by_id', entry_id: 9 }))
        expect(getById).toContain('mj.core.getEntryById(')

        const unknown = recoverStructuredJsonCode(JSON.stringify({ op: 'purge_everything', entry_id: 9 }))
        expect(unknown).toBeNull()

        const teamCreate = recoverStructuredJsonCode(JSON.stringify({ op: 'team_create_entry', content: 'hi' }))
        expect(teamCreate).toContain('mj.team.teamCreateEntry(')
    })

    it('H5: preserves return across unary !/~ continuations and blocks false call continuations after statements', () => {
        expect(transformAutoReturn('!\nfn()')).toBe('return !\nfn()')
        expect(transformAutoReturn('~\nfn()')).toBe('return ~\nfn()')
        expect(transformAutoReturn('if (ok) {}\n(fn())')).toBe('if (ok) {}\n\nreturn (fn())')
        expect(transformAutoReturn('fn()\n(x)')).toBe('return fn()\n(x)')
    })

    it('H6: rejects duplicate canonical columns in SQL literal WHERE and sql-recovery', () => {
        expect(isSupportedWhereClause('id = 1 AND entry_id = 2')).toBe(false)
        expect(isSupportedWhereClause("workspace_id = 'a' AND workspace_id = 'b'")).toBe(false)
        expect(isSupportedWhereClause('project_number = 1 AND project_id = 2')).toBe(false)
        expect(isSupportedWhereClause("id = 1 AND workspace_id = 'a'")).toBe(true)

        expect(extractAndRecoverSqlCode('SELECT * FROM relationships WHERE id = 1 AND entry_id = 2')).toBeNull()
        expect(extractAndRecoverSqlCode("SELECT * FROM tags WHERE workspace_id = 'a' AND workspace_id = 'b'")).toBeNull()
        expect(extractAndRecoverSqlCode('SELECT * FROM relationships WHERE id = 1')).toContain(
            'mj.relationships.visualizeRelationships('
        )
    })

    it('C-M1..C-M5: normalizers, synthesizers, and team search deferral behave consistently', () => {
        // C-M1: filter unwrapping preserves outer tags
        const unwrapped = convertKeysToSnakeCase({ filter: { query: 'abc' }, tags: ['keep'] }, 'search_entries')
        expect(unwrapped['query']).toBe('abc')
        expect(unwrapped['tags']).toEqual(['keep'])

        // C-M2: extractMetadataContextAliases does not stamp undefined own keys
        const metaTarget: Record<string, unknown> = { content: 'note', context: {} }
        extractMetadataContextAliases(metaTarget)
        expect(Object.hasOwn(metaTarget, 'tags')).toBe(false)
        expect(Object.hasOwn(metaTarget, 'project_number')).toBe(false)

        // C-M3: project registry methods reject non-numeric project_number without alias lookup
        const projObj: Record<string, unknown> = { name: 'repo', project_number: 'not-a-number' }
        const coercedErr = coerceNumericStringIds(projObj, 'get_project')
        expect(coercedErr).toBeDefined()
        expect(projObj['project_number']).toBe('not-a-number')

        // C-M4: outer tags inherited and explicit [] kept; blank strings skipped in NL parsers
        const resInherited = resolveExecutionPayload(
            {
                dry_run: false,
                tags: ['outer-tag'],
                context: { content: 'body content' },
            },
            { tags: ['outer-tag'], context: { content: 'body content' } },
            true,
            0
        )
        expect('executionCode' in resInherited && resInherited.executionCode).toContain('"outer-tag"')

        const resEmptyTags = resolveExecutionPayload(
            {
                dry_run: false,
                context: { content: 'body content', tags: [] },
            },
            { context: { content: 'body content', tags: [] } },
            true,
            0
        )
        expect('executionCode' in resEmptyTags && resEmptyTags.executionCode).toContain('"tags":[]')

        expect(parseProjectNumberField({ project_number: '' }, { projectNumber: 5 })).toBe(5)
        expect(parsePositiveEntryId({ entry_id: '  ' }, { id: 42 })).toBe(42)

        // C-M5: worker proxy defers missing project check, direct calls still fail unless workspace_id given
        const deferred = applyArgInterceptions('team_search', [{ query: 'x' }], { deferTeamProjectCheck: true })
        expect('args' in deferred).toBe(true)
        const withConcreteWs = applyArgInterceptions('team_search', [{ query: 'x', workspace_id: 'repo' }])
        expect('args' in withConcreteWs).toBe(true)
        const directFail = applyArgInterceptions('team_search', [{ query: 'x' }])
        expect('error' in directFail).toBe(true)
    })

    it('C-L1..C-L5: null-proto db shim, auto-route workspace alias, SQL aggregates, nested autoVersion, autoContext recovery', async () => {
        // C-L1: null-prototype db shim and gated stats
        const dbProxy = createSystemDatabaseDomainProxy({}, {}) as Record<string, unknown>
        expect('constructor' in dbProxy).toBe(false)
        expect('stats' in dbProxy).toBe(false)
        const unknownRes = (await (dbProxy['stats'] as () => Promise<Record<string, unknown>>)())
        expect(unknownRes['success']).toBe(false)

        // C-L2: normalizeAutoRouteArg honors workspace alias
        const teamGetMock = vi.fn(() => Promise.resolve({ success: true, entry: { id: 7 } }))
        const core: Record<string, unknown> = {
            getEntryById: () =>
                Promise.resolve({
                    success: false,
                    code: 'RESOURCE_NOT_FOUND',
                    suggestion: 'Try team_get_entry_by_id',
                }),
        }
        wireProjectAndTeamAliasesHelper({
            core,
            search: {},
            admin: {},
            relationships: {},
            team: { teamGetEntryById: teamGetMock },
            hasDispatcher: true,
            registryProvider: undefined,
            copyFnSchema: () => undefined,
        })
        await (core['getEntryById'] as (arg: Record<string, unknown>) => Promise<unknown>)({
            entry_id: 7,
            workspace: 'repo',
        })
        expect(teamGetMock).toHaveBeenCalledWith(expect.objectContaining({ entry_id: 7, workspace_id: 'repo' }))

        // C-L3: SQL positional binder rejects aggregate projections
        expect(parseSqlStatement('SELECT COUNT(*) FROM memory_journal WHERE id = 1', []).action).toBe('unmapped')

        // C-L4: ExecuteCodeSchema promotes dryRun -> dry_run while keeping {} default false
        expect(ExecuteCodeSchema.parse({})['dry_run']).toBe(false)
        expect(ExecuteCodeSchema.parse({ code: '1', dryRun: true })['dry_run']).toBe(true)
        const runIsolatedSpy = vi.fn(() => Promise.resolve({ success: true, isolated: true }))
        const nestedExec = createSandboxExecutor({
            shimMj: {
                core: {},
                admin: {},
                search: {},
                relationships: {},
            },
            vmContextRef: {},
            timeoutMs: 1000,
            readonlyMode: false,
            dryRunMode: false,
            pinnedWorkspaceRaw: undefined,
            pinnedProjectRaw: undefined,
            projectRegistryRaw: undefined,
            runIsolatedNestedCode: runIsolatedSpy,
        })
        await nestedExec({ content: 'updated body', entry_id: 5, autoVersion: false })
        expect(runIsolatedSpy).toHaveBeenCalledTimes(1)

        // C-L5: json-entry-recovery strips nested autoContext metadata before scanning top-level type/tags
        const recoveredEntry = extractAndRecoverEntryCode(
            'mj.core.createEntry({ content: "broken trailing", autoContext: { tags: ["nested"], type: "decision" } '
        )
        const entryMatch = /^return await mj\.createEntry\(([\s\S]*)\);$/.exec(recoveredEntry ?? '')
        expect(entryMatch).not.toBeNull()
        const entryPayload = JSON.parse(entryMatch?.[1] ?? '{}') as Record<string, unknown>
        expect(entryPayload['entry_type']).toBe('technical_note')
        expect(entryPayload['tags']).toBeUndefined()
        expect(entryPayload['auto_context']).toEqual({ tags: ['nested'], type: 'decision' })
    })
})
