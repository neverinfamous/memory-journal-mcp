/**
 * Regression tests for H1-H6: Code Mode .schema() introspection, batch bare-array &
 * string-ID healing, direct MCP session-summary & auto_context healing, tagged-template
 * inline backtick healing, GitHub prompt defaultProjectNumber fallback, and refreshed gotchas.
 */

import * as vm from 'node:vm'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { collectNonCodeModeTools } from '../../src/handlers/tools/codemode/singleton-state.js'
import { createJournalApi } from '../../src/codemode/api/journal-api.js'
import { buildApiProxy } from '../../src/codemode/worker-api-proxy.js'
import { applyArgInterceptions } from '../../src/codemode/param-normalizer.js'
import { CreateEntrySchema, CreateEntrySchemaMcp } from '../../src/handlers/tools/core/schemas.js'
import {
    BatchCreateEntriesSchema,
    BatchUpdateEntriesSchema,
    BatchDeleteEntriesSchema,
} from '../../src/handlers/tools/admin/schemas/crud-batch-schemas.js'
import {
    TeamBatchCreateEntriesSchema,
    TeamBatchUpdateEntriesSchema,
    TeamBatchDeleteEntriesSchema,
} from '../../src/handlers/tools/team/schemas/admin-batch-schemas.js'
import { TeamCreateEntrySchemaMcp } from '../../src/handlers/tools/team/schemas/core-search-schemas.js'
import {
    healCodeModeScript,
    healTemplateBackticksOnRuntimeError,
} from '../../src/handlers/tools/codemode/code-healer.js'
import { getGitHubPromptDefinitions } from '../../src/handlers/prompts/github.js'
import { getLoadBriefingPromptDefinitions } from '../../src/handlers/prompts/load-briefing.js'
import { GOTCHAS_HELP } from '../../src/constants/instructions/gotchas.js'

interface MethodProxyWithIntrospection {
    (...args: unknown[]): Promise<Record<string, unknown>>
    schema: () => Promise<string>
}

function collectMethodList(bindings: Record<string, unknown>): Record<string, string[]> {
    const methodList: Record<string, string[]> = {}
    const topLevel: string[] = []
    for (const [key, value] of Object.entries(bindings)) {
        if (typeof value === 'function') {
            topLevel.push(key)
        } else if (typeof value === 'object' && value !== null) {
            const methods: string[] = []
            for (const [mName, mVal] of Object.entries(value)) {
                if (typeof mVal === 'function') methods.push(mName)
            }
            if (methods.length > 0) methodList[key] = methods
        }
    }
    if (topLevel.length > 0) methodList['_topLevel'] = topLevel
    return methodList
}

