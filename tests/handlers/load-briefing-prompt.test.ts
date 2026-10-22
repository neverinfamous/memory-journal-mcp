/**
 * load-briefing Prompt Tests
 *
 * Verifies that the interactive project list displays the registry's configured
 * project_number (not the list position) and that numeric input resolves against it.
 */

import { describe, it, expect } from 'vitest'
import { getLoadBriefingPromptDefinitions } from '../../src/handlers/prompts/load-briefing.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import type { BriefingConfig } from '../../src/handlers/resources/shared.js'

const config: BriefingConfig = {
    ...DEFAULT_BRIEFING_CONFIG,
    defaultProjectNumber: 16,
    projectRegistry: {
        adamic: { path: 'C:/Users/chris/Desktop/adamic', project_number: 16 },
        'R2-Manager-Worker': { path: 'C:/Users/chris/Desktop/R2-Manager-Worker', project_number: 24 },
        'do-test-worker': { path: 'C:/Users/chris/Desktop/do-test-worker', project_number: 1 },
        'no-number': { path: 'C:/Users/chris/Desktop/no-number' },
    },
}

async function runPrompt(projects?: string): Promise<string> {
    const def = getLoadBriefingPromptDefinitions().find((d) => d.name === 'load-briefing')
    if (!def) throw new Error('load-briefing prompt not registered')
    const args: Record<string, string> = projects !== undefined ? { projects } : {}
    const result = await def.handler(args, undefined, undefined, undefined, config)
    const first = result.messages[0]
    if (first?.content.type !== 'text') throw new Error('Expected a text message')
    return first.content.text
}

describe('load-briefing prompt', () => {
    describe('interactive list', () => {
        it('shows the configured project_number instead of the list position', async () => {
            const text = await runPrompt()
            expect(text).toContain('| Project # | Name | Path |')
            expect(text).toContain('| 16 | adamic | C:/Users/chris/Desktop/adamic |')
            expect(text).toContain('| 24 | R2-Manager-Worker |')
            expect(text).toContain('| 1 | do-test-worker |')
            expect(text).not.toContain('| 2 | R2-Manager-Worker |')
        })

        it('shows a dash for entries without a project_number', async () => {
            const text = await runPrompt()
            expect(text).toContain('| - | no-number |')
        })

        it('marks the active workspace by defaultProjectNumber', async () => {
            const text = await runPrompt()
            expect(text).toContain('**Active**: adamic (#16)')
        })
    })

    describe('resolution', () => {
        it('resolves numeric input by project_number', async () => {
            const text = await runPrompt('16')
            expect(text).toContain('memory://briefing/adamic')
        })

        it('resolves "1" to the project numbered 1, not the first list entry', async () => {
            const text = await runPrompt('1')
            expect(text).toContain('memory://briefing/do-test-worker')
            expect(text).not.toContain('memory://briefing/adamic')
        })

        it('resolves multiple project numbers', async () => {
            const text = await runPrompt('16, 24')
            expect(text).toContain('1. memory://briefing/adamic')
            expect(text).toContain('2. memory://briefing/R2-Manager-Worker')
        })

        it('does not fall back to list position or partial name match for unknown numbers', async () => {
            // "2" is a valid list position and a substring of "R2-Manager-Worker"
            const text = await runPrompt('2')
            expect(text).toContain('Not found: 2')
            expect(text).not.toContain('memory://briefing/')
        })

        it('lists project numbers in the not-found error message', async () => {
            const text = await runPrompt('999')
            expect(text).toContain('Available projects: adamic (#16), R2-Manager-Worker (#24), do-test-worker (#1), no-number')
        })

        it('still resolves names and partial names', async () => {
            expect(await runPrompt('ADAMIC')).toContain('memory://briefing/adamic')
            expect(await runPrompt('r2-man')).toContain('memory://briefing/R2-Manager-Worker')
        })
    })
})
