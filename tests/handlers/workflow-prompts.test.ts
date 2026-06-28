import { describe, it, expect, vi } from 'vitest'
import { getWorkflowPromptDefinitions } from '../../src/handlers/prompts/workflow.js'
import { getAnalyticsPromptDefinitions } from '../../src/handlers/prompts/analytics.js'

describe('Workflow Prompts', () => {
    it('covers prepare-standup', () => {
        const prompts = [...getWorkflowPromptDefinitions(), ...getAnalyticsPromptDefinitions()]
        const analyze = prompts.find((p) => p.name === 'prepare-standup')!

        const mockDb = {}

        const result = analyze.handler({}, mockDb as any)
        expect(result.messages[0].content).toBeDefined()
    })

    it('covers goal-tracker', () => {
        const prompts = [...getWorkflowPromptDefinitions(), ...getAnalyticsPromptDefinitions()]
        const track = prompts.find((p) => p.name === 'goal-tracker')!

        const mockDb = {
            getSignificantEntries: vi.fn().mockReturnValue([
                {
                    id: 1,
                    entryType: 'goal',
                    timestamp: 'test',
                    content: 'test content '.repeat(20),
                },
            ]),
        }

        const result = track.handler({}, mockDb as any)
        expect(result.messages[0].content).toBeDefined()
    })

    it('covers session-summary', async () => {
        const prompts = [...getWorkflowPromptDefinitions(), ...getAnalyticsPromptDefinitions()]
        const summary = prompts.find((p) => p.name === 'session-summary')!

        const mockDb = {
            getRecentEntries: vi.fn().mockReturnValue({ entries: [
                {
                    id: 1,
                    entryType: 'note',
                    timestamp: 'test',
                    content: 'test content ',
                },
            ]}),
        }

        const result = await summary.handler({}, mockDb as any)
        expect(result.messages[0].content).toBeDefined()
    })
})
