import { describe, it, expect } from 'vitest'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getPerformanceAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-performance.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'

const stubDb = {
    searchByDateRange: () => ({ entries: [] }),
    searchEntries: () => ({ entries: [] }),
} as unknown as IDatabaseAdapter

describe('Audit Pass 55 — adversarial-audit-performance (AP1–AP4)', () => {
    it('bumps AUDIT_PROMPT_REVISION to 2026-11-20-audit-pass57 and includes AP1–AP4 guidance', () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass88')

        const def = getPerformanceAuditPromptDefinition()
        const result = def.handler({ target: 'lib-git-history' }, stubDb)
        const text = result.messages[0]?.content.type === 'text' ? result.messages[0].content.text : ''

        expect(text).toContain('Prompt revision: 2026-11-24-audit-pass88')
        // AP1: pattern-matcher/closure & static filter re-parsing in hot loops
        expect(text).toContain('per-item pattern-matcher/closure allocation')
        // AP2: eager upfront subprocesses, stripped-output subprocesses, duplicate file opens
        expect(text).toContain('eager upfront subprocess probes')
        expect(text).toContain('duplicate file opens')
        // AP3: focused library proportionality (<= 20 files)
        expect(text).toContain('<= 20')
        // AP4: dual closed-loop SP1-SPn starter prompt proposals
        expect(text).toContain('Starter Prompt Proposals')
        // Portability & harness token invariants
        expect(text).toContain('explore')
        expect(text).toContain('generalPurpose')
        expect(text).not.toContain('invoke_subagent')
    })
})
