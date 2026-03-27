/**
 * memory-journal-mcp — GitHub Helpers Unit Tests
 *
 * Tests for resolveIssueUrl utility function.
 */

import { describe, it, expect, vi } from 'vitest'
import { resolveIssueUrl } from '../../src/utils/github-helpers.js'

// ============================================================================
// Tests
// ============================================================================

describe('resolveIssueUrl', () => {
    it('should return existingUrl when provided', async () => {
        const result = await resolveIssueUrl({} as never, undefined, 42, 'https://example.com/issue/42')
        expect(result).toBe('https://example.com/issue/42')
    })

    it('should return undefined when no issueNumber', async () => {
        const result = await resolveIssueUrl({} as never, undefined, undefined, undefined)
        expect(result).toBeUndefined()
    })

    it('should return undefined when no github integration', async () => {
        const result = await resolveIssueUrl({} as never, undefined, 42, undefined)
        expect(result).toBeUndefined()
    })

    it('should construct URL from cached repo info', async () => {
        const github = {
            getCachedRepoInfo: vi
                .fn()
                .mockReturnValue({ owner: 'neverinfamous', repo: 'memory-journal-mcp' }),
        }

        const result = await resolveIssueUrl({ github } as never, undefined, 42, undefined)
        expect(result).toBe('https://github.com/neverinfamous/memory-journal-mcp/issues/42')
    })

    it('should return undefined when cached repo info is incomplete', async () => {
        const github = {
            getCachedRepoInfo: vi.fn().mockReturnValue(null),
        }

        const result = await resolveIssueUrl({ github } as never, undefined, 42, undefined)
        expect(result).toBeUndefined()
    })

    it('should return undefined when cached repo has no owner', async () => {
        const github = {
            getCachedRepoInfo: vi.fn().mockReturnValue({ owner: '', repo: 'memory-journal-mcp' }),
        }

        const result = await resolveIssueUrl({ github } as never, undefined, 42, undefined)
        expect(result).toBeUndefined()
    })
})
