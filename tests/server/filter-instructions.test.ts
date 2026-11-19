/**
 * Filter-Aware Instruction & Dynamic Help Validation
 *
 * Replaces standalone `test-filter-instructions.mjs` and `test-server-config.mjs`
 * with fast in-process Vitest assertions covering all 9 `--tool-filter` presets,
 * `codemodeInternalFullAccess` scoping, `memory://help`, and static fallback topics.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { getTools } from '../../src/handlers/tools/index.js'
import { getPrompts } from '../../src/handlers/prompts/index.js'
import { parseToolFilter } from '../../src/filtering/tool-filter.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { DEFAULT_BRIEFING_CONFIG, type ResourceContext } from '../../src/handlers/resources/shared.js'
import { getHelpResourceDefinitions } from '../../src/handlers/resources/help.js'
import {
    buildServerInstructions,
    getCachedReadOnlyHints,
} from '../../src/server/mcp-server/tool-registration/server-instructions-cache.js'
import type { ServerContext, ServerOptions } from '../../src/server/mcp-server/types.js'
import type { PromptDefinition } from '../../src/server/registration.js'

const HELP_GROUP_ORDER = [
    'core',
    'search',
    'analytics',
    'relationships',
    'io',
    'admin',
    'github',
    'git',
    'backup',
    'team',
    'codemode',
]

const ALL_GROUPS = [...HELP_GROUP_ORDER].sort()

interface FilterPresetCase {
    label: string
    filter: string | null
    codemodeFull?: boolean
    expectCodeModeRef: boolean
    expectedGroups: string[]
    expectedTools: number
    expectedActiveTools: number
}

const FILTER_CASES: FilterPresetCase[] = [
    {
        label: 'full (all groups)',
        filter: null,
        expectCodeModeRef: false,
        expectedGroups: ALL_GROUPS,
        expectedTools: 108,
        expectedActiveTools: 108,
    },
    {
        label: 'codemode only (default sandbox scoping)',
        filter: 'codemode',
        expectCodeModeRef: true,
        expectedGroups: ['admin', 'codemode'],
        expectedTools: 2,
        expectedActiveTools: 2,
    },
    {
        label: 'codemode + --codemode-internal-full-access',
        filter: 'codemode',
        codemodeFull: true,
        expectCodeModeRef: true,
        expectedGroups: ALL_GROUPS,
        expectedTools: 108,
        expectedActiveTools: 2,
    },
    {
        label: 'essential (core+admin+codemode — no github)',
        filter: 'essential',
        expectCodeModeRef: false,
        expectedGroups: ['core', 'admin', 'codemode'],
        expectedTools: 11,
        expectedActiveTools: 11,
    },
    {
        label: 'starter (core+search+admin+codemode — no github)',
        filter: 'starter',
        expectCodeModeRef: false,
        expectedGroups: ['core', 'search', 'admin', 'codemode'],
        expectedTools: 17,
        expectedActiveTools: 17,
    },
    {
        label: 'core only (escape hatch keeps Code Mode + update_configuration)',
        filter: 'core',
        expectCodeModeRef: false,
        expectedGroups: ['core', 'admin', 'codemode'],
        expectedTools: 11,
        expectedActiveTools: 11,
    },
    {
        label: 'full -codemode (escape hatch keeps Code Mode)',
        filter: '-codemode',
        expectCodeModeRef: false,
        expectedGroups: ALL_GROUPS,
        expectedTools: 108,
        expectedActiveTools: 108,
    },
    {
        label: 'full -github (no github, no copilot)',
        filter: '-github',
        expectCodeModeRef: false,
        expectedGroups: ALL_GROUPS.filter((g) => g !== 'github'),
        expectedTools: 90,
        expectedActiveTools: 90,
    },
    {
        label: 'readonly (core+search+analytics+relationships+io+admin+git+codemode)',
        filter: 'readonly',
        expectCodeModeRef: false,
        expectedGroups: ['core', 'search', 'analytics', 'relationships', 'io', 'admin', 'git', 'codemode'],
        expectedTools: 24,
        expectedActiveTools: 24,
    },
]

describe('Filter-Aware Server Instructions & Help Index', () => {
    let db: DatabaseAdapter
    let allToolNames: Set<string>
    let readOnlyHints: Map<string, boolean | undefined>
    let prompts: PromptDefinition[]
    let rootHelpHandler: ((uri: string, ctx: ResourceContext) => Promise<{ data: unknown }>) | undefined
    let groupHelpHandler: ((uri: string, ctx: ResourceContext) => Promise<{ data: unknown }>) | undefined
    let prevDbKey: string | undefined
    let prevMjKey: string | undefined

    beforeAll(async () => {
        prevDbKey = process.env['DB_ENCRYPTION_KEY']
        prevMjKey = process.env['MJ_DB_ENCRYPTION_KEY']
        process.env['DB_ENCRYPTION_KEY'] = ''
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''

        db = new DatabaseAdapter(':memory:')
        await db.initialize()

        const allTools = getTools(db, null)
        allToolNames = new Set(allTools.map((t) => t.name))
        readOnlyHints = getCachedReadOnlyHints(allTools)
        prompts = getPrompts() as PromptDefinition[]

        const defs = getHelpResourceDefinitions()
        rootHelpHandler = defs.find((d) => d.uri === 'memory://help')?.handler
        groupHelpHandler = defs.find((d) => d.uri === 'memory://help/{group}')?.handler
    })

    afterAll(() => {
        db.close()
        if (prevDbKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = prevDbKey
        else delete process.env['DB_ENCRYPTION_KEY']
        if (prevMjKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = prevMjKey
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
    })

    for (const tc of FILTER_CASES) {
        it(`matches instructions and memory://help contract for ${tc.label}`, async () => {
            const filterConfig = tc.filter !== null ? parseToolFilter(tc.filter) : null
            const configManager = new ConfigManager({
                rawToolFilter: tc.filter ?? undefined,
                toolFilterConfig: filterConfig,
                briefingConfig: { ...DEFAULT_BRIEFING_CONFIG },
                codemodeInternalFullAccess: tc.codemodeFull === true,
            })
            const runtime = new ServerRuntime()
            runtime.configManager = configManager

            const serverCtx = { configManager } as unknown as ServerContext
            const options: ServerOptions = {
                transport: 'stdio',
                dbPath: ':memory:',
                instructionLevel: 'full',
            }
            const instructions = buildServerInstructions(
                serverCtx,
                options,
                prompts,
                allToolNames,
                readOnlyHints
            )

            expect(instructions).toContain('Essential Behaviors')
            expect(instructions).toContain('## Code Mode')
            expect(instructions).toContain('## Available Help')
            expect(instructions).toContain(`## Active Tools (${String(tc.expectedActiveTools)})`)

            if (tc.expectCodeModeRef) {
                expect(instructions).toContain('# Code Mode API Reference')
            } else {
                expect(instructions).not.toContain('# Code Mode API Reference')
            }

            const expectedSet = new Set(tc.expectedGroups)
            const expectedOrder = HELP_GROUP_ORDER.filter((g) => expectedSet.has(g))
            expect(instructions).toContain(
                `Read \`memory://help/{group}\` for: ${expectedOrder.join(', ')}.`
            )

            const resourceCtx: ResourceContext = {
                db,
                filterConfig,
                runtime,
            }

            if (!expectedSet.has('github')) {
                expect(instructions).not.toContain('## GitHub Integration')
                expect(instructions).not.toContain('Copilot Review Patterns')
                expect(instructions).not.toContain('**github**:')
                expect(instructions).not.toContain('get_copilot_reviews')

                expect(groupHelpHandler).toBeDefined()
                const fallbackRes = await groupHelpHandler?.('memory://help/github', resourceCtx)
                const fallbackText =
                    typeof fallbackRes?.data === 'string'
                        ? fallbackRes.data
                        : JSON.stringify(fallbackRes?.data)
                expect(fallbackText).toContain('GitHub')
            }

            expect(rootHelpHandler).toBeDefined()
            const helpResult = await rootHelpHandler?.('memory://help', resourceCtx)
            const helpData = helpResult?.data as {
                totalTools: number
                groups: Array<{ name: string }>
            }
            expect(helpData.totalTools).toBe(tc.expectedTools)
            expect(helpData.groups.map((g) => g.name)).toEqual([...tc.expectedGroups].sort())
        })
    }

    it('validates test-server/scripts/test-server-config.json defines test DB paths', () => {
        const configPath = path.join(process.cwd(), 'test-server', 'scripts', 'test-server-config.json')
        const raw = fs.readFileSync(configPath, 'utf-8')
        const parsed = JSON.parse(raw) as Record<string, unknown>

        expect(typeof parsed['testDbPath']).toBe('string')
        expect(String(parsed['testDbPath']).trim()).not.toBe('')
        expect(typeof parsed['testTeamDbPath']).toBe('string')
        expect(String(parsed['testTeamDbPath']).trim()).not.toBe('')
    })
})
