/**
 * Unit Tests for CLI Entry Commands (src/cli/commands/entry.ts)
 * and Exec Command (src/cli/commands/exec.ts)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { Command } from 'commander'
import { createEntryAction, updateEntryAction } from '../../src/cli/commands/entry.js'
import { execAction } from '../../src/cli/commands/exec.js'
import {
    projectListAction,
    projectCreateAction,
    projectUpdateAction,
    projectDeleteAction,
} from '../../src/cli/commands/project.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

describe('CLI Entry & Exec Commands', () => {
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
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-cli-entry-test-'))
        dbPath = path.join(tmpDir, 'entry-test.db')
        savedDbEnv = process.env['DB_PATH']
        savedTeamDbEnv = process.env['TEAM_DB_PATH']
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        process.env['DB_PATH'] = dbPath
        process.env['TEAM_DB_PATH'] = path.join(tmpDir, 'entry-team-test.db')
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
        dummyCmd = new Command('entry')
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

    describe('createEntryAction & updateEntryAction', () => {
        it('should create an entry with flags, frontmatter file, metadata JSON, and relationships', async () => {
            // 1. Create initial entry via CLI using positional content and alias flags
            await createEntryAction(
                'Initial entry content via rest args',
                {
                    db: dbPath,
                    tag: 'tag1,tag2',
                    summary: 'My Title',
                    project: 5,
                    workspace: 'memory-journal-mcp',
                    confidence: 0.9,
                    impact: 0.7,
                    validation: 'passed',
                    session: 'sess-001',
                    json: true,
                },
                dummyCmd
            )

            const created1 = JSON.parse(stdoutOutput.join('')) as {
                status: string
                id: number
                version: number
            }
            expect(created1.status).toBe('success')
            expect(created1.id).toBe(1)

            // 2. Create second entry using --file with YAML frontmatter, --metadata JSON file, and --related-to + --rel
            const mdFile = path.join(tmpDir, 'entry.md')
            fs.writeFileSync(
                mdFile,
                '---\ntype: technical_note\n---\nBody content from markdown file\n',
                'utf-8'
            )

            const metaFile = path.join(tmpDir, 'meta.json')
            fs.writeFileSync(
                metaFile,
                JSON.stringify({
                    tags: ['from-meta'],
                    project_number: 5,
                    workspace_id: 'memory-journal-mcp',
                    trust_score: 0.85,
                    impact_score: 0.5,
                    validation_status: false,
                    auto_context: { env: 'test' },
                }),
                'utf-8'
            )

            stdoutOutput = []
            stderrOutput = []
            await createEntryAction(
                {
                    db: dbPath,
                    contentFile: mdFile,
                    metadata: metaFile,
                    relatedTo: String(created1.id),
                    relationships: JSON.stringify([
                        { target_id: created1.id, relation_type: 'evolves_from' },
                    ]),
                    json: false,
                },
                dummyCmd
            )
            expect(stderrOutput.join('')).toContain('Successfully created entry #2')

            // 3. Update entry #1 via updateEntryAction (JSON and text modes)
            stdoutOutput = []
            await updateEntryAction(
                {
                    db: dbPath,
                    id: created1.id,
                    expectedVersion: 1,
                    body: 'Updated content body',
                    title: 'Updated Header',
                    tag: 'updated-tag',
                    project: 5,
                    workspace: 'memory-journal-mcp',
                    validation: 'failed',
                    relatedTo: '2',
                    json: true,
                },
                dummyCmd
            )
            const updated1 = JSON.parse(stdoutOutput.join('')) as {
                status: string
                id: number
                version: number
            }
            expect(updated1.status).toBe('success')
            expect(updated1.version).toBe(2)

            // Verify in DB
            const db = new DatabaseAdapter(dbPath)
            await db.initialize()
            const fetched = db.getEntryById(created1.id, 'memory-journal-mcp')
            expect(fetched?.content).toContain('# Updated Header')
            expect(fetched?.content).toContain('Updated content body')
            db.close()
        })

        it('should handle validation and missing parameter errors in createEntryAction and updateEntryAction', async () => {
            // Missing workspace/project in createEntryAction triggers ZodError exit(1)
            await expect(
                createEntryAction(
                    {
                        db: dbPath,
                        content: 'Missing project and workspace',
                    },
                    dummyCmd
                )
            ).rejects.toThrow('PROCESS_EXIT_1')
            expect(stderrOutput.join('')).toContain('Validation Error:')

            // Missing --id in updateEntryAction
            stderrOutput = []
            await expect(
                updateEntryAction(
                    {
                        db: dbPath,
                        content: 'No ID',
                    },
                    dummyCmd
                )
            ).rejects.toThrow('PROCESS_EXIT_1')
            expect(stderrOutput.join('')).toContain('Must provide a valid --id')

            // Missing --expected-version in updateEntryAction
            stderrOutput = []
            await expect(
                updateEntryAction(
                    {
                        db: dbPath,
                        id: 1,
                        content: 'No expected version',
                    },
                    dummyCmd
                )
            ).rejects.toThrow('PROCESS_EXIT_1')
            expect(stderrOutput.join('')).toContain('Must provide a valid --expected-version')

            // Non-existent entry ID in updateEntryAction
            stderrOutput = []
            await expect(
                updateEntryAction(
                    {
                        db: dbPath,
                        id: 9999,
                        expectedVersion: 1,
                        content: 'Nonexistent entry',
                    },
                    dummyCmd
                )
            ).rejects.toThrow('PROCESS_EXIT_1')
            expect(stderrOutput.join('')).toContain('not found or version mismatch')
        })
    })

    describe('execAction (src/cli/commands/exec.ts)', () => {
        it('should execute a Code Mode script file and exit(0)', async () => {
            const scriptFile = path.join(tmpDir, 'test-script.js')
            fs.writeFileSync(scriptFile, 'return 21 * 2;', 'utf-8')

            stdoutOutput = []
            await expect(
                execAction(scriptFile, { db: dbPath }, dummyCmd)
            ).rejects.toThrow('PROCESS_EXIT_0')

            const output = JSON.parse(stdoutOutput.join('')) as {
                success: boolean
                result: number
            }
            expect(output.success).toBe(true)
            expect(output.result).toBe(42)
        })
    })

    describe('src/cli/commands/project.ts (projectListAction, projectCreateAction, projectUpdateAction, projectDeleteAction)', () => {
        it('should create, list, update, rename, and delete projects in isolated config', async () => {
            const cfgFile = path.join(tmpDir, 'test-project-config.json')

            // 1. Empty list
            stdoutOutput = []
            projectListAction({ config: cfgFile }, dummyCmd)
            expect(stdoutOutput.join('')).toContain('No projects registered.')

            // 2. Create project with DB init
            stdoutOutput = []
            await projectCreateAction(
                'proj-alpha',
                { config: cfgFile, path: './alpha', number: '42', db: dbPath },
                dummyCmd
            )
            expect(stdoutOutput.join('')).toContain(
                "Project 'proj-alpha' successfully registered"
            )
            expect(stdoutOutput.join('')).toContain(
                'Database initialization entry successfully created.'
            )

            // 3. Create project with --skip-init
            stdoutOutput = []
            await projectCreateAction(
                'proj-beta',
                { config: cfgFile, path: './beta', skipInit: true },
                dummyCmd
            )
            expect(stdoutOutput.join('')).toContain('Skipping automated database initialization')

            // 4. List projects in text & JSON modes
            stdoutOutput = []
            projectListAction({ config: cfgFile }, dummyCmd)
            expect(stdoutOutput.join('')).toContain('proj-alpha')
            expect(stdoutOutput.join('')).toContain('Project Number: 42')

            stdoutOutput = []
            projectListAction({ config: cfgFile, json: true }, dummyCmd)
            const listJson = JSON.parse(stdoutOutput.join('')) as Record<
                string,
                { project_number?: number }
            >
            expect(listJson['proj-alpha']?.project_number).toBe(42)

            // 5. Update project (no changes vs path/number/rename)
            stdoutOutput = []
            projectUpdateAction('proj-alpha', { config: cfgFile }, dummyCmd)
            expect(stdoutOutput.join('')).toContain('No updates specified.')

            stdoutOutput = []
            projectUpdateAction(
                'proj-alpha',
                {
                    config: cfgFile,
                    path: './alpha-v2',
                    number: '99',
                    rename: 'proj-alpha-renamed',
                },
                dummyCmd
            )
            expect(stdoutOutput.join('')).toContain(
                "Project 'proj-alpha-renamed' successfully updated."
            )

            // 6. Delete project
            stdoutOutput = []
            projectDeleteAction('proj-alpha-renamed', { config: cfgFile }, dummyCmd)
            expect(stdoutOutput.join('')).toContain(
                "Project 'proj-alpha-renamed' successfully deleted."
            )

            // 7. Error cases (missing name, missing path, invalid number, missing project on update/delete)
            await expect(
                projectCreateAction('', { config: cfgFile }, dummyCmd)
            ).rejects.toThrow('PROCESS_EXIT_1')
            await expect(
                projectCreateAction('p', { config: cfgFile }, dummyCmd)
            ).rejects.toThrow('PROCESS_EXIT_1')
            await expect(
                projectCreateAction(
                    'p',
                    { config: cfgFile, path: './p', number: 'not-a-num' },
                    dummyCmd
                )
            ).rejects.toThrow('PROCESS_EXIT_1')
            expect(() => projectUpdateAction('', { config: cfgFile }, dummyCmd)).toThrow(
                'PROCESS_EXIT_1'
            )
            expect(() =>
                projectUpdateAction('nonexistent', { config: cfgFile }, dummyCmd)
            ).toThrow('PROCESS_EXIT_1')
            expect(() => projectDeleteAction('', { config: cfgFile }, dummyCmd)).toThrow(
                'PROCESS_EXIT_1'
            )
            expect(() =>
                projectDeleteAction('nonexistent', { config: cfgFile }, dummyCmd)
            ).toThrow('PROCESS_EXIT_1')
        })
    })
})
