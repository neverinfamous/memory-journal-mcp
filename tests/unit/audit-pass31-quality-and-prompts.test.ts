/**
 * Pass 31 Quality, Config, Schema, Fencing, Prompt & Tooling Regression Suite
 * Covers M1-M12, L1-L8, and AP1-AP6.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { TestInfo } from '@playwright/test'
import { Command } from 'commander'
import { z } from 'zod'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ExecuteCodeSchema, ExecuteCodeSchemaMcp } from '../../src/handlers/tools/codemode/schemas.js'
import { healSearchPayload } from '../../src/handlers/tools/schemas/hallucination-healer-search.js'
import { createRestoreEntryTool } from '../../src/handlers/tools/admin/restore-entry-tool.js'
import { getTeamAliasTools } from '../../src/handlers/tools/team/alias-tools.js'
import { getTeamAnalyticsTools } from '../../src/handlers/tools/team/analytics-tools.js'
import { closeCrossTeamAdapters } from '../../src/handlers/tools/search/cross-team.js'
import { extractParameters } from '../../src/handlers/resources/help-schema-params.js'
import { fenceUntrustedInline, sliceUntrustedInline } from '../../src/handlers/resources/uri-and-fencing.js'
import { getTeamResourceDefinitions } from '../../src/handlers/resources/team.js'
import { skillsResource } from '../../src/handlers/resources/core/utilities.js'
import { getBaseURL } from '../e2e/helpers.js'
import { buildServerOptions } from '../../src/cli/server-options-builder.js'
import { addBriefingOptions, addCoreOptions, addPruningOptions } from '../../src/cli/option-groups.js'
import { ConfigResolver } from '../../src/utils/config-resolver.js'
import { buildCliAttributionFlags } from '../../src/handlers/prompts/workflow-helpers.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import {
    buildPriorAuditSection,
    hasExplicitPromptTarget,
    sanitizeCopilotTarget,
} from '../../src/handlers/prompts/adversarial-helpers.js'
import { resolveRegistryMatchForTarget } from '../../src/handlers/prompts/adversarial-args.js'
import { getPrompt } from '../../src/handlers/prompts/index.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'

const TEST_REGISTRY = {
    'memory-journal-mcp': { project_number: 5, path: process.cwd() },
    'other-repo': { project_number: 9 },
}

describe('Pass 31 Quality, Config, Prompt & Tooling Regressions (M1-M12, L1-L8, AP1-AP6)', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter
    let tmpDir: string

    beforeEach(async () => {
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
        await teamDb.applyTeamSchema()
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass31-qual-'))
    })

    afterEach(() => {
        closeCrossTeamAdapters()
        db.close()
        teamDb.close()
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('M1: ExecuteCodeSchema & ExecuteCodeSchemaMcp accept readonly, dryRun, and autoVersion consistently', () => {
        const parsedMcp = ExecuteCodeSchemaMcp.parse({
            code: 'return await mj.core.getRecentEntries({ limit: 5 })',
            readonly: true,
            dry_run: true,
            auto_version: true,
        })
        expect(parsedMcp.readonly).toBe(true)

        const parsedStrict = ExecuteCodeSchema.parse({
            code: 'return await mj.core.getRecentEntries({ limit: 5 })',
            readonly: true,
            dryRun: true,
            autoVersion: true,
        })
        expect(parsedStrict.dryRun).toBe(true)
        expect(parsedStrict.autoVersion).toBe(true)
    })

    it('M2 & M3: server-options-builder validates [0, 1] importance thresholds and invalid logLevel', () => {
        const emptyConfigPath = path.join(tmpDir, 'empty-config.json')
        fs.writeFileSync(emptyConfigPath, '{}', 'utf-8')
        const savedEnv = { ...process.env }
        try {
            const badCmd = addPruningOptions(addBriefingOptions(addCoreOptions(new Command('serve'))))
            badCmd.parse([
                'node',
                'mj',
                '--briefing-importance-threshold',
                '1.5',
                '--prune-importance-threshold',
                '-0.2',
                '--log-level',
                'verbose',
            ])
            const errors: string[] = []
            buildServerOptions(
                new ConfigResolver(badCmd, badCmd.opts(), emptyConfigPath),
                badCmd.opts(),
                badCmd,
                errors
            )
            expect(errors.some((e) => e.includes('briefingImportanceThreshold'))).toBe(true)
            expect(errors.some((e) => e.includes('pruneImportanceThreshold'))).toBe(true)
            expect(errors.some((e) => e.includes('Invalid log level'))).toBe(true)
        } finally {
            for (const k of Object.keys(process.env)) {
                if (!(k in savedEnv)) delete process.env[k]
            }
            Object.assign(process.env, savedEnv)
        }
    })

    it('M4 & M5: healSearchPayload strips sort_order on searches only; restore_entry normalizes id to entry_id', async () => {
        const healed = healSearchPayload({
            query: 'auth',
            excludeTag: ['draft'],
            sort_order: 'desc',
            sortBy: 'importance',
        }) as Record<string, unknown>
        expect(healed['exclude_tags']).toEqual(['draft'])
        expect(healed['sort_by']).toBe('importance')
        expect('sort_order' in healed).toBe(false)

        const entry = db.createEntry({
            content: 'Restore target',
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
        })
        db.deleteEntry(entry.id, false, 'memory-journal-mcp')

        const restoreTool = createRestoreEntryTool({
            db,
            config: { projectRegistry: TEST_REGISTRY },
        })
        const res = (await restoreTool.handler({ id: entry.id })) as {
            success: boolean
            entryId?: number
        }
        expect(res.success).toBe(true)
        expect(res.entryId).toBe(entry.id)
    })

    it('M6 & M9: team_resolve_author and team_get_collaboration_matrix reject wildcard * without project_number', async () => {
        const resolveAuthorTool = getTeamAliasTools({
            db,
            teamDb,
            config: { projectRegistry: TEST_REGISTRY },
        }).find((t) => t.name === 'team_resolve_author')
        const aliasRes = (await resolveAuthorTool?.handler({
            author: 'Alice',
            workspace_id: '*',
        })) as { success: boolean; code?: string }
        expect(aliasRes.success).toBe(false)
        expect(aliasRes.code).toBe('VALIDATION_ERROR')

        const matrixTool = getTeamAnalyticsTools({
            db,
            teamDb,
            config: { projectRegistry: TEST_REGISTRY },
        }).find((t) => t.name === 'team_get_collaboration_matrix')
        const matrixRes = (await matrixTool?.handler({ workspace_id: '*' })) as {
            success: boolean
            code?: string
        }
        expect(matrixRes.success).toBe(false)
        expect(matrixRes.code).toBe('VALIDATION_ERROR')
    })

    it('M7: help-schema-params unwraps ZodNullable inside ZodPipe and formats ZodDiscriminatedUnion', () => {
        const schema = z.object({
            nullablePipe: z.preprocess((v) => v, z.string().nullable()),
            mode: z.discriminatedUnion('kind', [
                z.object({ kind: z.literal('a'), val: z.string() }),
                z.object({ kind: z.literal('b'), count: z.number() }),
            ]),
            strOrNum: z.union([z.string(), z.number()]),
        })
        const params = extractParameters(schema)
        const byName = new Map(params.map((p) => [p.name, p]))
        expect(byName.get('nullablePipe')?.type).toBe('string')
        expect(byName.get('mode')?.type).toBe('object')
        expect(byName.get('strOrNum')?.type).toBe('string | number')
    })

    it('M8: fenceUntrustedInline is idempotent and sliceUntrustedInline truncates before re-fencing', () => {
        const once = fenceUntrustedInline('Hello <world>')
        expect(fenceUntrustedInline(once)).toBe(once)

        const sliced = sliceUntrustedInline(fenceUntrustedInline('A'.repeat(40)), 10, '...')
        expect(sliced).toBe('<untrusted_remote_content>AAAAAAAAAA...</untrusted_remote_content>')
    })

    it('M10 & L2: closeCrossTeamAdapters runs cleanly and memory://team/statistics sanitizes authors', async () => {
        expect(() => closeCrossTeamAdapters()).not.toThrow()

        teamDb.createEntry({
            content: 'Authored entry',
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
            author: 'Alice\u0007\n' + 'X'.repeat(120),
            isPersonal: false,
        })
        const statsRes = getTeamResourceDefinitions().find((r) => r.uri === 'memory://team/statistics')
        const res = (await statsRes?.handler('memory://team/statistics', {
            db,
            teamDb,
            briefingConfig: {
                ...DEFAULT_BRIEFING_CONFIG,
                defaultWorkspaceId: 'memory-journal-mcp',
                projectRegistry: TEST_REGISTRY,
            },
        })) as { data: { authors: Array<{ author: string }> } }
        expect(res.data.authors.length).toBeGreaterThanOrEqual(1)
        const sanitized = res.data.authors[0]?.author ?? ''
        expect(sanitized.length).toBeLessThanOrEqual(100)
        expect(/\p{Cc}/u.test(sanitized)).toBe(false)
    })

    it('M12 & L3-L8: isolates E2E worker ports, emits quoted CLI attribution flags, strips skill frontmatter, and validates lint/vitest config', async () => {
        const worker2Info = {
            parallelIndex: 2,
            project: { use: { baseURL: 'http://localhost:3105' } },
        } as unknown as TestInfo
        expect(getBaseURL(worker2Info)).toBe('http://localhost:3107')

        const customInfo = {
            parallelIndex: 2,
            project: { use: { baseURL: 'http://127.0.0.1:4999' } },
        } as unknown as TestInfo
        expect(getBaseURL(customInfo)).toBe('http://127.0.0.1:4999')

        const cliFlags = buildCliAttributionFlags(
            'memory-journal-mcp',
            { projectRegistry: TEST_REGISTRY },
            5
        )
        expect(cliFlags).toBe('--workspace "memory-journal-mcp" --project-number 5 ')

        const skillsDir = path.join(tmpDir, 'skills')
        fs.mkdirSync(path.join(skillsDir, 'custom-zod-skill'), { recursive: true })
        fs.writeFileSync(
            path.join(skillsDir, 'custom-zod-skill', 'SKILL.md'),
            '---\nname: custom-zod-skill\ndescription: hidden frontmatter\n---\n\n# Zod Heading\nActual skill guidance line.\n',
            'utf-8'
        )
        const skillRes = (await skillsResource.handler('memory://skills', {
            db,
            briefingConfig: {
                ...DEFAULT_BRIEFING_CONFIG,
                skillsDirPath: skillsDir,
                allowedIoRoots: [skillsDir],
            },
        })) as { data: { skills: Array<{ name: string; excerpt: string }> } }
        const customSkill = skillRes.data.skills.find((s) => s.name === 'custom-zod-skill')
        expect(customSkill?.excerpt).toContain('Actual skill guidance line.')
        expect(customSkill?.excerpt).not.toContain('hidden frontmatter')

        const eslintConfig = fs.readFileSync(path.join(process.cwd(), 'eslint.config.js'), 'utf-8')
        expect(eslintConfig).toContain("files: ['scripts/**/*.ts', 'scripts/**/*.mjs']")
        const pkgJson = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')
        expect(pkgJson).toContain('eslint src/ tests/ scripts/ --fix')
        const vitestCfg = fs.readFileSync(path.join(process.cwd(), 'vitest.config.ts'), 'utf-8')
        expect(vitestCfg).not.toContain("'src/cli.ts'")
    })

    it('AP1-AP6: enforces canonical roots, multi-statement Detector 3 rules, fallback query hints, Copilot sanitization, and Win32 targets', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-22-audit-pass71')

        const def = getCodeQualityAuditPromptDefinition()
        const promptResult = def.handler({ target: 'src' }, db, {
            ...DEFAULT_BRIEFING_CONFIG,
            projectRegistry: TEST_REGISTRY,
        })
        const text = (promptResult.messages[0]?.content as { text: string }).text
        expect(text).toContain("['src','app','apps','packages','components','lib','workers']")
        expect(text).toContain('const defs = [...]; return [...defs, ...extra]')
        expect(text).toContain('handler: (...) => { ... }')

        expect(
            hasExplicitPromptTarget({ projectRegistry: TEST_REGISTRY }, 'memory-journal-mcp', undefined)
        ).toBe(true)
        expect(hasExplicitPromptTarget({ projectRegistry: TEST_REGISTRY }, undefined, '{target}')).toBe(
            false
        )

        const priorSection = buildPriorAuditSection(
            db,
            'code-quality-audit',
            'Prior code-quality audits',
            { ...DEFAULT_BRIEFING_CONFIG, projectRegistry: TEST_REGISTRY },
            undefined,
            'unknown-target'
        )
        expect(priorSection).toContain('mj.search.searchByDateRange')

        expect(sanitizeCopilotTarget('C:\\repo\\src\\a.ts; rm -rf /')).toBe('C:\\repo\\src\\a.ts rm -rf /')

        const winTargetMatch = resolveRegistryMatchForTarget(
            { winproj: { path: 'C:\\Users\\dev\\winproj', project_number: 7 } },
            'C:\\Users\\dev\\winproj\\src\\index.ts'
        )
        expect(winTargetMatch).toBe('winproj')

        // Optimize prompt safe-integer #project handling
        const optPrompt = await getPrompt(
            'optimize-journal',
            { project: '#5' },
            db,
            undefined,
            { ...DEFAULT_BRIEFING_CONFIG, projectRegistry: TEST_REGISTRY }
        )
        const optText = (optPrompt.messages[0]?.content as { text: string }).text
        expect(optText).toContain('project_number: 5')
    })
})
