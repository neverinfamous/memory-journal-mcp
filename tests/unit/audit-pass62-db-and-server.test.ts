import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'
import { MembersManager } from '../../src/database/sqlite-adapter/members.js'
import { acquireRestoreLock } from '../../src/database/sqlite-adapter/restore-lock.js'
import {
    assertWalCheckpointComplete,
    releaseRestoreLock,
} from '../../src/database/sqlite-adapter/backup-helpers.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import {
    safeJsonStringify,
    bigintReplacer,
    estimatePayloadTokens,
} from '../../src/observability/token-estimator.js'
import {
    isCrossRealmError,
    isCrossRealmDate,
    tryResolveToJson,
} from '../../src/utils/sanitize-value-helpers.js'
import { formatHandlerError } from '../../src/utils/error-helpers.js'
import { scrubAuditArgs, scrubAuditArgValue } from '../../src/audit/audit-arg-scrubber.js'
import { sanitizeAuditEntryForEgress } from '../../src/audit/audit-resource.js'
import { sanitizeIssueInput } from '../../src/utils/issue-logger.js'
import { logger } from '../../src/utils/logger.js'
import { searchAuditFileBackward } from '../../src/audit/audit-file-helpers.js'
import { ConfigResolver, type CliCommandLike } from '../../src/utils/config-resolver.js'
import { parseImportanceThresholdOption } from '../../src/cli/server-options-parsers.js'
import { parseFrontmatter } from '../../src/markdown/frontmatter.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { ConfigurationError } from '../../src/types/errors.js'

