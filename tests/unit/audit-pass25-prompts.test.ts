/**
 * Pass 25 Prompt Hardening & Attribution Regressions
 *
 * Split from `audit-pass25-option-a.test.ts` to keep every test file <= 450 lines.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as vm from 'node:vm'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { ValidationError } from '../../src/types/errors.js'
import type { ToolHandlerConfig } from '../../src/types/index.js'
import { getAdversarialPromptDefinitions } from '../../src/handlers/prompts/adversarial.js'
import { validateAdversarialPromptScope } from '../../src/handlers/prompts/adversarial-args.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import {
    buildPlanReviewPriorContextSection,
    buildPriorAuditSection,
} from '../../src/handlers/prompts/adversarial-helpers.js'
import { getCmsSupervisorPromptDefinitions } from '../../src/handlers/prompts/cms-supervisor.js'
import { getOptimizerPromptDefinitions } from '../../src/handlers/prompts/optimizer.js'

const REGISTRY: Record<string, { path: string; project_number: number }> = {
    'memory-journal-mcp': { path: path.resolve('/repos/memory-journal-mcp'), project_number: 5 },
    'other-repo': { path: path.resolve('/repos/other-repo'), project_number: 9 },
}

function getPromptText(res: { messages: { content: unknown }[] }): string {
    const first = res.messages[0]
    if (first === undefined || typeof first.content !== 'object' || first.content === null) return ''
    const textVal = Reflect.get(first.content, 'text')
    return typeof textVal === 'string' ? textVal : ''
}

describe('Pass 25 Prompt Hardening & Attribution', () => {
    let db: DatabaseAdapter

    beforeEach(async () => {
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
    })

    afterEach(() => {
        db.close()
    })

    it('renders hardened audit prompt with valid Method 2 JS syntax and zero banned strings', async () => {
        const def = getCodeQualityAuditPromptDefinition()
        const text = getPromptText(await def.handler({}, db))
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-20-audit-pass58')
        expect(text).toContain('memory://agent-context/')
        expect(text).toContain('mj.core.createEntry')
        expect(text).toContain('node <file>')
        expect(text).not.toContain('invoke_subagent')
        expect(text).not.toContain('bun path/to/commit.ts')

        const m2Idx = text.indexOf('Method 2')
        expect(m2Idx).toBeGreaterThan(-1)
        const fenceMatch = /```(?:js|javascript|mjs)\r?\n([\s\S]*?)```/.exec(text.slice(m2Idx))
        expect(fenceMatch?.[1]).toBeDefined()
        const stripped = (fenceMatch?.[1] ?? '').replace(/import\s*\{[^;]*\}\s*from\s*'[^']+';\s*/g, '')
        expect(stripped).toContain('SCAN_OK')
        expect(() => new vm.Script(stripped)).not.toThrow()
    })

    it('omits hardcoded project #5 in supervisor and optimizer prompts when registry is empty', async () => {
        const emptyBriefing = { ...DEFAULT_BRIEFING_CONFIG, projectRegistry: {} }
        const supDef = getCmsSupervisorPromptDefinitions()[0]
        expect(supDef).toBeDefined()
        const supText = supDef ? getPromptText(await supDef.handler({}, db, undefined, undefined, emptyBriefing)) : ''
        expect(supText).toContain('pnpm exec vitest run')
        expect(supText).toContain('pnpm exec playwright test')
        expect(supText).not.toContain('npx vitest run')
        expect(supText).not.toContain('npx playwright test')
        expect(supText).not.toContain('project #5')
        expect(supText).not.toContain('project_number: 5')

        const optDef = getOptimizerPromptDefinitions()[0]
        expect(optDef).toBeDefined()
        const optText = optDef ? getPromptText(await optDef.handler({}, db, undefined, undefined, emptyBriefing)) : ''
        expect(optText).not.toContain('project_number: 5')
        expect(optText).toContain('{ workspace_id: "*" }')
    })

    it('enforces target/workspace pair validation and explicit default vs free-text attribution', () => {
        const cfg: ToolHandlerConfig = { projectRegistry: REGISTRY }
        expect(() =>
            validateAdversarialPromptScope('memory-journal-mcp', undefined, cfg, 'other-repo')
        ).toThrow(ValidationError)
        expect(() => validateAdversarialPromptScope('default', 5, cfg)).toThrow(ValidationError)

        db.createEntry({
            content: '## Plan\nExisting OAuth refactor plan',
            entryType: 'plan_finalized',
            tags: ['adversarial-planner'],
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
        })

        const briefing = { ...DEFAULT_BRIEFING_CONFIG, projectRegistry: REGISTRY, defaultWorkspaceId: 'memory-journal-mcp' }
        const explicitDefaultAudit = buildPriorAuditSection(db, 'topic', undefined, briefing, 'default')
        expect(explicitDefaultAudit).toContain('explicitly targets personal workspace `default`')
        expect(explicitDefaultAudit).not.toContain('project_number: 5')

        const explicitDefaultPlan = buildPlanReviewPriorContextSection(db, 'topic', undefined, briefing, 'default')
        expect(explicitDefaultPlan).toContain('explicitly targets personal workspace `default`')

        const freeTextPlan = buildPlanReviewPriorContextSection(db, 'OAuth refactor', 'OAuth refactor', briefing)
        expect(freeTextPlan).toContain('Existing OAuth refactor plan')

        const explicitPlan = buildPlanReviewPriorContextSection(db, 'OAuth', undefined, briefing, 'memory-journal-mcp', undefined, 5)
        expect(explicitPlan).toContain('workspace_id: "memory-journal-mcp"')

        const explicitAudit = buildPriorAuditSection(db, 'topic', undefined, briefing, 'memory-journal-mcp', undefined, 5)
        expect(explicitAudit).toContain('instead of `default`')

        const unresolvedAudit = buildPriorAuditSection(db, 'unregistered-ext', 'unregistered-ext', briefing)
        expect(unresolvedAudit).toContain('Never log audit entries or session summaries to workspace `default`')
        expect(unresolvedAudit).not.toContain('Existing OAuth refactor plan')
    })

    it('includes portable cross-host subagent guidance in sibling audit prompts', async () => {
        const defs = getAdversarialPromptDefinitions().filter((d) =>
            ['adversarial-audit-seo', 'adversarial-audit-skill', 'adversarial-audit-workflow'].includes(d.name)
        )
        expect(defs).toHaveLength(3)
        for (const def of defs) {
            const text = getPromptText(await def.handler({}, db))
            expect(text).toContain("that host's read-only subagent tool")
        }
    })
})
