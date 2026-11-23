import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { assertSafeDirectoryPath } from '../../src/utils/path-safety.js'
import {
    getOrCreateCodemodeBundle,
    disposeCodemodeResources,
} from '../../src/handlers/tools/codemode/singleton-state.js'
import { runWithCodemodeInvocation } from '../../src/handlers/tools/codemode/invocation-store.js'
import { resolveWorkspaceFromFilePath } from '../../src/utils/workspace-resolver.js'
import { buildPersonalMirrorIndex, findMirroredPersonalId } from '../../src/utils/team-mirror.js'
import { isCacheHit } from '../../src/handlers/tools/index.js'
import {
    getRuntimeWrapperConfig,
    isBareRuntimeWrapperConfig,
    type CachedToolContextRefs,
} from '../../src/handlers/tools/tool-cache-helpers.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { buildBriefingSystemSummary } from '../../src/handlers/resources/core/briefing/system-section.js'
import { RepositoryManager } from '../../src/github/github-integration/repository.js'
import { createScopedAuthorCanonicalizer } from '../../src/handlers/tools/team/admin-tools/batch-prefetch-helpers.js'
import { SubscriptionManager } from '../../src/server/subscription-manager.js'
import { validateResourceSubscription } from '../../src/handlers/resources/index.js'
import { withResourceTokenMeta } from '../../src/handlers/resources/shared.js'
import { getSerializedPayloadJson } from '../../src/observability/token-estimator.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getPerformanceAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-performance.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'
import type { ToolContext } from '../../src/types/index.js'
import { ResourceNotFoundError } from '../../src/types/errors.js'

function getRawDb(adapter: DatabaseAdapter): {
    prepare: (sql: string) => { all: (...params: unknown[]) => { detail: string }[] }
    exec: (sql: string) => void
} {
    return (
        adapter as unknown as {
            connection: {
                getNativeDb: () => {
                    prepare: (sql: string) => { all: (...params: unknown[]) => { detail: string }[] }
                    exec: (sql: string) => void
                }
            }
        }
    ).connection.getNativeDb()
}

function cleanupDb(dbPath: string): void {
    for (const suffix of ['', '-wal', '-shm']) {
        try {
            fs.unlinkSync(`${dbPath}${suffix}`)
        } catch {
            // ignore missing wal/shm
        }
    }
}

