/**
 * Pass 29 Adversarial Code-Quality Audit — Handlers, Schemas, CLI, Resources & Prompts Regressions
 * Covers H12-H17, M11-M12, AP1-AP5, and GitHub prompt validation hardening.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { z } from 'zod'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Command } from 'commander'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ValidationError } from '../../src/types/errors.js'
import { UpdateEntrySchema } from '../../src/handlers/tools/admin/schemas/crud-batch-schemas.js'
import { CreateEntrySchema } from '../../src/handlers/tools/core/schemas.js'
import { MAX_CONTENT_LENGTH } from '../../src/handlers/tools/schemas/constants-and-primitives.js'
import { importMarkdownEntries } from '../../src/markdown/importer.js'
import { isSafeUserRegex } from '../../src/handlers/tools/core/dummy-healing/directory-search.js'
import { getGitTools } from '../../src/handlers/tools/git.js'
import { resolveOwnerRepo } from '../../src/handlers/tools/github/helpers.js'
import { importExternalAction } from '../../src/cli/commands/io.js'
import {
    fenceUntrustedInline,
    sliceUntrustedInline,
    DEFAULT_BRIEFING_CONFIG,
} from '../../src/handlers/resources/shared.js'
import {
    extractParameters,
    peelZodType,
} from '../../src/handlers/resources/help-schema-params.js'
import { getGitHubPromptDefinitions } from '../../src/handlers/prompts/github.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import type { ToolContext } from '../../src/types/index.js'

describe('Pass 29 Handler, Schema, CLI, Resource & Prompt Regressions', () => {
    let db: DatabaseAdapter
    let tmpDir: string

    beforeEach(async () => {
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass29-cli-'))
    })

    afterEach(() => {
        db.close()
        vi.restoreAllMocks()
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('H12: enforces MAX_CONTENT_LENGTH in UpdateEntrySchema and markdown importer', async () => {
        const tooLong = 'x'.repeat(MAX_CONTENT_LENGTH + 1)
        expect(UpdateEntrySchema.safeParse({ entry_id: 1, content: tooLong }).success).toBe(false)

        const mdPath = path.join(tmpDir, 'oversized.md')
        fs.writeFileSync(
            mdPath,
            `---\nentry_type: technical_note\nworkspace_id: memory-journal-mcp\nproject_number: 5\n---\n\n${tooLong}`,
            'utf8'
        )
        const result = await importMarkdownEntries(
            tmpDir,
            db,
            {
                workspaceId: 'memory-journal-mcp',
                project_number: 5,
            },
            undefined,
            [tmpDir]
        )
        expect(result.created).toBe(0)
        expect(result.errors.length).toBeGreaterThan(0)
    })

    it('H13: isSafeUserRegex rejects ReDoS nested quantifiers, backreferences, and over-long patterns', () => {
        expect(isSafeUserRegex('(a+)+$')).toBe(false)
        expect(isSafeUserRegex('([a-zA-Z]+)*')).toBe(false)
        expect(isSafeUserRegex('(\\w+)\\1')).toBe(false)
        expect(isSafeUserRegex('a'.repeat(300))).toBe(false)
        expect(isSafeUserRegex('feat|fix\\(auth\\)')).toBe(true)
    })

    it('H14: check_entry_staleness rejects malformed entry_id values instead of scanning all workspaces', async () => {
        const stalenessTool = getGitTools({ db, config: {} }).find(
            (t) => t.name === 'check_entry_staleness'
        )
        expect(stalenessTool).toBeDefined()

        const badRes = (await stalenessTool?.handler({ entry_id: 'not-an-int' })) as {
            success: boolean
        }
        expect(badRes.success).toBe(false)

        const zeroRes = (await stalenessTool?.handler({ entry_id: 0 })) as { success: boolean }
        expect(zeroRes.success).toBe(false)
    })

    it('H15: resolveOwnerRepo refuses to pair a foreign owner with the local CWD repository name', async () => {
        const fakeGithub = {
            isApiAvailable: vi.fn().mockReturnValue(true),
            getRepoInfo: vi.fn().mockResolvedValue({ owner: 'local-owner', repo: 'local-repo' }),
            getCachedRepoInfo: vi
                .fn()
                .mockReturnValue({ owner: 'local-owner', repo: 'local-repo' }),
        } as unknown as ToolContext['github']

        const res = await resolveOwnerRepo(
            {
                db,
                config: {},
                ...(fakeGithub !== undefined ? { github: fakeGithub } : {}),
            },
            { owner: 'foreign-owner' }
        )
        expect('error' in res).toBe(true)
        if ('error' in res) {
            expect(res.response['code']).toBe('CONFIGURATION_ERROR')
        }
    })

    it('M11: CLI importExternalAction rejects oversized (>5 MB) import files and null-byte directories', async () => {
        const savedDb = process.env['DB_PATH']
        const savedMjKey = process.env['MJ_DB_ENCRYPTION_KEY']
        const savedDbKey = process.env['DB_ENCRYPTION_KEY']
        const savedExitCode = process.exitCode
        const cliDbPath = path.join(tmpDir, 'cli.db')
        process.env['DB_PATH'] = cliDbPath
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''

        const stdoutChunks: string[] = []
        const stderrChunks: string[] = []
        const stdoutSpy = vi
            .spyOn(process.stdout, 'write')
            .mockImplementation((chunk: string | Uint8Array) => {
                stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
                return true
            })
        const stderrSpy = vi
            .spyOn(process.stderr, 'write')
            .mockImplementation((chunk: string | Uint8Array) => {
                stderrChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
                return true
            })
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
            throw new Error('PROCESS_EXIT')
        }) as () => never)

        try {
            const extDir = path.join(tmpDir, 'ext')
            fs.mkdirSync(extDir, { recursive: true })
            fs.writeFileSync(path.join(extDir, 'huge.md'), 'A'.repeat(5 * 1024 * 1024 + 128), 'utf8')

            const dummyCmd = new Command('import')
            vi.spyOn(dummyCmd, 'optsWithGlobals').mockReturnValue({
                database: cliDbPath,
            })

            await importExternalAction({ dir: extDir, format: 'obsidian' }, dummyCmd)
            expect(process.exitCode).toBe(1)
            expect(stdoutChunks.join('')).toContain('exceeds maximum allowed')

            await expect(
                importExternalAction({ dir: 'bad\0dir', format: 'obsidian' }, dummyCmd)
            ).rejects.toThrow('PROCESS_EXIT')
            expect(stderrChunks.join('')).toContain('null bytes')
        } finally {
            stdoutSpy.mockRestore()
            stderrSpy.mockRestore()
            exitSpy.mockRestore()
            process.exitCode = savedExitCode
            if (savedDb !== undefined) process.env['DB_PATH'] = savedDb
            else delete process.env['DB_PATH']
            if (savedMjKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedMjKey
            else delete process.env['MJ_DB_ENCRYPTION_KEY']
            if (savedDbKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbKey
            else delete process.env['DB_ENCRYPTION_KEY']
        }
    })

    it('H17: fenceUntrustedInline is idempotent and sliceUntrustedInline truncates before wrapping', () => {
        const once = fenceUntrustedInline('remote text')
        expect(once).toContain('<untrusted_remote_content>')
        expect(once).toContain('</untrusted_remote_content>')
        expect(fenceUntrustedInline(once)).toBe(once)

        const sliced = sliceUntrustedInline('0123456789ABCDEFGH', 10, '...')
        expect(sliced).toBe('<untrusted_remote_content>0123456789...</untrusted_remote_content>')
        expect(sliceUntrustedInline(once, 6)).toBe('<untrusted_remote_content>remote</untrusted_remote_content>')
    })

    it('M12: help-schema-params unwraps Zod 4 pipes, prefaults, and outer descriptions cleanly', () => {
        const schema = z
            .object({
                title: z.string().min(1).describe('Title description'),
                limit: z
                    .number()
                    .int()
                    .prefault(10)
                    .refine((n) => n > 0)
                    .transform((n) => n)
                    .describe('Result limit'),
            })
            .refine((d) => d.title.length > 0)

        const params = extractParameters(schema)
        expect(params).toEqual([
            { name: 'title', type: 'string', required: true, description: 'Title description' },
            { name: 'limit', type: 'number', required: false, description: 'Result limit' },
        ])

        const defObj = schema.shape.limit._def as unknown as Record<string, unknown>
        const peeled = peelZodType(defObj, schema.shape.limit as unknown as Record<string, unknown>)
        expect(peeled.typeName).toBe('number')
        expect(peeled.isOptional).toBe(true)
        expect(peeled.description).toBe('Result limit')
    })

    it('validates GitHub prompt arguments and skips ambiguous or default-workspace project fallbacks', () => {
        const prompts = getGitHubPromptDefinitions()
        const issueCommander = prompts.find((p) => p.name === 'issue-commander')
        const prCommander = prompts.find((p) => p.name === 'pr-commander')
        expect(issueCommander).toBeDefined()
        expect(prCommander).toBeDefined()

        const defaultWsRes = issueCommander?.handler({}, db, undefined, undefined, {
            ...DEFAULT_BRIEFING_CONFIG,
            defaultWorkspaceId: 'default',
            defaultProjectNumber: 5,
        }) as { messages: { content: { text: string } }[] }
        expect(defaultWsRes.messages[0]?.content.text).toContain('Project #{project_number}')

        const conflictRegistryRes = issueCommander?.handler({}, db, undefined, undefined, {
            ...DEFAULT_BRIEFING_CONFIG,
            defaultWorkspaceId: 'repo-a',
            defaultProjectNumber: 5,
            projectRegistry: {
                'repo-a': { path: '/a', project_number: 1 },
            },
        }) as { messages: { content: { text: string } }[] }
        expect(conflictRegistryRes.messages[0]?.content.text).toContain('Project #{project_number}')

        expect(() =>
            issueCommander?.handler({ project_number: 'not-int' }, db)
        ).toThrow(ValidationError)
        expect(() =>
            issueCommander?.handler({ workflow_type: 'drop-table' }, db)
        ).toThrow(ValidationError)
        expect(() =>
            prCommander?.handler({ workflow_type: 'invalid-wf' }, db)
        ).toThrow(ValidationError)
    })

    it('AP1-AP5: code-quality audit prompt uses Pass 29 revision, bench exclusions, factory clarity, and end-to-end backstop rules', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-21-audit-pass63')
        const prompt = getCodeQualityAuditPromptDefinition()
        const res = (await prompt.handler({}, db)) as { messages: { content: { text: string } }[] }
        const text = res.messages[0]?.content.text ?? ''
        expect(text).toContain('*.bench.*')
        expect(text).toContain('src/vendor')
        expect(text).toContain('Zero Critical/High findings is valid when backstops hold.')
        expect(text).toContain('never sliced inside `<untrusted_remote_content>` wrapper tags')
        expect(text).toContain('by tag `code-quality-audit` (not by a hybrid search) in `readonly: true` mode')
    })

    it('CMS-04: heals object-wrapped anchors ({ files: [...] }) and filesystem path repo slugs in GitHub tools', async () => {
        const parsed = CreateEntrySchema.safeParse({
            workspace_id: 'db-mcp',
            project_number: 15,
            entry_type: 'bug_fix',
            content: 'Fixed validation bug',
            anchors: {
                files: ['src/adapters/sqlite/schemas/json/admin.ts', 'tests/api.test.ts#L10'],
            },
        })
        expect(parsed.success).toBe(true)
        if (parsed.success) {
            expect(parsed.data.anchors).toEqual([
                {
                    anchor_path: 'src/adapters/sqlite/schemas/json/admin.ts',
                    anchor_type: 'file',
                    status: 'pending',
                },
                {
                    anchor_path: 'tests/api.test.ts#L10',
                    anchor_type: 'symbol',
                    status: 'pending',
                },
            ])
        }

        const fakeGithub = {
            isApiAvailable: vi.fn().mockReturnValue(true),
            getRepoInfo: vi
                .fn()
                .mockResolvedValue({ owner: 'neverinfamous', repo: 'memory-journal-mcp' }),
            getCachedRepoInfo: vi
                .fn()
                .mockReturnValue({ owner: 'neverinfamous', repo: 'memory-journal-mcp' }),
        } as unknown as ToolContext['github']

        const resolved = await resolveOwnerRepo(
            {
                db,
                config: {
                    projectRegistry: {
                        'memory-journal-mcp': {
                            path: '',
                            project_number: 5,
                        },
                    },
                },
                ...(fakeGithub !== undefined ? { github: fakeGithub } : {}),
            },
            {
                workspace_id: 'memory-journal-mcp',
                project_number: 5,
                repo: '/repos/memory-journal-mcp',
            }
        )
        expect('error' in resolved).toBe(false)
        if (!('error' in resolved)) {
            expect(resolved.repo).toBe('memory-journal-mcp')
            expect(resolved.owner).toBe('neverinfamous')
        }
    })
})
