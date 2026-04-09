import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rulesResource, workflowsResource, statisticsResource, tagsResource } from '../../src/handlers/resources/core/utilities.js'
import * as fs from 'node:fs'

describe('utilities coverage', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('covers rulesResource stat checks and caching', async () => {
        process.env['RULES_FILE_PATH'] = 'dummy/path'
        
        let time = Date.now()
        vi.spyOn(Date, 'now').mockImplementation(() => time)
        vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 1234 } as any)
        vi.spyOn(fs.promises, 'readFile').mockResolvedValue('rules content')
        
        // 1. Initial read
        const result = await rulesResource.handler('mem', {} as any)
        expect(typeof result.data).toBe('string')
        expect(result.data).toBe('rules content')

        // 2. Cache hit (advance time by 1ms)
        time += 1
        vi.spyOn(fs.promises, 'readFile').mockResolvedValue('should not happen')
        const result2 = await rulesResource.handler('mem', {} as any)
        expect(result2.data).toBe('rules content')
        
        // 3. Complete error handling
        vi.spyOn(fs.promises, 'stat').mockRejectedValue('String error stat')
        const errResult = await rulesResource.handler('mem', {} as any)
        expect((errResult.data as any).error).toContain('String error')
    })

    it('covers workflowsResource when fallback to process.env is needed', () => {
        process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY'] = 'test workflow summary'
        const result = workflowsResource.handler('mem', {} as any)
        expect((result.data as any).summary).toBe('test workflow summary')
        
        delete process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY']
        const result2 = workflowsResource.handler('mem', {} as any)
        expect((result2.data as any).configured).toBe(false)
    })
    
    it('covers statisticsResource', () => {
        const mockDb = { getStatistics: vi.fn().mockReturnValue({ total: 5 }) }
        const result = statisticsResource.handler('mem', { db: mockDb } as any)
        expect((result as any).total).toBe(5)
    })
    
    it('covers tagsResource', () => {
        const mockDb = { listTags: vi.fn().mockReturnValue([{ id: 1, name: 'tag1', usageCount: 5 }]) }
        const result = tagsResource.handler('mem', { db: mockDb } as any)
        expect((result as any).count).toBe(1)
        expect((result as any).tags[0].name).toBe('tag1')
    })
})
