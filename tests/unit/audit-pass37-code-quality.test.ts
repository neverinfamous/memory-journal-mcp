/**
 * Pass 37 code-quality regressions: canonical project and entry ids,
 * opaque Code Mode bags, legacy numeric restore locks, and embedding fallback.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractAuditScopeFromArgs } from '../../src/audit/audit-query-helpers.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { acquireRestoreLock } from '../../src/database/sqlite-adapter/restore-lock.js'
import { coerceNumericStringIds } from '../../src/codemode/normalizers/generic-field-aliases.js'
import { deepCamelToSnake } from '../../src/handlers/tools/codemode/dispatch-scope.js'
import { readProjectNumber } from '../../src/handlers/tools/codemode/json-entry-scope.js'
import { parseProjectNumberField } from '../../src/handlers/tools/codemode/natural-language-synthesizer.js'
import { parseGitProjectNumber } from '../../src/handlers/tools/git-workdir.js'
import { getPrompt } from '../../src/handlers/prompts/index.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { coerceEntryIdField } from '../../src/handlers/tools/schemas/hallucination-healer-search.js'
import { normalizeProjectFields } from '../../src/handlers/tools/schemas/hallucination-healer-scope.js'
import { runPipelineBatchEmbeddingsSettled } from '../../src/vector/vector-search-manager/candidate-search.js'
import { parsePositiveProjectNumber } from '../../src/utils/safe-positive-int.js'

const tempDirs: string[] = []

function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass37-'))
    tempDirs.push(dir)
    return dir
}

afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

describe('pass 37 code quality', () => {
    it('rejects non-canonical project and entry id strings', () => {
        expect(parsePositiveProjectNumber('0x10')).toBeUndefined()
        expect(parsePositiveProjectNumber('1e2')).toBeUndefined()
        expect(parsePositiveProjectNumber('01')).toBeUndefined()
        expect(parsePositiveProjectNumber('9007199254740993')).toBeUndefined()
        expect(parsePositiveProjectNumber(12)).toBe(12)

        const aliased = { project_number: '0x10' }
        expect(coerceNumericStringIds(aliased)).toBeDefined()
        expect(aliased.project_number).toBe('0x10')

        expect(readProjectNumber({ project_number: '0x10' })).toBe('0x10')
        expect(readProjectNumber({ project_number: '12' })).toBe(12)
        expect(parseProjectNumberField({ project_number: '1e2' }, {})).toBe('1e2')

        expect(() => parseGitProjectNumber('0x10')).toThrow(/positive integer/i)
        expect(() => parseGitProjectNumber('01')).toThrow(/positive integer/i)
        expect(parseGitProjectNumber('12')).toBe(12)

        const healed = { project_number: '0x10' }
        normalizeProjectFields(healed, {})
        expect(healed.project_number).toBe('0x10')

        const entry = { entry_id: '0x10' }
        expect(coerceEntryIdField(entry)).toBe(false)
        expect(entry.entry_id).toBe('0x10')

        expect(extractAuditScopeFromArgs({ project_number: '0x10' }).projectNumber).toBeUndefined()
        expect(extractAuditScopeFromArgs({ project_number: '01' }).projectNumber).toBeUndefined()
        expect(extractAuditScopeFromArgs({ project_number: 12 }).projectNumber).toBe(12)
    })

    it('copies context and prompt bags without renaming nested keys', () => {
        const converted = deepCamelToSnake({
            context: { promptText: 'keep' },
            prompt: { rawQuery: 'same' },
            autoContext: { taskName: 'note' },
        })
        expect(converted).toEqual({
            context: { promptText: 'keep' },
            prompt: { rawQuery: 'same' },
            auto_context: { taskName: 'note' },
        })
    })

    it('keeps a legacy numeric restore lock when the pid is alive', () => {
        const lockDir = path.join(makeTempDir(), 'restore.lock.d')
        const lockFile = path.join(lockDir, 'lock.json')
        fs.mkdirSync(lockDir, { recursive: true })
        fs.writeFileSync(lockFile, '424242')
        const past = new Date(Date.now() - 10_000)
        fs.utimesSync(lockDir, past, past)
        vi.spyOn(process, 'kill').mockImplementation(() => true)

        expect(() => acquireRestoreLock(lockDir, lockFile, undefined)).toThrow(/holding the database lock/i)
    })

    it('rejects an optimize-journal number that is not a unique registered project', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            await expect(
                getPrompt('optimize-journal', { project: '999999' }, db, undefined, undefined, {
                    ...DEFAULT_BRIEFING_CONFIG,
                    projectRegistry: { only: { project_number: 1, path: os.tmpdir() } },
                })
            ).rejects.toThrow(/not a unique registered project/)
        } finally {
            db.close()
        }
    })

    it('embeds every text after a batch embedding failure', async () => {
        const pipeline = () => {
            throw new Error('batch failed')
        }
        const vector = new Float32Array([1, 2, 3])
        const settled = await runPipelineBatchEmbeddingsSettled(pipeline, ['one', 'two'], 3, async () => vector)

        expect(settled).toHaveLength(2)
        expect(settled[0]).toEqual({ status: 'fulfilled', value: vector })
        expect(settled[1]).toEqual({ status: 'fulfilled', value: vector })
    })
})
