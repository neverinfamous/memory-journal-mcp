/**
 * Regression tests: Code Mode scope isolation (C3/H6) and SQL positional binding (C4).
 */

import { describe, it, expect } from 'vitest'
import { parseSqlStatement } from '../../src/codemode/sql-positional-binder.js'
import { extractAndRecoverPreparedStatementCode } from '../../src/handlers/tools/codemode/sql-recovery.js'
import { deepCamelToSnake } from '../../src/handlers/tools/codemode/secure-dispatcher.js'
import { recoverStructuredJsonCode } from '../../src/handlers/tools/codemode/json-entry-structured.js'
import { resolveCreateEntryProjectContext } from '../../src/codemode/normalizers/generic-field-aliases.js'
import { resolveCodeModeSessionContext } from '../../src/handlers/tools/codemode/session-context.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

describe('SQL positional binding (C4)', () => {
    it('binds ? placeholders by column instead of grabbing the first number as entry_id', () => {
        const parsed = parseSqlStatement(
            'UPDATE memory_journal SET content = ?, project_number = ? WHERE id = ?',
            ['new body', 5, 12]
        )
        expect(parsed.action).toBe('update')
        expect(parsed.params).toMatchObject({ entry_id: 12, project_number: 5, content: 'new body' })
    })

    it('maps WHERE scope binds positionally for DELETE', () => {
        const parsed = parseSqlStatement('DELETE FROM memory_journal WHERE workspace_id = ? AND id = ?', ['core-platform', 7])
        expect(parsed).toEqual({ action: 'delete', params: { entry_id: 7, workspace_id: 'core-platform' } })
    })

    it('refuses to guess when placeholders outnumber binds', () => {
        const parsed = parseSqlStatement('UPDATE memory_journal SET content = ?, title = ? WHERE id = ?', ['a', 3])
        expect(parsed.action).toBe('unmapped')
    })

    it('binds INSERT column lists positionally including scope columns', () => {
        const parsed = parseSqlStatement(
            'INSERT INTO memory_journal (workspace_id, project_number, content) VALUES (?, ?, ?)',
            ['core-platform', 9, 'body']
        )
        expect(parsed.action).toBe('create')
        expect(parsed.params).toMatchObject({ workspace_id: 'core-platform', project_number: 9, content: 'body' })
    })

    it('host recovery uses the same positional binder', () => {
        const code = extractAndRecoverPreparedStatementCode(
            'db.prepare("UPDATE memory_journal SET project_number = ? WHERE id = ?").run(5, 33);'
        )
        expect(code).toContain('mj.admin.updateEntry')
        expect(code).toContain('"entry_id":33')
        expect(code).toContain('"project_number":5')
    })
})

describe('Code Mode scope isolation (C3/H6)', () => {
    it('does not infer workspace from content keywords in worker normalizers', () => {
        const obj: Record<string, unknown> = { content: 'Worked on memory-journal-mcp and core-platform today', tags: ['core-platform'] }
        resolveCreateEntryProjectContext(obj)
        expect(obj['workspace_id']).toBeUndefined()
        expect(obj['project_number']).toBeUndefined()
    })

    it('aliases only top-level id -> entry_id and respects schemas that accept id', () => {
        const converted = deepCamelToSnake({ id: 4, anchors: [{ id: 9, filePath: 'a.ts' }] })
        expect(converted).toEqual({ entry_id: 4, anchors: [{ id: 9, file_path: 'a.ts' }] })
        const kept = deepCamelToSnake({ id: 4 }, 0, (key) => key === 'id')
        expect(kept).toEqual({ id: 4 })
    })

    it('rejects non-identifier tool names in recovered JSON tool calls', () => {
        const recovered = recoverStructuredJsonCode(JSON.stringify({ tool: 'x);globalThis.evil(', params: {} }))
        expect(recovered ?? '').not.toContain('evil')
    })

    it('preserves outer scope when unwrapping a nested payload tool call', () => {
        const recovered = recoverStructuredJsonCode(
            JSON.stringify({ workspace_id: 'core-platform', project_number: 3, payload: { tool: 'core.getRecentEntries', params: {} } })
        )
        expect(recovered).toContain('"workspace_id":"core-platform"')
        expect(recovered).toContain('"project_number":3')
    })

    it('never copies an unregistered owner/repo into workspace_id', () => {
        const recovered = recoverStructuredJsonCode(
            JSON.stringify({ query: 'find things', repo: 'someone/unregistered-repo-xyz' })
        )
        expect(recovered).toContain('mj.search.searchEntries')
        expect(recovered).not.toContain('someone/unregistered-repo-xyz')
    })

    it('rejects conflicting workspace_id and repo and isolates explicit default from defaultProjectNumber in resolveCodeModeSessionContext', async () => {
        const db = new DatabaseAdapter(':memory:')
        const config = {
            projectRegistry: {
                'core-platform': { path: '/workspace/core-platform', project_number: 16 },
                'memory-journal-mcp': { path: '/workspace/mj', project_number: 5 },
            },
            defaultProjectNumber: 5,
        }
        const conflictRes = await resolveCodeModeSessionContext(
            { db, config },
            { code: 'return 1', workspace_id: 'core-platform', repo: 'memory-journal-mcp' }
        )
        expect('errorResponse' in conflictRes).toBe(true)
        if ('errorResponse' in conflictRes) {
            expect(String(conflictRes.errorResponse['error'])).toContain('conflicts with repo')
        }

        const defaultRes = await resolveCodeModeSessionContext(
            { db, config },
            { code: 'return 1', workspace_id: 'default' }
        )
        expect('errorResponse' in defaultRes).toBe(false)
        if (!('errorResponse' in defaultRes)) {
            expect(defaultRes.workspaceId).toBe('default')
            expect(defaultRes.projectId).toBeUndefined()
            expect(defaultRes.numericProjectId).toBeUndefined()
        }
    })
})
