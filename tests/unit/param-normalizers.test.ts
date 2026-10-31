import { describe, it, expect } from 'vitest'
import { applyArgInterceptions, isRecord } from '../../src/codemode/param-normalizer.js'
import { convertKeysToSnakeCase, normalizeParams } from '../../src/codemode/api/param-normalizer.js'

describe('src/codemode/param-normalizer.ts (applyArgInterceptions)', () => {
    it('normalizes raw strings and positional args', () => {
        expect(isRecord({})).toBe(true)
        expect(isRecord([])).toBe(false)
        expect(isRecord(null)).toBe(false)

        const execRes = applyArgInterceptions('mj_execute_code', ['return 1'])
        expect('args' in execRes && execRes.args[0]).toEqual({ code: 'return 1' })

        const createRes = applyArgInterceptions('create_entry', ['My note'])
        expect('args' in createRes && createRes.args[0]).toEqual(
            expect.objectContaining({ content: 'My note' })
        )

        const pos1 = applyArgInterceptions('appendEntry', ['my-ws', { content: 'body' }])
        expect('args' in pos1 && pos1.args[0]).toEqual({ workspace_id: 'my-ws', content: 'body' })

        const pos2 = applyArgInterceptions('appendEntry', ['My Title', { workspace_id: 'ws' }])
        expect('args' in pos2 && pos2.args[0]).toEqual({ workspace_id: 'ws', title: 'My Title' })
    })

    it('cleans up underscore metadata, search/grep aliases, nested metadata, and numeric IDs', () => {
        const searchRes = applyArgInterceptions('grep_search', [
            {
                _u_r_i: 'memory://recent',
                _uri: 'ignored',
                _url: 'http://test',
                _server_name: 'mj',
                _tool_name: 'grep',
                _meta: {},
                _custom_field: 'val',
                searchPath: '/src',
                Query: 'foo',
                filePattern: '*.ts',
                caseInsensitive: true,
                isRegex: false,
                matchPerLine: true,
                metadata: {
                    projectNumber: 'p-5',
                    sessionId: 'sess-1',
                    entry_type: 'technical_note',
                    tags: ['t1'],
                    workspaceId: 'ws-meta',
                },
                entry_id: '42',
                user: 'alice',
                severity: 'blocker',
                msg: 'hi',
                sortBy: 'timestamp_asc',
                confidence: '0.9',
                impact: '0.8',
                validation: 'pass',
                repo: 'my-repo',
                item_type: 'issue',
            },
        ])
        expect('args' in searchRes).toBe(true)
        if ('args' in searchRes) {
            const arg = searchRes.args[0] as Record<string, unknown>
            expect(arg['uri']).toBe('memory://recent')
            expect(arg['url']).toBe('http://test')
            expect(arg['custom_field']).toBe('val')
            expect(arg['search_path']).toBe('/src')
            expect(arg['query']).toBe('foo')
            expect(arg['file_pattern']).toBe('*.ts')
            expect(arg['case_insensitive']).toBe(true)
            expect(arg['is_regex']).toBe(false)
            expect(arg['match_per_line']).toBe(true)
            expect(arg['project_number']).toBe(5)
            expect(arg['session_id']).toBe('sess-1')
            expect(arg['workspace_id']).toBe('ws-meta')
            expect(arg['entry_id']).toBe(42)
            expect(arg['target_user']).toBe('alice')
            expect(arg['flag_type']).toBe('blocker')
            expect(arg['sort_by']).toBe('timestamp')
            expect(arg['sort_order']).toBe('asc')
            expect(arg['trust_score']).toBe(0.9)
            expect(arg['impact_score']).toBe(0.8)
            expect(arg['validation_status']).toBe('passed')
            expect(arg['repo_name']).toBe('my-repo')
            expect(arg['type']).toBe('technical_note')
        }

        // Validation status variants and project_name / project string fallback
        const vFail = applyArgInterceptions('other_tool', [
            {
                projectNumber: 'N/A',
                project_name: '12',
                trust: '0.5',
                impactScore: '0.6',
                validationStatus: 'fail',
                sort_by: 'date_desc',
                category: 'cat1',
            },
        ])
        if ('args' in vFail) {
            const arg = vFail.args[0] as Record<string, unknown>
            expect(arg['project_number']).toBe(12)
            expect(arg['validation_status']).toBe('failed')
            expect(arg['sort_order']).toBe('desc')
            expect(arg['type']).toBe('cat1')
        }

        const vSkip = applyArgInterceptions('other_tool', [
            {
                projectName: '15',
                trustScore: '0.7',
                validation_status: 'skip',
            },
        ])
        if ('args' in vSkip) {
            const arg = vSkip.args[0] as Record<string, unknown>
            expect(arg['project_number']).toBe(15)
            expect(arg['validation_status']).toBe('none')
        }

        const vUnknown = applyArgInterceptions('other_tool', [
            {
                project: 'my-tag-proj',
                validation_status: 'weird_status',
            },
        ])
        if ('args' in vUnknown) {
            const arg = vUnknown.args[0] as Record<string, unknown>
            expect(arg['tags']).toContain('my-tag-proj')
            expect(arg['validation_status']).toBe('none')
        }
    })

    it('handles execute_code and update_configuration interceptions', () => {
        const ex1 = applyArgInterceptions('execute_code', [{ repo_name: 'r1', script: '1+1' }])
        if ('args' in ex1) {
            expect(ex1.args[0]).toEqual({ repo: 'r1', code: '1+1', script: '1+1' })
        }

        const ex2 = applyArgInterceptions('execute_code', [{ payload: { a: 1 } }])
        if ('args' in ex2) {
            expect((ex2.args[0] as Record<string, unknown>)['code']).toBe('{"a":1}')
        }

        const ex3 = applyArgInterceptions('execute_code', [{ entry: { b: 2 } }])
        if ('args' in ex3) {
            expect((ex3.args[0] as Record<string, unknown>)['code']).toBe('{"b":2}')
        }

        const ex4 = applyArgInterceptions('execute_code', [{ input: { c: 3 } }])
        if ('args' in ex4) {
            expect((ex4.args[0] as Record<string, unknown>)['code']).toBe('{"c":3}')
        }

        const ex5 = applyArgInterceptions('execute_code', [{ notes: 123 }])
        if ('args' in ex5) {
            expect((ex5.args[0] as Record<string, unknown>)['code']).toContain('123')
        }

        const ex6 = applyArgInterceptions('execute_code', [{ customStr: 'mj.help()' }])
        if ('args' in ex6) {
            expect((ex6.args[0] as Record<string, unknown>)['code']).toBe('mj.help()')
        }

        const cfgErr1 = applyArgInterceptions('update_configuration', [{ update_notes: 'note' }])
        expect('error' in cfgErr1).toBe(true)

        const cfgErr2 = applyArgInterceptions('update_configuration', [{ maxTokens: 100 }])
        expect('error' in cfgErr2).toBe(true)

        const cfgUnwrap = applyArgInterceptions('update_configuration', [
            { config: { tool_filter: 'core' } },
        ])
        if ('args' in cfgUnwrap) {
            expect((cfgUnwrap.args[0] as Record<string, unknown>)['tool_filter']).toBe('core')
        }
    })

    it('handles entry mutation synthesis, auto_context, and session-summary healing', () => {
        for (const [inputType, expectedType] of [
            ['bug', 'bug_fix'],
            ['progress', 'development_note'],
            ['feature', 'feature_implementation'],
            ['meeting', 'meeting_notes'],
            ['task', 'technical_note'],
            ['session-summary', 'retrospective'],
        ] as const) {
            const res = applyArgInterceptions('create_entry', [
                {
                    type: inputType,
                    title: 'Title',
                    description: 'Desc',
                    context: { env: 'prod' },
                    focus: 'Goal',
                    resolution: 'Fixed',
                    artifacts: ['a.ts', 'b.ts'],
                    findings: ['f1', 'f2'],
                    content: 'Existing \\"quoted\\"',
                },
            ])
            if ('args' in res) {
                const arg = res.args[0] as Record<string, unknown>
                expect(arg['entry_type']).toBe(expectedType)
                expect(arg['content']).toContain('# Title')
                expect(arg['content']).toContain('**Artifacts:** a.ts, b.ts')
                expect(arg['content']).toContain('- f1')
            }
        }

        // Unwrap nested entry, auto_context object vs invalid type, and forbidden query param
        const nestedRes = applyArgInterceptions('create_entry', [
            {
                entry: { text: 'From nested' },
                auto_context: { commits: ['abc1234'] },
            },
        ])
        if ('args' in nestedRes) {
            const arg = nestedRes.args[0] as Record<string, unknown>
            expect(arg['content']).toContain('From nested')
            expect(typeof arg['auto_context']).toBe('string')
        }

        const badAc = applyArgInterceptions('create_entry', [
            { content: 'hi', auto_context: 12345 },
        ])
        expect('error' in badAc).toBe(true)

        const badQuery = applyArgInterceptions('create_entry', [{ content: 'hi', query: 'find' }])
        expect('error' in badQuery).toBe(true)

        // Session summary mangled & duplicate headers healing
        const ssRes = applyArgInterceptions('create_entry', [
            {
                tags: ['session-summary'],
                content:
                    '## Accomplishments\n- Did A\n## Accomplished\n- Did B\n## Blockers\n- None',
            },
        ])
        if ('args' in ssRes) {
            const content = (ssRes.args[0] as Record<string, unknown>)['content'] as string
            expect(content).toContain('## Accomplished')
            expect(content).toContain('## Unfinished / Blocked')
            expect(content).toContain('## Context for Next Session')
            expect(content).toContain('## Commits')
        }
    })

    it('handles search, IO, vector, deleted entries, analytics, GitHub, and backup interceptions', () => {
        expect(
            'error' in applyArgInterceptions('search_by_date_range', [{ query: 'bad' }])
        ).toBe(true)

        const searchOk = applyArgInterceptions('search_entries', [
            {
                q: 'term',
                start: '2026-01-01',
                limit: '10',
                exact_match: false,
            },
        ])
        if ('args' in searchOk) {
            const arg = searchOk.args[0] as Record<string, unknown>
            expect(arg['query']).toBe('term')
            expect(arg['start_date']).toBe('2026-01-01')
            expect(arg['end_date']).toBeDefined()
            expect(arg['limit']).toBe(10)
            expect(arg['fuzzy_match']).toBe(true)
            expect(arg['auto_correct']).toBe(true)
        }

        expect(
            'error' in applyArgInterceptions('semantic_search', [{ query: 'x', mode: 'hybrid' }])
        ).toBe(true)
        expect('error' in applyArgInterceptions('team_search', [{ query: 'x' }])).toBe(true)
        expect(
            'args' in
                applyArgInterceptions('team_search', [{ query: 'x', tags: ['flag:blocker'] }])
        ).toBe(true)
        expect(
            'error' in
                applyArgInterceptions('team_search_by_date_range', [{ start_date: '2026-01-01' }])
        ).toBe(true)

        // IO
        expect('error' in applyArgInterceptions('export_entries', [{ q: 'bad' }])).toBe(true)
        expect('error' in applyArgInterceptions('export_entries', [{ mode: 'bad' }])).toBe(true)
        expect('error' in applyArgInterceptions('export_entries', [{ path: '/tmp' }])).toBe(true)
        expect('error' in applyArgInterceptions('import_external', [{ url: 'http://x' }])).toBe(
            true
        )

        const ioExport = applyArgInterceptions('export_markdown', [{ keep: 5, path: '/out' }])
        if ('args' in ioExport) {
            expect(ioExport.args[0]).toEqual({ limit: 5, output_dir: '/out' })
        }

        const ioImport = applyArgInterceptions('import_external', [
            { filename: '/in', format: 'obsidian' },
        ])
        if ('args' in ioImport) {
            expect(ioImport.args[0]).toEqual({ source_dir: '/in', source_format: 'obsidian' })
        }

        // Vector & list deleted & analytics
        expect('error' in applyArgInterceptions('get_vector_index_stats', [{ q: 'x' }])).toBe(true)
        const reb = applyArgInterceptions('rebuild_vector_index', [true])
        if ('args' in reb) expect(reb.args[0]).toEqual({})

        expect('error' in applyArgInterceptions('list_deleted_entries', [{ q: 'x' }])).toBe(true)
        const delList = applyArgInterceptions('list_deleted_entries', [
            { keep: 10, project_number: 5, project_id: 5 },
        ])
        if ('args' in delList) expect(delList.args[0]).toEqual({ limit: 10 })

        expect('error' in applyArgInterceptions('get_statistics', [{ q: 'x' }])).toBe(true)
        const statOk = applyArgInterceptions('get_statistics', [{ timeframe: 'week' }])
        if ('args' in statOk) expect(statOk.args[0]).toEqual({ group_by: 'week' })
        expect(
            'error' in applyArgInterceptions('get_cross_project_insights', [{ limit: 5 }])
        ).toBe(true)

        // GitHub
        const ghIssue = applyArgInterceptions('create_github_issue_with_entry', [{ text: 'body' }])
        if ('args' in ghIssue) expect(ghIssue.args[0]).toEqual({ body: 'body' })

        const ghMs = applyArgInterceptions('create_github_milestone', [{ message: 'v1' }])
        if ('args' in ghMs) expect(ghMs.args[0]).toEqual({ title: 'v1' })

        const ghClose = applyArgInterceptions('close_github_issue_with_entry', [
            { text: 'c1', description: 'res1' },
        ])
        if ('args' in ghClose) {
            expect(ghClose.args[0]).toEqual({ comment: 'c1', resolution_notes: 'res1' })
        }

        const ghList = applyArgInterceptions('get_github_issues', [{ keep: true }])
        if ('args' in ghList) expect(ghList.args[0]).toEqual({ state: 'open' })

        expect('error' in applyArgInterceptions('get_github_issues', [{ q: 'bug' }])).toBe(true)
        expect('error' in applyArgInterceptions('get_github_context', [{ path: '/a' }])).toBe(true)

        const kbMove = applyArgInterceptions('move_kanban_item', [
            { keep: 'item-1', path: 'Done', mode: 'summary' },
        ])
        if ('args' in kbMove) {
            expect(kbMove.args[0]).toEqual({
                item_id: 'item-1',
                target_status: 'Done',
                summary_only: true,
            })
        }

        // Backups
        const bk1 = applyArgInterceptions('backup_journal', [{ description: 'daily' }])
        if ('args' in bk1) expect(bk1.args[0]).toEqual({ name: 'daily' })
        expect('error' in applyArgInterceptions('list_backups', [{ q: 'x' }])).toBe(true)
        expect('error' in applyArgInterceptions('list_backups', [{ limit: 5 }])).toBe(true)
        const bkRestore = applyArgInterceptions('restore_backup', [{ path: 'b.db' }])
        if ('args' in bkRestore) expect(bkRestore.args[0]).toEqual({ filename: 'b.db' })
        const bkClean = applyArgInterceptions('cleanup_backups', [{ keep: 3 }])
        if ('args' in bkClean) expect(bkClean.args[0]).toEqual({ keep_count: 3 })
    })

    it('handles single ID, batch, link_entries, merge_tags, audit, recent, tags, member, and alias tools', () => {
        expect('error' in applyArgInterceptions('delete_entry', [])).toBe(true)
        expect('error' in applyArgInterceptions('delete_entry', [[1, 2]])).toBe(true)
        expect('error' in applyArgInterceptions('delete_entry', [{ ids: [1, 2] }])).toBe(true)
        expect('error' in applyArgInterceptions('delete_entry', [{ foo: 'bar' }])).toBe(true)
        expect('error' in applyArgInterceptions('get_entry_by_id', [{ entry_id: 1, q: 'x' }])).toBe(
            true
        )
        expect('error' in applyArgInterceptions('delete_entry', [{ entry_id: 'abc' }])).toBe(true)
        expect('error' in applyArgInterceptions('delete_entry', ['abc'])).toBe(true)

        const singlePrim = applyArgInterceptions('get_entry_by_id', ['42'])
        if ('args' in singlePrim) expect(singlePrim.args[0]).toEqual({ entry_id: 42 })

        const delVer = applyArgInterceptions('delete_entry', [
            { path: 10, version: 2, project_number: 5 },
        ])
        if ('args' in delVer) expect(delVer.args[0]).toEqual({ entry_id: 10, expected_version: 2 })

        const upd2 = applyArgInterceptions('update_entry', [15, { text: 'updated' }])
        if ('args' in upd2) expect(upd2.args[0]).toEqual({ entry_id: 15, content: 'updated' })

        const updKeep = applyArgInterceptions('team_update_entry', [
            { entry_id: 1, keep: false, text: 'hi' },
        ])
        if ('args' in updKeep) {
            expect(updKeep.args[0]).toEqual({ entry_id: 1, is_archived: true, content: 'hi' })
        }
        expect('error' in applyArgInterceptions('update_entry', [{ entry_id: 1, q: 'bad' }])).toBe(
            true
        )

        // Batch
        const bc = applyArgInterceptions('batch_create_entries', [[{ content: 'a' }]])
        if ('args' in bc) expect(bc.args[0]).toEqual({ entries: [{ content: 'a' }] })
        expect('error' in applyArgInterceptions('batch_create_entries', [{ foo: 1 }])).toBe(true)

        const bu = applyArgInterceptions('batch_update_entries', [[{ entry_id: 1 }]])
        if ('args' in bu) expect(bu.args[0]).toEqual({ updates: [{ entry_id: 1 }] })
        expect('error' in applyArgInterceptions('batch_update_entries', [{ foo: 1 }])).toBe(true)

        const bdStr = applyArgInterceptions('batch_delete_entries', ['1, 2, 3'])
        if ('args' in bdStr) expect(bdStr.args[0]).toEqual({ entry_ids: [1, 2, 3] })
        const bdArr = applyArgInterceptions('batch_delete_entries', [[1, 2]])
        if ('args' in bdArr) expect(bdArr.args[0]).toEqual({ entry_ids: [1, 2] })
        const bdMulti = applyArgInterceptions('batch_delete_entries', [4, 5])
        if ('args' in bdMulti) expect(bdMulti.args[0]).toEqual({ entry_ids: [4, 5] })
        expect('error' in applyArgInterceptions('batch_delete_entries', [['1', '2']])).toBe(true)
        expect('error' in applyArgInterceptions('batch_delete_entries', [{ foo: 1 }])).toBe(true)

        // Link, merge_tags, audit, recent, list_tags, test, member, alias
        const linkRes = applyArgInterceptions('link_entries', [
            { source: 1, target: 2, type: 'blocks', notes: 'n' },
        ])
        if ('args' in linkRes) {
            expect(linkRes.args[0]).toEqual({
                from_entry_id: 1,
                to_entry_id: 2,
                relationship_type: 'blocks',
                description: 'n',
            })
        }

        const mergeOk = applyArgInterceptions('merge_tags', [
            { source_tags: ['old'], new_tag: 'new' },
        ])
        if ('args' in mergeOk) {
            expect(mergeOk.args[0]).toEqual({ source_tag: 'old', target_tag: 'new' })
        }
        expect(
            'error' in applyArgInterceptions('merge_tags', [{ source_tag: 'a,b', target_tag: 'c' }])
        ).toBe(true)

        const auditRes = applyArgInterceptions('search_audit_log', [{ keep: '25' }])
        if ('args' in auditRes) expect(auditRes.args[0]).toEqual({ limit: 25 })

        expect('error' in applyArgInterceptions('get_recent_entries', [{ q: 'x' }])).toBe(true)
        const recOk = applyArgInterceptions('get_recent_entries', [{ keep: 5 }])
        if ('args' in recOk) expect(recOk.args[0]).toEqual({ limit: 5 })

        expect('error' in applyArgInterceptions('list_tags', [{ q: 'x' }])).toBe(true)

        const testErr = applyArgInterceptions('test_error_handling', [
            { text: 'msg', type: 'validation' },
        ])
        if ('args' in testErr) {
            expect(testErr.args[0]).toEqual({ message: 'msg', error_type: 'validation' })
        }

        const memRes = applyArgInterceptions('team_add_member', [
            { username: 'bob', permission: 'admin' },
        ])
        if ('args' in memRes) expect(memRes.args[0]).toEqual({ author: 'bob', role: 'admin' })

        const aliasRes = applyArgInterceptions('team_add_author_alias', [
            { from: 'bobby', to: 'bob' },
        ])
        if ('args' in aliasRes) {
            expect(aliasRes.args[0]).toEqual({ alias: 'bobby', canonical_author: 'bob' })
        }

        const aliasQ = applyArgInterceptions('team_resolve_author', [{ q: 'bob' }])
        if ('args' in aliasQ) {
            expect(aliasQ.args[0]).toEqual({
                canonical_author: 'bob',
                author: 'bob',
                alias: 'bob',
            })
        }
    })
})

