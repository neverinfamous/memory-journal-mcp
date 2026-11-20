/**
 * Pass 39 adversarial code-quality remediation tests:
 * fencing, sandbox query synthesis, session isolation, CLI options, filters,
 * canonical safe integers, token/subscription lifecycle, circular logging,
 * Code Mode aliases, Zod DAG types, prompt capabilities, and AP1-AP7.
 */

import * as vm from 'node:vm'
import { McpServer } from '@modelcontextprotocol/server'
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { sanitizeAuditEntryForEgress } from '../../src/audit/audit-resource.js'
import { extractAuditScopeFromArgs } from '../../src/audit/audit-query-helpers.js'
import type { AuditEntry } from '../../src/audit/types.js'
import { addOutputOptions } from '../../src/cli/option-groups.js'
import { parseRelationshipArray } from '../../src/cli/commands/entry-payload-helpers.js'
import { coerceNumericValue } from '../../src/codemode/api/key-normalizer-postprocess.js'
import { coerceNumericStringIds } from '../../src/codemode/normalizers/generic-field-aliases.js'
import { healAutoContext } from '../../src/codemode/normalizers/shared-utils.js'
import { createReadResourceInterceptor } from '../../src/codemode/proxy-helpers.js'
import { scopeFromSqlLiterals } from '../../src/codemode/sql-literal-scope.js'
import { getZodTypeString } from '../../src/codemode/type-generator.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { getCmsSupervisorPromptDefinitions } from '../../src/handlers/prompts/cms-supervisor.js'
import { requirePositiveIntOrPlaceholder } from '../../src/handlers/prompts/github-commander.js'
import { getOptimizerPromptDefinitions } from '../../src/handlers/prompts/optimizer.js'
import { updateConfigurationSchema } from '../../src/handlers/tools/admin/update_configuration.js'
import { deepCamelToSnake as deepCamelToSnakeDispatch } from '../../src/handlers/tools/codemode/dispatch-scope.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { ExecuteCodeSchema } from '../../src/handlers/tools/codemode/schemas.js'
import { ListTagsSchema, ListTagsSchemaMcp } from '../../src/handlers/tools/core/schemas.js'
import { ensureBlockFenced, ensureInlineFenced } from '../../src/handlers/tools/github/fencing-helpers.js'
import { CrossTeamSearchSchema } from '../../src/handlers/tools/search/cross-team.js'
import { TeamSemanticSearchSchema } from '../../src/handlers/tools/team/schemas/analytics-vector-schemas.js'
import {
    estimatePayloadTokens,
    getSerializedPayloadJson,
    injectTokenEstimate,
    invalidateSerializedPayload,
} from '../../src/observability/token-estimator.js'
import { deepCamelToSnake as deepCamelToSnakeIngress } from '../../src/server/mcp-server/tool-registration/call-arg-normalizer.js'
import { SubscriptionManager } from '../../src/server/subscription-manager.js'
import { sanitizeIssueInput } from '../../src/utils/issue-logger.js'
import { requestContextStorage } from '../../src/utils/request-context.js'
import { parseCanonicalPositiveInt, parsePositiveProjectNumber } from '../../src/utils/safe-positive-int.js'
import {
    fenceNonCanonicalRefOrKey,
    isAlreadyFencedUntrustedContent,
    isAlreadyInlineFencedUntrustedContent,
} from '../../src/utils/security-utils.js'
import {
    clearActiveSessionProject,
    getActiveSessionProject,
    setActiveSessionProject,
} from '../../src/utils/workspace-resolver-session.js'

afterEach(() => {
    vi.restoreAllMocks()
})

