import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatDigestReport, deliverReport } from '../../src/server/digest-reporter.js'
import type { DigestSnapshot } from '../../src/database/sqlite-adapter/entries/digest.js'

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))

describe('Digest Reporter', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
        mockFetch = vi.fn()
        global.fetch = mockFetch as unknown as typeof fetch
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    const sampleSnapshot: DigestSnapshot = {
        computedAt: '2026-06-09T10:00:00.000Z',
        currentPeriodEntries: 10,
        previousPeriodEntries: 8,
        activityGrowthPercent: 25,
        currentPeriodSignificant: 3,
        historicalAvgSignificant: 2,
        significanceMultiplier: 1.5,
        currentRelDensity: 1.2,
        previousRelDensity: 1.0,
        staleProjects: [
            { projectNumber: 42, lastEntryDate: '2026-05-01T00:00:00.000Z', daysSilent: 39 }
        ],
        topImportanceEntries: [
            { id: 100, score: 9.5, preview: 'Important architectural decision.' }
        ]
    }

    describe('formatDigestReport', () => {
        it('should generate markdown containing key statistics', () => {
            const report = formatDigestReport(sampleSnapshot, '1.0.0')
            expect(report).toContain('Entries this period**: 10 (+25% vs last period)')
            expect(report).toContain('Significant entries**: 3 (1.5× historical average)')
            expect(report).toContain('Project P42: 39 days silent')
            expect(report).toContain('Important architectural decision.')
            expect(report).toContain('(v1.0.0)')
        })

        it('should handle snapshots with zero/empty values gracefully', () => {
            const emptySnapshot: DigestSnapshot = {
                computedAt: '2026-06-09T10:00:00.000Z',
                currentPeriodEntries: 5,
                previousPeriodEntries: 5,
                activityGrowthPercent: null,
                currentPeriodSignificant: 0,
                historicalAvgSignificant: 0,
                significanceMultiplier: null,
                currentRelDensity: 1.0,
                previousRelDensity: 1.0,
                staleProjects: [],
                topImportanceEntries: []
            }
            const report = formatDigestReport(emptySnapshot, '1.0.0')
            expect(report).toContain('Entries this period**: 5 (baseline period)')
            expect(report).not.toContain('Significance Highlights')
            expect(report).not.toContain('Stale Projects')
            expect(report).not.toContain('Top Importance')
        })
    })

    describe('deliverReport', () => {
        const url = 'https://example.com/webhook'
        const auth = 'Bearer test-token'
        
        it('should deliver slack markdown by default', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true })
            const result = await deliverReport('Test report', sampleSnapshot, { webhookUrl: url })
            expect(result).toBe(true)
            expect(mockFetch).toHaveBeenCalledWith(url, expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: 'Test report' })
            }))
        })

        it('should deliver discord markdown when configured', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true })
            const result = await deliverReport('Test report', sampleSnapshot, { webhookUrl: url, contentType: 'discord' })
            expect(result).toBe(true)
            expect(mockFetch).toHaveBeenCalledWith(url, expect.objectContaining({
                body: JSON.stringify({ content: 'Test report' })
            }))
        })

        it('should deliver raw json when configured', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true })
            const result = await deliverReport('Test report', sampleSnapshot, { webhookUrl: url, contentType: 'json' })
            expect(result).toBe(true)
            expect(mockFetch).toHaveBeenCalledWith(url, expect.objectContaining({
                body: JSON.stringify(sampleSnapshot)
            }))
        })

        it('should inject Authorization header if webhookAuth is provided', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true })
            await deliverReport('Test', sampleSnapshot, { webhookUrl: url, webhookAuth: auth })
            expect(mockFetch).toHaveBeenCalledWith(url, expect.objectContaining({
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': auth
                }
            }))
        })

        it('should not retry on client errors (400-499)', async () => {
            mockFetch.mockResolvedValueOnce({ ok: false, status: 400, statusText: 'Bad Request' })
            const result = await deliverReport('Test', sampleSnapshot, { webhookUrl: url })
            expect(result).toBe(false)
            expect(mockFetch).toHaveBeenCalledTimes(1)
        })

        it('should retry once on server errors (500+)', async () => {
            mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
            mockFetch.mockResolvedValueOnce({ ok: true })
            
            const promise = deliverReport('Test', sampleSnapshot, { webhookUrl: url })
            await vi.advanceTimersByTimeAsync(3000)
            const result = await promise
            
            expect(result).toBe(true)
            expect(mockFetch).toHaveBeenCalledTimes(2)
        })

        it('should fail after max retries', async () => {
            mockFetch.mockRejectedValue(new Error('Network error'))
            
            const promise = deliverReport('Test', sampleSnapshot, { webhookUrl: url })
            await vi.advanceTimersByTimeAsync(3000) // first retry wait
            await vi.advanceTimersByTimeAsync(3000) // max retries exceeded
            
            const result = await promise
            expect(result).toBe(false)
            expect(mockFetch).toHaveBeenCalledTimes(2)
        })
    })
})
