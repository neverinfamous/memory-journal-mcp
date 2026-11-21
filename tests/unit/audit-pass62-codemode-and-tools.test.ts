import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as path from 'node:path'
import * as vm from 'node:vm'
import { parseSqlStatement } from '../../src/codemode/sql-positional-binder.js'
import { hasMultipleTopLevelSqlStatements } from '../../src/codemode/sql-placeholder-helpers.js'
import { extractAndRecoverSqlCode } from '../../src/handlers/tools/codemode/sql-recovery.js'
import { extractAndRecoverPreparedStatementCode } from '../../src/handlers/tools/codemode/sql-prepared-recovery.js'
import { extractAndRecoverEntryCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { recoverStructuredJsonCode } from '../../src/handlers/tools/codemode/json-entry-structured.js'
import { applyProjectNameAlias } from '../../src/codemode/normalizers/project-alias-helpers.js'
import {
    parseProjectNumberField,
    type ExecuteCodeInput,
} from '../../src/handlers/tools/codemode/natural-language-synthesizer.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { ExecuteCodeSchemaMcp } from '../../src/handlers/tools/codemode/schemas.js'
import { enrichEntryRecord } from '../../src/codemode/api/cross-group-aliases.js'
import {
    normalizeDispatchParams,
    isDefaultWorkspaceName,
} from '../../src/handlers/tools/codemode/dispatch-scope.js'
import { normalizeBatchDispatchItems } from '../../src/handlers/tools/codemode/dispatch-batch-scope.js'
import {
    lookupRegistryEntry,
    resolveCodeModeSessionContext,
} from '../../src/handlers/tools/codemode/session-context.js'
import { healCodeModeScript } from '../../src/handlers/tools/codemode/code-healer.js'
import { transformAutoReturn } from '../../src/codemode/auto-return.js'
import { applyDomainToolInterceptions } from '../../src/codemode/normalizers/domain-tool-interceptions.js'
import { postProcessNormalizedKeys } from '../../src/codemode/api/key-normalizer-postprocess.js'
import { createContextProxy } from '../../src/codemode/worker/namespace-shims.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import { GitUnreleasedOptionsSchema } from '../../src/handlers/tools/git-schemas.js'
import { getGitTools } from '../../src/handlers/tools/git.js'
import {
    LinkEntriesSchema,
    LinkEntriesSchemaMcp,
} from '../../src/handlers/tools/relationship-schemas.js'
import { getTeamMemberTools } from '../../src/handlers/tools/team/member-tools.js'
import { runSemanticSearch } from '../../src/handlers/tools/search/semantic-branch.js'
import { isTargetExcludedByRules } from '../../src/handlers/tools/dummy-filter-helpers.js'
import { prepareBatchCreateInputs } from '../../src/handlers/tools/admin/batch-create-helpers.js'
import { MarkAnchorsStaleSchema } from '../../src/handlers/tools/core/staleness-tools.js'
import { buildEntryPayload } from '../../src/cli/commands/entry-payload.js'
import { generateSummaryPrompt } from '../../src/handlers/prompts/workflow-helpers.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { setActiveSessionProject } from '../../src/utils/workspace-resolver-session.js'
import { ValidationError } from '../../src/types/errors.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'
import type { ToolContext } from '../../src/types/index.js'

const TEST_REGISTRY = {
    'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
    adamic: { path: path.resolve(process.cwd(), '..', 'adamic'), project_number: 16 },
}

describe('Pass 62 Code-Quality Audit — Code Mode, Scope, Schemas, Tools & CLI', () => {
    let savedRuntime: ServerRuntime | undefined

    beforeEach(() => {
        savedRuntime = new ServerRuntime()
    })

    afterEach(() => {
        vi.restoreAllMocks()
        if (savedRuntime !== undefined) {
            setActiveSessionProject(undefined, savedRuntime)
        }
    })

    it('H3 & M10: binds named SQL placeholders cleanly, preserves source workspace_id, and rejects unbound/multi-statement SQL', () => {
        expect(hasMultipleTopLevelSqlStatements('SELECT 1; DROP TABLE entries')).toBe(true)
        expect(hasMultipleTopLevelSqlStatements("SELECT ';';")).toBe(false)

        const parsed = parseSqlStatement(
            'UPDATE memory_journal SET content = :content, workspace_id = @workspace_id WHERE id = :id',
            [{ content: 'updated', workspace_id: 'adamic', id: 7 }]
        )
        expect(parsed.params['entry_id']).toBe(7)
        expect(parsed.params['content']).toBe('updated')
        expect(parsed.params['target_workspace_id']).toBe('adamic')
        expect(parsed.params['workspace_id']).toBeUndefined()

        expect(
            parseSqlStatement('UPDATE memory_journal SET content = :missing WHERE id = 1', [
                { content: 'ok' },
            ]).action
        ).toBe('unmapped')

        expect(
            parseSqlStatement('DELETE FROM memory_journal WHERE id = 1; DROP TABLE memory_journal', [])
                .action
        ).toBe('unmapped')

        expect(
            extractAndRecoverSqlCode(
                'DELETE FROM memory_journal WHERE id = 1; DELETE FROM memory_journal WHERE id = 2'
            )
        ).toBeNull()
        expect(
            extractAndRecoverSqlCode('UPDATE memory_journal SET content = :missing WHERE id = 1')
        ).toBeNull()
    })

    it('H4, O3, O13, O14: rejects invalid numeric project/entry_id inputs instead of silently dropping or creating', () => {
        const negObj: Record<string, unknown> = { project_number: -5, content: 'x' }
        const aliasRes = applyProjectNameAlias(-5, negObj)
        expect(typeof aliasRes === 'object' && 'conflict' in aliasRes).toBe(true)
        expect(negObj['project_number']).toBe(-5)

        const structured = recoverStructuredJsonCode(
            '{"action":"update","entry_id":-5,"content":"x"}'
        )
        expect(structured).not.toContain('createEntry')

        const fuzzy = extractAndRecoverEntryCode('mj.updateMemory({ id: -5, content: "x" })')
        expect(fuzzy).not.toContain('createEntry')

        expect(parseProjectNumberField({ project_number: -5 }, {})).toBe(-5)
        expect(ExecuteCodeSchemaMcp.safeParse({ code: '1', workspace_id: 'a'.repeat(256) }).success).toBe(false)

        const enriched: Record<string, unknown> = { project_number: 'adamic', content: 'hi' }
        enrichEntryRecord(enriched, () => TEST_REGISTRY)
        expect(enriched['project_number']).toBe(16)

        expect(() =>
            enrichEntryRecord({ project_number: 'missing-project', content: 'hi' }, () => TEST_REGISTRY)
        ).toThrow(ValidationError)
    })

    it('H5, H6, O16: prevents double-synthesis of recovered JS, blocks ${} backtick SQL and multi-run scripts, and keeps single-stmt recovery', () => {
        const payloadRes = resolveExecutionPayload(
            { context: 'ctx' } as ExecuteCodeInput,
            { action: 'create', content: 'synthesized once' },
            true,
            Date.now()
        )
        expect('executionCode' in payloadRes).toBe(true)
        if ('executionCode' in payloadRes) {
            expect(payloadRes.executionCode.match(/createEntry/g)?.length).toBe(1)
        }

        expect(
            extractAndRecoverPreparedStatementCode(
                "const s = db.prepare(`UPDATE memory_journal SET content = '${evil}' WHERE id = 1`); s.run();"
            )
        ).toBeNull()
        expect(
            extractAndRecoverPreparedStatementCode(
                "const s = db.prepare('DELETE FROM memory_journal WHERE id = ?'); s.run(1); s.run(2);"
            )
        ).toBeNull()

        const singlePrepared = extractAndRecoverPreparedStatementCode(
            "const s = db.prepare('UPDATE memory_journal SET content = ? WHERE id = ?'); s.run('ok', 1); return 'Updated';"
        )
        expect(singlePrepared).not.toBeNull()
    })

    it('H7 & H8: enforces default-workspace source project ownership on moves and gates session projectNumber fallback', async () => {
        const sessionContext = {
            db: { getEntryById: () => ({ id: 1, workspaceId: 'default', projectNumber: 5 }) },
            runtime: savedRuntime,
            config: { projectRegistry: TEST_REGISTRY },
        } as unknown as ToolContext

        const moveRes = await normalizeDispatchParams(
            { name: 'update_entry', inputSchema: {} } as never,
            { entry_id: 1, workspace_id: 'default', target_workspace_id: 'adamic', project_number: 16 },
            { sessionContext, projectId: 16, workspaceId: 'default', explicitWorkspace: true }
        )
        expect('errorResult' in moveRes).toBe(true)

        const batchMoveRes = normalizeBatchDispatchItems(
            'updates',
            { updates: [{ id: 1, entry_id: 1, content: 'moved', target_workspace_id: 'adamic' }] },
            TEST_REGISTRY,
            {
                projectId: 16,
                workspaceId: 'default',
                toolName: 'batch_update_entries',
                sessionContext,
                isDefaultWorkspaceName,
                coerceProjectNumberField: () => undefined,
            }
        )
        expect(batchMoveRes?.errorResult['code']).toBe('RESOURCE_NOT_FOUND')

        setActiveSessionProject(5, savedRuntime)
        const scopedCtx = await resolveCodeModeSessionContext(
            {
                db: {} as IDatabaseAdapter,
                runtime: savedRuntime,
                config: { projectRegistry: TEST_REGISTRY },
            } as unknown as ToolContext,
            { code: '1', workspace_id: 'adamic' }
        )
        expect('errorResponse' in scopedCtx).toBe(false)
        if (!('errorResponse' in scopedCtx)) {
            expect(scopedCtx.workspaceId).toBe('adamic')
            expect(scopedCtx.numericProjectId).toBe(16)
        }
    })

    it('M1: relaxed *SchemaMcp preprocessors never throw directly and invalid inputs return formatted handler errors', async () => {
        expect(() => GitUnreleasedOptionsSchema.safeParse({ project_number: -5 })).not.toThrow()
        expect(() =>
            LinkEntriesSchemaMcp.safeParse({
                from_entry_id: 'bad',
                to_entry_id: 2,
                relationship_type: 'references',
            })
        ).not.toThrow()
        expect(
            LinkEntriesSchema.safeParse({
                from_entry_id: 1,
                to_entry_id: 1.5,
                relationship_type: 'references',
            }).success
        ).toBe(false)

        const fakeCtx = {
            db: {} as IDatabaseAdapter,
            teamDb: {} as IDatabaseAdapter,
            config: { projectRegistry: {} },
        } as unknown as ToolContext
        const unreleasedTool = getGitTools(fakeCtx).find((t) => t.name === 'get_unreleased_commits')
        const gitRes = (await unreleasedTool?.handler({ project_number: -5 })) as { success?: boolean }
        expect(gitRes?.success).toBe(false)

        const addMemberTool = getTeamMemberTools(fakeCtx).find((t) => t.name === 'team_add_member')
        const memberRes = (await addMemberTool?.handler({ author: 'alice', workspace_id: 'bad' })) as {
            success?: boolean
        }
        expect(memberRes?.success).toBe(false)
    })

    it('M7, M8, M9, M11: semantic + 1 lookahead, sequential filter rules, singular tag preservation, and prototype lookup guards', async () => {
        const searchMock = vi.fn().mockResolvedValue([])
        await runSemanticSearch({
            context: {
                db: { getEntriesByIds: () => new Map() } as unknown as IDatabaseAdapter,
                vectorManager: {
                    isInitialized: () => true,
                    search: searchMock,
                } as never,
            } as unknown as ToolContext,
            input: { limit: 50 } as never,
            query: 'test',
            wsId: 'default',
            hasFilters: false,
            searchOptions: {},
        })
        expect(searchMock.mock.calls[0]?.[1]).toBe(102)

        expect(
            isTargetExcludedByRules(['tool_a'], {
                raw: '-tool_a,+tool_a',
                rules: [
                    { type: 'exclude', target: 'tool_a' },
                    { type: 'include', target: 'tool_a' },
                ],
            })
        ).toBe(false)
        expect(
            isTargetExcludedByRules(['tool_a'], {
                raw: '+tool_a,-tool_a',
                rules: [
                    { type: 'include', target: 'tool_a' },
                    { type: 'exclude', target: 'tool_a' },
                ],
            })
        ).toBe(true)

        const relArg: Record<string, unknown> = { tag: 'bug' }
        postProcessNormalizedKeys(relArg, 'team_visualize_relationships')
        expect(relArg).toEqual({ tag: 'bug' })

        expect(lookupRegistryEntry({}, 'constructor')).toBeUndefined()
        expect(createContextProxy({})['constructor']).toBeUndefined()
        expect(createContextProxy({})['valueOf']).toBeUndefined()
    })

    it('O1, O2, O4, O7, O8, O11, O12, O15: covers remaining Code Mode, schema, CLI, prompt & shortcut bounds fixes', async () => {
        const healed = healCodeModeScript('const c = obj.tools.count; return await tools.core.listTags()')
        expect(healed).toContain('obj.tools.count')
        expect(healed).toContain('mj.core.listTags()')

        const mergeErr = applyDomainToolInterceptions('merge_tags', [
            { source_tags: ['a', 'b'], target_tag: 'c' },
        ])
        expect(mergeErr).toHaveProperty('error')

        const cliRels = JSON.stringify([{ target_id: 2, relation_type: 'references' }])
        expect(() =>
            buildEntryPayload({ relationships: cliRels }, { relationships: 'invalid' })
        ).toThrow(ValidationError)
        const cliWins = buildEntryPayload(
            { relationships: cliRels },
            { relationships: [{ target_id: 9, relation_type: 'supports' }] }
        )
        expect(cliWins.relationships).toEqual([{ target_id: 2, relation_type: 'references' }])

        await expect(
            prepareBatchCreateInputs([{ content: 'x', workspace_id: 'default' }], undefined, {
                config: {},
            } as unknown as ToolContext)
        ).rejects.toThrow(ValidationError)

        expect(MarkAnchorsStaleSchema.safeParse({ updates: [{ id: 0, status: 'stale' }] }).success).toBe(false)

        const summaryPrompt = generateSummaryPrompt(
            { getRecentEntries: () => ({ entries: [] }) } as unknown as IDatabaseAdapter,
            undefined,
            'personal'
        )
        const summaryText = summaryPrompt.messages[0]?.content.text ?? ''
        expect(summaryText).toContain('project: <Positive integer ID')

        expect(transformAutoReturn('constantine')).toBe('return constantine')

        const sizeLimitedExec = createSandboxExecutor({
            shimMj: {
                search: { searchEntries: async () => ({ entries: ['x'.repeat(200)] }) },
            },
            vmContextRef: { current: vm.createContext({}) },
            timeoutMs: 2000,
            maxResultSize: 1024,
            readonlyMode: true,
            dryRunMode: false,
            pinnedWorkspaceRaw: 'default',
            pinnedProjectRaw: undefined,
            projectRegistryRaw: {},
            runIsolatedNestedCode: async () => ({ success: true }),
        })
        await expect(sizeLimitedExec({ query: 'find', max_result_size: 20 })).rejects.toThrow(
            /limit exceeded|exceeds/i
        )

        const timedExec = createSandboxExecutor({
            shimMj: {
                search: { searchEntries: async () => await new Promise(() => {}) },
            },
            vmContextRef: { current: vm.createContext({}) },
            timeoutMs: 2000,
            maxResultSize: 1024,
            readonlyMode: true,
            dryRunMode: false,
            pinnedWorkspaceRaw: 'default',
            pinnedProjectRaw: undefined,
            projectRegistryRaw: {},
            runIsolatedNestedCode: async () => ({ success: true }),
        })
        await expect(timedExec({ query: 'hang', timeout_ms: 25 })).rejects.toThrow(/timed out/i)
    })
})
