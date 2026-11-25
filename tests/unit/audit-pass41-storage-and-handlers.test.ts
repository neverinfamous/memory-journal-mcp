import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { acquireRestoreLock } from '../../src/database/sqlite-adapter/restore-lock.js'
import { BackupManager } from '../../src/database/sqlite-adapter/backup.js'
import { ValidationError } from '../../src/types/errors.js'
import {
    assertSafeDirectoryPath,
    PathTraversalError,
} from '../../src/utils/path-safety.js'
import { isValidProjectPath } from '../../src/utils/project-registry-guards.js'
import { resourceProjectNumber } from '../../src/handlers/resources/shared.js'
import { resolveTeamMutationProjectNumber } from '../../src/handlers/tools/team/admin-tools/team-pk-scope-helpers.js'
import { getAuditResourceDef } from '../../src/audit/audit-resource.js'
import { metricsUsersResource } from '../../src/handlers/resources/core/metrics-resource.js'
import { getPrompts } from '../../src/handlers/prompts/index.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import {
    markUntrustedContent,
    markUntrustedContentInline,
    sanitizeAuthor,
} from '../../src/utils/security-utils.js'
import { transformOutsideCodeFences } from '../../src/markdown/converters/utils.js'
import type { ToolContext } from '../../src/types/index.js'
import type { AuditLogger } from '../../src/audit/index.js'

const origEncryptionKey = process.env['DB_ENCRYPTION_KEY']
const cleanupPaths: string[] = []

afterEach(() => {
    if (origEncryptionKey === undefined) delete process.env['DB_ENCRYPTION_KEY']
    else process.env['DB_ENCRYPTION_KEY'] = origEncryptionKey
    while (cleanupPaths.length > 0) {
        const target = cleanupPaths.pop()
        if (target !== undefined) {
            fs.rmSync(target, { recursive: true, force: true })
        }
    }
})

async function createMemoryAdapter(): Promise<DatabaseAdapter> {
    process.env['DB_ENCRYPTION_KEY'] = ''
    const db = new DatabaseAdapter(':memory:')
    await db.initialize()
    return db
}