describe('Pass 62 Code-Quality Audit — DB, Lock, Sanitizers, Server & Prompts', () => {
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined
    let tempDirs: string[] = []

    beforeEach(() => {
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        vi.restoreAllMocks()
        if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
        else delete process.env['DB_ENCRYPTION_KEY']
        for (const dir of tempDirs) {
            if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
        }
        tempDirs = []
    })

    function makeTempDir(prefix: string): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
        tempDirs.push(dir)
        return dir
    }

    it('H1: MembersManager.isRbacActive() tracks PRAGMA data_version and does not cache missing-table probes', async () => {
        const dir = makeTempDir('mj-pass62-rbac-')
        const dbPath = path.join(dir, 'team.db')
        const connA = new NativeConnectionManager(dbPath)
        await connA.initialize()
        const mgrA = new MembersManager(connA)
        const adapter = new DatabaseAdapter(dbPath)
        await adapter.initialize()

        try {
            // Before team schema is applied on adapter, connA must NOT cache `false` across missing-table probes.
            expect(mgrA.isRbacActive()).toBe(false)

            adapter.applyTeamSchema()
            adapter.addTeamMember('alice', 'admin')
            expect(mgrA.isRbacActive()).toBe(true)

            // Cross-connection transition from empty team_members -> populated invalidates via data_version.
            adapter.removeTeamMember('alice')
            expect(mgrA.isRbacActive()).toBe(false)
            adapter.addTeamMember('bob', 'admin')
            expect(mgrA.isRbacActive()).toBe(true)
        } finally {
            connA.close()
            adapter.close()
        }
    })

    it('H2: acquireRestoreLock enforces live lock contention and allows orphaned empty-dir reclaim', () => {
        const dir = makeTempDir('mj-pass62-lock-')
        const lockDir = path.join(dir, '.restore.lock')
        const lockFile = path.join(dir, '.restore.lock.pid')
        const runtime = new ServerRuntime()

        // Orphaned empty lockDir (> 2s old with no PID file) reclaims cleanly.
        fs.mkdirSync(lockDir, { recursive: true })
        const staleDate = new Date(Date.now() - 5000)
        fs.utimesSync(lockDir, staleDate, staleDate)
        acquireRestoreLock(lockDir, lockFile, runtime)
        expect(fs.existsSync(lockFile)).toBe(true)

        // Competing acquisition while live PID holds lockFile must fail.
        expect(() => acquireRestoreLock(lockDir, lockFile, runtime)).toThrow(
            /holding the database lock/i
        )

        releaseRestoreLock(lockDir, lockFile)
        expect(fs.existsSync(lockDir)).toBe(false)
        expect(fs.existsSync(lockFile)).toBe(false)
    })

    it('M2: safeJsonStringify handles DAG sharing, self-cycles, depth caps, bigint, and throwing toJSON while keeping bigintReplacer', () => {
        expect(bigintReplacer('id', 42n)).toBe('42')

        const shared = { tag: 'leaf' }
        const dagJson = safeJsonStringify({ a: shared, b: shared })
        expect(dagJson).not.toContain('[Circular]')
        expect(dagJson).toContain('"leaf"')

        const cyc: Record<string, unknown> = { id: 7n }
        cyc['self'] = cyc
        const cycJson = safeJsonStringify(cyc)
        expect(cycJson).toContain('"7"')
        expect(cycJson).toContain('[Circular]')

        const deep = { a: { b: { c: { d: { e: 'bottom' } } } } }
        expect(safeJsonStringify(deep, 3)).toContain('[Truncated]')

        const badToJson = {
            toJSON(): never {
                throw new Error('toJSON exploded')
            },
        }
        expect(() => safeJsonStringify({ bad: badToJson })).not.toThrow()
        expect(() => estimatePayloadTokens({ bad: badToJson, a: shared, b: shared })).not.toThrow()
    })

    it('M3: shared sanitize-value-helpers detect cross-realm Error/Date and guard throwing toJSON across host scrubbers and logger', () => {
        const vmErr: unknown = vm.runInNewContext('new Error("cross-realm boom")')
        const vmDate: unknown = vm.runInNewContext('new Date("2026-11-21T00:00:00.000Z")')
        expect(isCrossRealmError(vmErr)).toBe(true)
        expect(isCrossRealmDate(vmDate)).toBe(true)

        const evil = {
            toJSON(): never {
                throw new Error('bad toJSON')
            },
        }
        expect(tryResolveToJson(evil)).toEqual({ resolved: true, value: '[Unserializable]' })
        expect(() => scrubAuditArgValue(evil, 0, new WeakSet(), { count: 0 })).not.toThrow()
        expect(() => scrubAuditArgs({ bad: evil })).not.toThrow()
        expect(() => formatHandlerError(vmErr)).not.toThrow()
        expect(() =>
            sanitizeIssueInput({
                phase: 'p',
                tool: 't',
                error: 'e',
                params: evil,
            })
        ).not.toThrow()

        const sanitizedEntry = sanitizeAuditEntryForEgress({
            id: 1,
            timestamp: '2026-11-21T00:00:00Z',
            tool: 'test_tool',
            category: 'read',
            success: true,
            durationMs: 1,
            args: { when: vmDate },
        })
        expect(sanitizedEntry.success).toBe(true)

        const rootCycle: Record<string, unknown> = { label: 'root' }
        rootCycle['self'] = rootCycle
        expect(() => logger.info('pass62-root-cycle-test', rootCycle)).not.toThrow()
    })

    it('M5 & M6: NativeConnectionManager permits foreign_key_check, skips PRAGMA optimize on closeDbBeforeRestore, and assertWalCheckpointComplete fails closed', async () => {
        const dir = makeTempDir('mj-pass62-native-')
        const dbPath = path.join(dir, 'native.db')
        const conn = new NativeConnectionManager(dbPath)
        await conn.initialize()
        let closed = false

        try {
            expect(() => conn.pragma('foreign_key_check')).not.toThrow()
            expect(() => conn.exec('PRAGMA foreign_key_check')).not.toThrow()

            const nativeDb = conn.getNativeDb()
            const pragmaSpy = vi.spyOn(nativeDb, 'pragma')
            conn.closeDbBeforeRestore()
            closed = true
            expect(pragmaSpy).not.toHaveBeenCalledWith('optimize')
        } finally {
            if (!closed) conn.close()
        }

        expect(() =>
            assertWalCheckpointComplete({
                getNativeDb: () => ({ pragma: () => [{ busy: 1, log: 1, checkpointed: 0 }] }),
                exec: () => [],
            } as unknown as NativeConnectionManager)
        ).toThrow()
        expect(() =>
            assertWalCheckpointComplete({
                getNativeDb: () => ({ pragma: () => [] }),
                exec: () => [],
            } as unknown as NativeConnectionManager)
        ).toThrow()
        expect(() =>
            assertWalCheckpointComplete({
                getNativeDb: () => ({ pragma: () => [{ busy: 0, log: 0, checkpointed: 1 }] }),
                exec: () => [],
            } as unknown as NativeConnectionManager)
        ).not.toThrow()
    })

    it('M12 & O5: ConfigResolver.resolveBool and parseImportanceThresholdOption reject malformed inputs strictly', () => {
        const cmd: CliCommandLike = { name: () => 'serve', getOptionValueSource: () => undefined }
        const okResolver = new ConfigResolver(cmd, { flagA: 'TRUE', flagB: false })
        expect(okResolver.resolveBool('flagA', undefined, false)).toBe(true)
        expect(okResolver.resolveBool('flagB', undefined, true)).toBe(false)

        for (const badVal of [{}, [], 'yes', 1]) {
            const badResolver = new ConfigResolver(cmd, { badFlag: badVal })
            expect(() => badResolver.resolveBool('badFlag', undefined, false)).toThrow(
                ConfigurationError
            )
        }

        expect(parseImportanceThresholdOption('   ', '--importance-min', 0.5)).toBe(0.5)
        expect(() => parseImportanceThresholdOption('0x0', '--importance-min', 0.5)).toThrow()
    })

    it('L4, L6, L7: searchAuditFileBackward short-circuits zero limit, deleted/graph queries break timestamp ties by id DESC, and frontmatter validates anchors', async () => {
        const dir = makeTempDir('mj-pass62-audit-')
        const results = await searchAuditFileBackward(path.join(dir, 'nonexistent.jsonl'), {}, 0, [])
        expect(results).toEqual({ skippedLines: 0, limitReached: true })

        const parsedValid = parseFrontmatter(
            '---\n{\n  "anchors": ["src/a.ts"]\n}\n---\nBody content'
        )
        expect(parsedValid.metadata.anchors).toEqual(['src/a.ts'])
        expect(() => parseFrontmatter('---\n{\n  "anchors": "not-an-array"\n}\n---\nBody')).toThrow()

        const adapter = new DatabaseAdapter(path.join(dir, 'tie.db'))
        await adapter.initialize()
        try {
            const fixedTs = '2026-11-21T10:00:00.000Z'
            const e1 = adapter.createEntry({ content: 'first', timestamp: fixedTs })
            const e2 = adapter.createEntry({ content: 'second', timestamp: fixedTs })
            adapter.linkEntries(e1.id, e2.id, 'references')
            adapter.linkEntries(e2.id, e1.id, 'supports')
            const graphRels = adapter.getRecentGraphRelationships(10)
            expect(graphRels.length).toBe(2)

            adapter.deleteEntry(e1.id)
            adapter.deleteEntry(e2.id)
            const deleted = adapter.getDeletedEntries({ limit: 10 })
            expect(deleted.entries.map((e) => e.id)).toEqual([e2.id, e1.id])
        } finally {
            adapter.close()
        }
    })

    it('AP1–AP4: bumps AUDIT_PROMPT_REVISION to 2026-11-21-audit-pass67 and embeds Pass 62 detector rules cleanly', () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-21-audit-pass67')
        const def = getCodeQualityAuditPromptDefinition()
        const rendered = def.handler({ target: 'memory-journal-mcp' }, {
            searchEntries: () => ({ entries: [] }),
            searchByDateRange: () => ({ entries: [] }),
            getRecentEntries: () => [],
        } as never) as { messages: { content: { text: string } }[] }
        const text = rendered.messages[0]?.content.text ?? ''
        expect(text).toContain('Prompt revision: 2026-11-21-audit-pass67')
        expect(text).toContain('PRAGMA data_version')
        expect(text).toContain('lockRecordChanged(expected, null)')
        expect(text).toContain('Protocol.connect')
        expect(text).toContain('double-synthesis')
        expect(text).toContain('resolveBool')
        expect(text).toContain('+ 1` pagination lookahead')
    })
})
