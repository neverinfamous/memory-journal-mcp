/**
 * Icons Tests
 *
 * Tests icon constants and getToolIcon function.
 */

import { describe, it, expect } from 'vitest'
import {
    ICON_CORE,
    ICON_SEARCH,
    ICON_ANALYTICS,
    ICON_RELATIONSHIPS,
    ICON_IO,
    ICON_ADMIN,
    ICON_GITHUB,
    ICON_BACKUP,
    ICON_BRIEFING,
    ICON_CLOCK,
    ICON_TAG,
    ICON_STAR,
    ICON_ISSUE,
    ICON_PR,
    ICON_PROMPT,
    getToolIcon,
} from '../../src/constants/icons.js'

// ============================================================================
// Tool Group Icons
// ============================================================================

describe('Tool group icons', () => {
    const toolIcons = [
        { name: 'ICON_CORE', icon: ICON_CORE },
        { name: 'ICON_SEARCH', icon: ICON_SEARCH },
        { name: 'ICON_ANALYTICS', icon: ICON_ANALYTICS },
        { name: 'ICON_RELATIONSHIPS', icon: ICON_RELATIONSHIPS },
        { name: 'ICON_IO', icon: ICON_IO },
        { name: 'ICON_ADMIN', icon: ICON_ADMIN },
        { name: 'ICON_GITHUB', icon: ICON_GITHUB },
        { name: 'ICON_BACKUP', icon: ICON_BACKUP },
    ]

    it.each(toolIcons)('$name should have valid SVG data URI', ({ icon }) => {
        expect(icon.src).toMatch(/^data:image\/svg\+xml/)
        expect(icon.mimeType).toBe('image/svg+xml')
        expect(icon.sizes).toContain('24x24')
    })
})

// ============================================================================
// Resource Icons
// ============================================================================

describe('Resource icons', () => {
    const resourceIcons = [
        { name: 'ICON_BRIEFING', icon: ICON_BRIEFING },
        { name: 'ICON_CLOCK', icon: ICON_CLOCK },
        { name: 'ICON_TAG', icon: ICON_TAG },

        { name: 'ICON_STAR', icon: ICON_STAR },
        { name: 'ICON_ISSUE', icon: ICON_ISSUE },
        { name: 'ICON_PR', icon: ICON_PR },
        { name: 'ICON_PROMPT', icon: ICON_PROMPT },
    ]

    it.each(resourceIcons)('$name should have valid SVG data URI', ({ icon }) => {
        expect(icon.src).toMatch(/^data:image\/svg\+xml/)
        expect(icon.mimeType).toBe('image/svg+xml')
        expect(icon.sizes).toContain('24x24')
    })
})

// ============================================================================
// getToolIcon
// ============================================================================

describe('getToolIcon', () => {
    it('should return icon array for valid groups', () => {
        const groups = [
            'core',
            'search',
            'analytics',
            'relationships',
            'io',
            'admin',
            'github',
            'backup',
        ]

        for (const group of groups) {
            const icons = getToolIcon(group)
            expect(icons).toBeDefined()
            expect(Array.isArray(icons)).toBe(true)
            expect(icons!.length).toBeGreaterThan(0)
        }
    })

    it('should return undefined for unknown group', () => {
        expect(getToolIcon('nonexistent')).toBeUndefined()
    })
})
