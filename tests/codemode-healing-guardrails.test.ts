import { describe, it, expect } from 'vitest'
import * as vm from 'node:vm'
import { wrapResult } from '../src/codemode/worker-result-proxy.js'
import { ExecuteCodeSchema } from '../src/handlers/tools/codemode/schemas.js'
import { healCodeModeScript, extractAndRecoverEntryCode, extractAndRecoverJsonCode } from '../src/handlers/tools/codemode/handler.js'
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

        it('should auto-proxy projects.items and projects.data on list_projects dictionary result (agent-issues.jsonl regression)', () => {
            const listResult = {
                success: true,
                projects: {
                    'db-mcp': { path: 'C:/Users/chris/Desktop/db-mcp', project_number: 15 },
                    'memory-journal-mcp': { path: 'C:/Users/chris/Desktop/memory-journal-mcp', project_number: 5 },
                },
            }
            const wrapped = wrapResult(listResult) as Record<string, unknown>

            // 1. projects.items is available directly on root wrapped result
            const items = wrapped['items'] as { name: string; project_number: number; description: string }[]
            expect(Array.isArray(items)).toBe(true)
            expect(items.length).toBe(2)

            // Testing exact predicate from agent-issues.jsonl: p.name.includes(...) || p.description.includes(...)
            const target1 = items.find((p) => p.name.includes('db-mcp') || p.description.includes('db-mcp'))
            expect(target1).toBeDefined()
            expect(target1?.name).toBe('db-mcp')
            expect(target1?.project_number).toBe(15)
            expect(typeof target1?.description).toBe('string')

            // Testing exact predicate from agent-issues.jsonl Record 2: p.name === "db-mcp" || p.name === "neverinfamous/db-mcp"
            const target2 = items.find((p) => p.name === 'db-mcp' || p.name === 'neverinfamous/db-mcp')
            expect(target2).toBeDefined()
            expect(target2?.project_number).toBe(15)

            // 2. nested wrapped.projects.items also available
            const projectsObj = wrapped['projects'] as Record<string, unknown>
            const nestedItems = projectsObj['items'] as { name: string; project_number: number; description: string }[]
            expect(Array.isArray(nestedItems)).toBe(true)
            expect(nestedItems.length).toBe(2)
            expect(nestedItems.find((p) => p.name === 'db-mcp')?.project_number).toBe(15)

            // 3. projects.data and nested projects.projects.data also available
            const data = wrapped['data'] as { name: string; project_number: number }[]
            expect(Array.isArray(data)).toBe(true)
            expect(data.find((p) => p.name === 'db-mcp')?.project_number).toBe(15)

            const nestedData = projectsObj['data'] as { name: string; project_number: number }[]
            expect(Array.isArray(nestedData)).toBe(true)
            expect(nestedData.find((p) => p.name === 'db-mcp')?.project_number).toBe(15)
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

        it('should auto-resolve project_number from snake_case keywords and tokenized tags (Issue 1 regression)', async () => {
            const { resolveProjectContext } = await import('../src/utils/workspace-resolver.js')
            const mockConfig = {
                projectRegistry: {
                    'db-mcp': {
                        path: 'C:/Users/chris/Desktop/db-mcp',
                        project_number: 15
                    },
                    'adamic': {
                        path: 'C:/Users/chris/Desktop/adamic',
                        project_number: 16
                    },
                    'adamic-blog': {
                        path: 'C:/Users/chris/Desktop/adamic-blog',
                        project_number: 22
                    }
                }
            }

            // Issue 1: snake_case identifier in content should match alias
            const res1 = resolveProjectContext({
                content: "Add ifNotExists support to sqlite_create_view tool in Schema group. Verified tool schemas and execution. Validated logic with typecheck and linting.\n\n# schema-create-view-if-not-exists"
            }, mockConfig as unknown as import('../src/types/index.js').ToolHandlerConfig)
            expect(res1.workspaceId).toBe('db-mcp')
            expect(res1.projectNumber).toBe(15)

            // Tag tokenization should extract sqlite from composite tag
            const res2 = resolveProjectContext({
                tags: ['sqlite_create_view'],
                content: "No other mention"
            }, mockConfig as unknown as import('../src/types/index.js').ToolHandlerConfig)
            expect(res2.workspaceId).toBe('db-mcp')
            expect(res2.projectNumber).toBe(15)

            // Compound project names should be evaluated by length descending
            const res3 = resolveProjectContext({
                content: "Updated adamic-blog to latest version"
            }, mockConfig as unknown as import('../src/types/index.js').ToolHandlerConfig)
            expect(res3.workspaceId).toBe('adamic-blog')
            expect(res3.projectNumber).toBe(22)
            
            // Shorter project name should still match if only it is present
            const res4 = resolveProjectContext({
                content: "Updated adamic to latest version"
            }, mockConfig as unknown as import('../src/types/index.js').ToolHandlerConfig)
            expect(res4.workspaceId).toBe('adamic')
            expect(res4.projectNumber).toBe(16)
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

        it('should auto-heal entry parameter in CreateEntrySchema and CreateEntrySchemaMcp (agent-issues.jsonl mj_add_entry regression)', async () => {
            const { CreateEntrySchema, CreateEntrySchemaMcp } = await import('../src/handlers/tools/core/schemas.js')
            const rawPayload = {
                entry: '[admin] test-advanced-admin-part9.md: Fixed error formatting in CSV tools (analyze-csv.ts, csv.ts) to correctly return structured errors (ValidationError) for unsupported relative paths instead of raw objects. Replaced sanitizeIdentifier with quoteIdentifier in createCsvTable to properly support table names with spaces. Fixed scope of tempName in analyze-csv.ts to ensure virtual table is dropped properly.',
                tags: ['admin', 'csv', 'error-handling', 'schema'],
                title: 'Fix CSV Admin tools error handling & edge cases',
                project_number: 1,
                workspace_id: 'default'
            }

            const parsed = CreateEntrySchema.parse(rawPayload)
            expect(parsed.content).toContain('# Fix CSV Admin tools error handling & edge cases')
            expect(parsed.content).toContain('Fixed error formatting in CSV tools')
            expect((parsed as Record<string, unknown>)['entry']).toBeUndefined()
            expect((parsed as Record<string, unknown>)['title']).toBeUndefined()

            const parsedMcp = CreateEntrySchemaMcp.parse(rawPayload)
            expect(parsedMcp.content).toContain('# Fix CSV Admin tools error handling & edge cases')
            expect((parsedMcp as Record<string, unknown>)['entry']).toBeUndefined()
        })

        it('should auto-unwrap nested entry object in CreateEntrySchema', async () => {
            const { CreateEntrySchema } = await import('../src/handlers/tools/core/schemas.js')
            const rawPayload = {
                entry: {
                    content: 'Nested entry content payload.',
                    tags: ['nested', 'test'],
                    project_number: 1,
                    workspace_id: 'default'
                }
            }

            const parsed = CreateEntrySchema.parse(rawPayload)
            expect(parsed.content).toBe('Nested entry content payload.')
            expect(parsed.tags).toContain('nested')
            expect((parsed as Record<string, unknown>)['entry']).toBeUndefined()
        })

        it('should auto-heal mj_add_entry dummy tool with entry and title payload', async () => {
            const { getDummyHealingTools } = await import('../src/handlers/tools/core/dummy-healing.js')
            const mockDb = {
                createEntry: (entry: Record<string, unknown>) => ({ id: 999, ...entry }),
                getEntryById: () => undefined,
                getHealthStatus: () => ({ status: 'ok' })
            }
            const mockContext = {
                db: mockDb,
                config: {
                    defaultWorkspace: 'default',
                    projectRegistry: { default: { project_number: 1, path: '/dummy' } }
                }
            }

            const dummyTools = getDummyHealingTools(mockContext as unknown as import('../src/types/index.js').ToolContext)
            const addEntryTool = dummyTools.find(t => t.name === 'mj_add_entry')
            expect(addEntryTool).toBeDefined()

            const result = await addEntryTool?.handler({
                entry: 'Test entry body content from agent issue log.',
                tags: ['admin', 'csv'],
                title: 'Test Title For CSV',
                project_number: 1,
                workspace_id: 'default'
            }) as Record<string, unknown>

            expect(result).toBeDefined()
            expect(result.id).toBe(999)
            expect(result._healing_note).toContain('mj_add_entry')
        })

        it('should normalize entry parameter in codemode param-normalizer', async () => {
            const { applyArgInterceptions } = await import('../src/codemode/param-normalizer.js')
            const res = applyArgInterceptions('createEntry', [{
                entry: 'Entry content passed under entry key',
                tags: ['test']
            }])
            expect('args' in res).toBe(true)
            if ('args' in res) {
                const normalized = res.args[0] as Record<string, unknown>
                expect(normalized['content']).toBe('Entry content passed under entry key')
                expect(normalized['entry']).toBeUndefined()
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

    describe('Layer 1 & Layer 2: Database Adapter Listing (list_adapters) Healing Guardrails', () => {
        it('should include list_adapters in DUMMY_HEALING_TOOL_NAMES and DUMMY_ADAPTER_TOOL_NAMES', async () => {
            const { DUMMY_HEALING_TOOL_NAMES, DUMMY_ADAPTER_TOOL_NAMES } = await import(
                '../src/handlers/tools/core/dummy-healing.js'
            )
            expect(DUMMY_ADAPTER_TOOL_NAMES).toContain('list_adapters')
            expect(DUMMY_ADAPTER_TOOL_NAMES).toContain('listAdapters')
            expect(DUMMY_ADAPTER_TOOL_NAMES).toContain('adapters')
            expect(DUMMY_HEALING_TOOL_NAMES.has('list_adapters')).toBe(true)
            expect(DUMMY_HEALING_TOOL_NAMES.has('listAdapters')).toBe(true)
            expect(DUMMY_HEALING_TOOL_NAMES.has('adapters')).toBe(true)
        })

        it('should return adapter listing and healing note when list_adapters is called as a dummy tool', async () => {
            const { getDummyHealingTools } = await import('../src/handlers/tools/core/dummy-healing.js')
            const tools = getDummyHealingTools()
            const listAdaptersTool = tools.find((t) => t.name === 'list_adapters')
            expect(listAdaptersTool).toBeDefined()
            if (listAdaptersTool) {
                const result = (await listAdaptersTool.handler({})) as Record<string, unknown>
                expect(result['success']).toBe(true)
                expect(Array.isArray(result['adapters'])).toBe(true)
                const adapters = result['adapters'] as { name: string; driver: string }[]
                expect(adapters.some((a) => a.name === 'sqlite')).toBe(true)
                expect(result['default_adapter']).toBe('sqlite')
                expect(result['_healing_note']).toContain('🛠️ AUTONOMOUS HEALING')
            }
        })

        it('should map list_adapters in METHOD_ALIASES for core, analytics, and admin', async () => {
            const { METHOD_ALIASES } = await import('../src/codemode/api-constants.js')
            expect(METHOD_ALIASES.core?.list_adapters).toBe('getStatistics')
            expect(METHOD_ALIASES.core?.adapters).toBe('getStatistics')
            expect(METHOD_ALIASES.analytics?.list_adapters).toBe('getStatistics')
            expect(METHOD_ALIASES.analytics?.adapters).toBe('getStatistics')
            expect(METHOD_ALIASES.admin?.list_adapters).toBe('getStatistics')
            expect(METHOD_ALIASES.admin?.adapters).toBe('getStatistics')
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

    describe('Layer 8: Raw JSON Payloads, updateMemory Aliases, and Method Help Introspection', () => {
        it('should map updateMemory, createMemory, addMemory, recordMemory, and setMemory in METHOD_ALIASES', async () => {
            const { METHOD_ALIASES } = await import('../src/codemode/api-constants.js')
            expect(METHOD_ALIASES.core?.updateMemory).toBe('createEntry')
            expect(METHOD_ALIASES.core?.update_memory).toBe('createEntry')
            expect(METHOD_ALIASES.core?.createMemory).toBe('createEntry')
            expect(METHOD_ALIASES.core?.addMemory).toBe('createEntry')
            expect(METHOD_ALIASES.core?.recordMemory).toBe('createEntry')
            expect(METHOD_ALIASES.core?.setMemory).toBe('createEntry')

            expect(METHOD_ALIASES.admin?.updateMemory).toBe('updateEntry')
            expect(METHOD_ALIASES.admin?.update_memory).toBe('updateEntry')
            expect(METHOD_ALIASES.admin?.setMemory).toBe('updateEntry')
            expect(METHOD_ALIASES.admin?.saveMemory).toBe('updateEntry')
        })

        it('should attach help() and describe() on worker-api-proxy methods, group proxies, and top level', async () => {
            const { buildApiProxy } = await import('../src/codemode/worker-api-proxy.js')
            const mockCallTool = vi.fn().mockResolvedValue({ success: true })
            const methods = {
                core: ['create_entry', 'createEntry'],
            }
            const schemas = {
                core: {
                    create_entry: JSON.stringify({ type: 'object', properties: { content: { type: 'string' } } }),
                    createEntry: JSON.stringify({ type: 'object', properties: { content: { type: 'string' } } }),
                },
            }

            const api = buildApiProxy(mockCallTool, methods, schemas)
            const journalGroup = api['journal'] as Record<string, unknown> | undefined
            expect(journalGroup).toBeDefined()

            // Group help and describe
            expect(typeof (journalGroup as Record<string, unknown>)?.['help']).toBe('function')
            expect(typeof (journalGroup as Record<string, unknown>)?.['describe']).toBe('function')
            const groupDesc = await (journalGroup as Record<string, () => Promise<{ group: string }>>)['describe']()
            expect(groupDesc.group).toBe('core')

            // Method help and describe
            const createEntryFn = (journalGroup as Record<string, unknown>)?.['createEntry'] as {
                help?: () => Promise<{ name: string; group: string; description: string }>
                describe?: () => Promise<{ name: string; group: string; description: string }>
                schema?: () => Promise<unknown>
            }
            expect(typeof createEntryFn?.help).toBe('function')
            expect(typeof createEntryFn?.describe).toBe('function')
            expect(typeof createEntryFn?.schema).toBe('function')

            const methodHelp = await createEntryFn.help?.()
            expect(methodHelp?.name).toBe('createEntry')
            expect(methodHelp?.group).toBe('core')
        })

        it('should normalize findings and project string in applyArgInterceptions', async () => {
            const { applyArgInterceptions } = await import('../src/codemode/param-normalizer.js')
            const result = applyArgInterceptions('createEntry', [
                {
                    category: 'code',
                    summary: 'Fixed unexpected token in db-mcp parameter normalizer',
                    findings: [
                        'Identified missing syntax validation in parameter normalizer',
                        'Added regression tests for JSON code payloads'
                    ],
                    project: 'db-mcp',
                },
            ])

            expect('args' in result).toBe(true)
            if ('args' in result) {
                const normalized = result.args[0] as Record<string, unknown>
                expect(normalized.content).toContain('**Findings:**\n- Identified missing syntax validation')
                expect(normalized.content).toContain('- Added regression tests for JSON code payloads')
                expect(normalized.project).toBeUndefined()
                expect(normalized.tags).toContain('db-mcp')
            }
        })

        it('should map code and coding to technical_note in healAgentHallucinations', async () => {
            const { healAgentHallucinations } = await import('../src/handlers/tools/schemas.js')
            const healed1 = healAgentHallucinations({ entry_type: 'code' }) as Record<string, unknown>
            expect(healed1['entry_type']).toBe('technical_note')

            const healed2 = healAgentHallucinations({ entry_type: 'coding' }) as Record<string, unknown>
            expect(healed2['entry_type']).toBe('technical_note')
        })

        it('should route list_projects and get_project tool fallbacks correctly (Issue 2 regression)', async () => {
            const { getDummyHealingTools } = await import('../src/handlers/tools/core/dummy-healing.js')
            const { getAdminTools } = await import('../src/handlers/tools/admin/index.js')
            
            const context = { config: { projectRegistry: {} }, db: {}, runtime: {}, github: {}, teamDb: {}, vectorManager: {} } as any
            const dummyTools = getDummyHealingTools(context)
            
            const listProjectsTool = dummyTools.find(t => t.name === 'list_projects')
            expect(listProjectsTool).toBeDefined()
            
            const getProjectTool = dummyTools.find(t => t.name === 'mj.admin.getProject')
            expect(getProjectTool).toBeDefined()
        })

        it('should recover code with extractAndRecoverEntryCode when updateMemory or description/summary is used', async () => {
            const { extractAndRecoverEntryCode } = await import('../src/handlers/tools/codemode/handler.js')

            const brokenCode = `await updateMemory({ title: "Fix bug", description: "Resolved issue", tags: ["core"] })`
            const recovered = extractAndRecoverEntryCode(brokenCode)
            expect(recovered).toBeDefined()
            expect(recovered).toContain('mj.createEntry')
            expect(recovered).toContain('Resolved issue')
            expect(recovered).toContain('Fix bug')
        })

        it('should auto-heal dynamic imports of fs and path and statSync checks from agent issues log', async () => {
            const { healCodeModeScript } = await import('../src/handlers/tools/codemode/handler.js')
            const { CodeModeSecurityManager } = await import('../src/codemode/security.js')

            const rawAgentCode = `const fs = await import('fs');
const path = await import('path');
const dbPath = 'C:\\\\Users\\\\chris\\\\Desktop\\\\memory-journal-mcp\\\\memory.db';
let stat = null;
if (fs.existsSync(dbPath)) {
  stat = fs.statSync(dbPath);
}
return {
  exists: fs.existsSync(dbPath),
  size: stat ? stat.size : null,
  sizeMb: stat ? (stat.size / (1024 * 1024)).toFixed(2) : null
};`

            const healed = healCodeModeScript(rawAgentCode)

            // Ensure dynamic import and fs. are transformed
            expect(healed).not.toContain("import('fs')")
            expect(healed).not.toContain("import('path')")
            expect(healed).not.toContain('fs.existsSync')
            expect(healed).not.toContain('fs.statSync')
            expect(healed).toContain('__safeFs')

            // Ensure security validation passes on healed code
            const security = new CodeModeSecurityManager()
            const valResult = security.validateCode(healed)
            expect(valResult.valid).toBe(true)
            expect(valResult.errors).toHaveLength(0)
        })

        it('should route db and database aliases to analytics.getStatistics', async () => {
            const { METHOD_ALIASES } = await import('../src/codemode/api-constants.js')
            expect(METHOD_ALIASES.analytics['databaseInfo']).toBe('getStatistics')
            expect(METHOD_ALIASES.analytics['getDatabaseInfo']).toBe('getStatistics')
            expect(METHOD_ALIASES.analytics['dbStats']).toBe('getStatistics')
            expect(METHOD_ALIASES.analytics['getDbStats']).toBe('getStatistics')
        })

        it('should support schema property and introspection on buildApiProxy (agent-issues regression)', async () => {
            const { buildApiProxy } = await import('../src/codemode/worker-api-proxy.js')
            const mockPostMessage = () => {}
            const methods = {
                analytics: ['get_statistics'],
                core: ['create_entry', 'get_recent_entries'],
            }
            const proxy = buildApiProxy(mockPostMessage, methods)

            // Direct schema object
            const schema = (proxy as Record<string, any>)['schema']
            expect(typeof schema).toBe('function')
            expect(typeof schema.help).toBe('function')
            expect(typeof schema.describe).toBe('function')
            expect(typeof schema.listTables).toBe('function')
            expect(typeof schema.describeTable).toBe('function')
            expect(typeof schema.getSchema).toBe('function')

            const helpResult = await schema.help()
            expect(helpResult.group).toBe('schema')
            expect(helpResult.tables).toContain('entries')

            const tablesResult = await schema.listTables()
            expect(tablesResult.tables).toContain('entries')

            // Method introspection attached on alias methods (METHOD_ALIASES)
            const schemaAlias = (proxy as Record<string, any>)['schema']
            expect(typeof schemaAlias.help).toBe('function')

            // sqlite and db top-level fallback
            const sqlite = (proxy as Record<string, any>)['sqlite']
            expect(sqlite).toBeDefined()
            const db = (proxy as Record<string, any>)['db']
            expect(db).toBeDefined()
        })

        it('should execute scripts ending in single-line comments without syntax errors (agent-issues regression)', async () => {
            const { WorkerSandbox } = await import('../src/codemode/worker-sandbox.js')
            const sandbox = new WorkerSandbox()
            const bindings = {
                core: {
                    get_recent_entries: async () => ({
                        success: true,
                        entries: [
                            { id: 1, title: 'First', category: 'note', tags: ['a'], created_at: '2026-01-01' },
                            { id: 2, title: 'Second', category: 'note', tags: ['b'], created_at: '2026-01-02' },
                        ],
                    }),
                },
            }

            const scriptFromLog = `
return (await mj.core.getRecentEntries({
  project_number: 1,
  limit: 10
})).entries.map(e => ({
  id: e.id,
  title: e.title,
  category: e.category,
  tags: e.tags,
  created_at: e.created_at
})).reverse(); // chronological order`

            const res = await sandbox.execute(scriptFromLog, bindings)
            expect(res.success).toBe(true)
            expect(Array.isArray(res.result)).toBe(true)
            expect((res.result as Array<{ id: number }>)[0].id).toBe(2)
        })

        it('should support mj.projects.listProjects and mj.projects.list (agent-issues regression)', async () => {
            const { WorkerSandbox } = await import('../src/codemode/worker-sandbox.js')
            const sandbox = new WorkerSandbox()
            const bindings = {
                admin: {
                    list_projects: async () => ({ success: true, projects: [{ name: 'proj-1' }] }),
                },
            }

            const code = `
const p1 = await mj.projects.listProjects();
const p2 = await mj.projects.list();
const p3 = await mj.projects();
return { p1, p2, p3 };`

            const res = await sandbox.execute(code, bindings)
            expect(res.success).toBe(true)
            const r = res.result as Record<string, { success: boolean }>
            expect(r.p1.success).toBe(true)
            expect(r.p2.success).toBe(true)
            expect(r.p3.success).toBe(true)
        })

        it('should support mj.tags.list and mj.tags.listTags in sandbox', async () => {
            const { WorkerSandbox } = await import('../src/codemode/worker-sandbox.js')
            const sandbox = new WorkerSandbox()
            const bindings = {
                core: {
                    list_tags: async () => ({ success: true, tags: ['core', 'infra'], count: 2 }),
                },
            }

            const code = `
const t1 = await mj.tags.list();
const t2 = await mj.tags.listTags();
const t3 = await mj.tags();
return { t1, t2, t3 };`

            const res = await sandbox.execute(code, bindings)
            expect(res.success).toBe(true)
            const r = res.result as Record<string, { success: boolean; tags: string[] }>
            expect(r.t1.success).toBe(true)
            expect(r.t1.tags).toEqual(['core', 'infra'])
            expect(r.t2.tags).toEqual(['core', 'infra'])
            expect(r.t3.tags).toEqual(['core', 'infra'])
        })

        it('should support mj.system.serverInfo and mj.system.serverHealth in sandbox', async () => {
            const { WorkerSandbox } = await import('../src/codemode/worker-sandbox.js')
            const sandbox = new WorkerSandbox()
            const bindings = {
                analytics: {
                    get_statistics: async () => ({ success: true, stats: { total_entries: 42 } }),
                },
            }

            const code = `
const s1 = await mj.system.serverInfo();
const s2 = await mj.system.serverHealth();
const s3 = await mj.system.getStatistics();
return { s1, s2, s3 };`

            const res = await sandbox.execute(code, bindings)
            expect(res.success).toBe(true)
            const r = res.result as Record<string, { success: boolean }>
            expect(r.s1.success).toBe(true)
            expect(r.s2.success).toBe(true)
            expect(r.s3.success).toBe(true)
        })

        it('should expose projects, tags, and system namespaces on buildApiProxy', async () => {
            const { buildApiProxy } = await import('../src/codemode/worker-api-proxy.js')
            const mockPostMessage = () => {}
            const methods = {
                admin: ['list_projects', 'get_project', 'merge_tags'],
                core: ['list_tags'],
                analytics: ['get_statistics'],
            }
            const proxy = buildApiProxy(mockPostMessage, methods)

            const projects = (proxy as Record<string, any>)['projects']
            expect(typeof projects).toBe('function')
            expect(typeof projects.listProjects).toBe('function')
            expect(typeof projects.list).toBe('function')

            const tags = (proxy as Record<string, any>)['tags']
            expect(typeof tags).toBe('function')
            expect(typeof tags.listTags).toBe('function')
            expect(typeof tags.list).toBe('function')

            const system = (proxy as Record<string, any>)['system']
            expect(typeof system).toBe('function')
            expect(typeof system.serverInfo).toBe('function')
            expect(typeof system.serverHealth).toBe('function')
        })

        it('should heal mj_create_entry backticks correctly', async () => {
            const { healCodeModeScript } = await import('../src/handlers/tools/codemode/handler.js');
            const input = "await mj_create_entry(`some unescaped \" and ` backtick`)";
            const healed = healCodeModeScript(input);
            expect(healed).toContain('await mj_create_entry(`some unescaped " and \\` backtick`)');
        });

        it('should auto-heal dynamic import of mcp and unwrap mcp.execute prompt from agent issues log', async () => {
            const { healCodeModeScript } = await import('../src/handlers/tools/codemode/handler.js');
            const { CodeModeSecurityManager } = await import('../src/codemode/security.js');

            const rawAgentCode = `const mcp = await import("mcp");
return await mcp.execute(\`
  create entry for db-mcp schema tests part 4:
  - Added 'index' to resolveAliases for CreateIndexSchema and DropIndexSchema.
  - Added 'trigger' to resolveAliases for CreateTriggerSchema and DropTriggerSchema.
  - Validated edge cases for schema prefixes, nonexistent items, and SQL injection prevention in index and trigger commands.
\`);`;

            const healed = healCodeModeScript(rawAgentCode);

            // Dynamic import statement must not remain
            expect(healed).not.toContain('import("mcp")');
            expect(healed).not.toContain('import(');

            // Must pass security validation cleanly
            const security = new CodeModeSecurityManager();
            const valResult = security.validateCode(healed);
            expect(valResult.valid).toBe(true);
            expect(valResult.errors).toHaveLength(0);

            // Unwrapped to entry creation
            expect(healed).toContain('mj.core.createEntry');
            expect(healed).toContain('db-mcp schema tests part 4');
        });

        it('should support sandbox mcp.execute and execute globals', async () => {
            const { WorkerSandbox } = await import('../src/codemode/worker-sandbox.js');
            const sandbox = new WorkerSandbox();

            let createdEntry: unknown = null;
            const bindings = {
                core: {
                    create_entry: async (args: unknown) => {
                        createdEntry = args;
                        return { success: true, entry_id: 999 };
                    },
                },
            };

            const code = `
            const mcp = await import("mcp");
            return await mcp.execute(\`
              create entry for db-mcp schema tests part 4:
              - Added 'index' to resolveAliases for CreateIndexSchema and DropIndexSchema.
            \`);`;

            const { healCodeModeScript } = await import('../src/handlers/tools/codemode/handler.js');
            const healed = healCodeModeScript(code);

            const res = await sandbox.execute(healed, bindings);
            expect(res.success).toBe(true);
            expect(createdEntry).not.toBeNull();
            const entry = createdEntry as Record<string, unknown>;
            expect(entry['title'] ?? entry['content']).toContain('db-mcp schema tests part 4');
        });

        it('should auto-heal require("fs") and require("path") without TDZ ReferenceError', async () => {
            const { healCodeModeScript } = await import('../src/handlers/tools/codemode/handler.js');
            const { CodeModeSecurityManager } = await import('../src/codemode/security.js');
            const { WorkerSandbox } = await import('../src/codemode/worker-sandbox.js');

            const agentCode = `
const fs = require('fs');
const path = require('path');
return mj.createEntry({
  type: "progress",
  title: "db-mcp Code Mode Testing - Core Tools Part 2",
  content: "Completed rigorous testing of sqlite.core.upsert and sqlite.core.batchInsert.",
  project_number: "db-mcp"
});
`;

            const healed = healCodeModeScript(agentCode);

            // Verify require expressions were healed and safeFs is referenced
            expect(healed).not.toContain("require('fs')");
            expect(healed).not.toContain("require('path')");
            expect(healed).toContain('__safeFs');

            // Security check must pass
            const security = new CodeModeSecurityManager();
            const valResult = security.validateCode(healed);
            expect(valResult.valid).toBe(true);
            expect(valResult.errors).toHaveLength(0);

            // Execute in WorkerSandbox without TDZ ReferenceError
            const sandbox = new WorkerSandbox();
            let createdEntry: unknown = null;
            const bindings = {
                core: {
                    create_entry: async (args: unknown) => {
                        createdEntry = args;
                        return { success: true, entry_id: 1234 };
                    },
                },
            };

            const result = await sandbox.execute(healed, bindings);
            expect(result.success).toBe(true);
            expect(createdEntry).not.toBeNull();
            const entry = createdEntry as Record<string, unknown>;
            expect(entry['title'] ?? entry['content']).toContain('db-mcp Code Mode Testing - Core Tools Part 2');
            expect(entry['type'] === 'progress' || entry['entry_type'] === 'development_note').toBe(true);
        });

        it('should auto-heal ES module import and dynamic import of fs and path without TDZ error', async () => {
            const { healCodeModeScript } = await import('../src/handlers/tools/codemode/handler.js');
            const { WorkerSandbox } = await import('../src/codemode/worker-sandbox.js');

            const esmCode = `
import fs from 'fs';
import path from 'path';
const exists = fs.existsSync('/dummy/path');
return { exists };
`;
            const healedEsm = healCodeModeScript(esmCode);
            expect(healedEsm).not.toContain("import fs from 'fs'");
            expect(healedEsm).not.toContain("import path from 'path'");

            const sandbox = new WorkerSandbox();
            const result = await sandbox.execute(healedEsm, {});
            expect(result.success).toBe(true);
            expect(result.result).toEqual({ exists: true });
        });

        it('should preserve valid JS containing string literals with embedded createEntry calls without syntax corruption', async () => {
            const { healCodeModeScript } = await import('../src/handlers/tools/codemode/handler.js');
            const { WorkerSandbox } = await import('../src/codemode/worker-sandbox.js');

            const codeWithEmbeddedString = `
const entriesRes = await mj.entries.search({ workspaceId: 'db-mcp', limit: 20 });
const updates = [];
const deleted = [];

for (const entry of entriesRes.entries) {
  if (entry.content.includes("return await mj.createEntry(")) {
    await mj.admin.deleteEntry({ id: entry.id });
    deleted.push(entry.id);
    continue;
  }
  if (!entry.significanceType) {
    if (entry.content.toLowerCase().includes("fix") || entry.content.toLowerCase().includes("bug")) {
      updates.push(entry.id);
    }
  }
}

return { deleted, updated: updates };
`;

            const healed = healCodeModeScript(codeWithEmbeddedString);
            expect(healed).toContain('entry.content.includes("return await mj.createEntry(")');
            expect(healed).toContain('.includes("fix")');

            // Verify VM script parsing
            const wrapped = `(async () => {\n${healed}\n})()`;
            expect(() => new vm.Script(wrapped)).not.toThrow();

            // Execute in WorkerSandbox
            const sandbox = new WorkerSandbox();
            const bindings = {
                core: {
                    create_entry: async () => ({ success: true, entry_id: 1 }),
                    get_recent_entries: async () => ({ success: true, entries: [] }),
                    get_entry_by_id: async () => ({ success: true, entry: { id: 1 } }),
                },
                search: {
                    search_entries: async () => ({
                        success: true,
                        entries: [
                            { id: 10, content: 'return await mj.createEntry({ title: "test" })' },
                            { id: 11, content: 'fixing bug in search', tags: [] },
                        ],
                    }),
                },
                admin: {
                    delete_entry: async () => ({ success: true }),
                    update_entry: async () => ({ success: true }),
                },
            };
            const result = await sandbox.execute(healed, bindings);
            expect(result.success).toBe(true);
            expect(result.result).toEqual({ deleted: [10], updated: [11] });
        });

        it('should support mj.context.get() and projects.find() in sandbox (agent-issues.jsonl regression)', async () => {
            const { WorkerSandbox } = await import('../src/codemode/worker-sandbox.js');
            const sandbox = new WorkerSandbox();

            let createdEntry: unknown = null;
            const bindings = {
                core: {
                    create_entry: async (args: unknown) => {
                        createdEntry = args;
                        return { success: true, entry_id: 101 };
                    },
                },
                admin: {
                    get_project: async (args: unknown) => {
                        return {
                            success: true,
                            project: {
                                name: (args as Record<string, unknown>)['name'] ?? 'db-mcp',
                                id: 42,
                                project_number: 42,
                            },
                        };
                    },
                },
            };

            const agentCode = `
const currentContext = await mj.context.get();
const project = await mj.projects.find({ name: "db-mcp" });
const projectId = project?.[0]?.id || "unknown";

await mj.entries.create({
  title: "Fixed directory edge case in admin backup tools",
  content: "Added fs.statSync(resolvedPath).isFile() validation in verify.ts and restore.ts",
  type: "bugfix",
  project_number: currentContext.project_number || "P001",
  session_id: currentContext.session_id || "S001"
});
return { success: true, projectId };
`;

            const result = await sandbox.execute(agentCode, bindings, undefined, undefined, {
                project_number: 1,
                session_id: 'session-test-123',
            });

            expect(result.success).toBe(true);
            expect((result.result as Record<string, unknown>)['success']).toBe(true);
            expect((result.result as Record<string, unknown>)['projectId']).toBe(42);
            expect(createdEntry).not.toBeNull();
            const entry = createdEntry as Record<string, unknown>;
            expect(entry['project_number']).toBe(1);
            expect(entry['session_id']).toBe('session-test-123');
            expect(entry['entry_type']).toBe('bug_fix');
        });

        it('should expose context proxy with get, getContext, and properties on buildApiProxy', async () => {
            const { buildApiProxy } = await import('../src/codemode/worker-api-proxy.js');
            const mockRpc = () => Promise.resolve({ success: true });
            const methods = {
                admin: ['list_projects', 'get_project'],
                core: ['create_entry'],
            };
            const proxy = buildApiProxy(mockRpc, methods, undefined, false, {
                project_number: 7,
                session_id: 'sess-abc',
                workspace_id: 'ws-xyz',
            }) as Record<string, any>;

            expect(proxy.context).toBeDefined();
            expect(typeof proxy.context.get).toBe('function');
            expect(typeof proxy.getContext).toBe('function');

            const ctx = await proxy.context.get();
            expect(ctx.project_number).toBe(7);
            expect(ctx.session_id).toBe('sess-abc');
            expect(ctx.workspace_id).toBe('ws-xyz');

            const directCtx = await proxy.context();
            expect(directCtx.project_number).toBe(7);

            expect(proxy.context.project_number).toBe(7);
            expect(proxy.context.session_id).toBe('sess-abc');
        });
    });

    describe('Native Tool & Codebase Search Fallbacks (agent-issues.jsonl regression)', () => {
        it('should handle grep_search invoked directly as MCP tool (agent-issues.jsonl regression)', async () => {
            const dummyTools = getDummyHealingTools()
            const grepTool = dummyTools.find((t) => t.name === 'grep_search')
            expect(grepTool).toBeDefined()

            // Test on src/constants directory
            const res = (await grepTool?.handler({
                _case_insensitive: true,
                _file_pattern: 'gotchas.ts',
                _is_regex: false,
                _match_per_line: true,
                _query: 'GOTCHAS_HELP',
                _search_path: 'src/constants/instructions',
            })) as Record<string, unknown>

            expect(res['success']).toBe(true)
            expect(Array.isArray(res['matches'])).toBe(true)
            expect((res['matches'] as unknown[]).length).toBeGreaterThan(0)
            expect(res['_healing_note']).toContain('🛠️ AUTONOMOUS HEALING')
        })

        it('should handle non-existent directory in grep_search without crashing', async () => {
            const dummyTools = getDummyHealingTools()
            const grepTool = dummyTools.find((t) => t.name === 'grep_search')
            expect(grepTool).toBeDefined()

            const res = (await grepTool?.handler({
                _case_insensitive: true,
                _file_pattern: 'text.ts',
                _is_regex: false,
                _match_per_line: true,
                _query: 'advancedSearch',
                _search_path: 'C:\\NonExistentPath\\schemas',
            })) as Record<string, unknown>

            expect(res['success']).toBe(true)
            expect(res['totalMatches']).toBe(0)
            expect(res['_healing_note']).toBeDefined()
        })

        it('should route grep_search to search_entries when no path is provided', async () => {
            let searchCalledWith: unknown = null
            const mockContext = {
                db: {
                    getHealthStatus: () => ({ status: 'ok' }),
                },
                config: {},
            } as any

            const dummyTools = getDummyHealingTools({
                ...mockContext,
                db: {
                    searchEntries: (q: string) => {
                        searchCalledWith = q
                        return { entries: [{ id: 1, content: 'test match' }], total: 1, count: 1 }
                    },
                    searchFts: () => ({ entries: [{ id: 1, content: 'test match' }], total: 1, count: 1 }),
                    getHealthStatus: () => ({ status: 'ok' }),
                } as any,
            })
            const grepTool = dummyTools.find((t) => t.name === 'grep_search')
            expect(grepTool).toBeDefined()

            const res = (await grepTool?.handler({
                query: 'test query',
            })) as Record<string, unknown>

            expect(res['success']).toBe(true)
            expect(res['_healing_note']).toContain('🛠️ AUTONOMOUS HEALING')
        })

        it('should handle view_file and list_dir dummy tools', async () => {
            const dummyTools = getDummyHealingTools()
            const viewTool = dummyTools.find((t) => t.name === 'view_file')
            const listTool = dummyTools.find((t) => t.name === 'list_dir')
            expect(viewTool).toBeDefined()
            expect(listTool).toBeDefined()

            const viewRes = (await viewTool?.handler({
                path: 'package.json',
                start_line: 1,
                end_line: 5,
            })) as Record<string, unknown>

            expect(viewRes['success']).toBe(true)
            expect(typeof viewRes['content']).toBe('string')
            expect(viewRes['content'] as string).toContain('memory-journal-mcp')
            expect(viewRes['_healing_note']).toContain('🛠️ AUTONOMOUS HEALING')

            const listRes = (await listTool?.handler({
                path: 'src',
            })) as Record<string, unknown>

            expect(listRes['success']).toBe(true)
            expect(Array.isArray(listRes['entries'])).toBe(true)
            expect((listRes['entries'] as unknown[]).length).toBeGreaterThan(0)
            expect(listRes['_healing_note']).toContain('🛠️ AUTONOMOUS HEALING')
        })

        it('should unwrap leading underscores and normalize search parameters in param-normalizer', async () => {
            const { applyArgInterceptions } = await import('../src/codemode/param-normalizer.js')
            const intercept = applyArgInterceptions('search_entries', [{
                _query: 'database',
                _search_path: 'src',
                _case_insensitive: true,
                _file_pattern: '*.ts',
                _is_regex: false,
                _match_per_line: true,
            }])

            expect('args' in intercept).toBe(true)
            if ('args' in intercept) {
                const normalized = intercept.args[0] as Record<string, unknown>
                expect(normalized['query']).toBe('database')
                expect(normalized['search_path']).toBe('src')
                expect(normalized['case_insensitive']).toBe(true)
                expect(normalized['file_pattern']).toBe('*.ts')
                expect(normalized['is_regex']).toBe(false)
                expect(normalized['match_per_line']).toBe(true)
                expect(normalized['_query']).toBeUndefined()
                expect(normalized['_search_path']).toBeUndefined()
            }
        })

        it('should map grep and file search aliases in METHOD_ALIASES for search and core', async () => {
            const { METHOD_ALIASES } = await import('../src/codemode/api-constants.js')
            expect(METHOD_ALIASES['search']?.['grep_search']).toBe('searchEntries')
            expect(METHOD_ALIASES['search']?.['grepSearch']).toBe('searchEntries')
            expect(METHOD_ALIASES['search']?.['file_search']).toBe('searchEntries')
            expect(METHOD_ALIASES['core']?.['grep_search']).toBe('searchEntries')
            expect(METHOD_ALIASES['core']?.['view_file']).toBe('getEntryById')
            expect(METHOD_ALIASES['core']?.['list_dir']).toBe('getRecentEntries')
        })

        it('should auto-heal getDatabase and db.prepare statement update script into mj.admin.updateEntry (agent-issues.jsonl regression)', () => {
            const rawCode = [
                'const db = mj.getDatabase();',
                'const stmt = db.prepare("UPDATE journal_entries SET content = ?, tags = ? WHERE id = ?");',
                'stmt.run("db-mcp Advanced Stress Testing: [geo]\\nFixed a security bypass where read-only tools allowed state-mutating PRAGMAs. Added PRAGMA write blocking to DatabaseAdapter.validateQuery and updated nativeExecuteRead to reject statements that do not return data.", JSON.stringify(["bugfix", "security", "geo"]), 12433);',
                'return "Updated";',
            ].join('\n')

            const healed = healCodeModeScript(rawCode)
            expect(healed).toBeDefined()
            expect(healed).toContain('mj.admin.updateEntry')
            expect(healed).toContain('12433')
            expect(healed).toContain('Fixed a security bypass')
            expect(healed).toContain('bugfix')

            // Verify healed code compiles and executes in a VM script
            const wrapped = `(async () => {
                let calledWith = null;
                const mj = {
                    admin: {
                        updateEntry: async (params) => {
                            calledWith = params;
                            return { success: true, updated: true };
                        }
                    }
                };
                return await (async () => { ${healed} })();
            })()`
            expect(() => {
                new vm.Script(wrapped)
            }).not.toThrow()
        })

        it('should map getDatabase and database aliases in METHOD_ALIASES for analytics and core', async () => {
            const { METHOD_ALIASES } = await import('../src/codemode/api-constants.js')
            expect(METHOD_ALIASES['analytics']?.['getDatabase']).toBe('getStatistics')
            expect(METHOD_ALIASES['analytics']?.['database']).toBe('getStatistics')
            expect(METHOD_ALIASES['core']?.['getDatabase']).toBe('getStatistics')
            expect(METHOD_ALIASES['core']?.['database']).toBe('getStatistics')
        })

        it('should provide getDatabase, getDb, and connectToDatabase factory methods on buildApiProxy', async () => {
            const { buildApiProxy } = await import('../src/codemode/worker-api-proxy.js')
            const mockRpc = async () => ({ success: true })
            const proxy = buildApiProxy(mockRpc, { core: ['createEntry'] }) as Record<string, unknown>

            expect(typeof proxy['getDatabase']).toBe('function')
            expect(typeof proxy['getDb']).toBe('function')
            expect(typeof proxy['connectToDatabase']).toBe('function')
            
            const dbInstance = (proxy['getDatabase'] as () => unknown)()
            expect(dbInstance).toBeDefined()
        })

        it('should auto-heal raw JSON string containing action, task, changes, and notes into valid Code Mode createEntry (agent-issues.jsonl regression)', () => {
            const rawJsonCode = JSON.stringify({
                action: 'create',
                task: 'test-advanced-stats-part10',
                changes: [
                    'Added .max(50) to the sampleSize field in StatsSampleSchema to align with schema description and MAX_SAMPLE_SIZE limit.'
                ],
                status: 'completed',
                notes: 'Tested stats tools (sqlite.stats.windowNtile and sqlite.stats.statsSample) including SQL injection edges.'
            })

            const healed = healCodeModeScript(rawJsonCode)
            expect(healed).toBeDefined()
            expect(healed).toContain('mj.core.createEntry')
            expect(healed).toContain('test-advanced-stats-part10')
            expect(healed).toContain('Added .max(50)')
            expect(healed).toContain('Tested stats tools')
            expect(healed).toContain('completed')

            // Verify healed code is syntactically valid in vm context
            const wrapped = `(async () => {
                let createdPayload = null;
                const mj = {
                    core: {
                        createEntry: async (p) => {
                            createdPayload = p;
                            return { success: true, entry: p };
                        }
                    }
                };
                return await (async () => { ${healed} })();
            })()`
            expect(() => {
                new vm.Script(wrapped)
            }).not.toThrow()
        })

        it('should parse object payload in ExecuteCodeSchema without throwing (agent-issues.jsonl regression)', () => {
            const input = {
                auto_version: true,
                dry_run: false,
                payload: {
                    action: 'create',
                    changes: [
                        'Added .max(50) to the sampleSize field in StatsSampleSchema to align with schema description and MAX_SAMPLE_SIZE limit.'
                    ],
                    notes: 'Tested stats tools (sqlite.stats.windowNtile and sqlite.stats.statsSample) including SQL injection edges.',
                    status: 'completed',
                    task: 'test-advanced-stats-part10'
                }
            }

            expect(() => {
                const parsed = ExecuteCodeSchema.parse(input)
                expect(parsed.payload).toBeDefined()
                expect(typeof parsed.payload).toBe('object')
            }).not.toThrow()
        })

        it('should extract and recover JSON code for search and ID lookups', () => {
            const searchJson = JSON.stringify({ action: 'search', query: 'sqlite memory' })
            const healedSearch = extractAndRecoverJsonCode(searchJson)
            expect(healedSearch).toBeDefined()
            expect(healedSearch).toContain('mj.search.searchEntries')
            expect(healedSearch).toContain('sqlite memory')

            const idLookupJson = JSON.stringify({ entry_id: 12345 })
            const healedId = extractAndRecoverJsonCode(idLookupJson)
            expect(healedId).toBeDefined()
            expect(healedId).toContain('mj.core.getEntryById')
            expect(healedId).toContain('12345')
        })

        it('should normalize object payload into JSON code in param-normalizer', async () => {
            const { applyArgInterceptions } = await import('../src/codemode/param-normalizer.js')
            const result = applyArgInterceptions('mj_execute_code', [{
                auto_version: true,
                payload: {
                    action: 'create',
                    task: 'test-advanced-stats-part10',
                    notes: 'Some notes'
                }
            }])
            expect('args' in result).toBe(true)
            if ('args' in result) {
                const normalized = result.args[0] as Record<string, unknown>
                expect(typeof normalized['code']).toBe('string')
                expect(normalized['code']).toContain('test-advanced-stats-part10')
            }
        })
    })
})



