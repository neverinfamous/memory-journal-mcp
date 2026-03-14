/**
 * memory-journal-mcp — Export Tools Unit Tests
 *
 * Tests for getExportTools: export_entries handler
 * covering JSON/Markdown formats, date/tag filters, and error paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/error-helpers.js', () => ({
    formatHandlerError: vi.fn().mockImplementation((err: Error) => ({
        success: false,
        error: err.message,
    })),
}))

vi.mock('../../src/utils/progress-utils.js', () => ({
    sendProgress: vi.fn().mockResolvedValue(undefined),
}))

import { getExportTools } from '../../src/handlers/tools/export.js'

// ============================================================================
// Helpers
// ============================================================================

function createMockEntries(count = 3) {
    return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        timestamp: `2025-01-${String(15 - i).padStart(2, '0')}T10:00:00Z`,
        entryType: 'note',
        content: `Entry ${String(i + 1)} content`,
        tags: ['test'],
    }))
}

function createMockContext(dbOverrides: Partial<Record<string, unknown>> = {}) {
    return {
        db: {
            getRecentEntries: vi.fn().mockReturnValue(createMockEntries()),
            searchByDateRange: vi.fn().mockReturnValue(createMockEntries(2)),
            ...dbOverrides,
        },
        progress: null,
    }
}

// ============================================================================
// Tests
// ============================================================================

describe('getExportTools', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should define export_entries tool', () => {
        const context = createMockContext()
        const tools = getExportTools(context as never)

        expect(tools).toHaveLength(1)
        expect(tools[0]!.name).toBe('export_entries')
        expect(tools[0]!.group).toBe('export')
    })

    // ========================================================================
    // JSON format
    // ========================================================================

    it('should export entries as JSON by default', async () => {
        const context = createMockContext()
        const tools = getExportTools(context as never)
        const handler = tools[0]!.handler

        const result = (await handler({})) as Record<string, unknown>

        expect(result['format']).toBe('json')
        expect(result['entries']).toHaveLength(3)
        expect(context.db.getRecentEntries).toHaveBeenCalledWith(100) // default limit
    })

    it('should respect custom limit', async () => {
        const context = createMockContext()
        const tools = getExportTools(context as never)
        const handler = tools[0]!.handler

        await handler({ limit: 10 })

        expect(context.db.getRecentEntries).toHaveBeenCalledWith(10)
    })

    // ========================================================================
    // Markdown format
    // ========================================================================

    it('should export entries as Markdown', async () => {
        const context = createMockContext()
        const tools = getExportTools(context as never)
        const handler = tools[0]!.handler

        const result = (await handler({ format: 'markdown' })) as Record<string, unknown>

        expect(result['format']).toBe('markdown')
        expect(result['content']).toBeDefined()
        const content = result['content'] as string
        expect(content).toContain('## 2025-01-15T10:00:00Z')
        expect(content).toContain('**Type:** note')
        expect(content).toContain('Entry 1 content')
    })

    // ========================================================================
    // Date range filtering
    // ========================================================================

    it('should filter by date range when start_date provided', async () => {
        const context = createMockContext()
        const tools = getExportTools(context as never)
        const handler = tools[0]!.handler

        await handler({ start_date: '2025-01-10' })

        expect(context.db.searchByDateRange).toHaveBeenCalledWith(
            '2025-01-10',
            expect.any(String),
            expect.objectContaining({ limit: 100 })
        )
    })

    it('should filter by date range when end_date provided', async () => {
        const context = createMockContext()
        const tools = getExportTools(context as never)
        const handler = tools[0]!.handler

        await handler({ end_date: '2025-01-20' })

        expect(context.db.searchByDateRange).toHaveBeenCalledWith(
            expect.any(String),
            '2025-01-20',
            expect.objectContaining({ limit: 100 })
        )
    })

    // ========================================================================
    // Tag filtering
    // ========================================================================

    it('should filter by tags using searchByDateRange', async () => {
        const context = createMockContext()
        const tools = getExportTools(context as never)
        const handler = tools[0]!.handler

        await handler({ tags: ['important', 'review'] })

        expect(context.db.searchByDateRange).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(String),
            expect.objectContaining({ tags: ['important', 'review'] })
        )
    })

    // ========================================================================
    // Entry type filtering
    // ========================================================================

    it('should post-filter by entry_types', async () => {
        const entries = [
            { id: 1, timestamp: '2025-01-15', entryType: 'note', content: 'Note' },
            { id: 2, timestamp: '2025-01-14', entryType: 'project_decision', content: 'Decision' },
            { id: 3, timestamp: '2025-01-13', entryType: 'note', content: 'Another note' },
        ]
        const context = createMockContext({
            searchByDateRange: vi.fn().mockReturnValue(entries),
        })
        const tools = getExportTools(context as never)
        const handler = tools[0]!.handler

        const result = (await handler({
            format: 'json',
            entry_types: ['project_decision'],
        })) as Record<string, unknown>

        expect(result['format']).toBe('json')
        expect(result['entries']).toHaveLength(1)
        expect((result['entries'] as Record<string, unknown>[])[0]!['entryType']).toBe(
            'project_decision'
        )
    })

    // ========================================================================
    // Error handling
    // ========================================================================

    it('should handle invalid format gracefully via formatHandlerError', async () => {
        const context = createMockContext()
        const tools = getExportTools(context as never)
        const handler = tools[0]!.handler

        // Invalid date format should cause Zod parse error
        const result = (await handler({ start_date: 'not-a-date' })) as Record<string, unknown>

        expect(result['success']).toBe(false)
    })
})
