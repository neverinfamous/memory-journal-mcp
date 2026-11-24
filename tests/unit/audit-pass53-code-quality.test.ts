/**
 * Pass 53 Adversarial Code Quality Audit Regression Tests (M1–M5, L1–L6, AP1–AP3).
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { isForbiddenProjectKey as matchForbidden } from '../../src/utils/workspace-registry-match.js'
import { isForbiddenProjectKey as guardForbidden } from '../../src/utils/project-registry-guards.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { applyPersistableConfigKeys } from '../../src/utils/config-manager-persist.js'
import { readBriefingConfigEntry } from '../../src/utils/config-manager-helpers.js'
import { ConfigResolver } from '../../src/utils/config-resolver.js'
import { createSchemaProxy } from '../../src/codemode/proxy-namespaces.js'
import {
    setActiveSessionProject,
    getActiveSessionProject,
    clearActiveSessionProject,
} from '../../src/utils/workspace-resolver-session.js'
import { logger } from '../../src/utils/logger.js'
import { McpLogger } from '../../src/utils/mcp-logger.js'
import {
    GitHistoryOptionsSchema,
    GitSearchOptionsSchema,
} from '../../src/handlers/tools/git-schemas.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import { rebuildIndexAction } from '../../src/cli/commands/admin.js'
import type { Command } from 'commander'

describe('Pass 53 Adversarial Code Quality Audit Regressions', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        clearActiveSessionProject()
    })

    it('M1: isForbiddenProjectKey lives in worker-safe workspace-registry-match and project-alias-helpers avoids project-registry-guards', () => {
        expect(matchForbidden).toBe(guardForbidden)
        expect(matchForbidden('__proto__')).toBe(true)
        expect(matchForbidden('*')).toBe(true)
        expect(matchForbidden('   ')).toBe(true)
        expect(matchForbidden('memory-journal-mcp')).toBe(false)

        const helperSrc = fs.readFileSync(
            path.join(process.cwd(), 'src/codemode/normalizers/project-alias-helpers.ts'),
            'utf8'
        )
        expect(helperSrc).not.toContain('project-registry-guards')
    })

    it('M2: rebuildIndexAction exits non-zero when vectorManager.rebuildIndex returns success: false', async () => {
        const origKey = process.env['DB_ENCRYPTION_KEY']
        const origMjKey = process.env['MJ_DB_ENCRYPTION_KEY']
        process.env['DB_ENCRYPTION_KEY'] = ''
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''

        const tmpDir = path.join(process.cwd(), '.test-output', `pass53-admin-${String(Date.now())}`)
        fs.mkdirSync(tmpDir, { recursive: true })
        const dbPath = path.join(tmpDir, 'test.db')

        try {
            vi.spyOn(VectorSearchManager.prototype, 'rebuildIndex').mockResolvedValue({
                success: false,
                indexed: 0,
                failed: 2,
                firstError: 'simulated failure',
            })
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
            vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
            vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

            const dummyCmd = {
                name: () => 'rebuild-index',
                optsWithGlobals: () => ({ db: dbPath }),
                getOptionValueSource: () => undefined,
            } as unknown as Command

            await rebuildIndexAction({ db: dbPath, json: true }, dummyCmd)
            expect(exitSpy).toHaveBeenCalledWith(1)
        } finally {
            if (origKey === undefined) delete process.env['DB_ENCRYPTION_KEY']
            else process.env['DB_ENCRYPTION_KEY'] = origKey
            if (origMjKey === undefined) delete process.env['MJ_DB_ENCRYPTION_KEY']
            else process.env['MJ_DB_ENCRYPTION_KEY'] = origMjKey
            fs.rmSync(tmpDir, { recursive: true, force: true })
        }
    })

    it('M3: visualizeRelationships excludes direct DB self-loop edges', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const a = db.createEntry({ content: 'Entry A', workspaceId: 'ws-a' })
            const b = db.createEntry({ content: 'Entry B', workspaceId: 'ws-a' })
            db.linkEntries(a.id, a.id, 'references')
            db.linkEntries(a.id, b.id, 'references')

            const graph = db.visualizeRelationships({
                entryId: a.id,
                depth: 2,
                limit: 10,
                workspaceId: 'ws-a',
            })
            expect(graph.edges.some((e) => e.from === e.to)).toBe(false)
            expect(graph.edges.some((e) => e.from === a.id && e.to === b.id)).toBe(true)
        } finally {
            db.close()
        }
    })

    it('M4: applyPersistableConfigKeys deletes stale briefing alias keys and readBriefingConfigEntry prefers primaryKey', () => {
        const parsed: Record<string, unknown> = { briefingPrCount: 2, briefingPrs: 2 }
        applyPersistableConfigKeys(
            parsed,
            {
                rawToolFilter: undefined,
                briefingConfig: { prCount: 5 },
            },
            {
                toolFilter: false,
                codemode: false,
                briefingKeys: new Set(['prCount']),
                defaultWorkspaceId: false,
                defaultProjectNumber: false,
            }
        )
        expect(parsed['briefingPrs']).toBe(5)
        expect('briefingPrCount' in parsed).toBe(false)

        const hit = readBriefingConfigEntry(
            { briefingPrCount: 2, briefingPrs: 7 },
            'briefingPrs',
            ['briefingPrCount']
        )
        expect(hit).toEqual({ key: 'briefingPrs', value: 7 })
    })

    it('M5: ConfigResolver.resolveInt rejects leading-zero and unsafe integer strings', () => {
        const cliCmd = { getOptionValueSource: () => 'cli' } as unknown as Command
        const leadingZero = new ConfigResolver(cliCmd, { port: '007' })
        expect(() => leadingZero.resolveInt('port')).toThrow(/Invalid numeric configuration/)

        const unsafeInt = new ConfigResolver(cliCmd, { port: '9007199254740993' })
        expect(() => unsafeInt.resolveInt('port')).toThrow(/Invalid numeric configuration/)

        const valid = new ConfigResolver(cliCmd, { port: '0', count: '42', neg: '-5' })
        expect(valid.resolveInt('port')).toBe(0)
        expect(valid.resolveInt('count')).toBe(42)
        expect(valid.resolveInt('neg')).toBe(-5)
    })

    it('L1: IMMUTABLE_PROXY_TRAPS blocks preventExtensions without V8 proxy invariant violations', () => {
        const schemaProxy = createSchemaProxy(() => Promise.resolve({}))
        expect(Object.isExtensible(schemaProxy)).toBe(true)
        expect(Reflect.preventExtensions(schemaProxy)).toBe(false)
        expect(() => Object.keys(schemaProxy)).not.toThrow()
    })

    it('L2: setActiveSessionProject ignores Infinity, floats, and unsafe integers', () => {
        const runtime = {}
        setActiveSessionProject('ws-test', Number.POSITIVE_INFINITY, runtime)
        expect(getActiveSessionProject(runtime)?.projectNumber).toBeUndefined()

        setActiveSessionProject('ws-test', 1.5, runtime)
        expect(getActiveSessionProject(runtime)?.projectNumber).toBeUndefined()

        setActiveSessionProject('ws-test', Number.MAX_SAFE_INTEGER + 1, runtime)
        expect(getActiveSessionProject(runtime)?.projectNumber).toBeUndefined()

        setActiveSessionProject('ws-test', 5, runtime)
        expect(getActiveSessionProject(runtime)?.projectNumber).toBe(5)
        clearActiveSessionProject(runtime)
    })

    it('L3: logger and McpLogger preserve Date/URL values and shared DAG sibling objects', () => {
        const writes: string[] = []
        vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            writes.push(args.map((a) => String(a)).join(' '))
        })

        const shared = { tag: 'v1' }
        const when = new Date('2026-11-20T00:00:00.000Z')
        const link = new URL('https://example.com/path')

        logger.info('pass53 test', {
            when,
            link,
            a: shared,
            b: shared,
        })

        const output = writes.join('')
        expect(output).toContain('2026-11-20T00:00:00.000Z')
        expect(output).toContain('https://example.com/path')
        expect(output).not.toContain('[Circular]')

        const sent: unknown[] = []
        const mcpLogger = new McpLogger()
        mcpLogger.setServer({
            sendLoggingMessage: (params) => {
                sent.push(params)
                return Promise.resolve()
            },
        })
        mcpLogger.info('Pass53', 'pass53 mcp', { when, link })
        const payload = JSON.stringify(sent)
        expect(payload).toContain('2026-11-20T00:00:00.000Z')
        expect(payload).toContain('https://example.com/path')
    })

    it('L5: GitSearchOptionsSchema omits unused uncommitted while GitHistoryOptionsSchema keeps it', () => {
        expect('uncommitted' in GitSearchOptionsSchema.shape).toBe(false)
        expect('uncommitted' in GitHistoryOptionsSchema.shape).toBe(true)
    })

    it('L6: scripts/encrypt-db.ts verifies PRAGMA foreign_key_check before rename', () => {
        const scriptSrc = fs.readFileSync(
            path.join(process.cwd(), 'scripts/encrypt-db.ts'),
            'utf8'
        )
        expect(scriptSrc).toContain("verify.pragma('foreign_key_check')")
    })

    it('AP1–AP3: bumps AUDIT_PROMPT_REVISION to 2026-11-20-audit-pass53 and includes Pass 53 guidance', () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass81')
        const def = getCodeQualityAuditPromptDefinition()
        const rendered = def.handler({ target: 'memory-journal-mcp' }, {
            searchByDateRange: () => [],
            searchByTags: () => [],
            searchEntries: () => [],
        } as never) as { messages: { content: { text: string } }[] }
        const text = rendered.messages[0]?.content.text ?? ''
        expect(text).toContain('Prompt revision: 2026-11-24-audit-pass81')
        expect(text).toContain('node:async_hooks')
        expect(text).toContain('process.exit(exitCode)')
        expect(text).toContain('standalone DB encryption/migration scripts')
    })
})
