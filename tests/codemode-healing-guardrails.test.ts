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
})
