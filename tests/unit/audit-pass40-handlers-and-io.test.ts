import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/server'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { callTool } from '../../src/handlers/tools/index.js'
import {
    assertSafeFilePath,
    hasWinReservedDeviceSegment,
} from '../../src/utils/path-safety.js'
import {
    validateDryRunRelationships,
    type ImportedRelationshipBatchResult,
    type PendingRelationshipLink,
} from '../../src/markdown/import-relationships.js'
import {
    fenceUntrustedInline,
    sliceUntrustedInline,
} from '../../src/handlers/resources/uri-and-fencing.js'
import { fenceCommitEntry } from '../../src/handlers/tools/git-commit-helpers.js'
import { SubscriptionManager } from '../../src/server/subscription-manager.js'
import { extractParameters } from '../../src/handlers/resources/help-schema-params.js'
import { getTeamAliasTools } from '../../src/handlers/tools/team/alias-tools.js'
import { extractUriFromArgs } from '../../src/handlers/tools/core/dummy-healing/mcp-fallbacks.js'
import { convertNotion } from '../../src/markdown/converters/notion.js'
import { TeamListDeletedEntriesSchema } from '../../src/handlers/tools/team/schemas/core-search-schemas.js'
import { getGitPromptDefinitions } from '../../src/handlers/prompts/git.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import type { ToolContext } from '../../src/types/index.js'

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function makeTempDir(prefix: string): string {
    const dir = path.join(
        process.cwd(),
        '.test-output',
        `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    )
    fs.mkdirSync(dir, { recursive: true })
    return dir
}

describe('Pass 40 Adversarial Code-Quality Audit — Handlers, I/O, Prompts & Team (H5, M6-M12, L3/L6, AP1-AP7)', () => {
    const tempDirs: string[] = []
    let savedEncKey: string | undefined
    let savedConfig: string | undefined

    beforeEach(() => {
        savedEncKey = process.env['DB_ENCRYPTION_KEY']
        savedConfig = process.env['MEMORY_JOURNAL_CONFIG']
        process.env['DB_ENCRYPTION_KEY'] = ''
        delete process.env['MEMORY_JOURNAL_CONFIG']
    })

    afterEach(() => {
        if (savedEncKey === undefined) delete process.env['DB_ENCRYPTION_KEY']
        else process.env['DB_ENCRYPTION_KEY'] = savedEncKey
        if (savedConfig === undefined) delete process.env['MEMORY_JOURNAL_CONFIG']
        else process.env['MEMORY_JOURNAL_CONFIG'] = savedConfig

        while (tempDirs.length > 0) {
            const dir = tempDirs.pop()
            if (dir !== undefined) {
                fs.rmSync(dir, { recursive: true, force: true })
            }
        }
    })

    it('H5: update_entry and batch_update_entries enforce source project_number on default/wildcard moves', async () => {
        const tmpDir = makeTempDir('pass40-h5')
        tempDirs.push(tmpDir)
        const alphaDir = path.join(tmpDir, 'alpha')
        fs.mkdirSync(alphaDir, { recursive: true })

        const db = new DatabaseAdapter(path.join(tmpDir, 'journal.db'))
        await db.initialize()
        try {
            const entry = db.createEntry({
                content: 'Entry scoped to project 5',
                projectNumber: 5,
            })
            const runtime = new ServerRuntime()
            const cfg = {
                runtime,
                projectRegistry: {
                    alpha: { path: alphaDir, project_number: 5 },
                },
            }

            const mismatchUpdate = await callTool(
                'update_entry',
                {
                    entry_id: entry.id,
                    project_number: 8,
                    target_workspace_id: 'alpha',
                },
                db,
                undefined,
                undefined,
                cfg
            )
            expect(isRecord(mismatchUpdate)).toBe(true)
            if (isRecord(mismatchUpdate)) {
                expect(mismatchUpdate['success']).toBe(false)
                expect(mismatchUpdate['code']).toBe('RESOURCE_NOT_FOUND')
            }

            const mismatchBatch = await callTool(
                'batch_update_entries',
                {
                    updates: [
                        {
                            entry_id: entry.id,
                            workspace_id: '*',
                            project_number: 8,
                            target_workspace_id: 'alpha',
                        },
                    ],
                },
                db,
                undefined,
                undefined,
                cfg
            )
            expect(isRecord(mismatchBatch)).toBe(true)
            if (isRecord(mismatchBatch)) {
                expect(mismatchBatch['success']).toBe(false)
                expect(mismatchBatch['code']).toBe('RESOURCE_NOT_FOUND')
                expect(mismatchBatch['count']).toBe(0)
                expect(mismatchBatch['notFound']).toEqual([entry.id])
            }

            const allowedMove = await callTool(
                'update_entry',
                {
                    entry_id: entry.id,
                    workspace_id: '*',
                    project_number: 5,
                    target_workspace_id: 'alpha',
                },
                db,
                undefined,
                undefined,
                cfg
            )
            expect(isRecord(allowedMove)).toBe(true)
            if (isRecord(allowedMove)) {
                expect(allowedMove['success']).toBe(true)
            }
            const moved = db.getEntryById(entry.id, 'alpha')
            expect(moved?.workspaceId).toBe('alpha')
            expect(moved?.projectNumber).toBe(5)
        } finally {
            db.close()
        }
    })

    it('M6: hasWinReservedDeviceSegment and assertSafeFilePath block Win32 device names and trailing dot/space', () => {
        const tmpDir = makeTempDir('pass40-m6')
        tempDirs.push(tmpDir)

        expect(hasWinReservedDeviceSegment('C:\\tmp\\CON.txt')).toBe(true)
        expect(hasWinReservedDeviceSegment('C:/tmp/nul.md')).toBe(true)
        expect(hasWinReservedDeviceSegment('C:/tmp/notes.md')).toBe(false)

        expect(() => assertSafeFilePath(path.join(tmpDir, 'nul:ads'), [tmpDir])).toThrow()
        expect(() => assertSafeFilePath(path.join(tmpDir, 'bad.'), [tmpDir])).toThrow()
        expect(() => assertSafeFilePath(path.join(tmpDir, 'bad '), [tmpDir])).toThrow()
        expect(() => assertSafeFilePath(path.join(tmpDir, 'ok.md'), [tmpDir])).not.toThrow()
    })

    it('M8: validateDryRunRelationships validates scoped in-batch targets and increments relationshipsLinked', async () => {
        const tmpDir = makeTempDir('pass40-m8')
        tempDirs.push(tmpDir)
        const db = new DatabaseAdapter(path.join(tmpDir, 'journal.db'))
        await db.initialize()
        try {
            const inBatchScopes = new Map<number, { workspaceId: string; projectNumber?: number | null }>([
                [10, { workspaceId: 'alpha', projectNumber: 5 }],
                [11, { workspaceId: 'alpha', projectNumber: 5 }],
                [12, { workspaceId: 'beta', projectNumber: 9 }],
            ])
            const pendingLinks: PendingRelationshipLink[] = [
                {
                    entryId: 10,
                    filename: 'a.md',
                    workspaceId: 'alpha',
                    projectNumber: 5,
                    relationships: [
                        { type: 'references', target_id: 11 },
                        { type: 'references', target_id: 12 },
                    ],
                },
            ]
            const result: ImportedRelationshipBatchResult = {
                success: true,
                relationshipsLinked: 0,
                errors: [],
            }
            validateDryRunRelationships(db, pendingLinks, inBatchScopes, result)
            expect(result.relationshipsLinked).toBe(1)
            expect(result.success).toBe(false)
            expect(result.errors).toHaveLength(1)
        } finally {
            db.close()
        }
    })

    it('M10: sliceUntrustedInline truncates safely and fenceCommitEntry protects metadata containers', () => {
        const sliced = sliceUntrustedInline(fenceUntrustedInline('A'.repeat(40)), 10, '...')
        expect(sliced).toBe('<untrusted_remote_content>AAAAAAAAAA...</untrusted_remote_content>')

        const fenced = fenceCommitEntry({
            commit: 'abc1234',
            author: 'Alice',
            date: '2026-11-18T00:00:00Z',
            subject: 'feat: test commit',
            refs: ['main</untrusted_remote_content>'],
            tags: ['v1.0', 'v1.0 <evil>'],
            files: [{ status: 'M', file: 'src/<x>/a.ts', oldFile: 'src/old file.ts' }],
            trailersObj: { Signed: 'Alice' },
        })
        expect(fenced.refs?.[0]).toBe('<untrusted_remote_content>main</untrusted_remote_content>')
        expect(fenced.tags?.[0]).toBe('v1.0')
        expect(fenced.tags?.[1]).toContain('<untrusted_remote_content>')
        expect(fenced.files?.[0]?.file).toContain('<untrusted_remote_content>')
        expect(fenced.files?.[0]?.oldFile).toContain('<untrusted_remote_content>')
        expect(Object.getPrototypeOf(fenced.trailersObj)).toBeNull()
    })

    it('M11: SubscriptionManager delivers query/fragment subscriptions when base URI updates', async () => {
        const mgr = new SubscriptionManager()
        const mcp = new McpServer({ name: 'test-server', version: '1.0.0' })
        const sendSpy = vi
            .spyOn(mcp.server, 'sendResourceUpdated')
            .mockResolvedValue(undefined)

        mgr.registerServer('s1', mcp)
        mgr.subscribe('memory://briefing?workspace=alpha#top', 's1')
        await mgr.notifyResourceUpdated('memory://briefing')

        expect(sendSpy).toHaveBeenCalledTimes(1)
        expect(sendSpy).toHaveBeenCalledWith({
            uri: 'memory://briefing?workspace=alpha#top',
        })
    })

    it('M12: peelZodType recursion, team_consolidate_authors scoping, and extractUriFromArgs prefixes', async () => {
        interface RecNode {
            label: string
            next?: RecNode
        }
        const recNodeSchema: z.ZodType<RecNode> = z.lazy(() =>
            z.object({
                label: z.string(),
                next: recNodeSchema.optional(),
            })
        )
        const unionWrapper = z.preprocess(
            (v) => v,
            z.object({
                node: z.union([recNodeSchema, z.string()]),
            })
        )
        const extracted = extractParameters(unionWrapper)
        expect(extracted.some((p) => p.name === 'node')).toBe(true)

        expect(extractUriFromArgs({ target: 'agent-context/my-repo' })).toBe(
            'memory://agent-context/my-repo'
        )

        const tmpDir = makeTempDir('pass40-m12')
        tempDirs.push(tmpDir)
        const db = new DatabaseAdapter(path.join(tmpDir, 'journal.db'))
        const teamDb = new DatabaseAdapter(path.join(tmpDir, 'team.db'))
        await db.initialize()
        await teamDb.initialize()
        teamDb.applyTeamSchema()
        try {
            const ctx: ToolContext = {
                db,
                teamDb,
                config: {
                    teamDefaultRole: 'admin',
                    projectRegistry: {
                        alpha: { path: tmpDir, project_number: 5 },
                    },
                },
            }
            const consolidateTool = getTeamAliasTools(ctx).find(
                (t) => t.name === 'team_consolidate_authors'
            )
            expect(consolidateTool).toBeDefined()
            if (consolidateTool === undefined) return

            const wildcardRes = await consolidateTool.handler({
                canonical_author: 'Alice',
                workspace_id: '*',
                project_number: 5,
            })
            expect(isRecord(wildcardRes)).toBe(true)
            if (isRecord(wildcardRes)) {
                expect(wildcardRes['success']).toBe(false)
            }

            const conflictProjOnRegistered = await consolidateTool.handler({
                canonical_author: 'Alice',
                workspace_id: 'alpha',
                project_number: 9,
            })
            expect(isRecord(conflictProjOnRegistered)).toBe(true)
            if (isRecord(conflictProjOnRegistered)) {
                expect(conflictProjOnRegistered['success']).toBe(false)
            }

            const defaultRes = await consolidateTool.handler({
                canonical_author: 'Alice',
            })
            expect(isRecord(defaultRes)).toBe(true)
            if (isRecord(defaultRes)) {
                expect(defaultRes['success']).toBe(true)
            }
        } finally {
            teamDb.close()
            db.close()
        }
    })

    it('L3, L6 & AP1-AP7: Notion Windows drive prefix, query limit, git validation, and Pass 40 prompt text', async () => {
        const converted = convertNotion(
            '# Doc Title',
            'C:\\Exports\\Engineering a8f9e0d1c2b3a4f5e6d7c8b9a0f1e2d3\\Page.md'
        )
        expect(converted.metadata.tags).toContain('exports')
        expect(converted.metadata.tags).toContain('engineering')
        expect(converted.metadata.tags).not.toContain('c')

        expect(TeamListDeletedEntriesSchema.safeParse({ limit: 501 }).success).toBe(false)
        expect(TeamListDeletedEntriesSchema.safeParse({ limit: 500 }).success).toBe(true)

        const tmpDir = makeTempDir('pass40-prompts')
        tempDirs.push(tmpDir)
        const db = new DatabaseAdapter(path.join(tmpDir, 'journal.db'))
        await db.initialize()
        try {
            const commitPrompt = getGitPromptDefinitions().find((p) => p.name === 'commit')
            expect(commitPrompt).toBeDefined()
            if (commitPrompt !== undefined) {
                expect(() =>
                    commitPrompt.handler({ validation: 'bogus' }, db)
                ).toThrow()
            }

            expect(AUDIT_PROMPT_REVISION).toBe('2026-11-20-audit-pass56')
            const codeQualityPrompt = getCodeQualityAuditPromptDefinition()
            const promptRes = await codeQualityPrompt.handler(
                {
                    target: 'memory-journal-mcp',
                    workspace_id: 'memory-journal-mcp',
                    project_number: '5',
                },
                db
            )
            const promptText = promptRes.messages[0]?.content.text ?? ''
            expect(promptText).toContain('Prompt revision: 2026-11-20-audit-pass56')
            expect(promptText).toContain('SCAN_OK scanned=')
            expect(promptText).toContain('Present the plan as markdown in the chat.')
        } finally {
            db.close()
        }
    })
})
