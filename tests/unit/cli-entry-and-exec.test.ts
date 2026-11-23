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
    createEntryFromFileInProcess,
    parseContent,
    parseFrontmatter,
    updateEntryAction,
} from '../../src/cli/commands/entry.js'
import { ValidationError } from '../../src/types/errors.js'
import { execAction } from '../../src/cli/commands/exec.js'
import { getSandboxPool } from '../../src/handlers/tools/codemode/singleton-state.js'
import {
    projectListAction,
    projectCreateAction,
    projectUpdateAction,
    projectDeleteAction,
} from '../../src/cli/commands/project.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { resolveCliReadScope } from '../../src/cli/commands/db-helper.js'

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

            // 4. Metadata-only update without --content/--file and explicit --target-workspace reassignment (H16 & M7)
            stdoutOutput = []
            await updateEntryAction(
                {
                    db: dbPath,
                    id: created1.id,
                    expectedVersion: 2,
                    tag: 'metadata-only-tag',
                    project: 9,
                    workspace: 'memory-journal-mcp',
                    targetWorkspace: 'mysql-mcp',
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

        it('should reject --workspace * and mismatched --project without --workspace in updateEntryAction', async () => {
            stdoutOutput = []
            await createEntryAction(
                'Baseline entry for update guard test',
                {
                    db: dbPath,
                    workspace: 'core-platform',
                    project: 16,
                    json: true,
                },
                dummyCmd
            )
            const created = JSON.parse(stdoutOutput.join('')) as { id: number }

            const wildcardCmd = new Command('entry')
            vi.spyOn(wildcardCmd, 'getOptionValueSource').mockImplementation((key: string) =>
                ['db', 'id', 'expectedVersion', 'workspace', 'content'].includes(key)
                    ? 'cli'
                    : 'default'
            )
            stderrOutput = []
            await expect(
                updateEntryAction(
                    {
                        db: dbPath,
                        id: created.id,
                        expectedVersion: 1,
                        workspace: '*',
                        content: 'Should reject wildcard',
                    },
                    wildcardCmd
                )
            ).rejects.toThrow('PROCESS_EXIT_1')
            expect(stderrOutput.join('')).toMatch(/Workspace '\*'|cannot be used|Validation Error/i)

            const savedRegistryEnv = process.env['PROJECT_REGISTRY']
            delete process.env['PROJECT_REGISTRY']
            try {
                const cfgFile = path.join(tmpDir, 'update-mismatch-config.json')
                fs.writeFileSync(
                    cfgFile,
                    JSON.stringify({
                        projectRegistry: {
                            'core-platform': { path: path.join(tmpDir, 'core-platform'), project_number: 16 },
                            'memory-journal-mcp': { path: path.join(tmpDir, 'mj'), project_number: 5 },
                        },
                    }),
                    'utf-8'
                )
                const updateCmd = new Command('entry')
                vi.spyOn(updateCmd, 'getOptionValueSource').mockImplementation((key: string) =>
                    ['db', 'config', 'id', 'expectedVersion', 'project', 'content'].includes(key)
                        ? 'cli'
                        : 'default'
                )
                stderrOutput = []
                await expect(
                    updateEntryAction(
                        {
                            db: dbPath,
                            config: cfgFile,
                            id: created.id,
                            expectedVersion: 1,
                            project: 5,
                            content: 'Cross-project update without --workspace',
                        },
                        updateCmd
                    )
                ).rejects.toThrow('PROCESS_EXIT_1')
                expect(stderrOutput.join('')).toMatch(/belongs to workspace|uses project_number/)
            } finally {
                if (savedRegistryEnv !== undefined) {
                    process.env['PROJECT_REGISTRY'] = savedRegistryEnv
                } else {
                    delete process.env['PROJECT_REGISTRY']
                }
            }
        })

        it('should attribute CLI buildEntryPayload and createEntryAction to registered CWD repo instead of hijacking on keyword aliases like "sqlite"', async () => {
            const platformDir = path.join(tmpDir, 'core-platform')
            const dbMcpDir = path.join(tmpDir, 'db-mcp')
            fs.mkdirSync(platformDir, { recursive: true })
            fs.mkdirSync(dbMcpDir, { recursive: true })

            const registry = {
                'db-mcp': { path: dbMcpDir, project_number: 15 },
                'core-platform': { path: platformDir, project_number: 16 },
            }

            const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(platformDir)
            const savedRegistryEnv = process.env['PROJECT_REGISTRY']
            delete process.env['PROJECT_REGISTRY']
            try {
                // 1. Direct buildEntryPayload check: CWD ('core-platform' #16) beats 'sqlite' keyword ('db-mcp' #15)
                const payload = buildEntryPayload(
                    { tags: 'sqlite,skills' },
                    {},
                    { projectRegistry: registry },
                    'Refined sqlite PRAGMA rules in core-platform skill'
                )
                expect(payload.workspaceId).toBe('core-platform')
                expect(payload.projectNumber).toBe(16)
                expect(payload.hasExplicitProject).toBe(false)
                expect(payload.hasExplicitWorkspace).toBe(false)

                // Explicit --project / --workspace still overrides CWD
                const explicitPayload = buildEntryPayload(
                    { project: 15, tags: 'sqlite' },
                    {},
                    { projectRegistry: registry },
                    'Explicitly targeting db-mcp from core-platform CWD'
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
                    'Documented sqlite connection pooling rules inside core-platform',
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
                const stored = db.getEntryById(created.id, 'core-platform')
                expect(stored).not.toBeNull()
                expect(stored?.workspaceId).toBe('core-platform')
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

        it('createEntryFromFileInProcess persists a frontmatter journal file in-process without calling process.exit', async () => {
            const mdFile = path.join(tmpDir, 'in-process-commit.md')
            fs.writeFileSync(
                mdFile,
                [
                    '---',
                    'type: "technical_note"',
                    'tags: ["commit-narrative"]',
                    'workspace_id: "memory-journal-mcp"',
                    'project: 5',
                    'impact: 0.4',
                    'trust: 0.95',
                    'validation_status: "passed"',
                    '---',
                    'perf(commit): run journal entry creation in-process',
                ].join('\n'),
                'utf-8'
            )

            const savedConfigEnv = process.env['MEMORY_JOURNAL_CONFIG']
            const cfgFile = path.join(tmpDir, 'in-process-config.json')
            fs.writeFileSync(
                cfgFile,
                JSON.stringify({
                    db: dbPath,
                    projectRegistry: {
                        'memory-journal-mcp': { path: tmpDir, project_number: 5 },
                    },
                }),
                'utf-8'
            )
            process.env['MEMORY_JOURNAL_CONFIG'] = cfgFile
            try {
                stderrOutput = []
                const code = await createEntryFromFileInProcess({ file: mdFile })
                expect(code).toBe(0)
                expect(stderrOutput.join('')).toContain('Successfully created entry #')
            } finally {
                if (savedConfigEnv !== undefined) {
                    process.env['MEMORY_JOURNAL_CONFIG'] = savedConfigEnv
                } else {
                    delete process.env['MEMORY_JOURNAL_CONFIG']
                }
            }
        })

        it('createEntryFromFileInProcess returns exit code 1 when relationship linking fails', async () => {
            const mdFile = path.join(tmpDir, 'in-process-bad-link.md')
            fs.writeFileSync(
                mdFile,
                [
                    '---',
                    'type: "technical_note"',
                    'tags: ["commit-narrative"]',
                    'workspace_id: "memory-journal-mcp"',
                    'project: 5',
                    'related_to: [999999]',
                    '---',
                    'fix(cli): propagate non-zero exit code when relationship link fails',
                ].join('\n'),
                'utf-8'
            )

            const savedConfigEnv = process.env['MEMORY_JOURNAL_CONFIG']
            const savedExitCode = process.exitCode
            const cfgFile = path.join(tmpDir, 'in-process-bad-link-config.json')
            fs.writeFileSync(
                cfgFile,
                JSON.stringify({
                    db: dbPath,
                    projectRegistry: {
                        'memory-journal-mcp': { path: tmpDir, project_number: 5 },
                    },
                }),
                'utf-8'
            )
            process.env['MEMORY_JOURNAL_CONFIG'] = cfgFile
            try {
                stderrOutput = []
                const code = await createEntryFromFileInProcess({ file: mdFile })
                expect(code).toBe(1)
                expect(stderrOutput.join('')).toContain('linking to #999999 failed')
            } finally {
                process.exitCode = savedExitCode
                if (savedConfigEnv !== undefined) {
                    process.env['MEMORY_JOURNAL_CONFIG'] = savedConfigEnv
                } else {
                    delete process.env['MEMORY_JOURNAL_CONFIG']
                }
            }
        })

        it('createEntryFromFileInProcess returns exit code 1 on startup config errors without calling process.exit or mutating process.exitCode (Q-H1)', async () => {
            const mdFile = path.join(tmpDir, 'in-process-bad-config.md')
            fs.writeFileSync(
                mdFile,
                [
                    '---',
                    'type: "technical_note"',
                    'tags: ["commit-narrative"]',
                    'workspace_id: "memory-journal-mcp"',
                    'project: 5',
                    '---',
                    'fix(cli): return exit code 1 cleanly without process.exit on config error',
                ].join('\n'),
                'utf-8'
            )

            const savedConfigEnv = process.env['MEMORY_JOURNAL_CONFIG']
            const savedRegistryEnv = process.env['PROJECT_REGISTRY']
            const savedExitCode = process.exitCode
            process.exitCode = 0
            delete process.env['PROJECT_REGISTRY']
            const badCfgFile = path.join(tmpDir, 'duplicate-project-config.json')
            fs.writeFileSync(
                badCfgFile,
                JSON.stringify({
                    db: dbPath,
                    projectRegistry: {
                        'repo-a': { path: path.join(tmpDir, 'a'), project_number: 99 },
                        'repo-b': { path: path.join(tmpDir, 'b'), project_number: 99 },
                    },
                }),
                'utf-8'
            )
            process.env['MEMORY_JOURNAL_CONFIG'] = badCfgFile
            try {
                stderrOutput = []
                const code = await createEntryFromFileInProcess({ file: mdFile })
                expect(code).toBe(1)
                expect(exitSpy).not.toHaveBeenCalled()
                expect(process.exitCode).toBe(0)
                expect(stderrOutput.join('')).toContain('Startup Configuration Errors:')
            } finally {
                process.exitCode = savedExitCode
                if (savedConfigEnv !== undefined) {
                    process.env['MEMORY_JOURNAL_CONFIG'] = savedConfigEnv
                } else {
                    delete process.env['MEMORY_JOURNAL_CONFIG']
                }
                if (savedRegistryEnv !== undefined) {
                    process.env['PROJECT_REGISTRY'] = savedRegistryEnv
                } else {
                    delete process.env['PROJECT_REGISTRY']
                }
            }
        })

        it('createEntryFromFileInProcess fails fast with exit code 1 when options.file is blank (Q-L3)', async () => {
            stderrOutput = []
            const code = await createEntryFromFileInProcess({ file: '' })
            expect(code).toBe(1)
            expect(exitSpy).not.toHaveBeenCalled()
            expect(stderrOutput.join('')).toContain('non-empty --file path')
        })

        it('parses BOM/mixed-CRLF/EOF frontmatter, preserves non-blank workspace_id/project aliases, and fails fast on blank --file in parseContent (Q-M5, Q-M6, Q-M7)', async () => {
            // Q-M5: UTF-8 BOM + mixed CRLF/LF + EOF ---
            const bomParsed = parseFrontmatter('\uFEFF---\nworkspace_id: "sample-repo"\nproject: 16\n---\nHello')
            expect(bomParsed.frontmatter).toEqual({ workspace_id: 'sample-repo', project: 16 })
            expect(bomParsed.body).toBe('Hello')

            const mixedParsed = parseFrontmatter('---\r\nworkspace_id: "sample-repo"\r\n---\nBody line')
            expect(mixedParsed.frontmatter).toEqual({ workspace_id: 'sample-repo' })
            expect(mixedParsed.body).toBe('Body line')

            const eofParsed = parseFrontmatter('---\nworkspace_id: "sample-repo"\n---')
            expect(eofParsed.frontmatter).toEqual({ workspace_id: 'sample-repo' })
            expect(eofParsed.body).toBe('')

            // Q-M6: Empty string workspace / project must not shadow non-blank aliases
            const aliasPayload = buildEntryPayload(
                { project: '' as unknown as number },
                { workspace: '', workspace_id: 'custom-unreg-ws', project: 999 },
                { projectRegistry: {} }
            )
            expect(aliasPayload.workspaceId).toBe('custom-unreg-ws')
            expect(aliasPayload.projectNumber).toBe(999)

            // Q-M7: Blank --file in parseContent fails fast with ValidationError without waiting for stdin
            await expect(parseContent({ file: '' })).rejects.toThrow(ValidationError)
            await expect(parseContent({ file: '   ' })).rejects.toThrow(ValidationError)
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

        it('B-M1 & B-M2: resolveCliReadScope resolves registered project_number on --team reads and parseFrontmatter uses lazy matching before --- HR', async () => {
            const memDb = new DatabaseAdapter(':memory:')
            await memDb.initialize()
            try {
                const serverOpts = {
                    projectRegistry: {
                        'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
                    },
                }
                const resolved = resolveCliReadScope(memDb, serverOpts as never, {
                    team: true,
                    workspace: 'memory-journal-mcp',
                })
                expect(resolved).toEqual({ workspaceId: 'memory-journal-mcp', projectNumber: 5 })

                expect(() =>
                    resolveCliReadScope(memDb, serverOpts as never, {
                        team: true,
                        workspace: 'unregistered-ws',
                    })
                ).toThrow(/Missing project_number for --team read/i)
            } finally {
                memDb.close()
            }

            expect(parseFrontmatter('---\n---\nSection 1\n---\nSection 2')).toEqual({
                frontmatter: {},
                body: 'Section 1\n---\nSection 2',
            })
            expect(
                parseFrontmatter('---\n---\nworkspace_id: spoofed\n---\nSection 2')
            ).toEqual({
                frontmatter: {},
                body: 'workspace_id: spoofed\n---\nSection 2',
            })
            expect(parseFrontmatter('---\ntags: [a]\n---\nBody\n---\nMore')).toEqual({
                frontmatter: { tags: ['a'] },
                body: 'Body\n---\nMore',
            })
        })

        it('B-M1: entry update preserves persisted project_number when linking relationships in shared/unregistered workspaces', async () => {
            const cfgFile = path.join(tmpDir, 'mj-config.json')
            fs.writeFileSync(cfgFile, JSON.stringify({ projectRegistry: {} }), 'utf-8')

            const seedDb = new DatabaseAdapter(dbPath)
            await seedDb.initialize()
            try {
                const e1 = seedDb.createEntry({
                    content: 'Project 7 source entry',
                    entryType: 'technical_note',
                    workspaceId: 'shared-ws',
                    projectNumber: 7,
                })
                const e2 = seedDb.createEntry({
                    content: 'Project 8 target entry',
                    entryType: 'technical_note',
                    workspaceId: 'shared-ws',
                    projectNumber: 8,
                })
                const e3 = seedDb.createEntry({
                    content: 'Project 7 matching entry',
                    entryType: 'technical_note',
                    workspaceId: 'shared-ws',
                    projectNumber: 7,
                })
                expect(e1.id).toBe(1)
                expect(e2.id).toBe(2)
                expect(e3.id).toBe(3)
                seedDb.flushSave()
            } finally {
                seedDb.close()
            }

            const prevExitCode = process.exitCode
            try {
                // Omitting --project leaves payload.projectNumber undefined; update must still enforce row #1's persisted projectNumber (7)
                stdoutOutput = []
                process.exitCode = undefined
                await updateEntryAction(
                    {
                        db: dbPath,
                        config: cfgFile,
                        id: 1,
                        expectedVersion: 1,
                        workspace: 'shared-ws',
                        relatedTo: '2',
                        json: true,
                    },
                    dummyCmd
                )
                const crossProjectResult = JSON.parse(stdoutOutput.join('')) as {
                    status: string
                    entryPersisted?: boolean
                    linkFailures?: { target_id: number; error: string }[]
                }
                expect(process.exitCode).toBe(1)
                expect(crossProjectResult.status).toBe('partial')
                expect(crossProjectResult.entryPersisted).toBe(true)
                expect(crossProjectResult.linkFailures).toHaveLength(1)
                expect(crossProjectResult.linkFailures?.[0]?.target_id).toBe(2)
                expect(crossProjectResult.linkFailures?.[0]?.error).toContain('project #8')
                expect(crossProjectResult.linkFailures?.[0]?.error).toContain('project #7')

                // Same-project link (#1 -> #3, both project #7) succeeds
                stdoutOutput = []
                process.exitCode = undefined
                await updateEntryAction(
                    {
                        db: dbPath,
                        config: cfgFile,
                        id: 1,
                        expectedVersion: 2,
                        workspace: 'shared-ws',
                        relatedTo: '3',
                        json: true,
                    },
                    dummyCmd
                )
                const sameProjectResult = JSON.parse(stdoutOutput.join('')) as {
                    status: string
                    version: number
                }
                expect(process.exitCode).toBeUndefined()
                expect(sameProjectResult.status).toBe('success')
                expect(sameProjectResult.version).toBe(3)
            } finally {
                process.exitCode = prevExitCode
            }

            const verifyDb = new DatabaseAdapter(dbPath)
            await verifyDb.initialize()
            try {
                const rels = verifyDb.getRelationships(1, 'shared-ws')
                expect(rels.map((r) => r.toEntryId)).toEqual([3])
            } finally {
                verifyDb.close()
            }
        })

        it('rejects oversized/symlink/Win32-unsafe CLI input files, limits frontmatter size/aliases, and sanitizes config errors (SEC-H7, SEC-M4, SEC-M5)', async () => {
            const { readBoundedCliInputFile } = await import('../../src/cli/commands/cli-input-reader.js')
            const { getCliCommandDb } = await import('../../src/cli/commands/db-core.js')

            expect(() => readBoundedCliInputFile('   ', '--file')).toThrow(/non-empty/)
            expect(() => readBoundedCliInputFile('\\\\server\\share\\file.md', '--file')).toThrow(/Unsafe --file/)
            expect(() => readBoundedCliInputFile('C:\\temp\\bad.md:stream', '--file')).toThrow(/Unsafe --file/)
            expect(() => readBoundedCliInputFile('CON.txt', '--file')).toThrow(/Unsafe --file/)

            const bigFile = path.join(tmpDir, 'too-big.md')
            fs.writeFileSync(bigFile, 'x'.repeat(2048), 'utf-8')
            expect(() => readBoundedCliInputFile(bigFile, '--file', 1024)).toThrow(/exceeds maximum/)

            const targetFile = path.join(tmpDir, 'real.md')
            const symFile = path.join(tmpDir, 'link.md')
            fs.writeFileSync(targetFile, 'hello\n', 'utf-8')
            let linked = false
            try {
                fs.symlinkSync(targetFile, symFile, 'file')
                linked = true
            } catch {
                // Developer Mode disabled
            }
            if (linked) {
                expect(() => readBoundedCliInputFile(symFile, '--file')).toThrow(/non-symlink/)
                await expect(parseContent({ file: symFile })).rejects.toThrow(/non-symlink/)
            }

            // SEC-M4: oversized frontmatter (> 64 KiB) throws ValidationError
            const hugeFm = `---\ntitle: "${'a'.repeat(70_000)}"\n---\nBody`
            expect(() => parseFrontmatter(hugeFm)).toThrow(/maximum size/i)

            // SEC-M4: CLI_CREATE_SCOPE_SCHEMA rejects >255-char workspace_id
            await expect(
                createEntryAction(
                    {
                        db: dbPath,
                        workspace: 'w'.repeat(260),
                        project: 5,
                        content: 'Overlong workspace',
                    },
                    dummyCmd
                )
            ).rejects.toThrow('PROCESS_EXIT_1')

            // SEC-M5: getCliCommandDb redacts bearer/secrets in startup configuration errors
            const badConfigCmd = new Command('serve')
            await expect(
                getCliCommandDb(
                    { config: path.join(tmpDir, 'missing.json'), authToken: 'Bearer secret_leak_tok' } as never,
                    badConfigCmd,
                    { throwOnExit: true }
                ).catch((e: unknown) => {
                    expect(stderrOutput.join('')).not.toContain('secret_leak_tok')
                    throw e
                })
            ).rejects.toBeDefined()

            // Pass 2: assertSafeCliDir and assertSafeCliOutputFile reject UNC/ADS/device paths before lstat
            const { assertSafeCliDir, assertSafeCliOutputFile } = await import(
                '../../src/cli/commands/db-helper.js'
            )
            await expect(assertSafeCliDir('\\\\nonexistent-smb\\share\\dir', 'export')).rejects.toThrow(
                /Unsafe --dir/
            )
            await expect(
                assertSafeCliOutputFile('\\\\nonexistent-smb\\share\\out.json', '--out')
            ).rejects.toThrow(/Unsafe --out/)
        })

        it('maps --summary to title without clobbering content, propagates root --json, and enforces 1..50000 content bounds (M1, M2, M3)', async () => {
            const { applyCliEntryFlagAliases, CLI_MAX_CONTENT_LENGTH, validateCliEntryContent } =
                await import('../../src/cli/commands/entry-payload-helpers.js')
            const { createProgram, withValidation } = await import('../../src/cli/program.js')
            const { outputOptionsSchema } = await import('../../src/cli/schemas.js')

            // M1: --summary acts strictly as --title alias without setting options.content
            const summaryOpts: Record<string, unknown> = { summary: 'Release Notes' }
            applyCliEntryFlagAliases(summaryOpts as never)
            expect(summaryOpts['title']).toBe('Release Notes')
            expect(summaryOpts['content']).toBeUndefined()

            // M2: root --json before subcommand propagates via withValidation when subcommand accepts --json
            const prog = createProgram()
            prog.option('--json', 'JSON output')
            let receivedJson: boolean | undefined
            const subCmd = prog
                .command('probe')
                .option('--json', 'Subcommand JSON output')
                .action(
                    withValidation(outputOptionsSchema, (opts: { json?: boolean }) => {
                        receivedJson = opts.json
                    })
                )
            await prog.parseAsync(['node', 'cli.js', '--json', 'probe'])
            expect(subCmd.name()).toBe('probe')
            expect(receivedJson).toBe(true)

            // M3: direct bounds validator + CLI entry create/update reject empty and >50,000-char content
            expect(() => validateCliEntryContent('')).toThrow(ValidationError)
            expect(() => validateCliEntryContent('   \n\t  ')).toThrow(ValidationError)
            expect(() => validateCliEntryContent('x'.repeat(CLI_MAX_CONTENT_LENGTH + 1))).toThrow(
                ValidationError
            )

            await expect(
                createEntryAction(
                    {
                        db: dbPath,
                        workspace: 'cli-bounds-ws',
                        project: 5,
                        content: '',
                    },
                    dummyCmd
                )
            ).rejects.toThrow('PROCESS_EXIT_1')
            expect(stderrOutput.join('')).toContain('cannot be empty')

            await createEntryAction(
                {
                    db: dbPath,
                    workspace: 'cli-bounds-ws',
                    project: 5,
                    content: 'Valid seed entry',
                },
                dummyCmd
            )
            await expect(
                updateEntryAction(
                    {
                        db: dbPath,
                        id: 1,
                        expectedVersion: 1,
                        content: 'x'.repeat(CLI_MAX_CONTENT_LENGTH + 1),
                    } as never,
                    dummyCmd
                )
            ).rejects.toThrow('PROCESS_EXIT_1')
            expect(stderrOutput.join('')).toContain('exceeds maximum length')
        })
    })
})
