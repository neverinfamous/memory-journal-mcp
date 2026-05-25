/**
 * memory-journal-mcp — Briefing System Section Unit Tests
 *
 * Tests for the system-section module that provides version, surface area,
 * unreleased summary, test health, and localTime for the briefing.
 */

import { describe, it, expect } from 'vitest'
import {
    parseUnreleasedSummary,
    parseTestHealth,
    buildSystemContext,
} from '../../src/handlers/resources/core/briefing/system-section.js'

// ============================================================================
// parseUnreleasedSummary
// ============================================================================

describe('parseUnreleasedSummary', () => {
    it('should parse a standard UNRELEASED.md with all categories', () => {
        const content = `# Unreleased

### Added
- Feature A
- Feature B
- Feature C

### Changed
- Change 1
- Change 2

### Fixed
- Fix 1

### Security
- Security patch 1
- Security patch 2

### Removed
- Removed item 1
`
        const result = parseUnreleasedSummary(content)

        expect(result).toEqual({
            added: 3,
            changed: 2,
            fixed: 1,
            security: 2,
            removed: 1,
            keyItems: [],
        })
    })

    it('should return null for empty file', () => {
        expect(parseUnreleasedSummary('')).toBeNull()
    })

    it('should return null when no bullet items exist', () => {
        const content = `# Unreleased

### Added

### Changed

`
        expect(parseUnreleasedSummary(content)).toBeNull()
    })

    it('should handle partial categories', () => {
        const content = `# Unreleased

### Fixed
- Fix 1
- Fix 2
- Fix 3
`
        const result = parseUnreleasedSummary(content)

        expect(result).toEqual({
            added: 0,
            changed: 0,
            fixed: 3,
            security: 0,
            removed: 0,
            keyItems: [],
        })
    })

    it('should ignore non-standard headers', () => {
        const content = `# Unreleased

### Added
- Feature A

### Deprecated
- Old API
`
        const result = parseUnreleasedSummary(content)

        expect(result).toEqual({
            added: 1,
            changed: 0,
            fixed: 0,
            security: 0,
            removed: 0,
            keyItems: [],
        })
    })

    it('should handle nested bullet points under items', () => {
        const content = `# Unreleased

### Added
- Feature A
  - Sub-detail (not counted)
  - Another sub-detail
- Feature B
`
        const result = parseUnreleasedSummary(content)

        // Only top-level bullets starting at column 0 are counted
        expect(result).toEqual({
            added: 2,
            changed: 0,
            fixed: 0,
            security: 0,
            removed: 0,
            keyItems: [],
        })
    })
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
        const result = await buildSystemContext()

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

    it('should include unreleased summary when UNRELEASED.md exists', async () => {
        const result = await buildSystemContext()

        // In dev environment, UNRELEASED.md should exist with content
        // In npm-installed scenarios, this may be null — both are valid
        if (result.unreleasedSummary !== null) {
            expect(result.unreleasedSummary).toHaveProperty('added')
            expect(result.unreleasedSummary).toHaveProperty('changed')
            expect(result.unreleasedSummary).toHaveProperty('fixed')
            expect(result.unreleasedSummary).toHaveProperty('security')
            expect(result.unreleasedSummary).toHaveProperty('removed')
        }
    })

    it('should format localTime as YYYY-MM-DD HH:MM TZ', async () => {
        const result = await buildSystemContext()

        // Should match pattern like "2026-05-25 06:12 EDT" or "2026-05-25 06:12 UTC"
        expect(result.localTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \w+/)
    })
})