describe('pass 39 code quality', () => {
    it('H1/M9/L3: enforces strict fencing wrappers, canonical ref fencing, and cycle-safe scrubbers', () => {
        expect(isAlreadyInlineFencedUntrustedContent('<untrusted_remote_content>ok</untrusted_remote_content>')).toBe(true)
        expect(
            isAlreadyInlineFencedUntrustedContent('<untrusted_remote_content>a</untrusted_remote_content> trailing')
        ).toBe(false)
        expect(
            isAlreadyInlineFencedUntrustedContent('<a><untrusted_remote_content>b</untrusted_remote_content>')
        ).toBe(false)
        expect(
            isAlreadyFencedUntrustedContent(
                '<untrusted_remote_content>&lt;untrusted_remote_content&gt;</untrusted_remote_content>'
            )
        ).toBe(false)

        const inlineBreakout = '<untrusted_remote_content>ok</untrusted_remote_content> INJECTED'
        expect(ensureInlineFenced(inlineBreakout)).not.toBe(inlineBreakout)
        expect(ensureInlineFenced(inlineBreakout)).toContain('INJECTED')

        const blockBreakout = '<untrusted_remote_content>\nok\n</untrusted_remote_content> EXTRA'
        expect(ensureBlockFenced(blockBreakout)).not.toBe(blockBreakout)

        expect(fenceNonCanonicalRefOrKey('main')).toBe('main')
        expect(fenceNonCanonicalRefOrKey('Alice Smith', true)).toBe('Alice Smith')
        expect(fenceNonCanonicalRefOrKey('feat<script>')).toContain('<untrusted_remote_content>')

        const cyclic: Record<string, unknown> = { ok: 'yes' }
        cyclic['self'] = cyclic
        const entry: AuditEntry = {
            timestamp: '2026-11-18T00:00:00Z',
            requestId: 'req<inject>',
            sessionId: 'sess\ninject',
            workspaceId: 'ws<x>',
            tool: 'test_tool',
            category: 'admin',
            scope: 'admin',
            user: 'u<1>',
            scopes: ['read', 'admin<x>'],
            durationMs: 1,
            success: true,
            args: cyclic,
        }
        const safe = sanitizeAuditEntryForEgress(entry)
        expect(safe.requestId).toContain('<untrusted_remote_content>')
        expect(safe.sessionId).toContain('<untrusted_remote_content>')
        expect(safe.workspaceId).toContain('<untrusted_remote_content>')
        expect(safe.scopes[1]).toContain('<untrusted_remote_content>')
        expect(safe.args?.['self']).toBe('[Circular]')

        const shared = { nested: 'value' }
        const dag: Record<string, unknown> = { left: shared, right: shared }
        dag['loop'] = dag
        const cleanIssue = sanitizeIssueInput(dag) as Record<string, unknown>
        expect(cleanIssue['left']).toEqual({ nested: 'value' })
        expect(cleanIssue['right']).toEqual({ nested: 'value' })
        expect(cleanIssue['loop']).toBe('[Circular]')

        let deep: Record<string, unknown> = { leaf: 'x' }
        for (let i = 0; i < 12; i++) deep = { child: deep }
        expect(JSON.stringify(sanitizeIssueInput(deep))).toContain('[Truncated]')

        expect(sanitizeIssueInput({ cliArgs: ['--auth-token', 'sec'] })).toEqual({
            cliArgs: ['--auth-token', '[REDACTED]'],
        })
        const cycArr: unknown[] = []
        cycArr.push(cycArr)
        expect(sanitizeIssueInput(cycArr)).toEqual(['[Circular]'])
    })

    it('H3/M10: prevents unintended nested write synthesis and threads Code Mode scope aliases', async () => {
        const createdCalls: unknown[] = []
        const executor = createSandboxExecutor({
            shimMj: {
                core: {
                    createEntry: (p: unknown) => {
                        createdCalls.push(p)
                        return Promise.resolve({ success: true })
                    },
                },
                search: { searchEntries: () => Promise.resolve({ success: true, entries: [] }) },
            },
            vmContextRef: { current: vm.createContext({}) },
            timeoutMs: 1000,
            readonlyMode: false,
            dryRunMode: false,
            pinnedWorkspaceRaw: 'ws-a',
            pinnedProjectRaw: undefined,
            projectRegistryRaw: { 'ws-a': { project_number: 5, path: '/tmp/a' } },
            runIsolatedNestedCode: (_code, _ro, _dr, _td, overrides) =>
                Promise.resolve({ success: true, overrides }),
        })

        const nlQueryRes = (await executor({
            query: 'Decision: accidental natural language write',
        })) as Record<string, unknown>
        expect(createdCalls).toHaveLength(0)
        expect(nlQueryRes['success']).toBe(true)

        const blockedNlRes = (await executor({
            query: 'write entry about Reflect',
        })) as Record<string, unknown>
        expect(createdCalls).toHaveLength(0)
        expect(blockedNlRes['success']).toBe(false)

        const isolatedRes = (await executor({
            code: 'return 1',
            project_number: 5,
        })) as { success: boolean; overrides?: { projectNumber?: number } }
        expect(isolatedRes.success).toBe(true)
        expect(isolatedRes.overrides?.projectNumber).toBe(5)

        const blankContent = resolveExecutionPayload(
            { workspace_id: 'ws-a' },
            { content: '   ' },
            true,
            Date.now()
        )
        expect('earlyReturn' in blankContent).toBe(true)

        const parsedExec = ExecuteCodeSchema.parse({
            code: 'return 1',
            workspaceId: 'ws-a',
            projectNumber: 5,
            repoName: 'memory-journal-mcp',
            sessionId: 'sess-1',
            timeoutMs: 2500,
        })
        expect(parsedExec.workspaceId).toBe('ws-a')
        expect(parsedExec.projectNumber).toBe(5)
        expect(parsedExec.repoName).toBe('memory-journal-mcp')
        expect(parsedExec.sessionId).toBe('sess-1')
        expect(parsedExec.timeoutMs).toBe(2500)
    })

    it('M1/M2/M3/M8: isolates ephemeral HTTP session state, supports --no-json & exclude_tags, and invalidates caches', () => {
        const captured: { ws?: string; proj?: number } = {}
        requestContextStorage.run({ ip: '127.0.0.1' }, () => {
            setActiveSessionProject('ephemeral-ws', 77)
            Object.assign(captured, getActiveSessionProject())
            clearActiveSessionProject()
            expect(getActiveSessionProject()).toEqual({})
        })
        expect(captured).toEqual({ workspaceId: 'ephemeral-ws', projectNumber: 77 })
        expect(getActiveSessionProject()).toEqual({})

        const cmd = new Command()
        addOutputOptions(cmd)
        cmd.parse(['node', 'mj', '--no-json'])
        expect(cmd.opts<{ json?: boolean }>().json).toBe(false)

        expect(
            TeamSemanticSearchSchema.parse({ query: 'abc', exclude_tags: ['draft'] }).exclude_tags
        ).toEqual(['draft'])
        expect(
            CrossTeamSearchSchema.parse({ query: 'abc', exclude_tags: ['draft'] }).exclude_tags
        ).toEqual(['draft'])

        const emptyObj: Record<string, unknown> = {}
        expect(estimatePayloadTokens(emptyObj)).toBe(1)
        const est = injectTokenEstimate(emptyObj) as { _meta: { tokenEstimate: number } }
        expect(est._meta.tokenEstimate).toBe(1)
        expect(getSerializedPayloadJson(est)).toBe('{"_meta":{"tokenEstimate":1}}')

        emptyObj['mutated'] = 'value'
        invalidateSerializedPayload(emptyObj)
        expect(estimatePayloadTokens(emptyObj)).toBeGreaterThan(1)
    })

    it('M8: unregisterServerIfMatch preserves newer bound server subscriptions', async () => {
        const subs = new SubscriptionManager()
        const serverA = new McpServer({ name: 'a', version: '1.0.0' })
        const serverB = new McpServer({ name: 'b', version: '1.0.0' })
        const spyB = vi.spyOn(serverB.server, 'sendResourceUpdated').mockResolvedValue(undefined)
        subs.registerServer('stdio', serverA)
        subs.registerServer('stdio', serverB)
        subs.subscribe('memory://recent', 'stdio')
        subs.unregisterServerIfMatch('stdio', serverA)
        await subs.notifyResourceUpdated('memory://recent')
        expect(spyB).toHaveBeenCalledTimes(1)
        subs.unregisterServerIfMatch('stdio', serverB)
        await subs.notifyResourceUpdated('memory://recent')
        expect(spyB).toHaveBeenCalledTimes(1)
    })

    it('M6: enforces canonical decimal positive integers across normalizers, schemas, prompts, and SQL parsers', () => {
        expect(parseCanonicalPositiveInt('0x10')).toBeUndefined()
        expect(parseCanonicalPositiveInt('1e2')).toBeUndefined()
        expect(parseCanonicalPositiveInt('01')).toBeUndefined()
        expect(parseCanonicalPositiveInt('9007199254740993')).toBeUndefined()
        expect(parsePositiveProjectNumber(42)).toBe(42)

        expect(coerceNumericValue('project_number', '0')).toEqual({ value: 0 })
        expect(coerceNumericValue('project_number', '0x10')).toBeUndefined()
        expect(coerceNumericValue('entry_id', '0')).toBeUndefined()
        expect(coerceNumericValue('entry_ids', ['5', '0x5', '05'])).toEqual({
            value: [5, '0x5', '05'],
        })

        const aliasOffset: Record<string, unknown> = { offset: '0', entry_id: '05' }
        expect(coerceNumericStringIds(aliasOffset)).toBeUndefined()
        expect(aliasOffset['offset']).toBe(0)
        expect(aliasOffset['entry_id']).toBe('05')

        expect(() => updateConfigurationSchema.parse({ project_number: '   ' })).toThrow()
        expect(() => updateConfigurationSchema.parse({ project_number: '0x10' })).toThrow()
        expect(updateConfigurationSchema.parse({ project_number: '#12' }).project_number).toBe(12)

        expect(ListTagsSchema.safeParse({ project_number: '0x10' }).success).toBe(false)
        expect(ListTagsSchemaMcp.parse({ project_number: '12' }).project_number).toBe('12')

        expect(() => requirePositiveIntOrPlaceholder('05', '{n}', 'pr_number')).toThrow()
        expect(requirePositiveIntOrPlaceholder('15', '{n}', 'pr_number')).toBe('15')

        expect(() =>
            parseRelationshipArray([{ target_id: '05', relation_type: 'relates_to' }], 'test')
        ).toThrow()
        expect(
            parseRelationshipArray([{ target_id: '15', relation_type: 'relates_to' }], 'test')[0]?.target_id
        ).toBe(15)

        expect(extractAuditScopeFromArgs({ project_number: '0x10' }).projectNumber).toBeUndefined()
        expect(scopeFromSqlLiterals('SELECT * FROM memory_journal WHERE project_number = 05')).toEqual({})
        expect(scopeFromSqlLiterals('SELECT * FROM memory_journal WHERE project_number = 7')).toEqual({
            project_number: 7,
        })
    })

    it('L1/L4/L7/L8/M10: preserves ZodLazy DAGs, opaque bags, apostrophes, admin prompt caps, and resource hints', () => {
        interface Node {
            name: string
            next?: Node
        }
        const NodeSchema: z.ZodType<Node> = z.lazy(() =>
            z.object({
                name: z.string(),
                next: NodeSchema.optional(),
            })
        )
        const dagSchema = z.object({
            first: NodeSchema,
            second: NodeSchema,
        })
        const tsType = getZodTypeString(dagSchema)
        expect(tsType).toContain('second: { name: string, next?:')

        const normalized = deepCamelToSnakeIngress(
            { workspaceId: 'ws', auto_context: { camelInner: 1 }, prompt: { rawField: 2 } },
            0,
            new Set(['context'])
        ) as Record<string, unknown>
        expect(normalized['workspace_id']).toBe('ws')
        expect(normalized['auto_context']).toEqual({ camelInner: 1 })
        expect(normalized['prompt']).toEqual({ rawField: 2 })

        const recWithApostrophe: Record<string, unknown> = {
            auto_context: '{"commits":["abc"],"note":"it\'s passing"}',
        }
        healAutoContext(recWithApostrophe)
        expect(JSON.parse(String(recWithApostrophe['auto_context']))).toEqual({
            commits: ['abc'],
            note: "it's passing",
        })

        const spreadOrder1 = deepCamelToSnakeDispatch({
            auto_context: 'explicit-snake',
            autoContext: 'stale-camel',
        }) as Record<string, unknown>
        expect(spreadOrder1['auto_context']).toBe('explicit-snake')

        const spreadOrder2 = deepCamelToSnakeDispatch({
            autoContext: 'defined-camel',
            auto_context: undefined,
        }) as Record<string, unknown>
        expect(spreadOrder2['auto_context']).toBe('defined-camel')

        expect(getCmsSupervisorPromptDefinitions()[0]?.capabilities?.requiresAdminScope).toBe(true)
        expect(getOptimizerPromptDefinitions()[0]?.capabilities?.requiresAdminScope).toBe(true)

        const readRes = createReadResourceInterceptor()
        return Promise.all([
            readRes('memory://agent-context/memory-journal-mcp'),
            readRes('memory://agent-context-other'),
        ]).then(([r1, r2]) => {
            expect((r1 as { error: string }).error).toContain('mj.admin.getConfig()')
            expect((r2 as { error: string }).error).not.toContain('mj.admin.getConfig()')
        })
    })

    it('AP1-AP7: updates code-quality audit prompt to pass39 with portable guidance', () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-19-audit-pass47')
        const def = getCodeQualityAuditPromptDefinition()
        const rendered = def.handler({ target: 'my-target' }, {
            searchByDateRange: () => [],
            getEntriesByIds: () => new Map(),
        } as never) as { messages: { content: { text: string } }[] }
        const text = rendered.messages[0]?.content.text ?? ''
        expect(text).toContain('Prompt revision: 2026-11-19-audit-pass47')
        expect(text).toContain('generalPurpose')
        expect(text).toContain('PRAGMA foreign_key_check')
        expect(text).toContain('Promise.allSettled')
        expect(text).toContain('ephemeral per-request store')
        expect(text).toContain('changelog.commits')
    })
})
