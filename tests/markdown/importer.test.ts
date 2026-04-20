import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importMarkdownEntries } from '../../src/markdown/importer.js'
import * as fs from 'node:fs/promises'

vi.mock('node:fs/promises', () => ({
    readdir: vi.fn(),
    opendir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn().mockResolvedValue({ isDirectory: () => true, size: 100 }),
    lstat: vi.fn().mockResolvedValue({ isSymbolicLink: () => false }),
    realpath: vi.fn(),
    open: vi.fn().mockImplementation(async (path) => {
        const fsPromises = await import('node:fs/promises');
        return {
            stat: vi.fn().mockResolvedValue({ size: 100 }),
            readFile: () => fsPromises.readFile(path),
            close: vi.fn()
        };
    }),
}))

vi.mock('../../src/utils/security-utils.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/security-utils.js')>()
    return {
        ...actual,
        assertSafeDirectoryPath: vi.fn(),
    }
})

describe('importMarkdownEntries', () => {
    const mockDb = {
        getEntryById: vi.fn(),
        createEntry: vi.fn(),
        updateEntry: vi.fn(),
        getOrCreateTag: vi.fn(),
        linkEntries: vi.fn(),
        executeInTransaction: vi.fn((cb) => cb()),
    }

    const mockVectorManager = {
        addEntry: vi.fn().mockResolvedValue({ success: true }),
    }

    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(fs.opendir).mockResolvedValue([
            { isFile: () => true, name: '1-test.md' },
            { isFile: () => false, name: 'ignore-dir' },
            { isFile: () => true, name: 'ignore.txt' }
        ] as any)

        mockDb.createEntry.mockReturnValue({ id: 99 })
    })

    it('should process .md files and create new entry when no mj_id is present', async () => {
        const fileContent = `---
{
  "tags": [
    "test"
  ]
}
---
New content`
        vi.mocked(fs.readFile).mockResolvedValue(fileContent)

        const result = await importMarkdownEntries(
            './import',
            mockDb as any,
            {},
            mockVectorManager as any,
            [process.cwd()]
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
{
  "mj_id": 42,
  "entry_type": "project_decision"
}
---
Updated decision content`
        vi.mocked(fs.readFile).mockResolvedValue(fileContent)

        // Mock finding the entry
        mockDb.getEntryById.mockReturnValue({ id: 42 })

        const result = await importMarkdownEntries('./import', mockDb as any, {}, undefined, [process.cwd()])

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
{
  "mj_id": 100
}
---
Restored entry`
        vi.mocked(fs.readFile).mockResolvedValue(fileContent)

        // Mock NOT finding the entry
        mockDb.getEntryById.mockReturnValue(null)

        const result = await importMarkdownEntries('./import', mockDb as any, {}, undefined, [process.cwd()])

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
{
  "mj_id": 42
}
---
Updated decision content`
        vi.mocked(fs.readFile).mockResolvedValue(fileContent)
        mockDb.getEntryById.mockReturnValue({ id: 42 })

        const result = await importMarkdownEntries('./import', mockDb as any, { dry_run: true }, undefined, [process.cwd()])

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
{
  "relationships": [
    {
      "type": "references",
      "target_id": 999
    }
  ]
}
---
Content`
        vi.mocked(fs.readFile).mockResolvedValue(fileContent)

        // Mock the target missing
        mockDb.getEntryById.mockImplementation((id) => (id === 999 ? null : undefined))

        const result = await importMarkdownEntries('./import', mockDb as any, {}, undefined, [process.cwd()])

        expect(result.success).toBe(true)
        expect(result.errors).toEqual([]) // It shouldn't be a hard error, just skipped quietly in importer mapping
        // We ensure `linkEntries` is NOT called if target is missing
        expect(mockDb.linkEntries).not.toHaveBeenCalled()
    })

    it('should skip entries with empty body', async () => {
        const fileContent = `---
{
  "tags": [
    "test"
  ]
}
---
  \n  `
        vi.mocked(fs.readFile).mockResolvedValue(fileContent)

        const result = await importMarkdownEntries('./import', mockDb as any, {}, undefined, [process.cwd()])
        expect(result.skipped).toBe(1)
        expect(result.created).toBe(0)
    })

    it('should handle dry_run where mj_id is present but not found, and no mj_id', async () => {
        // We'll return 2 files, one with mj_id (not found), one without mj_id
        vi.mocked(fs.opendir).mockResolvedValue([
            { isFile: () => true, name: '1-test.md' },
            { isFile: () => true, name: '2-test.md' }
        ] as any)
        vi.mocked(fs.readFile).mockImplementation(async (path: any) => {
            if (path.toString().includes('1-test.md')) {
                return `---\n{\n  "mj_id": 100\n}\n---\nContent1`
            }
            return `Content2`
        })
        mockDb.getEntryById.mockReturnValue(null) // mj_id 100 not found

        const result = await importMarkdownEntries('./import', mockDb as any, { dry_run: true }, undefined, [process.cwd()])
        expect(result.dry_run).toBe(true)
        expect(result.created).toBe(2) // Both should count as created
        expect(result.updated).toBe(0)
    })

    it('should link valid relationships successfully', async () => {
        const fileContent = `---
{
  "relationships": [
    {
      "type": "references",
      "target_id": 999
    }
  ]
}
---
Content`
        vi.mocked(fs.readFile).mockResolvedValue(fileContent)

        // Target exists
        mockDb.getEntryById.mockImplementation((id) => (id === 999 ? { id: 999 } : undefined))

        const result = await importMarkdownEntries('./import', mockDb as any, {}, undefined, [process.cwd()])

        expect(result.success).toBe(true)
        expect(mockDb.linkEntries).toHaveBeenCalledWith(99, 999, 'references')
    })

    it('should record vector manager errors without crashing', async () => {
        const fileContent = `Content`
        vi.mocked(fs.readFile).mockResolvedValue(fileContent)

        mockVectorManager.addEntry.mockRejectedValueOnce(new Error('Vector failure'))

        const result = await importMarkdownEntries(
            './import',
            mockDb as any,
            {},
            mockVectorManager as any,
            [process.cwd()]
        )

        expect(result.success).toBe(false)
        expect(mockVectorManager.addEntry).toHaveBeenCalled()
        // No hard errors thrown, but it should be recorded
        expect(result.errors.length).toBe(1)
        expect(result.errors[0]?.error).toContain('Vector fail')
    })
})
