/**
 * Pass 30 Adversarial Quality, Prompts & Appendix B Regression Suite
 * Covers M1-M12, L1-L7, AP1-AP6, and decomposed Appendix B complexity functions.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ValidationError } from '../../src/types/errors.js'
import { callTool, getTools } from '../../src/handlers/tools/index.js'
import { requireAnyScope } from '../../src/auth/middleware.js'
import { extractParameters } from '../../src/handlers/resources/help-schema-params.js'
import { getZodTypeString } from '../../src/codemode/type-generator.js'
import { GitAnalyzePatternsOptionsSchema } from '../../src/handlers/tools/git-schemas.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import { exportEntriesToMarkdown } from '../../src/markdown/exporter.js'
import { applyEntryAndSearchInterceptions } from '../../src/codemode/normalizers/entry-and-search-interceptions.js'
import { extractAndRecoverEntryCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { executeBatchUpdateEntries } from '../../src/handlers/tools/admin/batch-update-helpers.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { getPrompt } from '../../src/handlers/prompts/index.js'
import { buildPlanReviewPriorContextSection } from '../../src/handlers/prompts/adversarial-helpers.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { encodeCursor } from '../../src/database/sqlite-adapter/entries/search/cursor.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { runWithAuthContext } from '../../src/auth/auth-context.js'
import { SCOPES } from '../../src/auth/scopes.js'
import type { ToolContext } from '../../src/types/index.js'

describe('Pass 30 Quality, Prompts & Appendix B Regressions', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter
    let tmpDir: string

    beforeEach(async () => {
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
        await teamDb.applyTeamSchema()
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass30-qual-'))
    })

    afterEach(() => {
        db.close()
        teamDb.close()
        vi.restoreAllMocks()
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('M1: introspects Zod 4 Pipe, Literal, Record, Tuple, and Intersection schemas accurately', () => {
        const piped = z.object({ count: z.coerce.number().optional() }).transform((v) => v)
        const extracted = extractParameters(piped)
        expect(extracted.some((p) => p.name === 'count')).toBe(true)

        expect(getZodTypeString(z.literal('active'))).toBe("'active'")
        expect(getZodTypeString(z.record(z.string(), z.number()))).toBe('Record<string, number>')
        expect(getZodTypeString(z.tuple([z.string(), z.number()]))).toBe('[string, number]')
        expect(getZodTypeString(z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })))).toContain('&')
    })

    it('M2, M3 & M4: accepts max_count git alias, rejects FTS keyset cursor, and deduplicates cross-project rows', () => {
        const parsed = GitAnalyzePatternsOptionsSchema.parse({ max_count: 15 })
        expect(parsed.max_count).toBe(15)

        expect(() =>
            db.searchEntries('hello', {
                cursor: encodeCursor({ t: '2026-01-01T00:00:00.000Z', id: 1 }),
            })
        ).toThrow(ValidationError)

        const root = db.createEntry({ content: 'Root node', workspaceId: 'memory-journal-mcp', projectNumber: 5, tags: ['shared'] })
        const left = db.createEntry({ content: 'Left node', workspaceId: 'memory-journal-mcp', projectNumber: 5, tags: ['shared'] })
        const right = db.createEntry({ content: 'Right node', workspaceId: 'memory-journal-mcp', projectNumber: 5, tags: ['shared'] })
        const leaf = db.createEntry({ content: 'Leaf node', workspaceId: 'memory-journal-mcp', projectNumber: 5, tags: ['shared'] })
        db.linkEntries(root.id, left.id, 'references', undefined, 'memory-journal-mcp')
        db.linkEntries(root.id, right.id, 'references', undefined, 'memory-journal-mcp')
        db.linkEntries(left.id, leaf.id, 'references', undefined, 'memory-journal-mcp')
        db.linkEntries(right.id, leaf.id, 'references', undefined, 'memory-journal-mcp')
        const graph = db.visualizeRelationships({
            entryId: root.id,
            depth: 2,
            limit: 10,
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
        })
        const nodeIds = graph.nodes.map((n) => n.id)
        expect(new Set(nodeIds).size).toBe(nodeIds.length)
        expect(nodeIds).toContain(leaf.id)
    })

    it('M6 & L3: tracks VectorSearchManager ready flag cleanly on failure and unref-free startup', async () => {
        vi.spyOn(db, 'createVecTable').mockImplementation(() => {
            throw new Error('vec failed')
        })
        const manager = new VectorSearchManager(db)
        manager.generateEmbedding = (): Promise<Float32Array> =>
            Promise.resolve(new Float32Array([0.1, 0.2, 0.3, 0.4]))
        expect(manager.isInitialized()).toBe(false)
        await expect(manager.initialize()).rejects.toThrow('vec failed')
        expect(manager.isInitialized()).toBe(false)
        expect(manager.getDimensions()).toBeNull()
    })

    it('M9 & M10: marks team_merge_tags destructive and blocks unsafe markdown export traversal', async () => {
        const cfg = { runtime: new ServerRuntime(), projectRegistry: {} }
        const tools = getTools(db, null, undefined, undefined, cfg, teamDb)
        const mergeTool = tools.find((t) => t.name === 'team_merge_tags')
        expect(mergeTool?.annotations?.destructiveHint).toBe(true)

        const wildRes = await runWithAuthContext(
            { authenticated: true, claims: { sub: 'alice', scopes: [SCOPES.TEAM, SCOPES.WRITE, SCOPES.ADMIN] } },
            () =>
                callTool('team_merge_tags', { source_tag: 'a', target_tag: 'b', workspace_id: '*' }, db, undefined, undefined, cfg, undefined, teamDb)
        )
        expect((wildRes as { success: boolean }).success).toBe(false)

        await expect(
            exportEntriesToMarkdown(db, path.join(tmpDir, '..', '..', 'outside-escape'), { allowedRoots: [tmpDir] })
        ).rejects.toThrow()
    })

    it('L1 & M12: enforces explicit matching OAuth scopes in requireAnyScope and tool filter parity', () => {
        let calledNext = false
        let statusSent: number | undefined
        const middleware = requireAnyScope(['custom_unrelated_scope'])
        const req = { auth: { scopes: ['admin'], token: 't', clientId: 'c' } } as unknown as Request
        const res = {
            status: (code: number) => {
                statusSent = code
                return res
            },
            setHeader: () => res,
            json: () => res,
        } as unknown as Response
        const next: NextFunction = () => {
            calledNext = true
        }
        middleware(req, res, next)
        expect(calledNext).toBe(false)
        expect(statusSent).toBe(403)
    })

    it('AP1-AP6: verifies Pass 30 prompt revision, parameterized Topic preamble, detectors, and plan_draft recall', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-21-audit-pass69')

        const cqText = (await getCodeQualityAuditPromptDefinition().handler({}, db)).messages[0]?.content.text ?? ''
        expect(cqText).toContain('UTF8Encoding')
        expect(cqText).toContain('defs.map')
        expect(cqText).toContain('ZodPipe')
        expect(cqText).toContain('memory://team/*')

        const planRes = await getPrompt('adversarial-plan-review', { topic: 'auth-layer' }, db)
        const planText = planRes.messages[0]?.content.text ?? ''
        expect(planText).toContain('Topic: auth-layer')
        expect(planText).toContain('Review the repository')
        expect(planText).not.toContain('Target: auth-layer')

        db.createEntry({
            content: 'Draft OAuth hardening plan',
            entryType: 'plan_draft',
            tags: ['adversarial-planner'],
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
        })
        const section = buildPlanReviewPriorContextSection(
            db,
            'OAuth',
            'OAuth',
            { ...DEFAULT_BRIEFING_CONFIG, projectRegistry: { 'memory-journal-mcp': { project_number: 5 } } },
            'memory-journal-mcp',
            undefined,
            5
        )
        expect(section).toContain('Draft OAuth hardening plan')
    })

    it('Appendix B: preserves unclosed parenthetical prose in json-entry-recovery, normalizes batch deletes, and re-indexes on tag/type batch updates', async () => {
        const unclosed = `await mj.createEntry({ content: "OAuth fix (see note), workspace_id: "memory-journal-mcp", project_number: 5 })`
        const recovered = extractAndRecoverEntryCode(unclosed)
        expect(recovered).toContain('OAuth fix (see note)')

        const norm = applyEntryAndSearchInterceptions('batch_delete_entries', [{ ids: ['#1', '2'] }])
        expect('args' in norm).toBe(true)
        if ('args' in norm) {
            expect((norm.args[0] as { entry_ids: number[] }).entry_ids).toEqual([1, 2])
        }

        const created = db.createEntry({ content: 'Original', tags: ['v1'], workspaceId: 'memory-journal-mcp', projectNumber: 5 })
        const addEntry = vi.fn().mockResolvedValue(true)
        const ctx: ToolContext = {
            db,
            vectorManager: { addEntry, removeEntry: vi.fn(), isInitialized: () => true } as unknown as VectorSearchManager,
            config: { projectRegistry: { 'memory-journal-mcp': { project_number: 5 } } },
        }
        const updateRes = await executeBatchUpdateEntries(
            { updates: [{ entry_id: created.id, expected_version: 1, tags: ['v2'], entry_type: 'bug_fix' }] },
            ctx
        )
        expect(updateRes['success']).toBe(true)
        expect(addEntry).toHaveBeenCalledTimes(1)
    })
})
