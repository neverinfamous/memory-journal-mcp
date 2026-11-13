import { describe, it, expect } from 'vitest'
import { getRequiredScope } from '../../src/auth/scope-map.js'

describe('scope-map isolation regressions (pass 20, H5)', () => {
    it('requires team scope for memory://team resources', () => {
        expect(getRequiredScope('memory://team/recent')).toBe('team')
        expect(getRequiredScope('memory://team/statistics')).toBe('team')
    })

    it('requires audit scope for memory://audit', () => {
        expect(getRequiredScope('memory://audit')).toBe('audit')
    })

    it('keeps generic memory:// resources at read scope', () => {
        expect(getRequiredScope('memory://recent')).toBe('read')
    })

    it('does not downgrade mutating core methods with incidental read tokens', () => {
        expect(getRequiredScope('mj.core.setStatus')).toBe('admin')
        expect(getRequiredScope('mj.core.markStale')).toBe('admin')
        expect(getRequiredScope('mj.core.getRecentEntries')).toBe('read')
        expect(getRequiredScope('mj.core.semanticSearch')).toBe('read')
    })
})
