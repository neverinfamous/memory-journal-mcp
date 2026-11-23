import { describe, it, expect, vi } from 'vitest'
import { buildInsightsSection } from '../../src/handlers/resources/core/briefing/insights-section.js'
import type { ResourceContext } from '../../src/handlers/resources/shared.js'
import type { DigestSnapshot } from '../../src/database/sqlite-adapter/entries/digest.js'

describe('Briefing Insights Section', () => {
    it('should return null if no digest is available', () => {
        const context: ResourceContext = {}
        const result = buildInsightsSection(context)
        expect(result).toBeNull()
    })

    it('should build insights section from live compute digest', () => {
        const mockSnapshot: DigestSnapshot = {
            computedAt: '2026-04-11T12:00:00Z',
            currentPeriodEntries: 10,
            previousPeriodEntries: 5,
            activityGrowthPercent: 100,
            currentPeriodSignificant: 2,
            historicalAvgSignificant: 1,
            significanceMultiplier: 2.0,
            staleProjects: [
                { projectNumber: 42, daysSilent: 20, lastEntryDate: '2026-03-22T00:00:00Z' },
            ],
            currentRelDensity: 0.1,
            previousRelDensity: 0.05,
            topImportanceEntries: [{ id: 1, score: 0.9, preview: 'Top entry' }],
        }

        const context: ResourceContext = {
            db: {
                computeDigest: vi.fn().mockReturnValue(mockSnapshot),
            } as any,
        }

        const result = buildInsightsSection(context)
        expect(result).not.toBeNull()
        expect(result?.activityTrend).toBe('+100% vs. last period (10 entries)')
        expect(result?.significanceSpike).toBe('2 significant entries (2× avg)')
        expect(result?.staleProjects[0]?.projectNumber).toBe(42)
        expect(result?.topImportance[0]?.preview).toBe(
            '<untrusted_remote_content>Top entry</untrusted_remote_content>'
        )
        expect(result?.relationshipDensity).toBe(0.1)
    })

    it('should build insights section from persisted db digest', () => {
        const mockSnapshot: DigestSnapshot = {
            computedAt: '2026-04-11T12:00:00Z',
            currentPeriodEntries: 5,
            previousPeriodEntries: 0,
            activityGrowthPercent: null, // no previous data
            currentPeriodSignificant: 1,
            historicalAvgSignificant: 1,
            significanceMultiplier: 1.0, // multiplier not > 1.5
            staleProjects: [],
            currentRelDensity: 0, // 0 should omit relationshipDensity
            previousRelDensity: 0,
            topImportanceEntries: [],
        }

        const context: ResourceContext = {
            db: {
                getLatestAnalyticsSnapshot: vi.fn().mockReturnValue({
                    data: mockSnapshot,
                }),
            } as any,
        }

        const result = buildInsightsSection(context)
        expect(result).not.toBeNull()
        // Tests the `else` branches in formatDigest
        expect(result?.activityTrend).toBe('5 entries this period')
        expect(result?.significanceSpike).toBe('1 significant entries this period')
        expect(result?.relationshipDensity).toBeUndefined()
    })

    it('should format negative growth correctly', () => {
        const mockSnapshot: DigestSnapshot = {
            computedAt: '2026-04-11T12:00:00Z',
            currentPeriodEntries: 5,
            previousPeriodEntries: 10,
            activityGrowthPercent: -50,
            currentPeriodSignificant: 0, // Tests the `significanceSpike = null` branch
            historicalAvgSignificant: 0,
            significanceMultiplier: null,
            staleProjects: [],
            currentRelDensity: 0,
            previousRelDensity: 0,
            topImportanceEntries: [],
        }

        const context: ResourceContext = {
            db: {
                computeDigest: vi.fn().mockReturnValue(mockSnapshot),
            } as any,
        }

        const result = buildInsightsSection(context)
        expect(result?.activityTrend).toBe('-50% vs. last period (5 entries)') // sign = '' since it's < 0
        expect(result?.significanceSpike).toBeNull()
    })

    it('redacts home paths in topImportance previews and degrades gracefully when persisted lookup throws', () => {
        const throwingCtx: ResourceContext = {
            db: {
                getLatestAnalyticsSnapshot: vi.fn(() => {
                    throw new Error('corrupt snapshot')
                }),
            } as never,
        }
        expect(buildInsightsSection(throwingCtx)).toBeNull()

        const pathSnapshot: DigestSnapshot = {
            computedAt: '2026-04-11T12:00:00Z',
            currentPeriodEntries: 2,
            previousPeriodEntries: 1,
            activityGrowthPercent: 100,
            currentPeriodSignificant: 0,
            historicalAvgSignificant: 0,
            significanceMultiplier: null,
            staleProjects: [],
            currentRelDensity: 0,
            previousRelDensity: 0,
            topImportanceEntries: [
                { id: 7, score: 0.9, preview: 'Edited C:\\Users\\alice\\Desktop\\secret\\file.ts' },
            ],
        }
        const res = buildInsightsSection({
            db: { computeDigest: vi.fn().mockReturnValue(pathSnapshot) } as never,
        })
        expect(res?.topImportance[0]?.preview).not.toContain('alice')
        expect(res?.topImportance[0]?.preview).toContain('&lt;desktop&gt;')
    })
})
