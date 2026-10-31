/**
 * memory-journal-mcp — Briefing System Section Unit Tests
 *
 * Tests for the system-section module that provides version, surface area,
 * unreleased summary, test health, and localTime for the briefing.
 */

import { describe, it, expect, vi } from 'vitest'
import {
    parseTestHealth,
    buildSystemContext,
} from '../../src/handlers/resources/core/briefing/system-section.js'


vi.mock('../../src/git/git-client.js', () => {
    return {
        GitHistoryClient: vi.fn().mockImplementation(() => ({
            getUnreleasedChangelog: vi.fn().mockResolvedValue({
                categories: {},
                totalCount: 0
            }),
            getCommitHistory: vi.fn().mockResolvedValue([])
        }))
    }
})



// ============================================================================
// parseTestHealth
// ============================================================================

describe('parseTestHealth', () => {
    it('should parse shields.io badge patterns from README', () => {
        const content = `# Memory Journal MCP

![Tests](https://img.shields.io/badge/Tests-1782_passed-brightgreen)
![E2E Tests](https://img.shields.io/badge/E2E_Tests-391_passed-brightgreen)
![Coverage](https://img.shields.io/badge/Coverage-91.07%25-brightgreen)
`
        const result = parseTestHealth(content)

        expect(result).toEqual({
            unitTests: 1782,
            e2eTests: 391,
            coverage: 91.07,
        })
    })

    it('should return null when no badges found', () => {
        const content = `# Some Project

No badges here.
`
        expect(parseTestHealth(content)).toBeNull()
    })

    it('should handle partial badge data', () => {
        const content = `![Tests](https://img.shields.io/badge/Tests-500_passed-brightgreen)`
        const result = parseTestHealth(content)

        expect(result).toEqual({
            unitTests: 500,
            e2eTests: 0,
            coverage: 0,
        })
    })

    it('should handle URL-encoded spaces in badge labels', () => {
        const content = `![Tests](https://img.shields.io/badge/Tests-1200%20passed-brightgreen)
![E2E Tests](https://img.shields.io/badge/E2E%20Tests-200_passed-brightgreen)
`
        const result = parseTestHealth(content)

        expect(result).not.toBeNull()
        expect(result!.unitTests).toBe(1200)
        expect(result!.e2eTests).toBe(200)
    })
})

// ============================================================================
// buildSystemContext
// ============================================================================

describe('buildSystemContext', () => {
    it('should return a complete SystemContext object', async () => {
        const result = await buildSystemContext(undefined, undefined, undefined, 42)

        expect(result).toHaveProperty('version')
        expect(typeof result.version).toBe('string')
        expect(result.version.length).toBeGreaterThan(0)

        expect(result).toHaveProperty('toolCount')
        expect(typeof result.toolCount).toBe('number')
        expect(result.toolCount).toBeGreaterThan(0)

        expect(result).toHaveProperty('resourceCount')
        expect(typeof result.resourceCount).toBe('number')
        expect(result.resourceCount).toBeGreaterThan(0)

        expect(result).toHaveProperty('promptCount')
        expect(typeof result.promptCount).toBe('number')
        expect(result.promptCount).toBeGreaterThan(0)

        expect(result).toHaveProperty('localTime')
        expect(typeof result.localTime).toBe('string')
        expect(result.localTime.length).toBeGreaterThan(0)
    })

    it('should include git history summary', async () => {
        const result = await buildSystemContext(undefined, undefined, undefined, 42)

        if (result.gitHistory !== null) {
            expect(result.gitHistory).toHaveProperty('commits')
            expect(Array.isArray(result.gitHistory.commits)).toBe(true)
        }
    })

    it('should format localTime as YYYY-MM-DD HH:MM TZ', async () => {
        const result = await buildSystemContext(undefined, undefined, undefined, 42)

        // Should match pattern like "2026-05-25 06:12 EDT" or "2026-05-25 06:12 UTC"
        expect(result.localTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \w+/)
    })
})