describe('H1-H6 Gotchas Auto-Healing Regressions', () => {
    let db: DatabaseAdapter

    beforeEach(async () => {
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
    })

    afterEach(() => {
        db.close()
    })

    describe('H1: Code Mode .schema() introspection', () => {
        it('resolves non-unknown schemas for _topLevel, snake_case, cross-group aliases, and readonly mutations', async () => {
            const allTools = collectNonCodeModeTools({ db })
            const readonlyTools = allTools.filter((t) => t.annotations?.readOnlyHint === true)

            const fullApi = createJournalApi(allTools)
            const roApi = createJournalApi(readonlyTools)

            const schemas = fullApi.createSandboxSchemas()
            const roMethodList = collectMethodList(roApi.createSandboxBindings())

            const rpcStub = async (group: string, method: string): Promise<unknown> => ({
                success: true,
                group,
                method,
            })

            const mj = buildApiProxy(rpcStub, roMethodList, schemas, true, {})
            const core = mj['core'] as Record<string, MethodProxyWithIntrospection>

            // Blocked in readonly mode for execution, yet .schema() still returns real schema!
            const createCoreSchema = await core['createEntry']!.schema()
            expect(createCoreSchema).not.toBe('unknown')
            expect(createCoreSchema).toContain('content')

            const createTop = mj['createEntry'] as MethodProxyWithIntrospection
            expect(await createTop.schema()).toContain('content')
            const roCallRes = await createCoreOrTop(core['createEntry']!, createTop)
            expect(roCallRes.coreError).toContain('blocked in readonly mode')
            expect(roCallRes.topError).toContain('blocked in readonly mode')

            // Read-only _topLevel, cross-group alias, and snake_case introspection
            const searchTop = mj['searchEntries'] as MethodProxyWithIntrospection
            expect(await searchTop.schema()).not.toBe('unknown')
            expect(await searchTop.schema()).toContain('query')

            expect(await core['searchEntries']!.schema()).not.toBe('unknown')
            expect(await core['updateEntry']!.schema()).not.toBe('unknown')
            expect(await core['create_entry']!.schema()).not.toBe('unknown')
        })
    })

    describe('H2: Batch bare-array, alias-key, and numeric string-ID healing', () => {
        it('wraps bare arrays and normalizes aliases in MCP & Team Zod batch schemas', () => {
            const bcBare = BatchCreateEntriesSchema.parse([{ workspace_id: 'repo-a', content: 'Item 1' }])
            expect(bcBare.entries).toHaveLength(1)
            expect(bcBare.entries[0]?.content).toBe('Item 1')

            const bcItems = BatchCreateEntriesSchema.parse({
                workspace: 'repo-a',
                items: [{ content: 'Item 2' }],
            })
            expect(bcItems.entries[0]?.workspace_id).toBe('repo-a')

            const buBare = BatchUpdateEntriesSchema.parse([{ id: 42, content: 'Updated' }])
            expect(buBare.updates[0]?.entry_id).toBe(42)

            const bdBare = BatchDeleteEntriesSchema.parse(['10', '#20'])
            expect(bdBare.entry_ids).toEqual([10, 20])

            const tbcBare = TeamBatchCreateEntriesSchema.parse([{ content: 'Team item' }])
            expect(tbcBare.entries).toHaveLength(1)

            const tbuBare = TeamBatchUpdateEntriesSchema.parse([{ id: 7, content: 'Team upd' }])
            expect(tbuBare.updates[0]?.entry_id).toBe(7)

            const tbdBare = TeamBatchDeleteEntriesSchema.parse(['30', '#40'])
            expect(tbdBare.entry_ids).toEqual([30, 40])
        })

        it('normalizes { items } and #ID string arrays in Code Mode batch interceptions', () => {
            const bc = applyArgInterceptions('batchCreateEntries', [{ items: [{ content: 'A' }] }])
            expect('args' in bc).toBe(true)
            if ('args' in bc) {
                expect(bc.args[0]).toEqual({ entries: [{ content: 'A' }] })
            }

            const bu = applyArgInterceptions('batchUpdateEntries', [{ items: [{ id: 5, content: 'B' }] }])
            expect('args' in bu).toBe(true)
            if ('args' in bu) {
                expect((bu.args[0] as Record<string, unknown>)['updates']).toBeDefined()
            }

            const bd = applyArgInterceptions('batchDeleteEntries', [{ ids: ['11', '#22'] }])
            expect('args' in bd).toBe(true)
            if ('args' in bd) {
                expect(bd.args[0]).toEqual({ entry_ids: [11, 22] })
            }

            expect('error' in applyArgInterceptions('batchDeleteEntries', [['10', 'not-an-id']])).toBe(
                true
            )
        })
    })

    describe('H3: Direct MCP session-summary & auto_context healing', () => {
        it('promotes session-summary entry_type, heals 4-header synonyms, and heals auto_context aliases', () => {
            const parsed = CreateEntrySchema.parse({
                workspace_id: 'repo-a',
                tags: ['session-summary'],
                content:
                    '# Accomplishments\n- Shipped fix\n\n### Blockers\n- None\n\n## Next Steps\n- Monitor\n\n## Commit History\n- abc1234',
                auto_context: { commit_shas: 'abc1234' },
            })
            expect(parsed.entry_type).toBe('retrospective')
            expect(parsed.content).toContain('## Accomplished')
            expect(parsed.content).toContain('## Unfinished / Blocked')
            expect(parsed.content).toContain('## Context for Next Session')
            expect(parsed.content).toContain('## Commits')
            expect(parsed.auto_context).toBe(JSON.stringify({ commits: ['abc1234'] }))

            // Works even when one section is omitted completely
            const partialHeaders = CreateEntrySchemaMcp.parse({
                workspace_id: 'repo-a',
                tags: ['session-summary'],
                content: '## Accomplished\n- Done',
            })
            expect(partialHeaders.content).toContain('## Unfinished / Blocked')
            expect(partialHeaders.content).toContain('## Context for Next Session')
            expect(partialHeaders.content).toContain('## Commits')
        })
    })

    describe('H4: Accidental tagged-template inline backtick healing', () => {
        it('heals dot-file and index backtick collisions while keeping valid concatenation intact', () => {
            const brokenScript =
                'return { content: `Updated `.npmrc` and `[0]` config` };'
            const healed = healCodeModeScript(brokenScript)
            const fn = new vm.Script(`(() => { ${healed} })()`).runInThisContext() as {
                content: string
            }
            expect(fn.content).toBe('Updated `.npmrc` and `[0]` config')

            const retryHealed = healTemplateBackticksOnRuntimeError(brokenScript)
            expect(retryHealed).not.toBeNull()

            // Valid template concatenation remains untouched
            const validConcat = 'const s = `a` + `b`;\nreturn s;'
            expect(healCodeModeScript(validConcat)).toContain('const s = `a` + `b`;')
        })
    })

    describe('H5: GitHub prompt defaultProjectNumber fallback & public schema hygiene', () => {
        it('makes project_number optional and uses defaultProjectNumber on legacy project prompts', () => {
            const prompts = getGitHubPromptDefinitions()
            for (const promptName of ['project-status-summary', 'project-milestone-tracker'] as const) {
                const def = prompts.find((p) => p.name === promptName)
                expect(def).toBeDefined()
                expect(def?.arguments?.[0]?.required).toBe(false)
                const res = def!.handler({}, db, undefined, undefined, {
                    defaultProjectNumber: 42,
                }) as { messages: { content: { text: string } }[] }
                expect(res.messages[0]?.content.text).toContain('Project #42')
                expect(res.messages[0]?.content.text).toContain('memory://projects/42/timeline')
            }
        })

        it('keeps public schema & prompt descriptions free of private repo example names', () => {
            const getWorkspaceIdDescription = (schema: unknown): string => {
                let inner: unknown = schema
                while (inner instanceof z.ZodPipe) {
                    inner = inner.out
                }
                if (
                    inner !== null &&
                    typeof inner === 'object' &&
                    'shape' in inner &&
                    inner.shape !== null &&
                    typeof inner.shape === 'object' &&
                    'workspace_id' in inner.shape
                ) {
                    const wsField = inner.shape.workspace_id
                    if (
                        wsField !== null &&
                        typeof wsField === 'object' &&
                        'description' in wsField &&
                        typeof wsField.description === 'string'
                    ) {
                        return wsField.description
                    }
                }
                return ''
            }
            const wsDesc = getWorkspaceIdDescription(CreateEntrySchemaMcp)
            const teamWsDesc = getWorkspaceIdDescription(TeamCreateEntrySchemaMcp)
            const lbPrompt = getLoadBriefingPromptDefinitions().find((p) => p.name === 'load-briefing')
            const lbDesc = lbPrompt?.arguments?.[0]?.description ?? ''
            expect(wsDesc.length).toBeGreaterThan(0)
            expect(teamWsDesc.length).toBeGreaterThan(0)
            expect(lbDesc.length).toBeGreaterThan(0)
            expect(wsDesc).toContain('"my-repo"')
            expect(teamWsDesc).toContain('"my-repo"')
            expect(lbDesc).toContain('frontend-app')
        })
    })

    describe('H6: Regenerated GOTCHAS_HELP accuracy', () => {
        it('documents fuzzy_match default false, agent-context/{+repo}, auto_version, and 4-header session summaries', () => {
            expect(GOTCHAS_HELP).toContain('fuzzy_match: false')
            expect(GOTCHAS_HELP).toContain('memory://agent-context/{+repo}')
            expect(GOTCHAS_HELP).toContain('auto_version: true')
            expect(GOTCHAS_HELP).toContain('## Unfinished / Blocked')
            expect(GOTCHAS_HELP).not.toContain('NEVER** pass an array directly')
        })
    })
})

async function createCoreOrTop(
    coreFn: MethodProxyWithIntrospection,
    topFn: MethodProxyWithIntrospection
): Promise<{ coreError: string; topError: string }> {
    const coreRes = await coreFn({ content: 'blocked' })
    const topRes = await topFn({ content: 'blocked' })
    return {
        coreError: String(coreRes['error'] ?? ''),
        topError: String(topRes['error'] ?? ''),
    }
}
