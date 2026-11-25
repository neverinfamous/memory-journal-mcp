/**
 * CMS-04 REM Supervisor Regression Suite (2026-11-25)
 *
 * Covers the 2 deferred server self-healing adaptations mined from
 * logs/agent-issues.jsonl and logs/mcp-audit.jsonl:
 * 1. Scope `source -> source_tag` strictly to `merge_tags` / `team_merge_tags`
 *    (and method-less non-DB-selector payloads) in `convertKeysToSnakeCase` so
 *    canonical `source: 'personal' | 'team'` is never corrupted on `get_entry_by_id`
 *    or `visualize_relationships`.
 * 2. Short-circuit static-only `HELP_CONTENT` topics (`gotchas`, `templates`) in
 *    `memory://help/{group}` without importing lazy `tools/index.js` chunks, and
 *    emit actionable `🛠️ AUTONOMOUS HEALING:` guidance on stale `dist/` chunk errors.
 */

import { describe, it, expect } from 'vitest'
import { convertKeysToSnakeCase } from '../../src/codemode/api/key-normalizer.js'
import {
    formatHelpLoadErrorMessage,
    getHelpResourceDefinitions,
    isStaleModuleNotFoundError,
} from '../../src/handlers/resources/help.js'
import type { ResourceContext } from '../../src/handlers/resources/shared.js'

describe('CMS-04 REM Healing (2026-11-25)', () => {
    describe('1. Code Mode `source` alias scoping in convertKeysToSnakeCase', () => {
        it('preserves canonical source on get_entry_by_id and visualize_relationships', () => {
            const getPersonal = convertKeysToSnakeCase(
                {
                    entry_id: 16118,
                    workspace_id: 'adamic',
                    source: 'personal',
                    project_number: 16,
                },
                'getEntryById'
            )
            expect(getPersonal['source']).toBe('personal')
            expect(getPersonal['source_tag']).toBeUndefined()

            const getSnake = convertKeysToSnakeCase(
                { entry_id: 16118, source: 'team' },
                'get_entry_by_id'
            )
            expect(getSnake['source']).toBe('team')
            expect(getSnake['source_tag']).toBeUndefined()

            const vizCamel = convertKeysToSnakeCase(
                { entry_id: 16118, source: 'team' },
                'visualizeRelationships'
            )
            expect(vizCamel['source']).toBe('team')
            expect(vizCamel['source_tag']).toBeUndefined()

            const vizSnake = convertKeysToSnakeCase(
                { entry_id: 16118, source: 'personal' },
                'visualize_relationships'
            )
            expect(vizSnake['source']).toBe('personal')
            expect(vizSnake['source_tag']).toBeUndefined()
        })

        it('preserves source -> source_tag for merge_tags / team_merge_tags and source_format for import_external', () => {
            for (const method of ['mergeTags', 'merge_tags', 'teamMergeTags', 'team_merge_tags']) {
                const res = convertKeysToSnakeCase({ source: 'old', target: 'new' }, method)
                expect(res['source_tag']).toBe('old')
                expect(res['target_tag']).toBe('new')
                expect(res['source']).toBeUndefined()
            }

            const ext = convertKeysToSnakeCase({ source: 'obsidian' }, 'importExternal')
            expect(ext['source_format']).toBe('obsidian')
            expect(ext['source']).toBeUndefined()

            const md = convertKeysToSnakeCase({ source: 'obsidian' }, 'importMarkdown')
            expect(md['source']).toBe('obsidian')
            expect(md['source_format']).toBeUndefined()
        })

        it('guards method-less DB source selectors while allowing method-less tag payloads', () => {
            const dbSelector = convertKeysToSnakeCase({ entry_id: 42, source: 'personal' })
            expect(dbSelector['source']).toBe('personal')
            expect(dbSelector['source_tag']).toBeUndefined()

            const tagLike = convertKeysToSnakeCase({ source: 'old' })
            expect(tagLike['source_tag']).toBe('old')
            expect(tagLike['source']).toBeUndefined()
        })
    })

    describe('2. Static help resource short-circuit and stale-chunk healing message', () => {
        it('serves memory://help/gotchas and memory://help/templates without calling tool loader', async () => {
            const groupHelp = getHelpResourceDefinitions().find(
                (d) => d.uri === 'memory://help/{group}'
            )
            expect(groupHelp).toBeDefined()
            if (!groupHelp) return

            // Passing a null db proves getAllToolDefinitionsAsync/getTools is never invoked
            const nullContext = { db: null } as unknown as ResourceContext
            const gotchas = await groupHelp.handler('memory://help/gotchas', nullContext)
            expect(typeof gotchas.data).toBe('string')
            expect(String(gotchas.data)).toContain('Gotchas')

            const templates = await groupHelp.handler('memory://help/templates', nullContext)
            expect(typeof templates.data).toBe('string')
            expect(String(templates.data).length).toBeGreaterThan(0)
        })

        it('detects stale dist/ chunk errors and formats actionable restart guidance', () => {
            const errWithCode = Object.assign(
                new Error("Cannot find module 'C:\\repo\\dist\\tools-TXENZBK6.js'"),
                { code: 'ERR_MODULE_NOT_FOUND' }
            )
            expect(isStaleModuleNotFoundError(errWithCode)).toBe(true)
            expect(isStaleModuleNotFoundError(new Error('Cannot find module foo.js'))).toBe(true)
            expect(isStaleModuleNotFoundError(new Error('SQLITE_BUSY: database is locked'))).toBe(
                false
            )

            const healedMsg = formatHelpLoadErrorMessage(errWithCode)
            expect(healedMsg).toContain('🛠️ AUTONOMOUS HEALING:')
            expect(healedMsg).toContain('Restart the memory-journal-mcp server')

            const plainMsg = formatHelpLoadErrorMessage(new Error('Permission denied'))
            expect(plainMsg).toBe('Failed to load tool definitions: Permission denied')
        })
    })
})
