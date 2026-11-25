import { describe, it, expect } from 'vitest'
import { resolvePromptPriorWorkspace } from '../../src/handlers/prompts/adversarial-helpers.js'
import { buildExplicitAttributionArgs } from '../../src/handlers/prompts/workflow-helpers.js'
import { getAdversarialPromptDefinitions } from '../../src/handlers/prompts/adversarial.js'

const registry = {
    'memory-journal-mcp': { path: 'C:\\repos\\memory-journal-mcp', project_number: 5 },
}

describe('Pass 20 prompt isolation fixes', () => {
    it('does not hardcode workspace_id "default" in generated snippets unless requested (C8)', () => {
        expect(buildExplicitAttributionArgs('default', { projectRegistry: registry })).toBe('')
        expect(buildExplicitAttributionArgs('default', { projectRegistry: registry }, undefined, true)).toBe(
            ', workspace_id: "default"'
        )
        expect(buildExplicitAttributionArgs('memory-journal-mcp', { projectRegistry: registry })).toBe(
            ', workspace_id: "memory-journal-mcp", project_number: 5'
        )
    })

    it('resolves numeric ids only through the registry', () => {
        expect(resolvePromptPriorWorkspace({ projectRegistry: registry }, '#5')).toBe('memory-journal-mcp')
        expect(resolvePromptPriorWorkspace({ projectRegistry: registry }, '42')).not.toBe('42')
    })

    it('does not path-match relative targets against the server cwd', () => {
        expect(resolvePromptPriorWorkspace({ projectRegistry: registry }, undefined, 'src/cli')).toBe('default')
        expect(
            resolvePromptPriorWorkspace({ projectRegistry: registry }, undefined, 'C:\\repos\\memory-journal-mcp\\src')
        ).toBe(process.platform === 'win32' ? 'memory-journal-mcp' : 'default')
    })

    it('keeps all adversarial prompt definitions after the factory extraction (L1)', () => {
        const names = getAdversarialPromptDefinitions().map((p) => p.name)
        expect(names).toEqual([
            'adversarial-plan-review',
            'adversarial-audit-code-quality',
            'adversarial-audit-security',
            'adversarial-audit-performance',
            'adversarial-audit-seo',
            'adversarial-audit-skill',
            'adversarial-build-skill',
            'adversarial-audit-workflow',
        ])
    })
})
