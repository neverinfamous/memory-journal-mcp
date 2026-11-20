/**
 * Pass 36 code-quality regressions: restore lock, canonical project numbers,
 * fencing, context alias gaps, WAL busy, and foreign-key restore checks.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { extractAuditScopeFromUri } from '../../src/audit/audit-query-helpers.js'
import { acquireRestoreLock } from '../../src/database/sqlite-adapter/restore-lock.js'
import {
    assertIncomingBackupIntact,
    assertWalCheckpointComplete,
} from '../../src/database/sqlite-adapter/backup-helpers.js'
import { bucketInParams, chunkedInPredicate } from '../../src/database/sqlite-adapter/row-helpers.js'
import { extractMetadataContextAliases } from '../../src/codemode/normalizers/generic-field-aliases.js'
import { synthesizeNaturalLanguageOrEntryPayload } from '../../src/handlers/tools/codemode/natural-language-synthesizer.js'
import { unwrapFencedRemoteText } from '../../src/handlers/tools/github/fencing-helpers.js'
import { sanitizeKanbanBoard } from '../../src/handlers/resources/templates-kanban.js'
import { parsePositiveProjectNumber } from '../../src/server/mcp-server/tool-registration/create-scope-interceptor.js'
import { normalizeAndAliasToolCall } from '../../src/server/mcp-server/tool-registration/call-arg-normalizer.js'
import type { ServerOptions } from '../../src/server/mcp-server/types.js'
import type { IDatabaseConnection } from '../../src/database/core/interfaces.js'
import { writeCliResult } from '../../src/cli/commands/cli-output.js'
import { parseFrontmatter } from '../../src/markdown/frontmatter.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { RegistryConfigError } from '../../src/utils/registry-config-file.js'
import { parseCanonicalPositiveInt } from '../../src/utils/safe-positive-int.js'
import { assertSafeDirectoryPath } from '../../src/utils/path-safety.js'
import { markUntrustedContentInline } from '../../src/utils/security-utils.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'

const tempDirs: string[] = []

function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass36-'))
    tempDirs.push(dir)
    return dir
}

afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

describe('pass 36 code quality', () => {
    it('keeps a live restore holder even when the timestamp is older than 30 seconds', () => {
        const lockDir = path.join(makeTempDir(), 'restore.lock.d')
        const lockFile = path.join(lockDir, 'lock.json')
        fs.mkdirSync(lockDir, { recursive: true })
        fs.writeFileSync(
            lockFile,
            JSON.stringify({ pid: 424242, timestamp: Date.now() - 40_000, nonce: 'aged-live' })
        )
        vi.spyOn(process, 'kill').mockImplementation(() => true)

        expect(() => acquireRestoreLock(lockDir, lockFile, undefined)).toThrow(/holding the database lock/i)
    })

    it('reclaims a dead holder pid', () => {
        const lockDir = path.join(makeTempDir(), 'restore.lock.d')
        const lockFile = path.join(lockDir, 'lock.json')
        fs.mkdirSync(lockDir, { recursive: true })
        fs.writeFileSync(
            lockFile,
            JSON.stringify({ pid: 999999, timestamp: Date.now(), nonce: 'dead' })
        )

        expect(() => acquireRestoreLock(lockDir, lockFile, undefined)).not.toThrow()
    })

    it('rejects non-canonical project numbers', () => {
        expect(parseCanonicalPositiveInt('9007199254740993')).toBeUndefined()
        expect(parseCanonicalPositiveInt('0x10')).toBeUndefined()
        expect(parseCanonicalPositiveInt('1e2')).toBeUndefined()
        expect(parseCanonicalPositiveInt('12')).toBe(12)
        expect(parsePositiveProjectNumber('9007199254740993')).toBeUndefined()
        expect(parsePositiveProjectNumber(12)).toBe(12)

        const unsafe = extractAuditScopeFromUri('memory://audit?project_number=9007199254740993')
        expect(unsafe.projectNumber).toBeUndefined()
        const hex = extractAuditScopeFromUri('memory://audit?project_number=0x10')
        expect(hex.projectNumber).toBeUndefined()
        const safe = extractAuditScopeFromUri('memory://audit?project_number=12')
        expect(safe.projectNumber).toBe(12)

        const hinted: { name: string; arguments: Record<string, unknown> } = {
            name: 'create_entry',
            arguments: { project_number: '1e2' },
        }
        const options: ServerOptions = {
            transport: 'stdio',
            dbPath: ':memory:',
            projectRegistry: { 'memory-journal-mcp': { path: os.tmpdir(), project_number: 5 } },
        }
        normalizeAndAliasToolCall(hinted, options)
        expect(hinted.arguments['project_number']).toBe('1e2')

        const named: { name: string; arguments: Record<string, unknown> } = {
            name: 'create_entry',
            arguments: { project: 'memory-journal-mcp' },
        }
        normalizeAndAliasToolCall(named, options)
        expect(named.arguments['project_number']).toBe(5)
    })

    it('leaves an unsafe frontmatter relationship target uncoerced', () => {
        const body = [
            '---',
            JSON.stringify({
                relationships: [{ type: 'references', target_id: '9007199254740993' }],
            }),
            '---',
            'body',
        ].join('\n')
        expect(() => parseFrontmatter(body)).toThrow()

        const safe = parseFrontmatter(
            ['---', JSON.stringify({ relationships: [{ type: 'references', target_id: '12' }] }), '---', 'body'].join(
                '\n'
            )
        )
        expect(safe.metadata.relationships?.[0]?.target_id).toBe(12)
    })

    it('does not fence kanban status and unwraps journal titles', () => {
        const board = sanitizeKanbanBoard({
            projectId: 'p',
            projectNumber: 1,
            projectTitle: 'Board',
            statusFieldId: 'f',
            statusOptions: [],
            totalItems: 1,
            columns: [
                {
                    status: 'In Progress',
                    statusOptionId: 'opt',
                    items: [
                        {
                            id: 'i',
                            title: 'Task',
                            url: 'https://example.test/1',
                            type: 'ISSUE',
                            status: 'In Progress',
                            createdAt: '2026-11-17T00:00:00Z',
                            updatedAt: '2026-11-17T00:00:00Z',
                        },
                    ],
                },
            ],
        })
        expect(board.columns[0]?.status).toBe('In Progress')
        expect(board.columns[0]?.items[0]?.status).toBe('In Progress')
        expect(board.columns[0]?.items[0]?.title).toContain('<untrusted_remote_content>')
        expect(unwrapFencedRemoteText(markUntrustedContentInline('A & B'))).toBe('A & B')
    })

    it('hoists context fields metadata omits and reads outer impact_score', () => {
        const aliased: Record<string, unknown> = {
            metadata: { tags: ['keep'] },
            context: {
                workspace_id: 'memory-journal-mcp',
                project_number: 5,
                session_id: 'sess',
                type: 'technical_note',
            },
        }
        extractMetadataContextAliases(aliased, true)
        expect(aliased['tags']).toEqual(['keep'])
        expect(aliased['workspace_id']).toBe('memory-journal-mcp')
        expect(aliased['project_number']).toBe(5)
        expect(aliased['session_id']).toBe('sess')
        expect(aliased['type']).toBe('technical_note')

        const synthesized = synthesizeNaturalLanguageOrEntryPayload(
            'Please remember this impact note',
            {},
            { entry: { content: 'nested note' }, impact_score: 0.42 }
        )
        expect(synthesized).toContain('"impact_score":0.42')
    })

    it('fails a busy WAL checkpoint and a backup with a foreign-key violation', async () => {
        const native = {
            pragma: () => [{ busy: 1, log: 1, checkpointed: 0 }],
        }
        const busy = {
            getNativeDb: () => native,
        } as IDatabaseConnection
        expect(() => assertWalCheckpointComplete(busy)).toThrow(/busy=1/)

        const dbPath = path.join(makeTempDir(), 'orphan.db')
        const db = new Database(dbPath)
        try {
            db.pragma('foreign_keys = OFF')
            db.exec(`
                CREATE TABLE parent (id INTEGER PRIMARY KEY);
                CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));
                INSERT INTO child (id, parent_id) VALUES (1, 99);
            `)
        } finally {
            db.close()
        }
        await expect(assertIncomingBackupIntact(dbPath)).rejects.toThrow(/Foreign key check failed/)
    })

    it('treats a sibling directory as outside the allowed root', () => {
        const root = makeTempDir()
        expect(() => assertSafeDirectoryPath(path.join(root, 'child'), [root])).not.toThrow()
        expect(() => assertSafeDirectoryPath(path.join(`${root}-outside`, 'child'), [root])).toThrow(
            /escapes allowed/
        )
    })

    it('throws when the configuration file cannot be parsed', () => {
        const configPath = path.join(makeTempDir(), 'broken.json')
        fs.writeFileSync(configPath, '{')
        expect(
            () =>
                new ConfigManager(
                    {
                        rawToolFilter: undefined,
                        toolFilterConfig: null,
                        briefingConfig: DEFAULT_BRIEFING_CONFIG,
                    },
                    configPath
                )
        ).toThrow(RegistryConfigError)
    })

    it('prints plain text only when json is explicitly false', () => {
        const writes: string[] = []
        vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            writes.push(String(chunk))
            return true
        })
        writeCliResult({ ok: true }, undefined, 'Search finished.')
        writeCliResult({ ok: true }, false, 'Search finished.')
        expect(writes[0]).toContain('"ok": true')
        expect(writes[1]).toBe('Search finished.\n')
    })

    it('chunks a long tag list with OR for membership', () => {
        const padded = chunkedInPredicate(['a', 'b', 'c'], (placeholders) => `IN (${placeholders})`, 'OR')
        expect(padded.params).toEqual(['a', 'b', 'c', 'c'])
        const values = Array.from({ length: 501 }, (_, index) => `tag${String(index)}`)
        const membership = chunkedInPredicate(values, (placeholders) => `IN (${placeholders})`, 'OR')
        expect(membership.sql).toBe('IN (SELECT value FROM json_each(?))')
        expect(membership.params).toEqual([JSON.stringify(values)])
        expect(bucketInParams(values)).toHaveLength(2)
    })

    it('records the pass 36 prompt revision and restore rules', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-20-audit-pass49')
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const prompt = getCodeQualityAuditPromptDefinition()
            const rendered = await prompt.handler({ target: 'memory-journal-mcp' }, db)
            const text = rendered.messages.map((message) => message.content.text).join('\n')
            expect(text).toContain('exemptedOver80')
            expect(text).toContain('foreign_key_check')
            expect(text).toContain('busy !== 0')
        } finally {
            db.close()
        }
    })
})
