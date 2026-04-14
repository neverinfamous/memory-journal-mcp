import { describe, it, expect, vi } from 'vitest'
import { getWorkflowPromptDefinitions } from '../../src/handlers/prompts/workflow.js'

describe('Workflow Prompts', () => {
    it('covers prepare-standup', () => {
        const prompts = getWorkflowPromptDefinitions()
        const standup = prompts.find((p) => p.name === 'prepare-standup')!

        const mockDb = {
            searchByDateRange: vi
                .fn()
                .mockReturnValue([
                    { timestamp: '2025-01-01', entryType: 'note', content: 'test note' },
                ]),
        }

        const result = standup.handler({}, mockDb as any)
        expect(mockDb.searchByDateRange).toHaveBeenCalled()
        expect(result.messages[0].content).toBeDefined()
    })

    it('covers prepare-retro', () => {
        const prompts = getWorkflowPromptDefinitions()
        const retro = prompts.find((p) => p.name === 'prepare-retro')!

        const mockDb = {
            searchByDateRange: vi
                .fn()
                .mockReturnValue([
                    { timestamp: '2025-01-01', entryType: 'note', content: 'retro note' },
                ]),
        }

        const result = retro.handler({ days: '10' }, mockDb as any)
        expect(mockDb.searchByDateRange).toHaveBeenCalled()
        expect(result.messages[0].content).toBeDefined()
    })

    it('covers weekly-digest', () => {
        const prompts = getWorkflowPromptDefinitions()
        const digest = prompts.find((p) => p.name === 'weekly-digest')!

        const mockDb = {
            searchByDateRange: vi
                .fn()
                .mockReturnValue([
                    { timestamp: '2025-01-01', entryType: 'note', content: 'digest note' },
                ]),
        }

        const result = digest.handler({}, mockDb as any)
        expect(mockDb.searchByDateRange).toHaveBeenCalled()
        expect(result.messages[0].content).toBeDefined()
    })

    it('covers analyze-period', () => {
        const prompts = getWorkflowPromptDefinitions()
        const analyze = prompts.find((p) => p.name === 'analyze-period')!

        const mockDb = {
            searchByDateRange: vi.fn().mockReturnValue([]),
            getStatistics: vi.fn().mockReturnValue({}),
        }

        const result = analyze.handler({ start_date: '2025', end_date: '2025' }, mockDb as any)
        expect(mockDb.searchByDateRange).toHaveBeenCalled()
        expect(mockDb.getStatistics).toHaveBeenCalled()
        expect(result.messages[0].content).toBeDefined()
    })

    it('covers goal-tracker', () => {
        const prompts = getWorkflowPromptDefinitions()
        const track = prompts.find((p) => p.name === 'goal-tracker')!

        const mockDb = {
            _executeRawQueryUnsafe: vi.fn().mockReturnValue([
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

    it('covers get-context-bundle', () => {
        const prompts = getWorkflowPromptDefinitions()
        const bundle = prompts.find((p) => p.name === 'get-context-bundle')!

        const mockDb = {
            getRecentEntries: vi.fn().mockReturnValue([
                {
                    id: 1,
                    entryType: 'note',
                    timestamp: 'test',
                    content: 'test content '.repeat(10),
                },
            ]),
            getStatistics: vi.fn().mockReturnValue({}),
        }

        const result = bundle.handler({}, mockDb as any)
        expect(result.messages[0].content).toBeDefined()
    })

    it('covers confirm-briefing', () => {
        const prompts = getWorkflowPromptDefinitions()
        const confirm = prompts.find((p) => p.name === 'confirm-briefing')!

        const mockDb = {
            getRecentEntries: vi
                .fn()
                .mockReturnValue([
                    { id: 1, entryType: 'note', timestamp: 'test', content: 'test' },
                ]),
            getStatistics: vi.fn().mockReturnValue({ totalEntries: 1 }),
        }

        const result = confirm.handler({}, mockDb as any)
        expect(result.messages[0].content).toBeDefined()
    })
})