describe('src/codemode/api/param-normalizer.ts (convertKeysToSnakeCase & normalizeParams)', () => {
    it('converts camelCase keys, context-aware aliases, roles, significance, tags, and relationships', () => {
        const res1 = convertKeysToSnakeCase(
            {
                entry: { title: 'Nested Title', role: 'contributor' },
                id: '10',
                type: 'session-summary',
                significanceType: 'invalid_sig',
                entryIds: ['1', '2'],
                tag: 'session_summary',
                relationships: [{ target_id: 5, relation_type: 'relates_to' }],
                commits: ['1234567'],
                projectNumber: '5',
                entries: [{ content: 'batch item' }],
                filter: { id: 99, proj: 7, customFilter: 'yes' },
            },
            'createEntry'
        )
        expect(res1['entry_id']).toBe(10)
        expect(res1['entry_type']).toBe('retrospective')
        expect(res1['role']).toBe('member')
        expect(res1['significance_type']).toBeUndefined()
        expect(res1['entry_ids']).toEqual([1, 2])
        expect(res1['tags']).toEqual(['session-summary'])
        expect(res1['relationships']).toEqual([{ targetId: 5, relationType: 'relates_to' }])
        expect(res1['auto_context']).toBe(JSON.stringify({ commits: ['1234567'] }))
        expect((res1['entries'] as Record<string, unknown>[])[0]?.['project_number']).toBe(5)
        expect(res1['custom_filter']).toBe('yes')

        // Context-aware filename, target_user, export type, path, source, GitHub tools
        expect(
            convertKeysToSnakeCase({ filename: '/dir', project_number: 1 }, 'importMarkdown')[
                'source_dir'
            ]
        ).toBe('/dir')
        expect(
            convertKeysToSnakeCase({ target_user: 'alice', role: 'admin' }, 'teamAddMember')['author']
        ).toBe('alice')
        expect(convertKeysToSnakeCase({ type: 'json' }, 'exportEntries')['format']).toBe('json')
        expect(convertKeysToSnakeCase({ path: '/out' }, 'exportMarkdown')['output_dir']).toBe(
            '/out'
        )
        expect(convertKeysToSnakeCase({ source: 'obsidian' }, 'importExternal')['source_format']).toBe(
            'obsidian'
        )
        expect(
            convertKeysToSnakeCase(
                { name: 'Issue Title', message: 'Issue Body' },
                'createGithubIssue'
            )
        ).toEqual({ title: 'Issue Title', body: 'Issue Body' })
        expect(
            convertKeysToSnakeCase({ description: 'MS Desc' }, 'createGithubMilestone')[
                'description'
            ]
        ).toBe('MS Desc')
        expect(
            convertKeysToSnakeCase({ message: 'Closing' }, 'closeGithubIssue')['comment']
        ).toBe('Closing')
    })

    it('heals session-summary headers, commit-narrative SHAs, auto_context shas, and normalizeParams positional args', () => {
        const ss = convertKeysToSnakeCase({
            content: '## Accomplished\n- A\n## Unfinished / Blocked\n- None',
        })
        expect(ss['entry_type']).toBe('retrospective')
        expect(ss['tags']).toContain('session-summary')
        expect(ss['content']).toContain('## Context for Next Session')
        expect(ss['content']).toContain('## Commits')

        const cn = convertKeysToSnakeCase({
            tags: ['commit_narrative'],
            content: 'Fixed bug in commit a1b2c3d4e5f',
        })
        expect(cn['auto_context']).toBe(JSON.stringify({ commits: ['a1b2c3d4e5f'] }))

        const acStr = convertKeysToSnakeCase({
            auto_context: JSON.stringify({ commit_shas: 'abc1234' }),
        })
        expect(acStr['auto_context']).toBe(JSON.stringify({ commits: ['abc1234'] }))

        const acObj = convertKeysToSnakeCase({
            auto_context: { shas: 'def5678' },
        })
        expect(acObj['auto_context']).toEqual({ commits: ['def5678'] })

        // normalizeParams
        expect(normalizeParams('createEntry', [])).toBeUndefined()
        const synth = normalizeParams('createEntry', [
            { entry_type: 'technical_note', summary: 'My summary', extra: { k: 1 } },
        ]) as Record<string, unknown>
        expect(synth['content']).toContain('**summary**')
        expect(synth['content']).toContain('**extra**')

        expect(normalizeParams('createEntry', ['hello'])).toEqual({ content: 'hello' })
        expect(normalizeParams('getEntryById', [42])).toEqual({ entry_id: 42 })
        expect(normalizeParams('unknownMethod', ['str'])).toEqual({
            content: 'str',
            query: 'str',
        })
        expect(normalizeParams('linkEntries', [1, 2, 'blocks'])).toEqual({
            from_entry_id: 1,
            to_entry_id: 2,
            relationship_type: 'blocks',
        })
        expect(normalizeParams('createEntry', ['Positional content', { tags: ['t1'] }])).toEqual({
            content: 'Positional content',
            tags: ['t1'],
        })
    })
})
