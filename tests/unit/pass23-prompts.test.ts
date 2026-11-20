/**
 * Pass 23 Adversarial Prompt Hardening, Sanitizer & Scope Validation Regressions
 *
 * Split from `pass23-scope-and-quality.test.ts` to keep every test file <= 450 lines.
 */

import { describe, it, expect } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import type { BriefingConfig } from '../../src/handlers/resources/shared.js'
import { getAdversarialPromptDefinitions } from '../../src/handlers/prompts/adversarial.js'
import { sanitizeCopilotTarget } from '../../src/handlers/prompts/adversarial-helpers.js'
import {
    auditArgsSchema,
    planReviewArgsSchema,
    validateAdversarialPromptScope,
} from '../../src/handlers/prompts/adversarial-args.js'
import { ValidationError } from '../../src/types/errors.js'

async function createMemoryDb(): Promise<DatabaseAdapter> {
    const db = new DatabaseAdapter(':memory:')
    await db.initialize()
    return db
}

describe('P1-P7: adversarial prompt hardening, schemas, sanitizer, and scope validation', () => {
    it('includes hardened shared preamble, scan exclusions, and project_number argument in audit prompts', async () => {
        const db = await createMemoryDb()
        try {
            const defs = getAdversarialPromptDefinitions()
            const codeQuality = defs.find((p) => p.name === 'adversarial-audit-code-quality')
            const security = defs.find((p) => p.name === 'adversarial-audit-security')
            expect(codeQuality).toBeDefined()
            expect(security).toBeDefined()
            expect(codeQuality?.arguments?.some((a) => a.name === 'project_number')).toBe(true)

            const cqResult = await Promise.resolve(codeQuality?.handler({}, db))
            const cqText = cqResult?.messages[0]?.content.text ?? ''
            expect(cqText).toContain('Prompt revision: 2026-11-20-audit-pass57')
            expect(cqText).toContain('This prompt is shared by every project')
            expect(cqText).toContain('DO audit executable tool calls')
            expect(cqText).toContain('.wrangler')
            expect(cqText).toContain('*.d.ts')

            const secResult = await Promise.resolve(security?.handler({}, db))
            const secText = secResult?.messages[0]?.content.text ?? ''
            expect(secText).toContain('Prompt revision: 2026-11-20-audit-pass57')
            expect(secText).toContain('This prompt is shared by every project')
        } finally {
            db.close()
        }
    })

    it('preserves {target} placeholders while stripping shell metacharacters in sanitizeCopilotTarget', () => {
        expect(sanitizeCopilotTarget('{target}')).toBe('{target}')
        const cleaned = sanitizeCopilotTarget('src/a.ts; rm -rf / | $(id)')
        expect(cleaned).not.toMatch(/[;|$()]/)
        expect(cleaned).toContain('src/a.ts')
    })

    it('normalizes audit and plan-review arguments via Zod schemas', () => {
        expect(
            auditArgsSchema.parse({
                target: '   ',
                copilot: 'YES',
                project_number: '#5',
                workspace_id: '',
            })
        ).toEqual({
            target: undefined,
            copilot: 'true',
            project_number: 5,
            workspace_id: undefined,
        })

        expect(
            planReviewArgsSchema.parse({
                depth: 'DEEP',
                copilot: '0',
            })
        ).toEqual({
            depth: 'deep',
            copilot: 'false',
        })
    })

    it('validates adversarial prompt workspace and project_number scope consistency', () => {
        const cfg: Partial<BriefingConfig> = {
            projectRegistry: {
                'repo-a': { path: '/tmp/repo-a', project_number: 1 },
                'repo-b': { path: '/tmp/repo-b', project_number: 2 },
            },
        }

        expect(() => validateAdversarialPromptScope('*', undefined, cfg)).toThrow(ValidationError)
        expect(() => validateAdversarialPromptScope('repo-a', 2, cfg)).toThrow(ValidationError)
        expect(validateAdversarialPromptScope(undefined, 2, cfg)).toEqual({
            effectiveWorkspaceId: 'repo-b',
            projectNumber: 2,
        })
    })
})
