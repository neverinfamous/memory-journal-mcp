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
        'core-platform': { path: 'C:/workspace/core-platform', project_number: 16 },
        'S2-Manager-Worker': { path: 'C:/workspace/S2-Manager-Worker', project_number: 24 },
        'edge-test-worker': { path: 'C:/workspace/edge-test-worker', project_number: 1 },
        'no-number': { path: 'C:/workspace/no-number' },
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
            expect(text).toContain('| 16 | core-platform | C:/workspace/core-platform |')
            expect(text).toContain('| 24 | S2-Manager-Worker |')
            expect(text).toContain('| 1 | edge-test-worker |')
            expect(text).not.toContain('| 2 | S2-Manager-Worker |')
        })

        it('shows a dash for entries without a project_number', async () => {
            const text = await runPrompt()
            expect(text).toContain('| - | no-number |')
        })

        it('marks the active workspace by defaultProjectNumber', async () => {
            const text = await runPrompt()
            expect(text).toContain('**Active**: core-platform (#16)')
        })
    })

    describe('resolution', () => {
        it('resolves numeric input by project_number', async () => {
            const text = await runPrompt('16')
            expect(text).toContain('memory://briefing/core-platform')
        })

        it('resolves "1" to the project numbered 1, not the first list entry', async () => {
            const text = await runPrompt('1')
            expect(text).toContain('memory://briefing/edge-test-worker')
            expect(text).not.toContain('memory://briefing/core-platform')
        })

        it('resolves multiple project numbers', async () => {
            const text = await runPrompt('16, 24')
            expect(text).toContain('1. memory://briefing/core-platform')
            expect(text).toContain('2. memory://briefing/S2-Manager-Worker')
        })

        it('does not fall back to list position or partial name match for unknown numbers', async () => {
            // "2" is a valid list position and a substring of "S2-Manager-Worker"
            const text = await runPrompt('2')
            expect(text).toContain('Not found: 2')
            expect(text).not.toContain('memory://briefing/')
        })

        it('lists project numbers in the not-found error message', async () => {
            const text = await runPrompt('999')
            expect(text).toContain('Available projects: core-platform (#16), S2-Manager-Worker (#24), edge-test-worker (#1), no-number')
        })

        it('resolves exact names case-insensitively and does not resolve a unique substring', async () => {
            expect(await runPrompt('CORE-PLATFORM')).toContain('memory://briefing/core-platform')
            const partial = await runPrompt('s2-man')
            expect(partial).toContain('Not found: s2-man')
            expect(partial).not.toContain('memory://briefing/S2-Manager-Worker')
        })
    })
})
