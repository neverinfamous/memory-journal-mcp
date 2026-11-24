import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { getPrompt, getPrompts } from '../../src/handlers/prompts/index.js'

describe('adversarial-audit-skill prompt', () => {
    let db: DatabaseAdapter
    let tempDir: string

    beforeAll(async () => {
        tempDir = path.join(os.tmpdir(), `mj-skill-prompt-${crypto.randomUUID()}`)
        fs.mkdirSync(tempDir, { recursive: true })
        db = new DatabaseAdapter(path.join(tempDir, 'test.db'))
        await db.initialize()
    })

    afterAll(() => {
        db.close()
        fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('exposes closed-loop AP*/SK* self-improvement guidance portably', async () => {
        const promptMeta = getPrompts().find((p) => p.name === 'adversarial-audit-skill')
        expect(promptMeta?.description).toContain('closed-loop')

        const defaultRes = await getPrompt('adversarial-audit-skill', {}, db)
        const text = defaultRes.messages[0]?.content.text ?? ''

        expect(text).toContain('Closed-Loop Self-Improvement')
        expect(text).toContain('AP1')
        expect(text).toContain('SK1')
        expect(text).toContain('adversarial-build-skill')
        expect(text).toContain('AUDIT_PROMPT_REVISION')
        expect(text).toContain('generalPurpose')
        expect(text).toContain('None needed')
        expect(text).toContain('**Optional (Skip by default)**')

        expect(text).not.toContain('C:\\Users')
        expect(text).not.toContain('invoke_subagent')
        expect(text).not.toContain('bun path/to/commit.ts')

        const copilotRes = await getPrompt('adversarial-audit-skill', { copilot: 'true' }, db)
        const copilotText = copilotRes.messages[0]?.content.text ?? ''
        expect(copilotText).toContain('Run `gh copilot -- -p')
        expect(copilotText).not.toContain('**Optional (Skip by default)**')
    })
})
