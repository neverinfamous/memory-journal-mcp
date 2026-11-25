/**
 * Pass 52 Adversarial Code-Quality Audit Regression Tests (`M1`–`M9`, `L1`–`L8`, `AP1`–`AP3`).
 */

import vm from 'node:vm'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { wrapResult } from '../../src/codemode/worker-result-proxy.js'
import { createShimProjectsDomain } from '../../src/codemode/worker/mj-shim-domains.js'
import { getZodTypeString } from '../../src/codemode/type-generator.js'
import { resolveCompatibleInheritedScope } from '../../src/handlers/tools/codemode/json-entry-scope.js'
import { healCodeModeScript } from '../../src/handlers/tools/codemode/code-healer.js'
import { extractAndRecoverSqlCode } from '../../src/handlers/tools/codemode/sql-recovery.js'
import { coerceEntryIdField } from '../../src/handlers/tools/schemas/hallucination-healer-search.js'
import { healAgentHallucinations } from '../../src/handlers/tools/schemas/hallucination-healer.js'
import { getAgentContextResource } from '../../src/handlers/resources/core/agent-context.js'
import { attachStdioCloseCleanup } from '../../src/server/mcp-server/tool-registration/register-tools-helpers.js'
import { globalSubscriptionManager } from '../../src/server/subscription-manager.js'
import { parseToolFilter, isFilterEffectivelyReadOnly } from '../../src/filtering/tool-filter.js'
import { checkRateLimit } from '../../src/transports/http/security.js'
import { startMetricsServer } from '../../src/observability/metrics-server.js'
import { extractTargetWorkspaceId } from '../../src/handlers/tools/team/rbac-scope-target.js'
import { logger, onLogLevelChange } from '../../src/utils/logger.js'
import { runCheckEntryStaleness } from '../../src/handlers/tools/git-staleness.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { createIsolatedNestedRunner } from '../../src/codemode/worker/nested-exec-runner.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'
import type { Request } from 'express'
import type { RateLimitEntry } from '../../src/transports/http/types.js'

