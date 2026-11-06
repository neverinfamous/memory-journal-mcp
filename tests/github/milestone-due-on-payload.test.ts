/**
 * memory-journal-mcp — Milestone due_on payload tests
 *
 * Verifies what updateMilestone sends to octokit for the dueOn update field:
 * null clears the due date, strings pass through, omission sends nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/logger.js', () => ({
    logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { MilestonesManager } from '../../src/github/github-integration/milestones.js'

const milestoneData = {
    number: 1,
    title: 'v1.0',
    description: null,
    state: 'open',
    html_url: 'https://github.com/o/r/milestone/1',
    due_on: null,
    open_issues: 0,
    closed_issues: 0,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
    creator: null,
}

describe('MilestonesManager.updateMilestone due_on payload', () => {
    const updateMilestone = vi.fn()
    let manager: MilestonesManager

    beforeEach(() => {
        vi.clearAllMocks()
        updateMilestone.mockResolvedValue({ data: milestoneData })
        const client = {
            octokit: { issues: { updateMilestone } },
            invalidateCache: vi.fn(),
            getCached: vi.fn(),
            setCache: vi.fn(),
        }
        manager = new MilestonesManager(client as never)
    })

    function sentPayload(): Record<string, unknown> {
        const calls = updateMilestone.mock.calls as unknown[][]
        return (calls[0]?.[0] ?? {}) as Record<string, unknown>
    }

    it('sends due_on: null when dueOn is null (clears the due date)', async () => {
        await manager.updateMilestone('o', 'r', 1, { dueOn: null })
        const payload = sentPayload()
        expect(payload['due_on']).toBeNull()
        expect(payload['milestone_number']).toBe(1)
    })

    it('passes a string dueOn through unchanged', async () => {
        await manager.updateMilestone('o', 'r', 1, { dueOn: '2026-06-01T08:00:00Z' })
        expect(sentPayload()['due_on']).toBe('2026-06-01T08:00:00Z')
    })

    it('sends no due_on value when dueOn is omitted', async () => {
        await manager.updateMilestone('o', 'r', 1, { title: 'renamed' })
        const payload = sentPayload()
        expect(payload['due_on']).toBeUndefined()
        expect(payload['title']).toBe('renamed')
    })
})
