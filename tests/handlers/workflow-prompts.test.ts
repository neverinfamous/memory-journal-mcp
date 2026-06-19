import { describe, it, expect, vi } from 'vitest'
import { getWorkflowPromptDefinitions } from '../../src/handlers/prompts/workflow.js'

describe('Workflow Prompts', () => {
    it('covers time-period-analysis', () => {
        const prompts = getWorkflowPromptDefinitions()
        const analyze = prompts.find((p) => p.name === 'time-period-analysis')!

        const mockDb = {}

        const result = analyze.handler({ period_type: 'custom', start_date: '2025', end_date: '2025' }, mockDb as any)
        expect(result.messages[0].content).toBeDefined()
    })

    it('covers goal-tracker', () => {
        const prompts = getWorkflowPromptDefinitions()
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

    it('covers session-summary', () => {
        const prompts = getWorkflowPromptDefinitions()
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

        const result = summary.handler({}, mockDb as any)
        expect(result.messages[0].content).toBeDefined()
    })
})
