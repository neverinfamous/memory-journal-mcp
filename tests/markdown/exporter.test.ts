import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    exportEntriesToMarkdown,
    generateSlug,
    generateFilename,
} from '../../src/markdown/exporter.js'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Shared mock file handle
const mockHandle = {
    writeFile: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
}

vi.mock('node:fs/promises', () => ({
    mkdir: vi.fn(),
    open: vi.fn(),
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
        getRelationships: vi.fn(),
        getRelationshipsForEntries: vi.fn(),
    }

    beforeEach(() => {
        vi.clearAllMocks()
        mockHandle.writeFile.mockResolvedValue(undefined)
        mockHandle.close.mockResolvedValue(undefined)
        vi.mocked(fs.open).mockResolvedValue(mockHandle as any)
        mockDb.getTagsForEntry.mockReturnValue([])
        mockDb.getRelationships.mockReturnValue([])
        mockDb.getRelationshipsForEntries.mockReturnValue(new Map())
    })

    it('should export an array of entries to files', async () => {
        const entries = [
            {
                id: 1,
                content: 'Test content one',
                timestamp: '2026-04-08T12:00:00Z',
                entryType: 'note',
                tags: ['tag1'],
            },
            {
                id: 2,
                content: 'Test content two',
                timestamp: '2026-04-08T12:00:00Z',
                entryType: 'project_decision',
                significance: 'high',
                tags: ['tag2'],
                author: 'Test Author',
            },
        ]
        mockDb.getTagsForEntry.mockImplementation((id: number) => (id === 1 ? ['tag1'] : ['tag2']))
        mockDb.getRelationshipsForEntries.mockImplementation((ids: number[]) => {
            const map = new Map()
            for (const id of ids) {
                if (id === 2) {
                    map.set(2, [{ relationshipType: 'references', fromEntryId: 2, toEntryId: 3 }])
                } else {
                    map.set(id, [])
                }
            }
            return map
        })

        const result = await exportEntriesToMarkdown(
            entries as any,
            './export',
            mockDb as any
        )

        expect(result.success).toBe(true)
        expect(result.exported_count).toBe(2)
        expect(result.skipped).toBe(0)
        expect(result.output_dir).toBe(resolve('./export'))

        // Ensure directory was created with the resolved path
        expect(fs.mkdir).toHaveBeenCalledWith(resolve('./export'), {
            recursive: true,
        })

        // Ensure open was called twice (once per entry) with create-or-truncate + 0o600
        expect(fs.open).toHaveBeenCalledTimes(2)
        expect(fs.open).toHaveBeenCalledWith(
            join(resolve('./export'), '1-test-content-one.md'),
            expect.any(Number),
            0o600
        )

        // Ensure the handle wrote content and was closed
        expect(mockHandle.writeFile).toHaveBeenCalledTimes(2)
        expect(mockHandle.close).toHaveBeenCalledTimes(2)

        const firstWriteContent = vi.mocked(mockHandle.writeFile).mock.calls[0][0] as string
        expect(firstWriteContent).toContain('"mj_id": 1')
        expect(firstWriteContent).toContain('Test content one')
        expect(firstWriteContent).toContain('tag1')

        const secondWriteContent = vi.mocked(mockHandle.writeFile).mock.calls[1][0] as string
        expect(secondWriteContent).toContain('"mj_id": 2')
        expect(secondWriteContent).toContain('"author": "Test Author"')
        expect(secondWriteContent).toContain('"target_id": 3')
        expect(secondWriteContent).toContain('"type": "references"')
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

        const result = await exportEntriesToMarkdown(
            entries as any,
            './export',
            mockDb as any
        )

        expect(result.success).toBe(true)
        expect(result.exported_count).toBe(0)
        expect(result.skipped).toBe(1)
        expect(fs.open).not.toHaveBeenCalled()
    })

    it('should reject exporting into the os temp directory', async () => {
        const tmpExportDir = join(tmpdir(), 'export')
        await expect(exportEntriesToMarkdown([], tmpExportDir, mockDb as any)).rejects.toThrow(
            /Path traversal detected|escapes allowed sandbox boundaries/
        )
        expect(fs.mkdir).not.toHaveBeenCalled()
        expect(fs.open).not.toHaveBeenCalled()
    })
})
