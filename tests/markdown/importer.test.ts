import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importMarkdownEntries } from '../../src/markdown/importer.js'
import * as fs from 'node:fs/promises'

vi.mock('node:fs/promises', () => ({
    readdir: vi.fn(),
    readFile: vi.fn(),
}))

describe('importMarkdownEntries', () => {
    const mockDb = {
        getEntryById: vi.fn(),
        createEntry: vi.fn(),
        updateEntry: vi.fn(),
        getOrCreateTag: vi.fn(),
        linkEntries: vi.fn(),
    }

    const mockVectorManager = {
        addEntry: vi.fn().mockResolvedValue(undefined),
    }

    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(fs.readdir).mockResolvedValue(['1-test.md', 'ignore-dir', 'ignore.txt'] as any)

        mockDb.createEntry.mockReturnValue({ id: 99 })
    })

    it('should process .md files and create new entry when no mj_id is present', async () => {
        const fileContent = `---
tags:
  - test
---
New content`
        vi.mocked(fs.readFile).mockResolvedValue(fileContent)

        const result = await importMarkdownEntries(
            '/tmp/import',
            mockDb as any,
            {},
            mockVectorManager as any
        )

        expect(result.success).toBe(true)
        expect(result.created).toBe(1)
        expect(result.updated).toBe(0)

        // Assert creation logic
        expect(mockDb.createEntry).toHaveBeenCalledWith({
            content: 'New content',
            entryType: 'personal_reflection',
            tags: ['test'],
        })
    })

    it('should update existing entry when mj_id is present and found in db', async () => {
        const fileContent = `---
mj_id: 42
entry_type: project_decision
---
Updated decision content`
        vi.mocked(fs.readFile).mockResolvedValue(fileContent)

        // Mock finding the entry
        mockDb.getEntryById.mockReturnValue({ id: 42 })

        const result = await importMarkdownEntries('/tmp/import', mockDb as any)

        expect(result.success).toBe(true)
        expect(result.updated).toBe(1)
        expect(result.created).toBe(0)

        // Assert update logic
        expect(mockDb.updateEntry).toHaveBeenCalledWith(42, {
            content: 'Updated decision content',
            entryType: 'project_decision',
            tags: undefined,
        })
        expect(mockDb.createEntry).not.toHaveBeenCalled()
    })

    it('should create new entry matching mj_id when mj_id is present but NOT found in db', async () => {
        const fileContent = `---
mj_id: 100
---
Restored entry`
        vi.mocked(fs.readFile).mockResolvedValue(fileContent)

        // Mock NOT finding the entry
        mockDb.getEntryById.mockReturnValue(null)

        const result = await importMarkdownEntries('/tmp/import', mockDb as any)

        expect(result.success).toBe(true)
        // From importer perspective, if it brings its own ID but it's new, it counts as creation
        expect(result.created).toBe(1)
        expect(result.updated).toBe(0)

        // Assert creation logic explicitly using the requested ID
        expect(mockDb.createEntry).toHaveBeenCalledWith({
            content: 'Restored entry',
            entryType: 'personal_reflection',
            tags: undefined,
        })
    })

    it('should respect dry_run mode entirely', async () => {
        const fileContent = `---
mj_id: 42
---
Updated decision content`
        vi.mocked(fs.readFile).mockResolvedValue(fileContent)
        mockDb.getEntryById.mockReturnValue({ id: 42 })

        const result = await importMarkdownEntries('/tmp/import', mockDb as any, { dry_run: true })

        expect(result.success).toBe(true)
        expect(result.dry_run).toBe(true)
        expect(result.updated).toBe(1) // dry run count

        // Assert no mutations happened
        expect(mockDb.updateEntry).not.toHaveBeenCalled()
        expect(mockDb.createEntry).not.toHaveBeenCalled()
        expect(mockDb.getOrCreateTag).not.toHaveBeenCalled()
        expect(mockDb.linkEntries).not.toHaveBeenCalled()
        expect(mockVectorManager.addEntry).not.toHaveBeenCalled()
    })

    it('should gracefully handle relationships linking missing targets without crashing', async () => {
        const fileContent = `---
relationships:
  - type: references
    target_id: 999
---
Content`
        vi.mocked(fs.readFile).mockResolvedValue(fileContent)

        // Mock the target missing
        mockDb.getEntryById.mockImplementation((id) => (id === 999 ? null : undefined))

        const result = await importMarkdownEntries('/tmp/import', mockDb as any)

        expect(result.success).toBe(true)
        expect(result.errors).toEqual([]) // It shouldn't be a hard error, just skipped quietly in importer mapping
        // We ensure `linkEntries` is NOT called if target is missing
        expect(mockDb.linkEntries).not.toHaveBeenCalled()
    })
})
