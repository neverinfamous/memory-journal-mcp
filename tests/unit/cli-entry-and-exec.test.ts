/**
 * Unit Tests for CLI Entry Commands (src/cli/commands/entry.ts)
 * and Exec Command (src/cli/commands/exec.ts)
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { Command } from 'commander'

const { deterministicEmbedder } = vi.hoisted(() => {
    const embed = (): Promise<{ data: Float32Array }> =>
        Promise.resolve({ data: new Float32Array(16).fill(0.25) })
    return { deterministicEmbedder: embed }
})

vi.mock('@huggingface/transformers', () => ({
    pipeline: vi.fn().mockResolvedValue(deterministicEmbedder),
    env: { allowRemoteModels: false, localModelPath: '' },
}))

import {
    buildEntryPayload,
    createEntryAction,
    updateEntryAction,
} from '../../src/cli/commands/entry.js'
import { execAction } from '../../src/cli/commands/exec.js'
import { getSandboxPool } from '../../src/handlers/tools/codemode/singleton-state.js'
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

    afterAll(() => {
        getSandboxPool().dispose()
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

            // 4. Metadata-only update without --content/--file and workspace reassignment (H16 & M7)
            stdoutOutput = []
            await updateEntryAction(
                {
                    db: dbPath,
                    id: created1.id,
                    expectedVersion: 2,
                    tag: 'metadata-only-tag',
                    project: 9,
                    workspace: 'mysql-mcp',
                    json: true,
                },
                dummyCmd
            )
            const updatedMetaOnly = JSON.parse(stdoutOutput.join('')) as {
                status: string
                id: number
                version: number
            }
            expect(updatedMetaOnly.status).toBe('success')
            expect(updatedMetaOnly.version).toBe(3)

            const dbAfterReassign = new DatabaseAdapter(dbPath)
            await dbAfterReassign.initialize()
            const reassigned = dbAfterReassign.getEntryById(created1.id, 'mysql-mcp')
            expect(reassigned?.workspaceId).toBe('mysql-mcp')
            expect(reassigned?.content).toContain('# Updated Header')
            expect(reassigned?.tags).toContain('metadata-only-tag')
            dbAfterReassign.close()
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

        it('should attribute CLI buildEntryPayload and createEntryAction to registered CWD repo instead of hijacking on keyword aliases like "sqlite"', async () => {
            const adamicDir = path.join(tmpDir, 'adamic')
            const dbMcpDir = path.join(tmpDir, 'db-mcp')
            fs.mkdirSync(adamicDir, { recursive: true })
            fs.mkdirSync(dbMcpDir, { recursive: true })

            const registry = {
                'db-mcp': { path: dbMcpDir, project_number: 15 },
                adamic: { path: adamicDir, project_number: 16 },
            }

            const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(adamicDir)
            const savedRegistryEnv = process.env['PROJECT_REGISTRY']
            delete process.env['PROJECT_REGISTRY']
            try {
                // 1. Direct buildEntryPayload check: CWD ('adamic' #16) beats 'sqlite' keyword ('db-mcp' #15)
                const payload = buildEntryPayload(
                    { tags: 'sqlite,skills' },
                    {},
                    { projectRegistry: registry },
                    'Refined sqlite PRAGMA rules in adamic skill'
                )
                expect(payload.workspaceId).toBe('adamic')
                expect(payload.projectNumber).toBe(16)
                expect(payload.hasExplicitProject).toBe(false)
                expect(payload.hasExplicitWorkspace).toBe(false)

                // Explicit --project / --workspace still overrides CWD
                const explicitPayload = buildEntryPayload(
                    { project: 15, tags: 'sqlite' },
                    {},
                    { projectRegistry: registry },
                    'Explicitly targeting db-mcp from adamic CWD'
                )
                expect(explicitPayload.workspaceId).toBe('db-mcp')
                expect(explicitPayload.projectNumber).toBe(15)
                expect(explicitPayload.hasExplicitProject).toBe(true)

                // 2. End-to-end createEntryAction with config file projectRegistry and no --project/--workspace
                const cfgFile = path.join(tmpDir, 'cwd-priority-config.json')
                fs.writeFileSync(
                    cfgFile,
                    JSON.stringify({ projectRegistry: registry }),
                    'utf-8'
                )
                const realSourceCmd = new Command('entry')
                vi.spyOn(realSourceCmd, 'getOptionValueSource').mockImplementation((key: string) =>
                    ['db', 'config', 'tags', 'json'].includes(key) ? 'cli' : 'default'
                )

                stdoutOutput = []
                await createEntryAction(
                    'Documented sqlite connection pooling rules inside adamic',
                    {
                        db: dbPath,
                        config: cfgFile,
                        tags: 'sqlite,docs',
                        json: true,
                    },
                    realSourceCmd
                )

                const created = JSON.parse(stdoutOutput.join('')) as {
                    status: string
                    id: number
                }
                expect(created.status).toBe('success')

                const db = new DatabaseAdapter(dbPath)
                await db.initialize()
                const stored = db.getEntryById(created.id, 'adamic')
                expect(stored).not.toBeNull()
                expect(stored?.workspaceId).toBe('adamic')
                expect(stored?.projectNumber).toBe(16)
                db.close()
            } finally {
                if (savedRegistryEnv !== undefined) {
                    process.env['PROJECT_REGISTRY'] = savedRegistryEnv
                } else {
                    delete process.env['PROJECT_REGISTRY']
                }
                cwdSpy.mockRestore()
            }
        })
    })

    describe('execAction (src/cli/commands/exec.ts)', () => {
        it('should execute a Code Mode script file and exit(0)', async () => {
            const scriptFile = path.join(tmpDir, 'test-script.js')
            const cfgFile = path.join(tmpDir, 'exec-config.json')
            fs.writeFileSync(scriptFile, 'return 21 * 2;', 'utf-8')
            fs.writeFileSync(cfgFile, '{}', 'utf-8')

            stdoutOutput = []
            await expect(
                execAction(scriptFile, { db: dbPath, config: cfgFile }, dummyCmd)
            ).rejects.toThrow('PROCESS_EXIT_0')

            const output = JSON.parse(stdoutOutput.join('')) as {
                success: boolean
                result: number
            }
            expect(output.success).toBe(true)
            expect(output.result).toBe(42)

            // Failing Code Mode script should exit(1) (H19)
            const failScriptFile = path.join(tmpDir, 'fail-script.js')
            fs.writeFileSync(failScriptFile, 'throw new Error("boom");', 'utf-8')
            stdoutOutput = []
            await expect(
                execAction(failScriptFile, { db: dbPath, config: cfgFile }, dummyCmd)
            ).rejects.toThrow('PROCESS_EXIT_1')
        }, 30_000)
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

            // 2b. Create project without --number skips unassigned DB init and supports --json (C5 & M10)
            stdoutOutput = []
            await projectCreateAction(
                'proj-no-num',
                { config: cfgFile, path: './no-num', db: dbPath, json: true },
                dummyCmd
            )
            const createdNoNum = JSON.parse(stdoutOutput.join('')) as {
                status: string
                name: string
                initialized: boolean
            }
            expect(createdNoNum.status).toBe('success')
            expect(createdNoNum.name).toBe('proj-no-num')
            expect(createdNoNum.initialized).toBe(false)

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
