/**
 * Unit Tests for CLI Program, Admin, Analytics, Search, Visualize, IO, and Serve Commands
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { Command } from 'commander'
import { z } from 'zod'
import {
    createProgram,
    withGroup,
    addAgentInstructions,
    withValidation,
} from '../../src/cli/program.js'
import {
    backupAction,
    restoreAction,
    vacuumAction,
    pruneAction,
    auditAction,
    rebuildIndexAction,
} from '../../src/cli/commands/admin.js'
import {
    analyticsStatsAction,
    analyticsInsightsAction,
} from '../../src/cli/commands/analytics.js'
import { searchAction } from '../../src/cli/commands/search.js'
import { visualizeAction } from '../../src/cli/commands/visualize.js'
import {
    exportJsonAction,
    exportMarkdownAction,
    importMarkdownAction,
    importExternalAction,
} from '../../src/cli/commands/io.js'
import { serveAction } from '../../src/cli/commands/serve.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

const { mockCreateServer, mockEmbedderFn } = vi.hoisted(() => ({
    mockCreateServer: vi.fn().mockResolvedValue(undefined),
    mockEmbedderFn: vi.fn().mockResolvedValue({ data: new Float32Array(384).fill(0.1) }),
}))

vi.mock('../../src/server/mcp-server/index.js', () => ({
    createServer: mockCreateServer,
}))

vi.mock('@huggingface/transformers', () => ({
    pipeline: vi.fn().mockResolvedValue(mockEmbedderFn),
    env: { allowRemoteModels: false, localModelPath: '' },
}))

describe('CLI Program & Commands', () => {
    let tmpDir: string
    let dbPath: string
    let stdoutOutput: string[]
    let stderrOutput: string[]
    let stdoutSpy: ReturnType<typeof vi.spyOn>
    let stderrSpy: ReturnType<typeof vi.spyOn>
    let exitSpy: ReturnType<typeof vi.spyOn>
    let dummyCmd: Command
    let savedDbEnv: string | undefined
    let savedTeamDbEnv: string | undefined
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-cli-test-'))
        dbPath = path.join(tmpDir, 'cli-test.db')
        savedDbEnv = process.env['DB_PATH']
        savedTeamDbEnv = process.env['TEAM_DB_PATH']
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        process.env['DB_PATH'] = dbPath
        process.env['TEAM_DB_PATH'] = path.join(tmpDir, 'cli-team-test.db')
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
        stdoutOutput = []
        stderrOutput = []
        stdoutSpy = vi
            .spyOn(process.stdout, 'write')
            .mockImplementation((chunk: string | Uint8Array) => {
                stdoutOutput.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
                return true
            })
        stderrSpy = vi
            .spyOn(process.stderr, 'write')
            .mockImplementation((chunk: string | Uint8Array) => {
                stderrOutput.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
                return true
            })
        exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`PROCESS_EXIT_${String(code ?? 0)}`)
        }) as never)
        dummyCmd = new Command('test-cmd')
        vi.spyOn(dummyCmd, 'getOptionValueSource').mockReturnValue('cli')
    })

    afterEach(() => {
        if (savedDbEnv !== undefined) process.env['DB_PATH'] = savedDbEnv
        else delete process.env['DB_PATH']
        if (savedTeamDbEnv !== undefined) process.env['TEAM_DB_PATH'] = savedTeamDbEnv
        else delete process.env['TEAM_DB_PATH']
        if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
        else delete process.env['DB_ENCRYPTION_KEY']
        stdoutSpy.mockRestore()
        stderrSpy.mockRestore()
        exitSpy.mockRestore()
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true })
        } catch {
            // ignore
        }
    })

    describe('src/cli/program.ts (createProgram, withGroup, addAgentInstructions, withValidation)', () => {
        it('should format text help and JSON help with option groups and AI instructions', () => {
            const prog = createProgram()
            addAgentInstructions(prog, '\n🤖 AI AGENT INSTRUCTIONS:\n- Follow test instructions')

            const sub = prog
                .command('sub <arg1>')
                .description('Subcommand description')
                .argument('<arg1>', 'First positional argument')
                .option('--plain <val>', 'Plain command option')

            withGroup(sub, 'Custom Group', (c) => {
                c.option('--grouped <val>', 'Grouped option description')
            })
            addAgentInstructions(sub, '🤖 AI AGENT INSTRUCTIONS:\n- Subcommand tip')

            // 1. Standard text help
            const textHelp = sub.helpInformation()
            expect(textHelp).toContain('Usage: memory-journal-mcp sub')
            expect(textHelp).toContain('Subcommand description')
            expect(textHelp).toContain('Arguments:')
            expect(textHelp).toContain('Custom Group:')
            expect(textHelp).toContain('--grouped <val>')
            expect(textHelp).toContain('Command Options:')
            expect(textHelp).toContain('Standard Options:')
            expect(textHelp).toContain('Subcommand tip')

            // Parent text help with subcommands
            const parentHelp = prog.helpInformation()
            expect(parentHelp).toContain('Commands:')
            expect(parentHelp).toContain('Follow test instructions')

            // 2. JSON help mode
            const origArgv = [...process.argv]
            process.argv.push('--json')
            try {
                const jsonHelpRaw = prog.helpInformation()
                const parsed = JSON.parse(jsonHelpRaw) as {
                    status: string
                    data: {
                        name: string
                        commands: { name: string; options: { group: string }[] }[]
                        aiInstructions: string[]
                    }
                }
                expect(parsed.status).toBe('success')
                expect(parsed.data.name).toBe('memory-journal-mcp')
                expect(parsed.data.aiInstructions).toContain('Follow test instructions')
                expect(parsed.data.commands[0]?.name).toBe('sub')
            } finally {
                process.argv = origArgv
            }
        })

        it('should validate options via withValidation and handle ZodError vs generic Error', async () => {
            const schema = z.object({ count: z.coerce.number().int().positive() })
            const actionSpy = vi.fn()
            const wrapped = withValidation(schema, actionSpy)

            // Valid invocation
            await wrapped({ count: '5' }, dummyCmd)
            expect(actionSpy).toHaveBeenCalledWith({ count: 5 }, dummyCmd)

            // Invalid invocation triggers ZodError formatting + command.help
            const helpSpy = vi.spyOn(dummyCmd, 'help').mockImplementation((() => {
                throw new Error('HELP_CALLED')
            }) as never)
            await expect(wrapped({ count: '-3' }, dummyCmd)).rejects.toThrow('HELP_CALLED')
            expect(stderrOutput.join('')).toContain('Validation Error:')
            helpSpy.mockRestore()

            // Non-Zod error rethrows directly
            const errWrapped = withValidation(schema, () => {
                throw new Error('Boom')
            })
            await expect(errWrapped({ count: 1 }, dummyCmd)).rejects.toThrow('Boom')
        })
    })

    describe('src/cli/commands/admin.ts', () => {
        it('should run backupAction, restoreAction, vacuumAction, and pruneAction in text and JSON modes', async () => {
            // Seed database with an entry
            const seedDb = new DatabaseAdapter(dbPath)
            await seedDb.initialize()
            seedDb.createEntry({ content: 'Admin CLI test entry' })
            seedDb.close()

            // 1. backupAction (JSON mode)
            await backupAction({ db: dbPath, json: true }, dummyCmd)
            const backupJson = JSON.parse(stdoutOutput.join('')) as {
                filename: string
                path: string
            }
            expect(backupJson.filename).toBeDefined()

            // 2. backupAction (text mode)
            stdoutOutput = []
            stderrOutput = []
            await backupAction({ db: dbPath, json: false }, dummyCmd)
            expect(stderrOutput.join('')).toContain('Backup successful:')

            // 3. restoreAction (JSON mode and text mode)
            stdoutOutput = []
            await restoreAction(backupJson.filename, { db: dbPath, json: true }, dummyCmd)
            const restoreJson = JSON.parse(stdoutOutput.join('')) as { restoredFrom: string }
            expect(restoreJson.restoredFrom).toBe(backupJson.filename)

            stderrOutput = []
            await restoreAction(backupJson.filename, { db: dbPath, json: false }, dummyCmd)
            expect(stderrOutput.join('')).toContain('Restore successful')

            // 4. vacuumAction (JSON mode and text mode)
            stdoutOutput = []
            await vacuumAction({ db: dbPath, json: true }, dummyCmd)
            expect(JSON.parse(stdoutOutput.join(''))).toEqual({
                status: 'success',
                action: 'vacuum',
            })

            stderrOutput = []
            await vacuumAction({ db: dbPath, json: false }, dummyCmd)
            expect(stderrOutput.join('')).toContain('Vacuum and optimize successful')

            // 5. pruneAction (JSON mode and text mode)
            stdoutOutput = []
            await pruneAction(
                {
                    db: dbPath,
                    json: true,
                    dryRun: true,
                    excludeTags: 'keep,important',
                    archiveOlderThanDays: 30,
                    pruneOlderThanDays: 90,
                    hardDeleteOlderThanDays: 30,
                    importanceThreshold: 0.2,
                },
                dummyCmd
            )
            const pruneJson = JSON.parse(stdoutOutput.join('')) as { archivedCount: number }
            expect(pruneJson.archivedCount).toBe(0)

            stderrOutput = []
            await pruneAction({ db: dbPath, json: false, dryRun: true }, dummyCmd)
            expect(stderrOutput.join('')).toContain('Prune result:')
        })

        it('should run auditAction when auditLog is provided and fail when missing', async () => {
            const auditFile = path.join(tmpDir, 'audit.jsonl')
            fs.writeFileSync(
                auditFile,
                JSON.stringify({
                    timestamp: new Date().toISOString(),
                    requestId: 'r1',
                    tool: 'create_entry',
                    category: 'write',
                    scope: 'write',
                    user: 'alice',
                    scopes: [],
                    durationMs: 10,
                    success: true,
                }) + '\n',
                'utf-8'
            )

            stdoutOutput = []
            await auditAction(
                {
                    db: dbPath,
                    auditLog: auditFile,
                    limit: 10,
                    tool: 'create_entry',
                    status: 'success',
                },
                dummyCmd
            )
            const results = JSON.parse(stdoutOutput.join('')) as { tool: string }[]
            expect(results).toHaveLength(1)
            expect(results[0]?.tool).toBe('create_entry')

            // Missing auditLog should exit(1)
            const origEnv = process.env['MEMORY_JOURNAL_AUDIT_LOG']
            delete process.env['MEMORY_JOURNAL_AUDIT_LOG']
            try {
                await expect(auditAction({ db: dbPath }, dummyCmd)).rejects.toThrow(
                    'PROCESS_EXIT_1'
                )
            } finally {
                if (origEnv !== undefined) process.env['MEMORY_JOURNAL_AUDIT_LOG'] = origEnv
            }
        })

        it('should run rebuildIndexAction', async () => {
            stdoutOutput = []
            await rebuildIndexAction({ db: dbPath }, dummyCmd)
            const parsed = JSON.parse(stdoutOutput.join('')) as { status: string }
            expect(parsed.status).toBe('success')
        })
    })

    describe('src/cli/commands/analytics.ts, search.ts, visualize.ts', () => {
        beforeEach(async () => {
            const db = new DatabaseAdapter(dbPath)
            await db.initialize()
            const e1 = db.createEntry({
                content: 'First searchable entry about architecture',
                projectNumber: 5,
                tags: ['arch'],
            })
            const e2 = db.createEntry({
                content: 'Second searchable entry',
                projectNumber: 5,
            })
            db.linkEntries(e1.id, e2.id, 'relates_to')
            db.close()
        })

        it('should run analyticsStatsAction and analyticsInsightsAction', async () => {
            stdoutOutput = []
            await analyticsStatsAction({ db: dbPath }, dummyCmd)
            const stats = JSON.parse(stdoutOutput.join('')) as { totalEntries: number }
            expect(stats.totalEntries).toBe(2)

            stdoutOutput = []
            await analyticsInsightsAction({ db: dbPath }, dummyCmd)
            const insights = JSON.parse(stdoutOutput.join('')) as { projects: unknown[] }
            expect(insights.projects.length).toBeGreaterThanOrEqual(1)
        })

        it('should run searchAction with query and fail when query is missing', async () => {
            stdoutOutput = []
            await searchAction('architecture', { db: dbPath, mode: 'auto', limit: 10 }, dummyCmd)
            const searchRes = JSON.parse(stdoutOutput.join('')) as { entries: { content: string }[] }
            expect(searchRes.entries.length).toBeGreaterThanOrEqual(1)

            // Missing query triggers exit(1)
            await expect(searchAction(undefined, { db: dbPath }, dummyCmd)).rejects.toThrow(
                'PROCESS_EXIT_1'
            )
            expect(stderrOutput.join('')).toContain('Missing search query')
        })

        it('should run visualizeAction to stdout and to --out file', async () => {
            stdoutOutput = []
            await visualizeAction({ db: dbPath }, dummyCmd)
            expect(stdoutOutput.join('')).toContain('```mermaid')
            expect(stdoutOutput.join('')).toContain('graph TD')

            const outFile = path.join(tmpDir, 'graph.md')
            stderrOutput = []
            await visualizeAction({ db: dbPath, out: outFile }, dummyCmd)
            expect(fs.existsSync(outFile)).toBe(true)
            expect(fs.readFileSync(outFile, 'utf-8')).toContain('graph TD')
        })
    })

    describe('src/cli/commands/io.ts', () => {
        it('should run exportJsonAction, exportMarkdownAction, importMarkdownAction, and importExternalAction', async () => {
            const db = new DatabaseAdapter(dbPath)
            await db.initialize()
            db.createEntry({
                content: 'Entry to export to markdown',
                tags: ['export-tag'],
            })
            db.close()

            // 1. exportJsonAction
            stdoutOutput = []
            await exportJsonAction({ db: dbPath }, dummyCmd)
            const jsonExport = JSON.parse(stdoutOutput.join('')) as { filename: string }
            expect(jsonExport.filename).toBeDefined()

            // 2. exportMarkdownAction (must not be inside os.tmpdir() due to exporter security check)
            const mdDir = path.join(
                process.cwd(),
                '.test-output',
                `cli-md-export-${String(Date.now())}`
            )
            try {
                stdoutOutput = []
                await exportMarkdownAction({ db: dbPath, dir: mdDir }, dummyCmd)
                const mdExport = JSON.parse(stdoutOutput.join('')) as { exported_count: number }
                expect(mdExport.exported_count).toBe(1)

                // 3. importMarkdownAction
                stdoutOutput = []
                await importMarkdownAction({ db: dbPath, dir: mdDir }, dummyCmd)
                const mdImport = JSON.parse(stdoutOutput.join('')) as { success: boolean }
                expect(mdImport.success).toBe(true)
            } finally {
                fs.rmSync(mdDir, { recursive: true, force: true })
            }

            // 4. importExternalAction (obsidian format)
            const extDir = path.join(tmpDir, 'ext-obsidian')
            fs.mkdirSync(extDir, { recursive: true })
            fs.writeFileSync(
                path.join(extDir, 'note1.md'),
                '---\ntags:\n  - obsidian\n---\n# Obsidian Note\nExternal note body content\n',
                'utf-8'
            )
            fs.writeFileSync(path.join(extDir, 'empty.md'), '   \n', 'utf-8')

            stdoutOutput = []
            await importExternalAction(
                { db: dbPath, dir: extDir, format: 'obsidian' },
                dummyCmd
            )
            const extImport = JSON.parse(stdoutOutput.join('')) as { created: number }
            expect(extImport.created).toBe(1)

            // Missing --dir error path
            await expect(exportMarkdownAction({ db: dbPath }, dummyCmd)).rejects.toThrow(
                'PROCESS_EXIT_1'
            )
            await expect(importMarkdownAction({ db: dbPath }, dummyCmd)).rejects.toThrow(
                'PROCESS_EXIT_1'
            )
            await expect(importExternalAction({ db: dbPath }, dummyCmd)).rejects.toThrow(
                'PROCESS_EXIT_1'
            )
        })
    })

    describe('src/cli/commands/serve.ts', () => {
        it('should dump redacted configuration with --dump-config and call createServer normally', async () => {
            stdoutOutput = []
            await expect(
                serveAction(
                    {
                        db: dbPath,
                        dumpConfig: true,
                        authToken: 'secret-token-value',
                    },
                    dummyCmd
                )
            ).rejects.toThrow('PROCESS_EXIT_0')

            const dumped = JSON.parse(stdoutOutput.join('')) as { authToken: string }
            expect(dumped.authToken).toBe('[REDACTED]')

            // Normal server startup
            mockCreateServer.mockClear()
            await serveAction({ db: dbPath }, dummyCmd)
            expect(mockCreateServer).toHaveBeenCalledTimes(1)

            // Placeholder secret detection should exit(1)
            process.env['MCP_AUTH_TOKEN'] = 'CHANGEME_DEFAULT'
            try {
                await expect(serveAction({ db: dbPath }, dummyCmd)).rejects.toThrow(
                    'PROCESS_EXIT_1'
                )
                expect(stderrOutput.join('')).toContain('Insecure configuration detected')
            } finally {
                delete process.env['MCP_AUTH_TOKEN']
            }
        })
    })
})
