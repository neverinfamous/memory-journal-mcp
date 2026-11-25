import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../src/types/errors.js'
import { alignedProjectFilter, pairStoredScope } from '../../src/utils/write-scope.js'

const registry = {
    'core-platform': { project_number: 16 },
    'memory-journal-mcp': { project_number: 5 },
}

describe('pairStoredScope', () => {
    it('keeps a workspace with its own project number', () => {
        expect(pairStoredScope('core-platform', 16, registry)).toEqual({
            workspaceId: 'core-platform',
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
        expect(() => pairStoredScope('core-platform', 5, registry)).toThrow(ValidationError)
        expect(() => pairStoredScope('new-repo', 16, registry)).toThrow(ValidationError)
    })

    it('allows an unregistered workspace with an unregistered project number', () => {
        expect(pairStoredScope('new-repo', 99, registry)).toEqual({
            workspaceId: 'new-repo',
            projectNumber: 99,
        })
    })

    it('rejects a default workspace carrying another registry project', () => {
        expect(() => pairStoredScope('default', 16, registry)).toThrow(ValidationError)
        expect(pairStoredScope('default', undefined, registry)).toEqual({
            workspaceId: 'default',
            projectNumber: undefined,
        })
    })
})

describe('alignedProjectFilter', () => {
    it('keeps a project number that belongs to the workspace', () => {
        expect(alignedProjectFilter('core-platform', 16, registry)).toBe(16)
        expect(alignedProjectFilter('*', 5, registry)).toBe(5)
        expect(alignedProjectFilter('core-platform', undefined, registry)).toBeUndefined()
    })

    it('rejects a project number from a different workspace', () => {
        expect(() => alignedProjectFilter('core-platform', 5, registry)).toThrow(ValidationError)
    })

    it('pair-checks an explicit workspace of default', () => {
        expect(() => alignedProjectFilter('default', 16, registry)).toThrow(ValidationError)
        expect(alignedProjectFilter('default', undefined, registry)).toBeUndefined()
    })
})
