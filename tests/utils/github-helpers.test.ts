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
    it('should return existingUrl when provided', () => {
        const result = resolveIssueUrl(undefined, 42, 'https://example.com/issue/42')
        expect(result).toBe('https://example.com/issue/42')
    })

    it('should return undefined when no issueNumber', () => {
        const result = resolveIssueUrl(undefined, undefined, undefined)
        expect(result).toBeUndefined()
    })

    it('should return undefined when no github integration', () => {
        const result = resolveIssueUrl(undefined, 42, undefined)
        expect(result).toBeUndefined()
    })

    it('should construct URL from cached repo info', () => {
        const github = {
            getCachedRepoInfo: vi
                .fn()
                .mockReturnValue({ owner: 'neverinfamous', repo: 'memory-journal-mcp' }),
        }

        const result = resolveIssueUrl(github as never, 42, undefined)
        expect(result).toBe('https://github.com/neverinfamous/memory-journal-mcp/issues/42')
    })

    it('should return undefined when cached repo info is incomplete', () => {
        const github = {
            getCachedRepoInfo: vi.fn().mockReturnValue(null),
        }

        const result = resolveIssueUrl(github as never, 42, undefined)
        expect(result).toBeUndefined()
    })

    it('should return undefined when cached repo has no owner', () => {
        const github = {
            getCachedRepoInfo: vi.fn().mockReturnValue({ owner: '', repo: 'memory-journal-mcp' }),
        }

        const result = resolveIssueUrl(github as never, 42, undefined)
        expect(result).toBeUndefined()
    })
})