describe('Pass 59 Adversarial Performance Audit Regressions', () => {
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined

    beforeEach(() => {
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        delete process.env['MJ_DB_ENCRYPTION_KEY']
        delete process.env['DB_ENCRYPTION_KEY']
    })

    afterEach(() => {
        disposeCodemodeResources()
        if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
    })

    it('C1, C2 & M25: uses covering/composite indexes post-ANALYZE and fetches latest project entries in one query', async () => {
        const dbPath = path.join(os.tmpdir(), `mj-pass59-eqp-${String(process.pid)}-${String(Date.now())}.db`)
        const adapter = new DatabaseAdapter(dbPath, { projectRegistry: {} })
        try {
            await adapter.initialize()
            adapter.executeInTransaction(() => {
                for (let i = 0; i < 200; i++) {
                    adapter.createEntry({
                        workspaceId: 'ws-noise',
                        projectNumber: 9,
                        content: `Noise entry ${String(i)}`,
                        entryType: 'technical_note',
                        timestamp: `2026-10-${String((i % 28) + 1).padStart(2, '0')}T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
                    })
                }
                for (let i = 0; i < 20; i++) {
                    adapter.createEntry({
                        workspaceId: 'ws-hot',
                        projectNumber: 5,
                        issueNumber: 12,
                        prNumber: 77,
                        workflowRunId: 9001,
                        content: `Hot workspace entry ${String(i)}`,
                        entryType: 'project_decision',
                        timestamp: `2026-11-${String((i % 20) + 1).padStart(2, '0')}T12:00:00.000Z`,
                    })
                }
            })

            const rawDb = getRawDb(adapter)
            rawDb.exec('ANALYZE')

            const archivedPlan = rawDb
                .prepare(
                    `EXPLAIN QUERY PLAN
                     SELECT id FROM memory_journal
                     WHERE deleted_at IS NULL AND workspace_id = ? AND is_archived = 0 AND timestamp >= ?`
                )
                .all('ws-hot', '2026-11-01T00:00:00.000Z')
                .map((r) => r.detail)
                .join('\n')
            expect(archivedPlan).toContain('SEARCH memory_journal USING')

            const issuePlan = rawDb
                .prepare(
                    `EXPLAIN QUERY PLAN
                     SELECT id FROM memory_journal
                     WHERE deleted_at IS NULL AND issue_number = ? AND workspace_id = ?
                     ORDER BY timestamp DESC, id DESC LIMIT 10`
                )
                .all(12, 'ws-hot')
                .map((r) => r.detail)
                .join('\n')
            expect(issuePlan).toContain('idx_memory_journal_issue_ws_recent')
            expect(issuePlan).not.toContain('TEMP B-TREE')

            const prPlan = rawDb
                .prepare(
                    `EXPLAIN QUERY PLAN
                     SELECT id FROM memory_journal
                     WHERE deleted_at IS NULL AND pr_number = ? AND workspace_id = ?
                     ORDER BY timestamp DESC, id DESC LIMIT 10`
                )
                .all(77, 'ws-hot')
                .map((r) => r.detail)
                .join('\n')
            expect(prPlan).toContain('idx_memory_journal_pr_ws_recent')
            expect(prPlan).not.toContain('TEMP B-TREE')

            const latestMap = adapter.getLatestEntryPerProject()
            expect(latestMap.get('ws-hot:5')?.timestamp).toBe('2026-11-20T12:00:00.000Z')
            expect(latestMap.get('ws-noise:9')).toBeDefined()
        } finally {
            adapter.close()
            cleanupDb(dbPath)
        }
    })

    it('H5, H9, H10 & M26: preserves path checks, registry matching, lazy mirror hashing, and single-pass resource token meta', () => {
        const root = process.cwd()
        expect(() => assertSafeDirectoryPath(path.join(root, 'src'), [root])).not.toThrow()
        expect(() => assertSafeDirectoryPath(`${root}/%2e%2e`, [root])).toThrow()

        const resolved = resolveWorkspaceFromFilePath(path.join(root, 'src', 'index.ts'), {
            projectRegistry: {
                'demo-proj': { path: root, project_number: 5 },
            },
        })
        expect(resolved?.workspaceId).toBe('demo-proj')
        expect(resolved?.projectNumber).toBe(5)

        const index = buildPersonalMirrorIndex([
            {
                id: 101,
                content: 'Mirror candidate content',
                workspaceId: 'demo-proj',
                timestamp: '2026-11-20T12:00:00.000Z',
            },
        ])
        expect(Object.getOwnPropertyDescriptor(index, 'byContentKey')?.get).toBeTypeOf('function')
        expect(
            findMirroredPersonalId(
                {
                    id: 5001,
                    originPersonalId: 101,
                    content: 'Mirror candidate content',
                    workspaceId: 'demo-proj',
                    timestamp: '2026-11-20T12:00:05.000Z',
                },
                index
            )
        ).toBe(101)

        const tagged = withResourceTokenMeta({ ok: true, count: 3 }) as Record<string, unknown>
        const json = getSerializedPayloadJson(tagged)
        expect(JSON.parse(json)).toMatchObject({ ok: true, count: 3 })
    })

    it('H7 & H11: reuses Code Mode bundles across workspaces and memoizes bare runtime wrapper configs', async () => {
        const dbPath = path.join(os.tmpdir(), `mj-pass59-cm-${String(process.pid)}-${String(Date.now())}.db`)
        const adapter = new DatabaseAdapter(dbPath, { projectRegistry: {} })
        try {
            await adapter.initialize()
            const runtime = new ServerRuntime()
            const wrapper1 = getRuntimeWrapperConfig(runtime)
            const wrapper2 = getRuntimeWrapperConfig(runtime)
            expect(wrapper1).toBeDefined()
            expect(wrapper1).toBe(wrapper2)
            expect(isBareRuntimeWrapperConfig(wrapper1)).toBe(true)
            expect(isBareRuntimeWrapperConfig({ runtime })).toBe(false)

            const cfg = {
                runtime,
                codemodeEnabled: true,
                agentHealing: true,
                codemodeInternalFullAccess: false,
            }
            const refs: CachedToolContextRefs = {
                db: adapter,
                config: cfg,
                codemodeEnabled: cfg.codemodeEnabled,
                agentHealing: cfg.agentHealing,
                codemodeInternalFullAccess: cfg.codemodeInternalFullAccess,
            }
            const cache = new Map()
            expect(isCacheHit(refs, cache, adapter, undefined, undefined, cfg)).toBe(true)
            expect(
                isCacheHit(
                    refs,
                    cache,
                    adapter,
                    undefined,
                    undefined,
                    { runtime, codemodeEnabled: false }
                )
            ).toBe(false)

            const sessionContext: ToolContext = { db: adapter, config: cfg }
            const bundleA = runWithCodemodeInvocation(
                {
                    sessionContext,
                    projectId: 'p1',
                    workspaceId: 'ws-a',
                    explicitWorkspace: true,
                    autoVersion: true,
                    dryRun: false,
                },
                () => getOrCreateCodemodeBundle(sessionContext, sessionContext, false)
            )
            const bundleB = runWithCodemodeInvocation(
                {
                    sessionContext,
                    projectId: 'p2',
                    workspaceId: 'ws-b',
                    explicitWorkspace: true,
                    autoVersion: true,
                    dryRun: false,
                },
                () => getOrCreateCodemodeBundle(sessionContext, sessionContext, false)
            )
            expect(bundleB).toBe(bundleA)
        } finally {
            adapter.close()
            cleanupDb(dbPath)
        }
    })

    it('H13, H15, L11 & L18: skips lite/resolved logs, batches author canonicalization, and validates indexed subscriptions', async () => {
        const liteSummary = await buildBriefingSystemSummary(undefined, null, null, 42, 'ws-lite', {
            lite: true,
        })
        expect(liteSummary.testHealth).toBeNull()
        expect(liteSummary.hasCodeMap).toBe(false)
        expect(liteSummary.promptCount).toBe(0)

        const status = vi.fn().mockResolvedValue({
            current: 'main',
            modified: [],
            not_added: [],
            isClean: () => true,
        })
        const log = vi.fn()
        const repoMgr = new RepositoryManager({ git: { status, log } } as never)
        const gitRes = await repoMgr.getLocalGitStatus({ includeResolvedIssues: false })
        expect(gitRes.branch).toBe('main')
        expect(log).not.toHaveBeenCalled()

        const resolveAuthors = vi.fn(() => new Map([['Alice', 'alice@canonical']]))
        const resolveAuthor = vi.fn((a: string) => a)
        const canonicalizer = createScopedAuthorCanonicalizer(
            { resolveAuthors, resolveAuthor } as never,
            [
                { author: 'Alice', workspaceId: 'ws-1' },
                { author: 'Alice', workspaceId: 'ws-1' },
            ]
        )
        expect(canonicalizer('Alice', 'ws-1')).toBe('alice@canonical')
        expect(canonicalizer('Alice', 'ws-1')).toBe('alice@canonical')
        expect(resolveAuthors).toHaveBeenCalledTimes(1)
        expect(resolveAuthor).not.toHaveBeenCalled()

        const subMgr = new SubscriptionManager()
        subMgr.subscribe('memory://briefing?repo=a', 'sess-1')
        subMgr.subscribe('memory://recent', 'sess-1')
        subMgr.unsubscribe('memory://recent', 'sess-1')
        subMgr.unsubscribeSession('sess-1')
        await expect(subMgr.notifyResourceUpdated('memory://briefing')).resolves.toBeUndefined()

        expect(() => validateResourceSubscription('memory://briefing')).not.toThrow()
        expect(() => validateResourceSubscription('memory://prs/42/timeline')).not.toThrow()
        expect(() => validateResourceSubscription('memory://nonexistent/path')).toThrow(
            ResourceNotFoundError
        )
    })

    it('AP1–AP7: embeds Pass 59 portable performance gates while preserving contract tokens', () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-23-audit-pass78')
        const def = getPerformanceAuditPromptDefinition()
        const rendered = def.handler({ target: 'memory-journal-mcp' }, {
            searchEntries: () => ({ entries: [] }),
            searchByDateRange: () => ({ entries: [] }),
        } as unknown as IDatabaseAdapter)
        const text = rendered.messages.map((m) => m.content.text).join('\n')

        expect(text).toContain('Prompt revision: 2026-11-23-audit-pass78')
        expect(text).toContain('skewed multi-workspace datasets with distinct timestamps')
        expect(text).toContain('defer `COUNT(*)` total-vector bounds')
        expect(text).toContain('per-request auth/RBAC/filter query counts')
        expect(text).toContain('SHA-256 fallback index precomputation')
        expect(text).toContain('Trace producer-to-consumer object identity')
        expect(text).toContain('localeCompare')
        expect(text).toContain('setTimeout(0)')
        expect(text).toContain('lstat')
        expect(text).toContain('SAVEPOINT')
        expect(text).toContain('AST bundle-graph leaks')
        expect(text).toContain('explore')
        expect(text).toContain('generalPurpose')
        expect(text).not.toContain('invoke_subagent')
    })
})
