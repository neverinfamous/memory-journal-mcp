import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    exportEntriesToMarkdown,
    generateSlug,
    generateFilename,
} from '../../src/markdown/exporter.js'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'

vi.mock('node:fs/promises', () => ({
    mkdir: vi.fn(),
    writeFile: vi.fn(),
}))

describe('markdown exporter utilities', () => {
    describe('generateSlug', () => {
        it('should truncate to 50 characters', () => {
            const content = 'a'.repeat(100)
            const slug = generateSlug(content)
            expect(slug.length).toBeLessThanOrEqual(50)
            expect(slug).toBe('a'.repeat(50))
        })

        it('should lowercase and replace non-alphanumeric with dashes', () => {
            const content = 'Hello World! This is a Test@123'
            expect(generateSlug(content)).toBe('hello-world-this-is-a-test-123')
        })

        it('should avoid trailing or consecutive dashes', () => {
            const content = 'Hello   World---Testing!!!'
            expect(generateSlug(content)).toBe('hello-world-testing')
        })

        it('should fallback to untitled if content is empty or un-slugable', () => {
            expect(generateSlug('')).toBe('untitled')
            expect(generateSlug('!!! @@@')).toBe('untitled')
        })
    })

    describe('generateFilename', () => {
        it('should format filename with id and slug', () => {
            expect(generateFilename(42, 'My awesome entry')).toBe('42-my-awesome-entry.md')
        })
    })
})

describe('exportEntriesToMarkdown', () => {
    const mockDb = {
        getTagsForEntry: vi.fn(),
        getRelationshipsForEntry: vi.fn(),
    }

    beforeEach(() => {
        vi.clearAllMocks()
        mockDb.getTagsForEntry.mockReturnValue([])
        mockDb.getRelationshipsForEntry.mockReturnValue([])
    })

    it('should export an array of entries to files', async () => {
        const entries = [
            {
                id: 1,
                content: 'Test content one',
                timestamp: '2026-04-08T12:00:00Z',
                entryType: 'note',
            },
            {
                id: 2,
                content: 'Test content two',
                timestamp: '2026-04-08T12:00:00Z',
                entryType: 'decision',
                significance: 'high',
            },
        ]
        mockDb.getTagsForEntry.mockImplementation((id) => (id === 1 ? ['tag1'] : ['tag2']))

        const result = await exportEntriesToMarkdown(entries as any, '/tmp/export', mockDb as any)

        expect(result.success).toBe(true)
        expect(result.exported_count).toBe(2)
        expect(result.skipped).toBe(0)

        // Ensure directory was created
        expect(fs.mkdir).toHaveBeenCalledWith('/tmp/export', { recursive: true })

        // Ensure write file was called for both entries
        expect(fs.writeFile).toHaveBeenCalledTimes(2)

        const firstWriteCall = vi.mocked(fs.writeFile).mock.calls[0]
        expect(firstWriteCall[0]).toContain(join('/tmp/export', '1-test-content-one.md'))
        expect(firstWriteCall[1]).toContain('mj_id: 1')
        expect(firstWriteCall[1]).toContain('Test content one')
        expect(firstWriteCall[1]).toContain('tag1')
    })

    it('should skip entries without content', async () => {
        const entries = [
            {
                id: 1,
                content: '',
                timestamp: '2026-04-08T12:00:00Z',
                entryType: 'note',
            },
        ]

        const result = await exportEntriesToMarkdown(entries as any, '/tmp/export', mockDb as any)

        expect(result.success).toBe(true)
        expect(result.exported_count).toBe(0)
        expect(result.skipped).toBe(1)
        expect(fs.writeFile).not.toHaveBeenCalled()
    })
})
