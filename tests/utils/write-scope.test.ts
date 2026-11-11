import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../src/types/errors.js'
import { alignedProjectFilter, pairStoredScope } from '../../src/utils/write-scope.js'

const registry = {
    adamic: { project_number: 16 },
    'memory-journal-mcp': { project_number: 5 },
}

describe('pairStoredScope', () => {
    it('keeps a workspace with its own project number', () => {
        expect(pairStoredScope('adamic', 16, registry)).toEqual({
            workspaceId: 'adamic',
            projectNumber: 16,
        })
    })

    it('fills an omitted project number from the registry', () => {
        expect(pairStoredScope('memory-journal-mcp', undefined, registry)).toEqual({
            workspaceId: 'memory-journal-mcp',
            projectNumber: 5,
        })
    })

    it('rejects a project number owned by another workspace', () => {
        expect(() => pairStoredScope('adamic', 5, registry)).toThrow(ValidationError)
        expect(() => pairStoredScope('new-repo', 16, registry)).toThrow(ValidationError)
    })

    it('allows an unregistered workspace with an unregistered project number', () => {
        expect(pairStoredScope('new-repo', 99, registry)).toEqual({
            workspaceId: 'new-repo',
            projectNumber: 99,
        })
    })
})

describe('alignedProjectFilter', () => {
    it('uses the registry project of an explicit workspace', () => {
        expect(alignedProjectFilter('adamic', 5, registry)).toBe(16)
        expect(alignedProjectFilter('*', 5, registry)).toBe(5)
        expect(alignedProjectFilter('adamic', undefined, registry)).toBeUndefined()
    })
})
