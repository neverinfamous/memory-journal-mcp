import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getPerformanceAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-performance.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'

describe('Pass 63 Commit Pipeline Prompts (AP1–AP2)', () => {
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined

    beforeEach(() => {
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        delete process.env['MJ_DB_ENCRYPTION_KEY']
        delete process.env['DB_ENCRYPTION_KEY']
    })

    afterEach(() => {
        if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
    })

    it('AP1–AP2: bumps AUDIT_PROMPT_REVISION to pass63 and includes bundle freshness scope and CLI alias prototype guards', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass86')

        const dbPath = path.join(
            os.tmpdir(),
            `mj-pass63-prompts-${String(process.pid)}-${String(Date.now())}.db`
        )
        const adapter = new DatabaseAdapter(dbPath, { projectRegistry: {} })
        try {
            await adapter.initialize()
            const perfRes = await getPerformanceAuditPromptDefinition().handler(
                { target: 'src', copilot: 'false' },
                adapter
            )
            const perfText = perfRes.messages[0]?.content.text ?? ''
            expect(perfText).toContain('Prompt revision: 2026-11-24-audit-pass86')
            expect(perfText).toContain('precompiled-bundle `mtimeMs` freshness guards')
            expect(perfText).toContain('explore')
            expect(perfText).toContain('generalPurpose')
            expect(perfText).not.toMatch(/[A-Z]:\\Users\\/i)

            const cqRes = await getCodeQualityAuditPromptDefinition().handler(
                { target: 'src', copilot: 'false' },
                adapter
            )
            const cqText = cqRes.messages[0]?.content.text ?? ''
            expect(cqText).toContain('Prompt revision: 2026-11-24-audit-pass86')
            expect(cqText).toContain('CLI alias/category fallback tables')
            expect(cqText).toContain('`constructor`')
            expect(cqText).toContain('explore')
            expect(cqText).toContain('generalPurpose')
            expect(cqText).not.toMatch(/[A-Z]:\\Users\\/i)
        } finally {
            adapter.close()
            if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { force: true })
        }
    })
})
