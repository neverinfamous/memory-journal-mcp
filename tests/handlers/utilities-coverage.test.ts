import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    rulesResource,
    workflowsResource,
    statisticsResource,
    tagsResource,
} from '../../src/handlers/resources/core/utilities.js'
import * as fs from 'node:fs'

describe('utilities coverage', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('covers rulesResource stat checks and caching', async () => {
        const previousRulesFilePath = process.env['RULES_FILE_PATH']
        process.env['RULES_FILE_PATH'] = 'dummy/path'

        try {
            let time = Date.now()
            vi.spyOn(Date, 'now').mockImplementation(() => time)
            vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 1234 } as any)
            const readFileSpy = vi.spyOn(fs.promises, 'readFile').mockResolvedValue('rules content')

            // 1. Initial read
            const result = await rulesResource.handler('mem', {} as any)
            expect(result.data).toBe('rules content')

            // 2. Cache hit (advance time by 1ms)
            time += 1
            readFileSpy.mockResolvedValue('should not happen')
            const result2 = await rulesResource.handler('mem', {} as any)
            expect(result2.data).toBe('rules content')

            // 3. Error handling (cache expired)
            time += 10 * 60 * 1000
            readFileSpy.mockRejectedValue('String error read')
            const errResult = await rulesResource.handler('mem', {} as any)
            expect((errResult.data as any).error).toContain('String error read')
        } finally {
            if (previousRulesFilePath === undefined) {
                delete process.env['RULES_FILE_PATH']
            } else {
                process.env['RULES_FILE_PATH'] = previousRulesFilePath
            }
        }
    })

    it('covers workflowsResource when fallback to process.env is needed', () => {
        const previousWorkflowSummary = process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY']
        try {
            process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY'] = 'test workflow summary'
            const result = workflowsResource.handler('mem', {} as any)
            expect((result.data as any).summary).toBe('test workflow summary')

            delete process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY']
            const result2 = workflowsResource.handler('mem', {} as any)
            expect((result2.data as any).configured).toBe(false)
        } finally {
            if (previousWorkflowSummary === undefined) {
                delete process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY']
            } else {
                process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY'] = previousWorkflowSummary
            }
        }
    })

    it('covers statisticsResource', () => {
        const mockDb = { getStatistics: vi.fn().mockReturnValue({ total: 5 }) }
        const result = statisticsResource.handler('mem', { db: mockDb } as any)
        expect((result as any).total).toBe(5)
    })

    it('covers tagsResource', () => {
        const mockDb = {
            listTags: vi.fn().mockReturnValue([{ id: 1, name: 'tag1', usageCount: 5 }]),
        }
        const result = tagsResource.handler('mem', { db: mockDb } as any)
        expect((result as any).count).toBe(1)
        expect((result as any).tags[0].name).toBe('tag1')
    })
})
