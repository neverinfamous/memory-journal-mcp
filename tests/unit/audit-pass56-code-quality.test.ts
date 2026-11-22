/**
 * Pass 56 Adversarial Code-Quality Audit Regression Tests
 * Covers M1–M4, L1–L8, and AP1–AP2.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationServerDiscovery } from '../../src/auth/authorization-server-discovery.js'
import { projectListAction } from '../../src/cli/commands/project.js'
import { createGroupApi } from '../../src/codemode/api/group-factory.js'
import { createRegisterProjectFn } from '../../src/codemode/api/project-registry-ops.js'
import { cleanSqlText } from '../../src/codemode/sql-positional-binder.js'
import { isFts5QueryError } from '../../src/database/sqlite-adapter/entries/search/fts-sanitizer.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { escapeDelimiterChar } from '../../src/handlers/tools/codemode/code-healer-rewrites.js'
import {
    collectNonCodeModeTools,
    disposeCodemodeResources,
} from '../../src/handlers/tools/codemode/singleton-state.js'
import { processImportBatch } from '../../src/markdown/importer.js'
import { createResourceReadHandler } from '../../src/server/mcp-server/tool-registration/register-tools-helpers.js'
import type { ServerContext, ServerOptions } from '../../src/server/mcp-server/types.js'
import { ValidationError } from '../../src/types/errors.js'
import { formatHandlerError } from '../../src/utils/error-helpers.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'
import type { ToolContext, ToolDefinition } from '../../src/types/index.js'

describe('Pass 56 Code Quality Audit Regressions', () => {
    const tempDirs: string[] = []
    const makeTempDir = (): string => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass56-'))
        tempDirs.push(dir)
        return dir
    }

    afterEach(() => {
        vi.restoreAllMocks()
        disposeCodemodeResources()
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('M1: processImportBatch propagates db-resolved newEntry.projectNumber into relationship scope validation', async () => {
        const linkEntries = vi.fn()
        const mockDb = {
            executeInTransaction: (fn: () => void) => fn(),
            getEntryById: vi.fn((id: number) =>
                id === 99
                    ? {
                          id: 99,
                          workspaceId: 'proj-a',
                          projectNumber: 20,
                          content: 'other project entry',
                          entryType: 'technical_note',
                          timestamp: '2026-01-01T00:00:00Z',
                          isPersonal: true,
                          tags: [],
                      }
                    : null
            ),
            createEntry: vi.fn(() => ({
                id: 100,
                workspaceId: 'proj-a',
                projectNumber: 10,
                content: 'imported',
                entryType: 'technical_note',
                timestamp: '2026-01-01T00:00:00Z',
                isPersonal: true,
                tags: [],
            })),
            linkEntries,
        } as unknown as IDatabaseAdapter

        const result = await processImportBatch(
            [
                {
                    filename: 'note.md',
                    metadata: {
                        workspace_id: 'proj-a',
                        relationships: [{ target_id: 99, type: 'references' }],
                    },
                    body: 'imported',
                },
            ],
            mockDb,
            { workspace_id: 'proj-a' },
            undefined
        )

        expect(result.created).toBe(1)
        expect(linkEntries).not.toHaveBeenCalled()
        expect(result.errors.length).toBeGreaterThan(0)
        expect(result.errors.some((e) => /not found|target/i.test(e.error))).toBe(true)
    })

    it('M2: escapeDelimiterChar preserves backslash-run parity before delimiter', () => {
        expect(escapeDelimiterChar('C:\\\\dir\\\\`name`', '`')).toBe('C:\\\\dir\\\\\\`name\\`')
        expect(escapeDelimiterChar('already \\`escaped\\`', '`')).toBe('already \\`escaped\\`')
        expect(escapeDelimiterChar('triple \\\\\\`quote', '`')).toBe('triple \\\\\\`quote')
    })

    it('M3: isFts5QueryError matches all 4 recoverable FTS5 query errors and rejects unrelated errors', () => {
        expect(isFts5QueryError(new Error('fts5: syntax error near ":"'))).toBe(true)
        expect(isFts5QueryError(new Error('no such column: foo'))).toBe(true)
        expect(isFts5QueryError(new Error('unterminated string'))).toBe(true)
        expect(isFts5QueryError(new Error('unrecognized token: "$"'))).toBe(true)
        expect(isFts5QueryError(new Error('SQLITE_BUSY: database is locked'))).toBe(false)
        expect(isFts5QueryError('syntax error')).toBe(false)
    })

    it('M4: projectListAction emits valid empty JSON when --json is set and registry is empty', () => {
        const dir = makeTempDir()
        const cfgFile = path.join(dir, 'config.json')
        fs.writeFileSync(cfgFile, JSON.stringify({ projectRegistry: {} }), 'utf8')
        const out: string[] = []
        vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            out.push(String(chunk))
            return true
        })

        projectListAction({ config: cfgFile, json: true }, new Command())
        expect(JSON.parse(out.join(''))).toEqual({})

        out.length = 0
        projectListAction({ config: cfgFile }, new Command())
        expect(out.join('')).toContain('No projects registered.')
    })

    it('L1: cleanSqlText preserves comment tokens inside backslash-escaped quotes and backtick identifiers', () => {
        const sql1 = "SELECT 'it\\'s -- not a comment' FROM `t--1` -- trailing comment"
        expect(cleanSqlText(sql1)).toBe("SELECT 'it\\'s -- not a comment' FROM `t--1`")

        const sql2 = 'INSERT INTO journal_entries (content) VALUES ("a \\"/* keep */\\" b") /* strip */'
        expect(cleanSqlText(sql2)).toBe(
            'INSERT INTO journal_entries (content) VALUES ("a \\"/* keep */\\" b")'
        )
    })

    it('L2: formatHandlerError terminates direct self-cycles on response.details at depth 1', () => {
        const selfDetails: Record<string, unknown> = { label: 'root' }
        selfDetails['self'] = selfDetails
        const err = new ValidationError('bad input', selfDetails)

        const res = formatHandlerError(err)
        expect(res.details).toEqual({ label: 'root', self: '[Circular]' })
    })

    it('L3: MetricsAccumulator.loadFromFile does not throw on circular or BigInt non-Error failures', async () => {
        const runtime = new ServerRuntime()
        const circular: Record<string, unknown> = { id: 1n }
        circular['self'] = circular
        vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(circular)

        await expect(runtime.metrics.loadFromFile('/nonexistent/metrics.json')).resolves.toBeUndefined()
    })

    it('L4: createResourceReadHandler serializes BigInt resource payloads safely', async () => {
        const runtime = new ServerRuntime()
        const readHandler = createResourceReadHandler(
            {
                db: {
                    searchEntries: vi.fn(() => ({ entries: [{ id: 42n, content: 'ok' }] })),
                } as unknown as IDatabaseAdapter,
                vectorManager: undefined,
                github: undefined,
                teamDb: null,
                runtime,
                configManager: {
                    getConfig: () => ({
                        toolFilterConfig: {
                            enabledTools: new Set<string>(),
                            rules: [],
                        },
                        briefingConfig: {},
                    }),
                },
            } as unknown as ServerContext,
            {} as ServerOptions
        )

        const res = await readHandler(new URL('memory://projects/1/timeline'), 'application/json')
        expect(res.contents[0]?.text).toMatch(/"id":\s*"42"/)
    })

    it('L5: AuthorizationServerDiscovery rejects HTTPS URLs with embedded credentials', async () => {
        const discovery = new AuthorizationServerDiscovery({
            authServerUrl: 'https://user:secret@auth.example.com',
        })
        await expect(discovery.discover()).rejects.toThrow(/must not contain credentials/i)
    })

    it('L6: createRegisterProjectFn preserves POSIX absolute paths via path.posix.resolve', async () => {
        const dir = makeTempDir()
        const cfgFile = path.join(dir, 'config.json')
        fs.writeFileSync(cfgFile, JSON.stringify({ projectRegistry: {} }), 'utf8')
        const prevCfg = process.env['MEMORY_JOURNAL_CONFIG']
        process.env['MEMORY_JOURNAL_CONFIG'] = cfgFile
        try {
            const registerFn = createRegisterProjectFn({
                createEntry: vi.fn(async () => ({ success: true })),
            })
            const saved = await registerFn('linux-repo', '/home/dev/repo', 77)
            expect(saved.success).toBe(true)
            const parsed = JSON.parse(fs.readFileSync(cfgFile, 'utf8')) as {
                projectRegistry: Record<string, { path: string; project_number?: number }>
            }
            expect(parsed.projectRegistry['linux-repo']?.path).toBe('/home/dev/repo')
        } finally {
            if (prevCfg === undefined) delete process.env['MEMORY_JOURNAL_CONFIG']
            else process.env['MEMORY_JOURNAL_CONFIG'] = prevCfg
        }
    })

    it('L7: disposeCodemodeResources clears cachedNonCodeModeTools and cachedCodeModeContext', () => {
        const ctx = {
            db: {} as IDatabaseAdapter,
            config: {},
        } as unknown as ToolContext

        const first = collectNonCodeModeTools(ctx)
        expect(collectNonCodeModeTools(ctx)).toBe(first)

        disposeCodemodeResources()
        const second = collectNonCodeModeTools(ctx)
        expect(second).not.toBe(first)
    })

    it('L8: createGroupApi narrows non-Error thrown values without unsafe Error casts', async () => {
        const throwingTool: ToolDefinition = {
            name: 'test_throw_non_error',
            title: 'Throw Non Error',
            description: 'Test',
            group: 'core',
            inputSchema: {},
            handler: () => {
                throw 'plain string failure'
            },
        }
        const api = createGroupApi('core', [throwingTool])
        const fn = api['testThrowNonError'] as (params?: unknown) => Promise<Record<string, unknown>>
        const res = await fn({})
        expect(res['success']).toBe(false)
        expect(res['code']).toBeUndefined()
    })

    it('AP1–AP2: bumps AUDIT_PROMPT_REVISION to 2026-11-20-audit-pass57 and includes Pass 56 invariants', () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-22-audit-pass76')
        const def = getCodeQualityAuditPromptDefinition()
        const mockDb = {
            searchEntries: vi.fn(() => []),
            searchByDateRange: vi.fn(() => []),
            getRecentEntries: vi.fn(() => []),
        } as unknown as IDatabaseAdapter
        const rendered = def.handler({ target: 'memory-journal-mcp' }, mockDb)
        const text = rendered.messages[0]?.content.text ?? ''
        expect(text).toContain('Prompt revision: 2026-11-22-audit-pass76')
        expect(text).toContain('escapeDelimiterChar')
        expect(text).toContain('root-seeded active-ancestor-only cycle tracking')
        expect(text).toContain('String(error)')
    })
})
