import { describe, it, expect } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'

describe('audit pass69 portable detectors', () => {
    it('exports updated revision and includes AP1-AP4 portable detectors without repo-specific leakage', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass83')

        const promptDb = new DatabaseAdapter(':memory:')
        await promptDb.initialize()
        let text: string
        try {
            const res = await getCodeQualityAuditPromptDefinition().handler(
                { target: 'src', copilot: 'false' },
                promptDb
            )
            text = res.messages[0]?.content.text ?? ''
        } finally {
            promptDb.close()
        }

        expect(text).toContain('Prompt revision: 2026-11-24-audit-pass83')

        // AP1: HTTP batch scope & session isolation + requiredScopes parity
        expect(text).toContain('Array.isArray(body)')
        expect(text).toContain('single shared `McpServer`')
        expect(text).toContain('requiredScopes')

        // AP2: SQL comment unwrappers, unanchored --, quote regexes, backslash escaping
        expect(text).toContain("indexOf('/*')")
        expect(text).toContain('unanchored `--`')
        expect(text).toContain('sequential quote-stripping regexes')
        expect(text).toContain('without escaping')

        // AP3: Pre-execution validation & awaited pre-mutation snapshots
        expect(text).toContain('pre-execution audit/backup interceptors')
        expect(text).toContain('unawaited pre-mutation snapshot writes')

        // AP4: Isolate disposal, bounded log bridge, JSON-RPC parsed.error verification
        expect(text).toContain('isolate.dispose()')
        expect(text).toContain('maxResultSize')
        expect(text).toContain('parsed.error')

        // Path neutrality & multi-host subagent compatibility
        expect(text).not.toContain('mysql-mcp')
        expect(text).not.toContain('C:\\Users')
        expect(text).toContain('explore')
        expect(text).toContain('generalPurpose')
    })
})
