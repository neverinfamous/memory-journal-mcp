/**
 * Progress Utilities Tests
 *
 * Tests sendProgress and createBatchProgressReporter with mock NotificationSender.
 */

import { describe, it, expect, vi } from 'vitest'
import { sendProgress, createBatchProgressReporter } from '../../src/utils/progress-utils.js'
import type { ProgressContext } from '../../src/utils/progress-utils.js'

/** Create a mock ProgressContext */
function createMockContext(token?: string | number): {
    ctx: ProgressContext
    notifications: { progress: number; total?: number; message?: string }[]
} {
    const notifications: { progress: number; total?: number; message?: string }[] = []
    const ctx: ProgressContext = {
        server: {
            notification: vi.fn(async (n) => {
                notifications.push(n.params)
            }),
        },
        progressToken: token,
    }
    return { ctx, notifications }
}

// ============================================================================
// sendProgress
// ============================================================================

describe('sendProgress', () => {
    it('should no-op when context is undefined', async () => {
        // Should not throw
        await sendProgress(undefined, 5, 10, 'working')
    })

    it('should no-op when progressToken is undefined', async () => {
        const { ctx } = createMockContext(undefined)
        await sendProgress(ctx, 5, 10, 'working')
        expect(ctx.server.notification).not.toHaveBeenCalled()
    })

    it('should send notification with correct shape', async () => {
        const { ctx, notifications } = createMockContext('token-1')
        await sendProgress(ctx, 3, 10, 'Processing')

        expect(notifications).toHaveLength(1)
        expect(notifications[0]).toEqual({
            progressToken: 'token-1',
            progress: 3,
            total: 10,
            message: 'Processing',
        })
    })

    it('should omit total when undefined', async () => {
        const { ctx, notifications } = createMockContext('t2')
        await sendProgress(ctx, 5, undefined, 'step')

        expect(notifications[0]).not.toHaveProperty('total')
        expect(notifications[0]?.progress).toBe(5)
    })

    it('should omit message when undefined', async () => {
        const { ctx, notifications } = createMockContext('t3')
        await sendProgress(ctx, 7, 10)

        expect(notifications[0]).not.toHaveProperty('message')
    })

    it('should omit message when empty string', async () => {
        const { ctx, notifications } = createMockContext('t4')
        await sendProgress(ctx, 1, 5, '')

        expect(notifications[0]).not.toHaveProperty('message')
    })

    it('should accept numeric progressToken', async () => {
        const { ctx, notifications } = createMockContext(42)
        await sendProgress(ctx, 1, 1, 'done')

        expect(notifications[0]?.progressToken).toBe(42)
    })

    it('should silently handle notification errors', async () => {
        const ctx: ProgressContext = {
            server: {
                notification: vi.fn(async () => {
                    throw new Error('Transport closed')
                }),
            },
            progressToken: 'token',
        }

        // Should not throw
        await sendProgress(ctx, 1, 10, 'test')
    })
})

// ============================================================================
// createBatchProgressReporter
// ============================================================================

describe('createBatchProgressReporter', () => {
    it('should report at throttle intervals', async () => {
        const { ctx, notifications } = createMockContext('batch-1')
        const report = createBatchProgressReporter(ctx, 100, 10)

        // Report items 1 through 30
        for (let i = 1; i <= 30; i++) {
            await report(i, `Item ${i}`)
        }

        // Should have reported at 10, 20, 30
        expect(notifications).toHaveLength(3)
        expect(notifications[0]?.progress).toBe(10)
        expect(notifications[1]?.progress).toBe(20)
        expect(notifications[2]?.progress).toBe(30)
    })

    it('should always report on completion', async () => {
        const { ctx, notifications } = createMockContext('batch-2')
        const total = 15
        const report = createBatchProgressReporter(ctx, total, 10)

        // Report items 1 through 15 (total)
        for (let i = 1; i <= total; i++) {
            await report(i)
        }

        // Should report at 10 and 15 (completion)
        expect(notifications).toHaveLength(2)
        expect(notifications[1]?.progress).toBe(15)
    })

    it('should skip intermediate items below throttle', async () => {
        const { ctx, notifications } = createMockContext('batch-3')
        const report = createBatchProgressReporter(ctx, 100, 20)

        await report(5)
        await report(10)
        await report(15)

        expect(notifications).toHaveLength(0)
    })

    it('should work with undefined context', async () => {
        const report = createBatchProgressReporter(undefined, 50, 10)

        // Should not throw
        for (let i = 1; i <= 50; i++) {
            await report(i)
        }
    })
})
