import { describe, it, expect } from 'vitest'
import * as vm from 'node:vm'
import { wrapResult } from '../src/codemode/worker-result-proxy.js'
import { ExecuteCodeSchema } from '../src/handlers/tools/codemode/schemas.js'
import { healCodeModeScript, extractAndRecoverEntryCode } from '../src/handlers/tools/codemode/handler.js'
import { databaseOptionsSchema, networkOptionsSchema } from '../src/cli/schemas.js'
import { getDummyHealingTools } from '../src/handlers/tools/core/dummy-healing.js'

describe('Code Mode Anti-Hallucination & Healing Guardrails', () => {
    describe('Layer 2: Template Literal Unescaped Backtick Auto-Healing', () => {
        it('should heal code containing unescaped backticks in template literals (agent-issues.jsonl regression)', () => {
            const buggyCode = [
                'return await mj.core.createEntry({',
                '    entry_type: "retrospective",',
                '    tags: ["session-summary", "maintenance"],',
                '    title: "Dependency Updates & Favicon Extraction",',
                '    content: `## Accomplished',
                '- Successfully updated \\`pnpm\\` major dev dependencies (\\`vite\\`, \\`@vitejs/plugin-react\\`, \\`@types/node\\`).',
                '- Evaluated TypeScript 7.0.2 upgrade but identified an ecosystem conflict with \\`typescript-eslint\\`, causing us to intentionally hold back at \\`^6.0.3\\`.',
                '- Migrated \\`vite.config.ts\\` path resolution from the deprecated \\`__dirname\\` CommonJS global to \\`import.meta.dirname\\` to satisfy Vite 8.',
                '- Eliminated extraneous \\`npm\\` `.npmrc` configuration warnings by explicitly configuring \\`wrangler.toml\\` to build via \\`pnpm run build\\`.',
                '- Investigated global \\`wrangler\\` installation failures and diagnosed that \\`pnpm\\` natively blocked it due to a \\`minimum-release-age\\` supply-chain security guardrail.',
                '- Diagnosed a persistent Content Security Policy (CSP) violation inside the Cloudflare Access UI, identifying it as a known platform-level bug blocking its own inline \\`data:\\` SVG logo.',
                '- Extracted the application\'s inline favicon to \\`public/favicon.svg\\` to serve as a valid HTTPS endpoint.',
                '',
                '## Unfinished / Blocked',
                '- None',
                '',
                '## Context for Next Session',
                '- The repository is completely up to date, typechecked, linted, and ready for deployment.',
                '- The next session will focus on deploying the new version.',
                '- Remember to configure the custom logo URL using \\`https://d1.adamic.tech/favicon.svg\\` once deployed.`,',
                '    project_number: 1,',
                '    session_id: "2026-08-19-maintenance"',
                '})'
            ].join('\n')

            const healed = healCodeModeScript(buggyCode)
            expect(healed).toBeDefined()

            // Verify that the healed code is valid JavaScript syntax in a VM context
            const wrapped = `(async () => {
                const mj = {
                    core: {
                        createEntry: async (entry) => entry
                    }
                };
                ${healed}
            })()`
            expect(() => {
                new vm.Script(wrapped)
            }).not.toThrow()
        })

        it('should recover entry creation payload using extractAndRecoverEntryCode on mangled code', () => {
            const mangledCode = `mj.createEntry({
                title: "Session Retrospective",
                entry_type: "retrospective",
                project_number: 2,
                session_id: "sess-123",
                content: \`## Accomplished\n- Did something with \`.npmrc\` and \`pnpm\`\`
            })`

            const recovered = extractAndRecoverEntryCode(mangledCode)
            expect(recovered).toBeDefined()
            expect(recovered).toContain('return await mj.createEntry(')
            expect(recovered).toContain('"Session Retrospective"')
            expect(recovered).toContain('## Accomplished')
        })
    })

    describe('Layer 3: Worker Result Proxy Failed Result Safety', () => {
        it('should safely return empty arrays and 0 length on failed result object without throwing', () => {
            const failedResult = wrapResult({
                success: false,
                error: 'Entry 9999 not found',
                code: 'NOT_FOUND',
            }) as Record<string, unknown>

            expect(failedResult['success']).toBe(false)
            expect(failedResult['relationships']).toEqual([])
            expect(failedResult['entries']).toEqual([])
            expect(failedResult['projects']).toEqual([])
            expect(failedResult['length']).toBe(0)
            expect(typeof failedResult['map']).toBe('function')
            expect((failedResult['map'] as (fn: (x: unknown) => unknown) => unknown[])(() => 1)).toEqual([])
        })
    })

    describe('Layer 1: ExecuteCodeSchema Parameter Preservation', () => {
        it('should preserve entry and instructions fields when passed to ExecuteCodeSchema', () => {
            const parsed = ExecuteCodeSchema.parse({
                entry: { title: 'Test Entry', content: 'Testing auto-healing' },
                instructions: 'Write a journal entry',
            })

            expect(parsed['entry']).toBeDefined()
            expect(parsed['instructions']).toBe('Write a journal entry')
        })
    })

    describe('Layer 2: Empty Payload Auto-Healing Interceptor', () => {
        it('should parse empty objects with default values', () => {
            const parsed = ExecuteCodeSchema.parse({})
            expect(parsed['auto_version']).toBe(true)
            expect(parsed['dry_run']).toBe(false)
            expect(parsed['code']).toBeUndefined()
        })
    })

    describe('Layer 4: CLI Option Aliases & Schema Guardrails', () => {
        it('should allow --database and --team-database in databaseOptionsSchema', () => {
            const parsedDb = databaseOptionsSchema.parse({ database: './custom.db', teamDatabase: './team.db' })
            expect(parsedDb.database).toBe('./custom.db')
            expect(parsedDb.teamDatabase).toBe('./team.db')

            const parsedNet = networkOptionsSchema.parse({ http: true, stdio: false })
            expect(parsedNet.http).toBe(true)
            expect(parsedNet.stdio).toBe(false)
        })
    })

    describe('Layer 5: Dummy Tool Protocol Resource & Prompt Healing', () => {
        const tools = getDummyHealingTools()

        it('should have read_resource and mj_read_resource handlers in dummy healing tools', async () => {
            const readResourceTool = tools.find(t => t.name === 'read_resource')
            const mjReadResourceTool = tools.find(t => t.name === 'mj_read_resource')

            expect(readResourceTool).toBeDefined()
            expect(mjReadResourceTool).toBeDefined()

            const res = await readResourceTool!.handler({}) as Record<string, unknown>
            expect(res['success']).toBe(false)
            expect(String(res['error'])).toContain('AUTONOMOUS HEALING')
        })

        it('should have list_resources and list_prompts dummy tool handlers', async () => {
            const listResourcesTool = tools.find(t => t.name === 'list_resources')
            const listPromptsTool = tools.find(t => t.name === 'list_prompts')
            const listToolsTool = tools.find(t => t.name === 'list_tools')

            expect(listResourcesTool).toBeDefined()
            expect(listPromptsTool).toBeDefined()
            expect(listToolsTool).toBeDefined()

            const resResources = await listResourcesTool!.handler({}) as Record<string, unknown>
            expect(resResources['success']).toBe(true)
            expect(Array.isArray(resResources['resources'])).toBe(true)
            expect(String(resResources['_healing_note'])).toContain('AUTONOMOUS HEALING')

            const resPrompts = await listPromptsTool!.handler({}) as Record<string, unknown>
            expect(resPrompts['success']).toBe(true)
            expect(Array.isArray(resPrompts['prompts'])).toBe(true)
            expect(String(resPrompts['_healing_note'])).toContain('AUTONOMOUS HEALING')

            const resTools = await listToolsTool!.handler({}) as Record<string, unknown>
            expect(resTools['success']).toBe(true)
            expect(Array.isArray(resTools['tools'])).toBe(true)
            expect(String(resTools['_healing_note'])).toContain('AUTONOMOUS HEALING')
        })

        it('should have load-briefing and mj_session_summary dummy prompt handlers', async () => {
            const loadBriefingTool = tools.find(t => t.name === 'load-briefing')
            const sessionSummaryTool = tools.find(t => t.name === 'session-summary')

            expect(loadBriefingTool).toBeDefined()
            expect(sessionSummaryTool).toBeDefined()

            const res = await loadBriefingTool!.handler({}) as Record<string, unknown>
            expect(res['success']).toBe(false)
            expect(String(res['error'])).toContain('AUTONOMOUS HEALING')
        })

        it('should provide autonomous healing handlers for dotted code mode functions', async () => {
            const dottedTool = tools.find(t => t.name === 'mj.core.createEntry')

            expect(dottedTool).toBeDefined()
            const res = await dottedTool!.handler({}) as Record<string, unknown>
            expect(res['success']).toBe(false)
            expect(String(res['error'])).toContain('AUTONOMOUS HEALING')
        })

        it('should provide autonomous healing handlers for SQL and database execution dummy tools', async () => {
            const sqliteCodeTool = tools.find(t => t.name === 'sqlite_execute_code')
            const execSqlTool = tools.find(t => t.name === 'execute_sql')
            const sqlQueryTool = tools.find(t => t.name === 'sql_query')

            expect(sqliteCodeTool).toBeDefined()
            expect(execSqlTool).toBeDefined()
            expect(sqlQueryTool).toBeDefined()

            const res = await sqliteCodeTool!.handler({}) as Record<string, unknown>
            expect(res['success']).toBe(false)
            expect(String(res['error'])).toContain('AUTONOMOUS HEALING')
        })
    })

    describe('Layer 2: SQL Query Code Mode Auto-Healing (agent-issues.jsonl regression)', () => {
        it('should auto-heal raw SELECT queries from agent issues into valid Code Mode calls', () => {
            const rawSql = 'SELECT id, type, content, metadata FROM journal_entries ORDER BY id DESC LIMIT 10;'
            const healed = healCodeModeScript(rawSql)

            expect(healed).toBeDefined()
            expect(healed).toContain('mj.core.getRecentEntries')
            expect(healed).toContain('"limit":10')

            // Verify healed code compiles and executes in a VM script
            const wrapped = `(async () => {
                let calledWith = null;
                const mj = {
                    core: {
                        getRecentEntries: async (params) => {
                            calledWith = params;
                            return { success: true, entries: [] };
                        }
                    }
                };
                ${healed}
            })()`
            expect(() => {
                new vm.Script(wrapped)
            }).not.toThrow()
        })

        it('should auto-heal SELECT by ID queries', () => {
            const rawSql = 'SELECT * FROM journal_entries WHERE id = 42;'
            const healed = healCodeModeScript(rawSql)

            expect(healed).toBeDefined()
            expect(healed).toContain('mj.core.getEntryById')
            expect(healed).toContain('entry_id: 42')
        })

        it('should auto-heal SELECT queries with LIKE content filters into search calls', () => {
            const rawSql = "SELECT * FROM entries WHERE content LIKE '%authentication%';"
            const healed = healCodeModeScript(rawSql)

            expect(healed).toBeDefined()
            expect(healed).toContain('mj.search.searchEntries')
            expect(healed).toContain('authentication')
        })

        it('should auto-heal COUNT(*) queries into analytics statistics calls', () => {
            const rawSql = 'SELECT count(*) FROM journal_entries;'
            const healed = healCodeModeScript(rawSql)

            expect(healed).toBeDefined()
            expect(healed).toContain('mj.analytics.getStatistics')
        })

        it('should auto-heal queries on tags table into listTags', () => {
            const rawSql = 'SELECT * FROM tags;'
            const healed = healCodeModeScript(rawSql)

            expect(healed).toBeDefined()
            expect(healed).toContain('mj.core.listTags')
        })

        it('should auto-heal PRAGMA and SHOW commands into getStatistics', () => {
            const pragmaSql = 'PRAGMA table_info(journal_entries);'
            const healedPragma = healCodeModeScript(pragmaSql)
            expect(healedPragma).toContain('mj.analytics.getStatistics')

            const showSql = 'SHOW TABLES;'
            const healedShow = healCodeModeScript(showSql)
            expect(healedShow).toContain('mj.analytics.getStatistics')
        })
    })

    describe('Layer 2 & 3: better-sqlite3 and child_process Execution Auto-Healing (agent-issues.jsonl regression)', () => {
        it('should auto-heal better-sqlite3 require and constructor calls into safe execution', () => {
            const sqliteCode = [
                'const sqlite3 = require("better-sqlite3");',
                'const db = new sqlite3("C:/Users/chris/Desktop/db-mcp/data/test-backup.db");',
                'db.exec("CREATE TABLE test (id INT); INSERT INTO test VALUES (1);");',
                'db.close();',
                'return { success: true };',
            ].join('\n')

            const healed = healCodeModeScript(sqliteCode)
            expect(healed).toBeDefined()
            expect(healed).not.toContain('require("better-sqlite3")')
            expect(healed).toContain('const sqlite3 = mj.sqlite3;')

            // Test execution in a sandbox-like VM environment
            const wrapped = `(async () => {
                const callableFn = function() { return mj; };
                const createCallableShim = () => new Proxy(callableFn, {
                    apply() { return mj; },
                    construct() { return mj; },
                    get(_t, p) { return mj[p]; }
                });
                const mj = {
                    sqlite3: createCallableShim(),
                    close: () => ({ success: true }),
                    exec: () => ({ success: true })
                };
                ${healed}
            })()`

            expect(() => {
                const script = new vm.Script(wrapped)
                const context = vm.createContext({})
                script.runInContext(context)
            }).not.toThrow()
        })

        it('should auto-heal child_process require and execSync calls into safe execution', () => {
            const cpCode = [
                "const cp = require('child_process');",
                'cp.execSync(\'sqlite3 C:/Users/chris/Desktop/db-mcp/data/test-backup.db "CREATE TABLE test (id INT); INSERT INTO test VALUES (1);"\');',
                'return { success: true };',
            ].join('\n')

            const healed = healCodeModeScript(cpCode)
            expect(healed).toBeDefined()
            expect(healed).not.toContain("require('child_process')")
            expect(healed).not.toContain('child_process')
            expect(healed).toContain('const cp = mj;')

            const wrapped = `(async () => {
                const mj = {
                    execSync: () => '',
                };
                ${healed}
            })()`

            expect(() => {
                const script = new vm.Script(wrapped)
                const context = vm.createContext({})
                script.runInContext(context)
            }).not.toThrow()
        })
    })

    describe('Regression Tests: Issue Logs Healing (agent-issues.jsonl)', () => {
        it('should register add_journal_entry, mj_add_entry, and creation aliases in dummy healing tools', () => {
            const dummyTools = getDummyHealingTools(undefined)
            const names = dummyTools.map(t => t.name)
            expect(names).toContain('add_journal_entry')
            expect(names).toContain('mj_add_entry')
            expect(names).toContain('create_journal_entry')
            expect(names).toContain('log_journal')
            expect(names).toContain('append_entry')
        })

        it('should auto-unwrap nested mj_execute_code and __mcp.mj.execute_code calls', () => {
            const nested1 = 'const res = await mj_execute_code({ code: `await mj.core.createEntry({ content: "test" })` }); return res;'
            const healed1 = healCodeModeScript(nested1)
            expect(healed1).toContain('await mj.core.createEntry({ content: "test" })')
            expect(healed1).not.toContain('mj_execute_code({')

            const nested2 = 'return await __mcp.mj.execute_code(`await journal.append({ content: "test" })`)'
            const healed2 = healCodeModeScript(nested2)
            expect(healed2).toContain('await journal.append({ content: "test" })')
            expect(healed2).not.toContain('__mcp.mj.execute_code')
        })

        it('should auto-proxy array results to support .projects, .entries, and direct array methods', () => {
            const rawArray = [
                { name: 'db-mcp', project_number: 1, path: '/path/db-mcp' },
                { name: 'memory-journal', project_number: 2, path: '/path/mj' },
            ]
            const wrapped = wrapResult(rawArray) as Record<string, unknown>

            expect(wrapped['success']).toBe(true)
            // Accessing .projects on an array returns the array itself
            const projectsProp = wrapped['projects'] as unknown[]
            expect(Array.isArray(projectsProp)).toBe(true)
            expect(projectsProp.length).toBe(2)

            // Finding element on projects property
            const foundOnProp = (projectsProp as { name: string; project_number: number }[]).find((p) => p.name === 'db-mcp')
            expect(foundOnProp).toBeDefined()
            expect(foundOnProp?.project_number).toBe(1)

            // Finding element directly on wrapped array
            const foundDirect = (wrapped as unknown as { name: string; project_number: number }[]).find((p) => p.name === 'memory-journal')
            expect(foundDirect).toBeDefined()
            expect(foundDirect?.project_number).toBe(2)
        })

        it('should auto-proxy dictionary project objects to allow array methods like .find and .map', () => {
            const dictResult = {
                success: true,
                projects: {
                    'db-mcp': { path: 'C:/Users/chris/Desktop/db-mcp', project_number: 1 },
                    'memory-journal-mcp': { path: 'C:/Users/chris/Desktop/memory-journal-mcp', project_number: 2 },
                },
            }
            const wrapped = wrapResult(dictResult) as Record<string, unknown>

            // Accessing projects sub-object directly allows .find()
            const projects = wrapped['projects'] as Record<string, unknown>
            const foundProject = (projects as unknown as { find: (predicate: (p: { name: string; project_number: number }) => boolean) => { name: string; project_number: number } | undefined }).find(
                (p) => p.name === 'db-mcp'
            )
            expect(foundProject).toBeDefined()
            expect(foundProject?.project_number).toBe(1)
            expect(foundProject?.name).toBe('db-mcp')

            // Direct dictionary lookup still works seamlessly
            const directLookup = projects['db-mcp'] as { project_number: number; path: string }
            expect(directLookup).toBeDefined()
            expect(directLookup.project_number).toBe(1)

            // Iteration on wrapped dictionary works
            const iterated: unknown[] = []
            for (const item of projects as unknown as Iterable<unknown>) {
                iterated.push(item)
            }
            expect(iterated.length).toBe(2)

            // Array methods directly on success result wrapper delegating to projects dictionary
            const foundFromRoot = (wrapped as unknown as { find: (predicate: (p: { name: string; project_number: number }) => boolean) => { name: string; project_number: number } | undefined }).find(
                (p) => p.name === 'memory-journal-mcp'
            )
            expect(foundFromRoot).toBeDefined()
            expect(foundFromRoot?.project_number).toBe(2)
        })

        it('should auto-heal unquoted prose script with entry_id and content (Issue 1 regression)', () => {
            const proseCode = 'Replaced naive Math.sqrt vector normalization with numerically stable hypot fallback.'
            const healedUpdate = extractAndRecoverEntryCode(`updateEntry({
                title: "Vector Normalization Fix",
                entry_id: 105,
                content: \`${proseCode}\`,
                type: "bugfix"
            })`)
            expect(healedUpdate).toBeDefined()
            expect(healedUpdate).toContain('mj.updateEntry')
            expect(healedUpdate).toContain('Vector Normalization Fix')
            expect(healedUpdate).toContain('"entry_id":105')

            const healedCreate = extractAndRecoverEntryCode(`createEntry({
                title: "Vector Normalization Fix",
                content: \`${proseCode}\`,
                type: "bugfix"
            })`)
            expect(healedCreate).toBeDefined()
            expect(healedCreate).toContain('mj.createEntry')
            expect(healedCreate).toContain('Vector Normalization Fix')
        })

        it('should auto-heal confidence, impact, trust, and validation in CreateEntrySchema (agent-issues.jsonl Record 3 regression)', async () => {
            const { CreateEntrySchema } = await import('../src/handlers/tools/core/schemas.js')
            const rawPayload = {
                confidence: 0.95,
                content: 'Comprehensive test suite for StatsSampleSchema and output validation.',
                impact: 0.7,
                tags: ['stats', 'testing', 'schema', 'sqlite'],
                title: 'Test Suite Enhancement: StatsSampleSchema & Output Tests',
                trust: 0.95,
                type: 'code_change',
                validation: 'passed',
                project_number: 15
            }

            const parsed = CreateEntrySchema.parse(rawPayload)
            expect(parsed.trust_score).toBe(0.95)
            expect(parsed.impact_score).toBe(0.7)
            expect(parsed.validation_status).toBe('passed')
            expect(parsed.content).toContain('Test Suite Enhancement: StatsSampleSchema & Output Tests')
            expect(parsed.content).toContain('Comprehensive test suite')
            expect(parsed.entry_type).toBe('other')
        })

        it('should auto-resolve db-mcp project_number from sqlite keywords in tags or content (agent-issues.jsonl Records 1, 2, 4 regression)', async () => {
            const { resolveProjectContext } = await import('../src/utils/workspace-resolver.js')
            const mockConfig = {
                projectRegistry: {
                    'db-mcp': {
                        path: 'C:/Users/chris/Desktop/db-mcp',
                        project_number: 15
                    },
                    'memory-journal-mcp': {
                        path: 'C:/Users/chris/Desktop/memory-journal-mcp',
                        project_number: 5
                    }
                }
            }

            // Record 1: tags containing sqlite.json.diff and content mentioning SQLite
            const res1 = resolveProjectContext({
                tags: ['sqlite.json.diff', 'json', 'sqlite3.45'],
                content: "Added error mapping for 'bad json path' in src/utils/errors/suggestions.ts to correctly map SQLite 3.45 JSON path execution errors"
            }, mockConfig as unknown as import('../src/types/index.js').ToolHandlerConfig)
            expect(res1.workspaceId).toBe('db-mcp')
            expect(res1.projectNumber).toBe(15)

            // Record 2: tags containing sqlite.stats and content mentioning sqlite.stats.statsHypothesis
            const res2 = resolveProjectContext({
                tags: ['sqlite.stats', 'testing'],
                content: '# Test statsHypothesis and windowRowNumber\n\n- Tested sqlite.stats.statsHypothesis with code mode'
            }, mockConfig as unknown as import('../src/types/index.js').ToolHandlerConfig)
            expect(res2.workspaceId).toBe('db-mcp')
            expect(res2.projectNumber).toBe(15)

            // Record 4: tags containing sqlite.admin and content mentioning sqlite.admin.pragmaSettings
            const res4 = resolveProjectContext({
                tags: ['sqlite.admin', 'documentation', 'error-handling'],
                content: 'Updated sqlite.admin.pragmaSettings tool in src/adapters/sqlite/tools/admin/pragma.ts'
            }, mockConfig as unknown as import('../src/types/index.js').ToolHandlerConfig)
            expect(res4.workspaceId).toBe('db-mcp')
            expect(res4.projectNumber).toBe(15)
        })

        it('should support mj.search.queryEntries and aliases via METHOD_ALIASES (agent-issues.jsonl Record 1 regression)', async () => {
            const { METHOD_ALIASES } = await import('../src/codemode/api-constants.js')
            expect(METHOD_ALIASES['search']?.['queryEntries']).toBe('searchEntries')
            expect(METHOD_ALIASES['search']?.['query_entries']).toBe('searchEntries')
            expect(METHOD_ALIASES['search']?.['find_entries']).toBe('searchEntries')
            expect(METHOD_ALIASES['search']?.['list_entries']).toBe('searchEntries')
            expect(METHOD_ALIASES['core']?.['queryEntries']).toBe('searchEntries')
            expect(METHOD_ALIASES['core']?.['query_entries']).toBe('searchEntries')
        })

        it('should expose total and totalCount on search and entries results via wrapResult (agent-issues.jsonl Record 1 regression)', () => {
            const mockSearchResult = wrapResult({ success: true, count: 42, entries: [{ id: 1 }, { id: 2 }] }) as Record<string, unknown>
            expect(mockSearchResult['total']).toBe(42)
            expect(mockSearchResult['totalCount']).toBe(42)
            expect(mockSearchResult['total_entries']).toBe(42)
            expect(mockSearchResult['totalEntries']).toBe(42)

            const mockListResult = wrapResult({ success: true, entries: [{ id: 1 }, { id: 2 }, { id: 3 }] }) as Record<string, unknown>
            expect(mockListResult['total']).toBe(3)
            expect(mockListResult['totalCount']).toBe(3)
            expect(mockListResult['total_entries']).toBe(3)
            expect(mockListResult['totalEntries']).toBe(3)
        })

        it('should accept offset in GetRecentEntriesSchema and GetRecentEntriesSchemaMcp (agent-issues.jsonl Record 2 regression)', async () => {
            const { GetRecentEntriesSchema, GetRecentEntriesSchemaMcp } = await import('../src/handlers/tools/core/schemas.js')
            const parsedCore = GetRecentEntriesSchema.parse({ limit: 50, offset: 100, workspace_id: '*' })
            expect(parsedCore.offset).toBe(100)
            expect(parsedCore.limit).toBe(50)

            const parsedMcp = GetRecentEntriesSchemaMcp.parse({ limit: '25', offset: '50' })
            expect(parsedMcp.offset).toBe('50')
            expect(parsedMcp.limit).toBe('25')

            const parsedMcpNum = GetRecentEntriesSchemaMcp.parse({ limit: 25, offset: 50 })
            expect(parsedMcpNum.offset).toBe(50)
            expect(parsedMcpNum.limit).toBe(25)
        })

        it('should coerce numeric string offset and limit in param-normalizer (agent-issues.jsonl Record 2 regression)', async () => {
            const { applyArgInterceptions } = await import('../src/codemode/param-normalizer.js')
            const result = applyArgInterceptions('getRecentEntries', [{ offset: '100', limit: '25' }])
            expect('args' in result).toBe(true)
            if ('args' in result) {
                const normalized = result.args[0] as Record<string, unknown>
                expect(normalized['offset']).toBe(100)
                expect(normalized['limit']).toBe(25)
            }
        })

        it('should auto-heal name and type in CreateEntrySchema (agent-issues.jsonl Record 5 regression)', async () => {
            const { CreateEntrySchema } = await import('../src/handlers/tools/core/schemas.js')
            const rawPayload = {
                content: 'Fix duplicate error message in `sqlite.json.validatePath` tool handler.\n- Removed redundant `!path.startsWith("$")` check in `C:\\Users\\chris\\Desktop\\db-mcp\\src\\adapters\\sqlite\\tools\\json-helpers\\read.ts` since `validateJsonPath` already performs this validation and throws an appropriate `ValidationError` containing the exact same message.',
                name: 'db-mcp_json_validatePath_duplicate_error_fix',
                type: 'concept'
            }

            const parsed = CreateEntrySchema.parse(rawPayload)
            expect(parsed.content).toContain('# db-mcp_json_validatePath_duplicate_error_fix')
            expect(parsed.content).toContain('Fix duplicate error message')
            expect(parsed.entry_type).toBe('other')
            expect(parsed.tags).toContain('concept')
            expect((parsed as Record<string, unknown>)['name']).toBeUndefined()
        })

        it('should auto-heal name in entry mutations via param-normalizer (agent-issues.jsonl Record 5 regression)', async () => {
            const { applyArgInterceptions } = await import('../src/codemode/param-normalizer.js')
            const result = applyArgInterceptions('createEntry', [{
                content: 'Some fix implementation details.',
                name: 'duplicate_error_fix',
                type: 'bugfix'
            }])
            expect('args' in result).toBe(true)
            if ('args' in result) {
                const normalized = result.args[0] as Record<string, unknown>
                expect(normalized['content']).toContain('# duplicate_error_fix')
                expect(normalized['content']).toContain('Some fix implementation details.')
                expect(normalized['name']).toBeUndefined()
            }
        })

        it('should auto-heal double-escaped single quotes in single-line createEntry calls (agent-issues.jsonl SyntaxError regression)', async () => {
            const rawCode = `return await mj.core.createEntry({ project_number: 15, title: 'Fixed SQL NULL bug in JSON operations', content: 'In test-advanced-json-part7, found that json_type and json_extract returned \\\\'invalid\\\\' for SQL NULL values due to improper handling in the json_error_position wrapper. Added explicit IS NULL check in the CASE statement.', tags: ['json', 'bugfix'] });`
            const healed = healCodeModeScript(rawCode)

            expect(healed).toContain(`returned \\'invalid\\' for SQL NULL values`)
            expect(() => {
                new vm.Script(`(async () => { const mj = { core: { createEntry: async (p) => p } }; ${healed} })()`)
            }).not.toThrow()
        })

        it('should auto-heal double-escaped double quotes in object properties and positional arguments', () => {
            const rawCode = `mj.core.createEntry({ title: "Fix \\\\"quoted\\\\" issue", content: "Details with \\\\"escaped\\\\" text", tags: ["quotes"] });`
            const healed = healCodeModeScript(rawCode)

            expect(healed).toContain(`\\"quoted\\"`)
            expect(healed).toContain(`\\"escaped\\"`)
            expect(() => {
                new vm.Script(`(async () => { const mj = { core: { createEntry: async (p) => p } }; ${healed} })()`)
            }).not.toThrow()

            const positionalCode = `mj.core.createEntry('Note with \\\\'nested\\\\' single quotes')`
            const healedPositional = healCodeModeScript(positionalCode)
            expect(healedPositional).toContain(`\\'nested\\'`)
            expect(() => {
                new vm.Script(`(async () => { const mj = { core: { createEntry: async (p) => p } }; ${healedPositional} })()`)
            }).not.toThrow()
        })

        it('should recover single-line entry creation with double-escaped quotes using extractAndRecoverEntryCode', () => {
            const mangledCode = `return await mj.core.createEntry({ project_number: 15, title: 'Fixed SQL NULL bug in JSON operations', content: 'In test-advanced-json-part7, found that json_type and json_extract returned \\\\'invalid\\\\' for SQL NULL values due to improper handling in the json_error_position wrapper. Added explicit IS NULL check in the CASE statement.', tags: ['json', 'bugfix'] });`
            const recovered = extractAndRecoverEntryCode(mangledCode)

            expect(recovered).toBeDefined()
            expect(recovered).toContain('return await mj.createEntry(')
            expect(recovered).toContain('"Fixed SQL NULL bug in JSON operations"')
            expect(recovered).toContain('invalid')
            expect(recovered).toContain('"project_number":15')
            expect(recovered).toContain('"json"')
        })

        it('should sanitize double-escaped quotes in param-normalizer entry mutations', async () => {
            const { applyArgInterceptions } = await import('../src/codemode/param-normalizer.js')
            const result = applyArgInterceptions('createEntry', [{
                content: "Returned \\'invalid\\' result with \\\"double\\\" quotes",
                title: 'Escaped quote test'
            }])
            expect('args' in result).toBe(true)
            if ('args' in result) {
                const normalized = result.args[0] as Record<string, unknown>
                expect(normalized['content']).toContain("Returned 'invalid' result with \"double\" quotes")
            }
        })

        it('should heal schema, .schema, tables, and \\d inspection commands to getStatistics', async () => {
            const { extractAndRecoverSqlCode } = await import('../src/handlers/tools/codemode/handler.js')
            expect(extractAndRecoverSqlCode('schema')).toBe('return await mj.analytics.getStatistics({});')
            expect(extractAndRecoverSqlCode('SCHEMA')).toBe('return await mj.analytics.getStatistics({});')
            expect(extractAndRecoverSqlCode('.schema')).toBe('return await mj.analytics.getStatistics({});')
            expect(extractAndRecoverSqlCode('tables')).toBe('return await mj.analytics.getStatistics({});')
            expect(extractAndRecoverSqlCode('.tables')).toBe('return await mj.analytics.getStatistics({});')
            expect(extractAndRecoverSqlCode('\\d')).toBe('return await mj.analytics.getStatistics({});')
        })

        it('should alias schema in METHOD_ALIASES for analytics and core', async () => {
            const { METHOD_ALIASES } = await import('../src/codemode/api-constants.js')
            expect(METHOD_ALIASES.analytics?.schema).toBe('getStatistics')
            expect(METHOD_ALIASES.analytics?.tables).toBe('getStatistics')
            expect(METHOD_ALIASES.core?.schema).toBe('getStatistics')
        })

        it('should parse learned_context and group_name in ExecuteCodeSchema', async () => {
            const { ExecuteCodeSchema } = await import('../src/handlers/tools/codemode/schemas.js')
            const parsed = ExecuteCodeSchema.safeParse({
                code: 'schema',
                auto_version: true,
                dry_run: false,
                group_name: 'schema',
                learned_context: 'In SQLite MCP tools, using sanitizeIdentifier for dropping views...'
            })
            expect(parsed.success).toBe(true)
            if (parsed.success) {
                expect(parsed.data.group_name).toBe('schema')
                expect(parsed.data.learned_context).toContain('sanitizeIdentifier')
            }
        })

        it('should coerce validationStatus aliases (validated, valid, pass, etc.) in CLI schemas', async () => {
            const { safeCoerceValidationStatus, baseEntryOptionsSchema } = await import('../src/cli/schemas.js')
            expect(safeCoerceValidationStatus.parse('validated')).toBe('passed')
            expect(safeCoerceValidationStatus.parse('valid')).toBe('passed')
            expect(safeCoerceValidationStatus.parse('verified')).toBe('passed')
            expect(safeCoerceValidationStatus.parse('passed')).toBe('passed')
            expect(safeCoerceValidationStatus.parse(true)).toBe('passed')
            expect(safeCoerceValidationStatus.parse('failed')).toBe('failed')
            expect(safeCoerceValidationStatus.parse('error')).toBe('failed')
            expect(safeCoerceValidationStatus.parse(false)).toBe('failed')
            expect(safeCoerceValidationStatus.parse('none')).toBe('none')
            expect(safeCoerceValidationStatus.parse('other_string')).toBe('none')

            const schemaRes = baseEntryOptionsSchema.safeParse({
                validationStatus: 'validated',
                trustScore: '9',
                impactScore: '3'
            })
            expect(schemaRes.success).toBe(true)
            if (schemaRes.success) {
                expect(schemaRes.data.validationStatus).toBe('passed')
                expect(schemaRes.data.trustScore).toBe(9)
                expect(schemaRes.data.impactScore).toBe(3)
            }
        })

        it('should normalize validationStatus and validation aliases in param-normalizer', async () => {
            const { applyArgInterceptions } = await import('../src/codemode/param-normalizer.js')
            const res = applyArgInterceptions('createEntry', [{
                content: 'Test content',
                validationStatus: 'validated'
            }])
            expect('args' in res).toBe(true)
            if ('args' in res) {
                const normalized = res.args[0] as Record<string, unknown>
                expect(normalized['validation_status']).toBe('passed')
            }
        })
    })

    describe('Layer 1 & Layer 2: Server Info & Health Diagnostics Healing Guardrails', () => {
        it('should include server_info and server_health in DUMMY_HEALING_TOOL_NAMES', async () => {
            const { DUMMY_HEALING_TOOL_NAMES, DUMMY_SERVER_INFO_TOOL_NAMES } = await import(
                '../src/handlers/tools/core/dummy-healing.js'
            )
            expect(DUMMY_SERVER_INFO_TOOL_NAMES).toContain('server_info')
            expect(DUMMY_SERVER_INFO_TOOL_NAMES).toContain('server_health')
            expect(DUMMY_HEALING_TOOL_NAMES.has('server_info')).toBe(true)
            expect(DUMMY_HEALING_TOOL_NAMES.has('server_health')).toBe(true)
            expect(DUMMY_HEALING_TOOL_NAMES.has('serverInfo')).toBe(true)
            expect(DUMMY_HEALING_TOOL_NAMES.has('serverHealth')).toBe(true)
            expect(DUMMY_HEALING_TOOL_NAMES.has('health')).toBe(true)
            expect(DUMMY_HEALING_TOOL_NAMES.has('status')).toBe(true)
        })

        it('should return server diagnostics and healing note when server_info is called as a dummy tool', async () => {
            const { getDummyHealingTools } = await import('../src/handlers/tools/core/dummy-healing.js')
            const tools = getDummyHealingTools()
            const serverInfoTool = tools.find((t) => t.name === 'server_info')
            expect(serverInfoTool).toBeDefined()
            if (serverInfoTool) {
                const result = (await serverInfoTool.handler({})) as Record<string, unknown>
                expect(result['success']).toBe(true)
                expect(result['status']).toBe('healthy')
                expect(result['server']).toBeDefined()
                const serverObj = result['server'] as Record<string, unknown>
                expect(serverObj['name']).toBe('memory-journal-mcp')
                expect(serverObj['version']).toBeDefined()
                expect(result['runtime']).toBeDefined()
                expect(result['_healing_note']).toContain('🛠️ AUTONOMOUS HEALING')
            }
        })

        it('should return health status and healing note when server_health is called as a dummy tool', async () => {
            const { getDummyHealingTools } = await import('../src/handlers/tools/core/dummy-healing.js')
            const tools = getDummyHealingTools()
            const serverHealthTool = tools.find((t) => t.name === 'server_health')
            expect(serverHealthTool).toBeDefined()
            if (serverHealthTool) {
                const result = (await serverHealthTool.handler({})) as Record<string, unknown>
                expect(result['success']).toBe(true)
                expect(result['status']).toBe('healthy')
                expect(result['_healing_note']).toContain('🛠️ AUTONOMOUS HEALING')
            }
        })

        it('should map server_info and server_health in METHOD_ALIASES for core, analytics, and admin', async () => {
            const { METHOD_ALIASES } = await import('../src/codemode/api-constants.js')
            expect(METHOD_ALIASES.core?.server_info).toBe('getStatistics')
            expect(METHOD_ALIASES.core?.server_health).toBe('getStatistics')
            expect(METHOD_ALIASES.analytics?.server_info).toBe('getStatistics')
            expect(METHOD_ALIASES.analytics?.server_health).toBe('getStatistics')
            expect(METHOD_ALIASES.admin?.server_info).toBe('getStatistics')
            expect(METHOD_ALIASES.admin?.server_health).toBe('getStatistics')
        })
    })

    describe('Layer 7: JSON.parse(context) and memory_read_resource Healing', () => {
        it('should auto-heal JSON.parse(context) expressions in healCodeModeScript', async () => {
            const { healCodeModeScript } = await import('../src/handlers/tools/codemode/handler.js')

            const rawScript1 = 'const data = JSON.parse(context);\nreturn await mj.core.createEntry(data);'
            const healed1 = healCodeModeScript(rawScript1)
            expect(healed1).toContain('(typeof context === "string" ? JSON.parse(context) : context)')

            const rawScript2 = 'const data = JSON.parse(context || "{}");'
            const healed2 = healCodeModeScript(rawScript2)
            expect(healed2).toContain('(typeof context === "string" ? JSON.parse(context) : context)')

            const rawScript3 = 'const payload = JSON.parse(context.data);'
            const healed3 = healCodeModeScript(rawScript3)
            expect(healed3).toContain('(typeof context.data === "string" ? JSON.parse(context.data) : context.data)')
        })

        it('should normalize _uri to uri in applyArgInterceptions for memory_read_resource and read_resource', async () => {
            const { applyArgInterceptions } = await import('../src/codemode/param-normalizer.js')

            const result1 = applyArgInterceptions('memory_read_resource', [{ _uri: 'memory://agent-id' }])
            expect('args' in result1).toBe(true)
            if ('args' in result1) {
                const normalized = result1.args[0] as Record<string, unknown>
                expect(normalized.uri).toBe('memory://agent-id')
                expect(normalized._uri).toBeUndefined()
            }

            const result2 = applyArgInterceptions('read_resource', [{ _uri: 'memory://briefing' }])
            expect('args' in result2).toBe(true)
            if ('args' in result2) {
                const normalized = result2.args[0] as Record<string, unknown>
                expect(normalized.uri).toBe('memory://briefing')
                expect(normalized._uri).toBeUndefined()
            }
        })

        it('should include memory_read_resource in dummy healing tools and resolve _uri', async () => {
            const { getDummyHealingTools, DUMMY_HEALING_TOOL_NAMES } = await import('../src/handlers/tools/core/dummy-healing.js')

            expect(DUMMY_HEALING_TOOL_NAMES.has('memory_read_resource')).toBe(true)
            expect(DUMMY_HEALING_TOOL_NAMES.has('memory_list_resources')).toBe(true)

            const tools = getDummyHealingTools()
            const memoryReadTool = tools.find((t) => t.name === 'memory_read_resource')
            expect(memoryReadTool).toBeDefined()
            if (memoryReadTool) {
                const res = (await memoryReadTool.handler({ _uri: 'memory://agent-id' })) as Record<string, unknown>
                expect(res['success']).toBe(false)
                expect(String(res['error'])).toContain('memory://agent-id')
                expect(String(res['error'])).toContain('AUTONOMOUS HEALING')
            }
        })

        it('should map memory_read_resource and read_resource in METHOD_ALIASES for core', async () => {
            const { METHOD_ALIASES } = await import('../src/codemode/api-constants.js')
            expect(METHOD_ALIASES.core?.memory_read_resource).toBe('readResource')
            expect(METHOD_ALIASES.core?.read_resource).toBe('readResource')
            expect(METHOD_ALIASES.core?.memoryReadResource).toBe('readResource')
        })
    })
})