describe('Pass 52 Adversarial Code-Quality Regressions', () => {
    const savedEnv: Record<string, string | undefined> = {}

    function setEnv(key: string, value: string | undefined): void {
        if (!Object.hasOwn(savedEnv, key)) {
            savedEnv[key] = process.env[key]
        }
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }

    afterEach(() => {
        for (const [k, v] of Object.entries(savedEnv)) {
            if (v === undefined) delete process.env[k]
            else process.env[k] = v
            delete savedEnv[k]
        }
    })

    it('M1: createFailedResultProxy blocks set, deleteProperty, and setPrototypeOf mutations', () => {
        const failed = wrapResult({
            success: false,
            error: 'Entry not found',
            code: 'RESOURCE_NOT_FOUND',
        }) as Record<string, unknown>

        expect(Reflect.set(failed, 'success', true)).toBe(false)
        expect(Reflect.deleteProperty(failed, 'error')).toBe(false)
        expect(Reflect.setPrototypeOf(failed, null)).toBe(false)
        expect(failed['success']).toBe(false)
        expect(failed['error']).toBe('[RESOURCE_NOT_FOUND] Entry not found')
    })

    it('M2: disabledProjectTool wraps failure via wrapResult/wrapPromise and throws on collection reads', async () => {
        const domain = createShimProjectsDomain({}, {}) as Record<string, () => Promise<unknown>> &
            (() => Promise<unknown>)
        const listRes = (await domain['list']?.()) as Record<string, unknown>
        expect(listRes['success']).toBe(false)
        expect(listRes['code']).toBe('TOOL_DISABLED')
        expect(() => listRes['items']).toThrow(/not available in this sandbox/i)
        expect(() => listRes['entries']).toThrow(/not available in this sandbox/i)
        expect('projects' in listRes).toBe(false)
    })

    it('M3: createIsolatedNestedRunner preserves parent-pinned sessionId over child override', async () => {
        const seenRpcPayloads: unknown[] = []
        const sendRpc = (payload: unknown): Promise<unknown> => {
            seenRpcPayloads.push(payload)
            return Promise.resolve({ success: true })
        }
        const rpcFn = (group: string, method: string, args: unknown[]): Promise<unknown> =>
            sendRpc({ group, method, args })
        const captured: { sessionId?: string } = {}
        const runner = createIsolatedNestedRunner(
            {
                sendRpcRequest: sendRpc,
                rpcFn,
                methodList: { core: ['getRecentEntries'] },
                schemaList: {},
                timeoutMs: 5000,
                readonly: true,
                parentRpcOverrides: { sessionId: 'sess-outer' },
            },
            sendRpc,
            (vmOpts) => {
                captured.sessionId = vmOpts.parentRpcOverrides?.sessionId
                return vm.createContext({
                    mj: { core: { getRecentEntries: () => vmOpts.rpcFn('core', 'getRecentEntries', [{}]) } },
                })
            }
        )
        const out = await runner(
            '(async () => { await mj.core.getRecentEntries({}); return "ok"; })()',
            { session_id: 'sess-outer' },
            { sessionId: 'sess-inner' }
        )
        expect(out).toBe('ok')
        expect(captured.sessionId).toBe('sess-outer')
        expect(seenRpcPayloads.length).toBe(1)
        expect(seenRpcPayloads[0]).toMatchObject({ sessionId: 'sess-outer' })
    })

    it('M4: resolveCompatibleInheritedScope honors allowDefaultProjForward=false for default outer scope', () => {
        const blocked = resolveCompatibleInheritedScope(
            { query: 'foo' },
            { workspace_id: 'default', project_number: 5, payload: { query: 'foo' } },
            false
        )
        expect(blocked).toEqual({ workspaceId: 'default' })

        const allowed = resolveCompatibleInheritedScope(
            { query: 'foo' },
            { workspace_id: 'default', project_number: 5, payload: { query: 'foo' } },
            true
        )
        expect(allowed).toEqual({ workspaceId: 'default', projectNumber: 5 })
    })

    it('M5: getZodTypeString unwraps ZodPipe from ZodUnknown/ZodAny to schema.out including optionality', () => {
        const schema = z.object({
            a: z.unknown().pipe(z.string().optional()),
            b: z.any().pipe(z.number()),
        })
        expect(getZodTypeString(schema)).toBe('{ a?: string, b: number }')
    })

    it('M6: coerceEntryIdField and healAgentHallucinations reject negative numeric entry_id / entry_ids strings', () => {
        const single: Record<string, unknown> = { entry_id: '-5' }
        expect(coerceEntryIdField(single)).toBe(false)
        expect(single['entry_id']).toBe('-5')

        const batch = healAgentHallucinations({ entry_ids: ['-5', '#7', 'entry_9'] }) as Record<string, unknown>
        expect(batch['entry_ids']).toEqual(['-5', 7, 9])
    })

    it('M7: getTeamCollaborationMatrix excludes direct DB self-loops from inboundLinks', async () => {
        setEnv('DB_ENCRYPTION_KEY', '')
        setEnv('MJ_DB_ENCRYPTION_KEY', '')
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            db.applyTeamSchema()
            const e1 = db.createEntry({ content: 'self-loop test', workspaceId: 'ws-a', author: 'alice' })
            const e2 = db.createEntry({ content: 'peer entry', workspaceId: 'ws-a', author: 'bob' })
            ;(
                db as unknown as { connection: { run: (sql: string, params?: unknown[]) => void } }
            ).connection.run(
                'INSERT INTO relationships (from_entry_id, to_entry_id, relationship_type) VALUES (?, ?, ?)',
                [e1.id, e1.id, 'references']
            )
            db.linkEntries(e2.id, e1.id, 'references')

            const matrix = db.getTeamCollaborationMatrix({ workspaceId: 'ws-a', limit: 10 })
            const aliceImpact = matrix.impactFactor.find((r) => r.author === 'alice')
            expect(aliceImpact?.inboundLinks).toBe(1)
        } finally {
            db.close()
        }
    })

    it('M8 & L8: check_entry_staleness filters by session_id and coerces numeric-string project_number', async () => {
        const getRecentEntries = vi.fn().mockReturnValue({
            entries: [
                { id: 1, timestamp: '2026-11-20T00:00:00Z', sessionId: 'sess-keep' },
                { id: 2, timestamp: '2026-11-20T00:00:00Z', sessionId: 'sess-other' },
            ],
        })
        const getAnchorsByEntryIds = vi.fn().mockReturnValue(new Map())
        const mockDb = {
            getRecentEntries,
            getAnchorsByEntryIds,
        } as unknown as IDatabaseAdapter

        const res = (await runCheckEntryStaleness(
            {
                workspace_id: 'repo-a',
                project_number: '5',
                session_id: 'sess-keep',
            },
            {
                db: mockDb,
                config: {
                    projectRegistry: {
                        'repo-a': { project_number: 5, path: process.cwd() },
                    },
                },
            },
            vi.fn().mockResolvedValue(0)
        )) as Record<string, unknown>

        expect(res['success']).toBe(true)
        expect(getRecentEntries).toHaveBeenCalledWith(20, undefined, undefined, undefined, false, 'repo-a', 5)
        expect(getAnchorsByEntryIds).toHaveBeenCalledWith([1], 'repo-a')
    })

    it('M9: memory://agent-context/default?session_id=<id> appends session link targets', () => {
        const res = getAgentContextResource().handler('memory://agent-context/default?session_id=sess-123', {
            db: {
                getEntriesBySession: vi.fn().mockReturnValue([
                    { id: 42, entryType: 'technical_note', content: 'Default session entry' },
                ]),
            } as unknown as IDatabaseAdapter,
            briefingConfig: { projectRegistry: {} },
        })
        const text = typeof res.data === 'string' ? res.data : ''
        expect(text).toContain('Workspace ID: default')
        expect(text).toContain('#42')
    })

    it('L1: attachStdioCloseCleanup unregisters server on transport-initiated server.server.onclose', () => {
        const innerPrev = vi.fn()
        const fakeServer = {
            close: vi.fn().mockResolvedValue(undefined),
            server: {
                onclose: innerPrev,
                notification: vi.fn().mockResolvedValue(undefined),
            },
        }
        const unregisterSpy = vi.spyOn(globalSubscriptionManager, 'unregisterServerIfMatch')
        attachStdioCloseCleanup(fakeServer as never)
        fakeServer.server.onclose()
        expect(unregisterSpy).toHaveBeenCalledWith('stdio', fakeServer)
        expect(innerPrev).toHaveBeenCalledTimes(1)
        unregisterSpy.mockRestore()
    })

    it('L2 & L3: logger maps warn->warning; MCP_RATE_LIMIT_MAX, MJ_METRICS_PORT, and RBAC reject non-canonical ints', () => {
        const levels: string[] = []
        onLogLevelChange((lvl) => levels.push(lvl))
        logger.setLevel('warn' as never)
        expect(levels.at(-1)).toBe('warning')
        logger.setLevel('info')

        setEnv('MCP_RATE_LIMIT_MAX', '1abc')
        const map = new Map<string, RateLimitEntry>()
        const req = { ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } } as unknown as Request
        expect(checkRateLimit(req, { enableRateLimit: true }, map).allowed).toBe(true)
        expect(checkRateLimit(req, { enableRateLimit: true }, map).allowed).toBe(true)

        setEnv('MJ_METRICS_PORT', '0080')
        expect(() => startMetricsServer({} as never)).toThrow(/Invalid MJ_METRICS_PORT/)

        const target = extractTargetWorkspaceId(
            { project_number: '005' },
            { projectRegistry: { alpha: { project_number: 5, path: '/a' } } }
        )
        expect(target).not.toBe('alpha')
    })

    it('L4: isFilterEffectivelyReadOnly evaluates codemode include/exclude rules sequentially', () => {
        const reEnabled = parseToolFilter('search,-codemode,+codemode')
        expect(isFilterEffectivelyReadOnly(reEnabled)).toBe(false)
        const excludedAfter = parseToolFilter('search,+codemode,-codemode')
        expect(isFilterEffectivelyReadOnly(excludedAfter)).toBe(true)
    })

    it('L6 & L7: code-healer escapes even-backslash ${ and sql-recovery declines SET project_number = NULL mismatch', () => {
        const healed = healCodeModeScript("return await mj.core.createEntry({ content: 'line1\n\\\\${evil}' })")
        expect(healed).toContain('\\\\\\${evil}')

        const declined = extractAndRecoverSqlCode(
            'UPDATE journal_entries SET project_number = NULL WHERE id = 1 AND project_number = 5'
        )
        expect(declined).toBeNull()
    })

    it('AP1–AP3: bumps AUDIT_PROMPT_REVISION to 2026-11-20-audit-pass52 and includes Pass 52 guidance', () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-25-audit-pass95')
        const def = getCodeQualityAuditPromptDefinition()
        const mockDb = {
            searchEntries: vi.fn().mockReturnValue([]),
            searchByDateRange: vi.fn().mockReturnValue([]),
            getRecentEntries: vi.fn().mockReturnValue([]),
        } as unknown as IDatabaseAdapter
        const rendered = def.handler({ target: 'memory-journal-mcp' }, mockDb)
        const text = rendered.messages[0]?.content.text ?? ''
        expect(text).toContain('Prompt revision: 2026-11-25-audit-pass95')
        expect(text).toContain('leading `-` signs in ID-coercion healers')
        expect(text).toContain('full backslash-run parity')
        expect(text).toContain('collaboration/impact analytics')
    })
})
