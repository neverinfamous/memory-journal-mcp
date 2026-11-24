/**
 * Pass 26 Schema Bounds, Anchor Normalization, Prompt Target & GitHub Context Regressions
 *
 * Split from `audit-pass26.test.ts` to keep every test file <= 450 lines.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { resolveRegistryMatchForTarget } from '../../src/handlers/prompts/adversarial-args.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { applyGitInterceptions } from '../../src/codemode/api/git-api.js'
import { isInsideStringLiteral } from '../../src/handlers/tools/codemode/code-healer.js'
import { evaluateAnchorStaleness } from '../../src/handlers/tools/git-staleness.js'
import {
    SearchEntriesSchema,
    SearchByDateRangeSchema,
    SemanticSearchSchema,
} from '../../src/handlers/tools/search/schemas.js'
import { decodeCompoundCursor } from '../../src/handlers/tools/search/fts.js'
import { CreateEntrySchema } from '../../src/handlers/tools/core/schemas.js'
import { GitHubContextOutputSchema } from '../../src/handlers/tools/github/schemas.js'
import { MAX_CONTENT_LENGTH } from '../../src/handlers/tools/schemas/constants-and-primitives.js'

const REGISTRY = {
    'memory-journal-mcp': { path: path.resolve('/repos/memory-journal-mcp'), project_number: 5 },
    'other-repo': { path: path.resolve('/repos/other-repo'), project_number: 9 },
}

describe('Pass 26 Schema Bounds, Prompts & Normalization Regressions', () => {
    let db: DatabaseAdapter

    beforeEach(async () => {
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
    })

    afterEach(() => {
        db.close()
    })

    it('enforces search limit bounds, CreateEntrySchema max length, and strict compound cursors (M9)', () => {
        expect(() => SearchEntriesSchema.parse({ query: 'x', limit: 0 })).toThrow()
        expect(() => SearchEntriesSchema.parse({ query: 'x', limit: 1.5 })).toThrow()
        expect(() => SearchByDateRangeSchema.parse({ start_date: '2026-01-01', end_date: '2026-01-02', limit: 0 })).toThrow()
        expect(() => SemanticSearchSchema.parse({ query: 'x', limit: 0.5 })).toThrow()
        expect(() => CreateEntrySchema.parse({ content: 'a'.repeat(MAX_CONTENT_LENGTH + 1) })).toThrow()

        const noPT = Buffer.from(JSON.stringify({ x: '1' })).toString('base64')
        const badType = Buffer.from(JSON.stringify({ p: 123 })).toString('base64')
        const validCursor = Buffer.from(JSON.stringify({ p: 'c1', t: 'c2' })).toString('base64')
        expect(decodeCompoundCursor(noPT)).toBeNull()
        expect(decodeCompoundCursor(badType)).toBeNull()
        expect(decodeCompoundCursor(validCursor)).toEqual({ p: 'c1', t: 'c2' })
    })

    it('normalizes Windows backslashes and #symbol suffixes in anchors and maps repo_name in git API (M10)', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass26-'))
        try {
            fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true })
            fs.writeFileSync(path.join(tmpDir, 'src', 'app.ts'), 'export const x = 1\n')
            let seenPath: string | undefined
            const row = await evaluateAnchorStaleness(
                db,
                { id: 1, anchorPath: 'src\\app.ts#mySymbol', status: 'pending' },
                '2026-01-01T00:00:00Z',
                tmpDir,
                (anchorPath) => {
                    seenPath = anchorPath
                    return Promise.resolve(2)
                },
                'memory-journal-mcp'
            )
            expect(seenPath).toBe('src/app.ts')
            expect(row.newStatus).toBe('stale')
            expect(row.commitsSince).toBe(2)

            const intercepted = applyGitInterceptions('get_commit_history', [{ repo_name: 'memory-journal-mcp' }])
            expect(intercepted).not.toBeNull()
            if (intercepted && 'args' in intercepted) {
                const first = intercepted.args[0] as Record<string, unknown>
                expect(first['repo']).toBe('memory-journal-mcp')
                expect(first['repo_name']).toBeUndefined()
            }
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true })
        }
    })

    it('ignores quotes inside JS comments in isInsideStringLiteral (M11)', () => {
        const src = "// don't break\n/* won't \"quote\" */\nconst x = 1"
        const idx = src.indexOf('const x')
        expect(isInsideStringLiteral(src, idx)).toBe(false)
    })

    it('resolves relative <repo>/<subpath> targets against registry without matching arbitrary relative paths', () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass79')
        expect(resolveRegistryMatchForTarget(REGISTRY, 'memory-journal-mcp/src/cli')).toBe('memory-journal-mcp')
        expect(resolveRegistryMatchForTarget(REGISTRY, 'memory-journal-mcp\\src\\utils')).toBe('memory-journal-mcp')
        expect(resolveRegistryMatchForTarget(REGISTRY, 'src/cli')).toBeUndefined()
    })

    it('validates GitHubContextOutputSchema degraded as string[] rather than boolean', () => {
        const parsed = GitHubContextOutputSchema.parse({
            repoName: null,
            branch: null,
            commit: null,
            remoteUrl: null,
            issues: [],
            pullRequests: [],
            issueCount: 0,
            prCount: 0,
            degraded: ['commit'],
        })
        expect(parsed.degraded).toEqual(['commit'])
        expect(() =>
            GitHubContextOutputSchema.parse({
                repoName: null,
                branch: null,
                commit: null,
                remoteUrl: null,
                issues: [],
                pullRequests: [],
                issueCount: 0,
                prCount: 0,
                degraded: true,
            })
        ).toThrow()
    })
})