describe('Pass 41 Audit — Storage, Path Containment, Resource Isolation & Prompts', () => {
    it('H4, L1 & M11: isolates importance peer stats by workspace, filters self-loops, and normalizes empty strings', async () => {
        const db = await createMemoryAdapter()
        try {
            const wsA1 = db.createEntry({
                content: 'ws-a root',
                workspaceId: 'ws-a',
                significanceType: '',
                autoContext: '',
                sessionId: '',
            })
            expect(wsA1.significanceType).toBeNull()
            expect(wsA1.autoContext).toBeNull()
            expect(wsA1.sessionId).toBeNull()

            const wsB1 = db.createEntry({ content: 'ws-b peer', workspaceId: 'ws-b' })
            db.linkEntries(wsA1.id, wsB1.id, 'references', undefined, '*')
            db.linkEntries(wsA1.id, wsA1.id, 'references', undefined, 'ws-a')

            const scopedScores = db.getImportanceScoresByIds([wsA1.id], 'ws-a')
            const wsAStats = scopedScores.get(wsA1.id)
            expect(wsAStats?.breakdown.relationships).toBe(0)

            const updated = db.updateEntry(wsA1.id, {
                workspaceId: 'ws-a',
                issueUrl: '',
                prStatus: '',
                workflowName: '',
            })
            expect(updated?.issueUrl).toBeNull()
            expect(updated?.prStatus).toBeNull()
            expect(updated?.workflowName).toBeNull()
        } finally {
            db.close()
        }
    })

    it('H5 & H6: restore-lock probes foreign live PIDs unconditionally; BackupManager refuses :memory: restore & dir .db', async () => {
        const db = await createMemoryAdapter()
        try {
            await expect(db.restoreFromFile(':memory:')).rejects.toThrow(ValidationError)

            const tmpBase = path.join(process.cwd(), '.test-output', `pass41-backup-${randomUUID()}`)
            cleanupPaths.push(tmpBase)
            const backupsDir = path.join(tmpBase, 'backups')
            fs.mkdirSync(path.join(backupsDir, 'fake.db'), { recursive: true })
            fs.writeFileSync(path.join(backupsDir, 'real.db'), 'sqlite-placeholder')
            const mgr = new BackupManager({
                getDbPath: () => path.join(tmpBase, 'journal.db'),
                getBackupsDir: () => backupsDir,
            } as unknown as ConstructorParameters<typeof BackupManager>[0])
            const listed = mgr.listBackups()
            expect(listed.map((b) => b.filename)).toEqual(['real.db'])
        } finally {
            db.close()
        }

        const lockBase = path.join(process.cwd(), '.test-output', `pass41-lock-${randomUUID()}`)
        cleanupPaths.push(lockBase)
        const lockDir = path.join(lockBase, 'restore.lock')
        const lockFile = path.join(lockDir, 'lock.json')
        fs.mkdirSync(lockDir, { recursive: true })
        const foreignLivePid = process.ppid > 0 ? process.ppid : process.pid
        if (foreignLivePid !== process.pid) {
            fs.writeFileSync(
                lockFile,
                JSON.stringify({ pid: foreignLivePid, timestamp: 1, nonce: 'live' })
            )
            expect(() => acquireRestoreLock(lockDir, lockFile, undefined)).toThrow(
                'Backup restore cannot safely proceed'
            )
        }
        fs.writeFileSync(lockFile, JSON.stringify({ pid: 999_999_999, timestamp: 1, nonce: 'dead' }))
        expect(() => acquireRestoreLock(lockDir, lockFile, undefined)).not.toThrow()
    })

    it('M1: path-safety and registry guards reject trailing spaces/dots, ADS colons, Win32 device names, and encoded traversal while allowing ./foo..', () => {
        const root = process.cwd()
        expect(() => assertSafeDirectoryPath('./foo..', [root])).not.toThrow()
        expect(() => assertSafeDirectoryPath(path.join(root, 'bad '), [root])).toThrow(PathTraversalError)
        expect(() => assertSafeDirectoryPath(path.join(root, 'file:stream'), [root])).toThrow(
            PathTraversalError
        )
        expect(() => assertSafeDirectoryPath(path.join(root, 'CON'), [root])).toThrow(PathTraversalError)
        expect(() => assertSafeDirectoryPath(path.join(root, '%2e%2e'), [root])).toThrow(PathTraversalError)

        expect(isValidProjectPath(path.join(root, 'sub.'))).toBe(false)
        expect(isValidProjectPath('C:\\Windows.')).toBe(false)
        expect(isValidProjectPath(path.join(root, 'NUL'))).toBe(false)
        expect(isValidProjectPath(path.join(root, 'foo:bar'))).toBe(false)
    })

    it('H7, M6 & M10: isolates resource/team project fallback, audit query zero filter, metrics users gating, and prompt caps', async () => {
        const registry = {
            'repo-a': { path: process.cwd(), project_number: 5 },
        }
        expect(
            resourceProjectNumber(
                { briefingConfig: { projectRegistry: registry, defaultProjectNumber: 5 } },
                'default'
            )
        ).toBeUndefined()
        expect(
            resourceProjectNumber(
                { briefingConfig: { projectRegistry: registry, defaultProjectNumber: 5 } },
                'repo-a'
            )
        ).toBe(5)

        const dummyCtx: ToolContext = {
            db: {} as ToolContext['db'],
            config: { defaultWorkspaceId: 'default' },
        }
        expect(resolveTeamMutationProjectNumber(dummyCtx, 'default', undefined, 'default', 5)).toBeUndefined()
        expect(resolveTeamMutationProjectNumber(dummyCtx, 'default', undefined, undefined, 5)).toBe(5)

        const searchFilters: unknown[] = []
        const fakeLogger = {
            config: { logPath: 'memory://audit.log', redact: true },
            droppedCount: 0,
            isStderrOnly: () => false,
            recent: async () => [],
            search: async (filter: unknown) => {
                searchFilters.push(filter)
                return []
            },
        } as unknown as AuditLogger
        const auditDef = getAuditResourceDef(() => fakeLogger)
        await auditDef.handler('memory://audit?project_number=0', { db: {} as ToolContext['db'] })
        expect(searchFilters[0]).toMatchObject({ project_number: 0 })
        await expect(
            auditDef.handler('memory://audit?project_number=abc', { db: {} as ToolContext['db'] })
        ).rejects.toThrow(ValidationError)

        expect(metricsUsersResource.capabilities?.requiresAuditScope).toBe(true)
        const prompts = getPrompts() as { name: string; capabilities?: { requiresAdminScope?: boolean } }[]
        expect(prompts.find((p) => p.name === 'mcp-heal')).toBeUndefined()
        expect(prompts.find((p) => p.name === 'project-setup')?.capabilities?.requiresAdminScope).toBe(true)
    })

    it('M8 & M9: untrusted fencing is idempotent without entity bloat; transformOutsideCodeFences spares fenced blocks', () => {
        const once = markUntrustedContent('Hello & <script>')
        const twice = markUntrustedContent(once)
        expect(twice).toBe(once)
        expect(twice).not.toContain('&amp;lt;')

        const inlineOnce = markUntrustedContentInline('line1\nline2 & <b>')
        const inlineTwice = markUntrustedContentInline(inlineOnce)
        expect(inlineTwice).toBe(inlineOnce)
        expect(inlineTwice).not.toContain('\n')

        expect(sanitizeAuthor('Alice\x00\x07\nBob')).toBe('AliceBob')

        const md = 'outside [[Link]]\n```ts\nconst raw = "[[KeepMe]]"\n```\nafter [[Other]]'
        const transformed = transformOutsideCodeFences(md, (seg) => seg.replace(/\[\[(\w+)\]\]/g, '$1'))
        expect(transformed).toBe('outside Link\n```ts\nconst raw = "[[KeepMe]]"\n```\nafter Other')
    })

    it('AP1-AP7: bumps AUDIT_PROMPT_REVISION to pass41 and preserves required code-quality prompt contract', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass90')
        const db = await createMemoryAdapter()
        try {
            const def = getCodeQualityAuditPromptDefinition()
            const rendered = await def.handler({ target: 'memory-journal-mcp' }, db)
            const text = rendered.messages[0]?.content.text ?? ''
            expect(text).toContain('Prompt revision: 2026-11-24-audit-pass90')
            for (const token of [
                'explore',
                'generalPurpose',
                'code-quality-audit',
                'param-normalizer.ts',
                'SCAN_OK scanned=',
                'Present the plan as markdown in the chat.',
                'Do not add an audit plan file to the repository.',
            ]) {
                expect(text).toContain(token)
            }
        } finally {
            db.close()
        }
    })
})
